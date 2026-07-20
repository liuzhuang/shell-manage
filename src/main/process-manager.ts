import { exec, spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'
import type { CommandConfig, ProcessOutputPayload, ProcessStatusPayload } from '../shared/types'
import { terminateProcessTreeWithEscalation } from './process-tree'
import { resolveServiceArgs, resolveShellExecutable } from './shell-runtime'

interface ProcessRecord {
  child?: ChildProcess
  starting?: boolean
  restarts: number
  configHash: string
  stopping?: boolean
  pendingRestart?: CommandConfig
  health?: HealthMonitorState
  conflictPort?: number
}

interface HealthMonitorState {
  healthy: boolean
  failures: number
  pattern?: RegExp
  intervalTimer?: NodeJS.Timeout
  graceTimer?: NodeJS.Timeout
  inFlight?: boolean
}

type StatusEmitter = (payload: ProcessStatusPayload) => void
type OutputEmitter = (payload: ProcessOutputPayload) => void

export class ProcessManager {
  private processMap = new Map<string, ProcessRecord>()
  private execAsync = promisify(exec)

  constructor(
    private emitStatus: StatusEmitter,
    private emitOutput: OutputEmitter
  ) {}

  private hashCommand(config: CommandConfig): string {
    return JSON.stringify({
      command: config.command,
      tags: config.tags,
      mode: config.mode,
      sshKeyId: config.sshKeyId,
      autoRestart: config.autoRestart,
      maxRestarts: config.maxRestarts,
      healthCheck: config.healthCheck
    })
  }

  syncConfig(commands: CommandConfig[]): void {
    const commandNames = new Set(commands.map((c) => c.name))
    for (const [name, record] of this.processMap) {
      if (!commandNames.has(name) && record.child) {
        this.emitStatus({ commandName: name, state: 'running', message: '配置删除，建议停止此进程' })
      }
    }
    for (const cmd of commands) {
      const old = this.processMap.get(cmd.name)
      const newHash = this.hashCommand(cmd)
      if (old?.child && old.configHash !== newHash) {
        this.emitStatus({ commandName: cmd.name, state: 'running', configChanged: true, message: '配置已变更，需重启生效' })
      }
      if (!old) this.processMap.set(cmd.name, { restarts: 0, configHash: newHash })
      else old.configHash = newHash
    }
  }

  getState(name: string): ProcessStatusPayload {
    const rec = this.processMap.get(name)
    if (rec?.child?.pid) return { commandName: name, state: 'running', pid: rec.child.pid, restarts: rec.restarts }
    return { commandName: name, state: 'idle', restarts: rec?.restarts ?? 0 }
  }

  start(config: CommandConfig): void {
    void this.startInternal(config)
  }

  private async startInternal(config: CommandConfig): Promise<void> {
    const record = this.processMap.get(config.name) ?? {
      restarts: 0,
      configHash: this.hashCommand(config)
    }
    if (record.child?.pid || record.starting) return
    record.starting = true
    this.processMap.set(config.name, record)
    // 先立即反馈“启动中”，避免预清理期间 UI 体感卡顿。
    this.emitStatus({
      commandName: config.name,
      state: 'running',
      restarts: record.restarts,
      message: '启动中，正在预检查环境...'
    })
    try {
      const cleaned = await this.cleanupExternalConflictsBeforeStart(config)
      if (cleaned.killedRootPids.length > 0) {
        this.emitStatus({
          commandName: config.name,
          state: 'running',
          restarts: record.restarts,
          message: `启动前清理到 ${cleaned.killedRootPids.length} 个残留进程，避免重复实例`
        })
      }
    } catch {
      // Preflight cleanup is best-effort; should not block start.
    } finally {
      record.starting = false
    }
    if (record.child?.pid) return
    record.stopping = false
    record.conflictPort = undefined
    this.clearHealthMonitor(record)

    const shellExec = resolveShellExecutable()
    const shellArgs = resolveServiceArgs(shellExec, config.command)
    const child = spawn(shellExec, shellArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })

    record.child = child
    this.processMap.set(config.name, record)
    this.emitStatus({ commandName: config.name, state: 'running', pid: child.pid, restarts: record.restarts })

    child.stdout?.on('data', (buf) => {
      const line = String(buf)
      this.emitOutput({ commandName: config.name, line, stream: 'stdout', at: Date.now() })
      this.captureConflictPort(record, line)
      this.onProcessOutputForHealth(config, record, line)
    })
    child.stderr?.on('data', (buf) => {
      const line = String(buf)
      this.emitOutput({ commandName: config.name, line, stream: 'stderr', at: Date.now() })
      this.captureConflictPort(record, line)
      this.onProcessOutputForHealth(config, record, line)
    })
    this.startHealthMonitor(config, record, child)
    child.on('exit', async (code, signal) => {
      const wasStopping = Boolean(record.stopping)
      const restartAfterStop = record.pendingRestart
      record.stopping = false
      record.starting = false
      record.pendingRestart = undefined
      record.child = undefined
      this.clearHealthMonitor(record)

      if (restartAfterStop) {
        this.emitStatus({
          commandName: config.name,
          state: 'restarting',
          restarts: record.restarts,
          message: '手动重启中'
        })
        this.start(restartAfterStop)
        return
      }

      // SIGTERM/SIGKILL after manual stop should be treated as clean stop.
      if (wasStopping || signal === 'SIGTERM' || signal === 'SIGKILL') {
        this.emitStatus({
          commandName: config.name,
          state: 'idle',
          restarts: record.restarts,
          message: '已手动停止'
        })
        return
      }

      const shouldRestart = Boolean(config.autoRestart) && code !== 0 && record.restarts < (config.maxRestarts ?? 3)
      if (shouldRestart) {
        record.restarts += 1
        let restartMessage = `异常退出，准备重启（${record.restarts}/${config.maxRestarts ?? 3}）`
        if (record.restarts > 1 && record.conflictPort) {
          const released = await this.releasePortIfOccupied(record.conflictPort)
          if (released.listenerPids.length > 0) {
            restartMessage = `检测到端口 :${record.conflictPort} 占用，已清理 ${released.rootPids.length} 个主进程，准备重启（${record.restarts}/${config.maxRestarts ?? 3}）`
          }
        }
        this.emitStatus({
          commandName: config.name,
          state: 'restarting',
          restarts: record.restarts,
          message: restartMessage
        })
        setTimeout(() => this.start(config), 1500)
        return
      }
      this.emitStatus({
        commandName: config.name,
        state: code === 0 ? 'idle' : 'error',
        restarts: record.restarts,
        exitCode: code ?? undefined,
        message: code === 0 ? '已停止' : `退出码 ${code ?? -1}`
      })
    })
  }

  stop(name: string): void {
    const record = this.processMap.get(name)
    if (!record?.child?.pid) return
    const pid = record.child.pid
    record.stopping = true
    this.emitStatus({ commandName: name, state: 'running', pid, restarts: record.restarts, message: '停止中...' })
    void this.stopProcessTree(name, record, pid)
  }

  restart(config: CommandConfig): void {
    const record = this.processMap.get(config.name)
    if (!record?.child?.pid) {
      this.start(config)
      return
    }
    record.pendingRestart = config
    this.stop(config.name)
  }

  async stopAllRunning(): Promise<void> {
    const tasks: Array<Promise<void>> = []
    for (const [name, record] of this.processMap) {
      const pid = record.child?.pid
      if (!pid) continue
      record.stopping = true
      record.pendingRestart = undefined
      this.emitStatus({ commandName: name, state: 'running', pid, restarts: record.restarts, message: '应用退出中，正在停止...' })
      tasks.push(this.stopProcessTree(name, record, pid))
    }
    if (tasks.length === 0) return
    await Promise.allSettled(tasks)
  }

  private async stopProcessTree(name: string, record: ProcessRecord, pid: number): Promise<void> {
    const child = record.child
    if (!child) return
    let exited = false
    const onExit = () => {
      exited = true
    }
    child.once('exit', onExit)
    try {
      await terminateProcessTreeWithEscalation(pid, () => exited || record.child !== child, 1200)
      if (!exited && record.child === child) {
        this.emitStatus({
          commandName: name,
          state: 'running',
          pid,
          restarts: record.restarts,
          message: '已发送强制终止信号，等待进程退出事件...'
        })
      }
    } finally {
      child.removeListener('exit', onExit)
    }
  }

  private onProcessOutputForHealth(config: CommandConfig, record: ProcessRecord, line: string): void {
    const check = config.healthCheck
    const monitor = record.health
    if (!check || check.type !== 'log' || !monitor?.pattern || !record.child?.pid) return
    monitor.pattern.lastIndex = 0
    if (!monitor.pattern.test(line)) return
    if (!monitor.healthy) {
      monitor.healthy = true
      monitor.failures = 0
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: record.child.pid,
        restarts: record.restarts,
        message: `健康检查通过：检测到日志 "${check.pattern ?? ''}"`
      })
    }
  }

  private startHealthMonitor(config: CommandConfig, record: ProcessRecord, child: ChildProcess): void {
    const check = config.healthCheck
    if (!check || (config.mode || 'service') !== 'service') return
    const monitor: HealthMonitorState = { healthy: false, failures: 0 }
    record.health = monitor
    const graceMs = Math.max(1, check.startupGraceSec ?? 12) * 1000

    if (check.type === 'log') {
      const pattern = this.compileHealthPattern(check.pattern)
      if (!pattern) {
        this.emitStatus({
          commandName: config.name,
          state: 'running',
          pid: child.pid,
          restarts: record.restarts,
          message: '健康检查配置无效：log 模式缺少可用 pattern'
        })
        return
      }
      monitor.pattern = pattern
      monitor.graceTimer = setTimeout(() => {
        if (record.child !== child || monitor.healthy) return
        this.emitStatus({
          commandName: config.name,
          state: 'running',
          pid: child.pid,
          restarts: record.restarts,
          message: `健康检查未通过：${check.startupGraceSec ?? 12}s 内未检测到日志 "${check.pattern}"`
        })
      }, graceMs)
      return
    }

    const host = check.host || '127.0.0.1'
    const port = check.port
    if (!port || !Number.isFinite(port) || port <= 0 || port > 65535) {
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: child.pid,
        restarts: record.restarts,
        message: '健康检查配置无效：port 模式需要合法 port'
      })
      return
    }
    const intervalMs = Math.max(1, check.intervalSec ?? 5) * 1000
    const failureThreshold = Math.max(1, check.failureThreshold ?? 2)
    const runCheck = async () => {
      if (monitor.inFlight || record.child !== child) return
      monitor.inFlight = true
      try {
        const ok = await this.probeTcpPort(host, port)
        if (record.child !== child) return
        if (ok) {
          const wasUnhealthy = !monitor.healthy
          monitor.healthy = true
          monitor.failures = 0
          if (wasUnhealthy) {
            this.emitStatus({
              commandName: config.name,
              state: 'running',
              pid: child.pid,
              restarts: record.restarts,
              message: `健康检查通过：${host}:${port} 可连接`
            })
          }
          return
        }
        monitor.failures += 1
        if (monitor.failures >= failureThreshold && monitor.healthy) {
          monitor.healthy = false
          this.emitStatus({
            commandName: config.name,
            state: 'running',
            pid: child.pid,
            restarts: record.restarts,
            message: `健康检查告警：连续 ${monitor.failures} 次无法连接 ${host}:${port}`
          })
        }
      } finally {
        monitor.inFlight = false
      }
    }

    monitor.graceTimer = setTimeout(() => {
      if (record.child !== child || monitor.healthy || monitor.failures < failureThreshold) return
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: child.pid,
        restarts: record.restarts,
        message: `健康检查未通过：${check.startupGraceSec ?? 12}s 内无法连接 ${host}:${port}`
      })
    }, graceMs)
    void runCheck()
    monitor.intervalTimer = setInterval(() => {
      void runCheck()
    }, intervalMs)
  }

  private clearHealthMonitor(record: ProcessRecord): void {
    if (!record.health) return
    if (record.health.intervalTimer) clearInterval(record.health.intervalTimer)
    if (record.health.graceTimer) clearTimeout(record.health.graceTimer)
    record.health = undefined
  }

  private compileHealthPattern(raw?: string): RegExp | undefined {
    if (!raw || !raw.trim()) return undefined
    try {
      return new RegExp(raw)
    } catch {
      return undefined
    }
  }

  private captureConflictPort(record: ProcessRecord, line: string): void {
    const upper = line.toUpperCase()
    if (!upper.includes('EADDRINUSE') && !upper.includes('ADDRESS ALREADY IN USE') && !line.includes('端口被占用')) return
    const port = this.extractPortFromLine(line)
    if (!port) return
    record.conflictPort = port
  }

  private extractPortFromLine(line: string): number | undefined {
    const patterns = [/:::(\d{2,5})\b/, /\[::\]:(\d{2,5})\b/, /:\s*(\d{2,5})\b/, /\bport\s+(\d{2,5})\b/i, /端口\s*(\d{2,5})/]
    for (const pattern of patterns) {
      const matched = line.match(pattern)
      if (!matched) continue
      const port = Number.parseInt(matched[1], 10)
      if (Number.isFinite(port) && port > 0 && port <= 65535) return port
    }
    return undefined
  }

  private async releasePortIfOccupied(port: number): Promise<{ listenerPids: number[]; rootPids: number[] }> {
    const listenerPids = await this.findListeningPidsByPort(port)
    if (listenerPids.length === 0) return { listenerPids: [], rootPids: [] }
    const rootPids = await this.resolveTerminationRoots(listenerPids)
    for (const pid of rootPids) {
      await terminateProcessTreeWithEscalation(pid, () => !this.isPidAlive(pid), 900)
    }
    return { listenerPids, rootPids }
  }

  private async findListeningPidsByPort(port: number): Promise<number[]> {
    try {
      const { stdout } = await this.execAsync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`)
      const pidSet = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const value = Number.parseInt(line.trim(), 10)
        if (Number.isFinite(value) && value > 0) pidSet.add(value)
      }
      return [...pidSet]
    } catch {
      return []
    }
  }

  private async resolveTerminationRoots(pids: number[]): Promise<number[]> {
    const cache = new Map<number, { pid: number; ppid: number; name: string; command: string } | undefined>()
    const rootSet = new Set<number>()
    for (const pid of pids) {
      const root = await this.resolveTerminationRootInfo(pid, cache)
      if (root?.pid) rootSet.add(root.pid)
    }
    return [...rootSet]
  }

  private async resolveTerminationRootInfo(
    pid: number,
    cache: Map<number, { pid: number; ppid: number; name: string; command: string } | undefined>
  ): Promise<{ pid: number; ppid: number; name: string; command: string } | undefined> {
    let current = await this.getProcessBasicInfo(pid, cache)
    if (!current) return undefined
    for (let hop = 0; hop < 24; hop += 1) {
      if (!current.ppid || current.ppid <= 1) break
      const parent = await this.getProcessBasicInfo(current.ppid, cache)
      if (!parent) break
      if (!this.isSameExecutableProcess(current.command, current.name, parent.command, parent.name)) break
      current = parent
    }
    return current
  }

  private async getProcessBasicInfo(
    pid: number,
    cache: Map<number, { pid: number; ppid: number; name: string; command: string } | undefined>
  ): Promise<{ pid: number; ppid: number; name: string; command: string } | undefined> {
    if (!Number.isFinite(pid) || pid <= 0) return undefined
    if (cache.has(pid)) return cache.get(pid)
    try {
      const { stdout } = await this.execAsync(`ps -p ${pid} -o ppid=,comm=,command= 2>/dev/null || true`)
      const line = stdout.trim()
      if (!line) {
        cache.set(pid, undefined)
        return undefined
      }
      const matched = line.match(/^\s*(\d+)\s+(\S+)\s+([\s\S]+)$/)
      if (!matched) {
        cache.set(pid, undefined)
        return undefined
      }
      const info = {
        pid,
        ppid: Number.parseInt(matched[1], 10) || 0,
        name: matched[2]?.trim() || 'unknown',
        command: matched[3]?.trim() || ''
      }
      if (!info.command) {
        cache.set(pid, undefined)
        return undefined
      }
      cache.set(pid, info)
      return info
    } catch {
      cache.set(pid, undefined)
      return undefined
    }
  }

  private isSameExecutableProcess(currentCommand: string, currentName: string, parentCommand: string, parentName: string): boolean {
    const normalize = (command: string, fallbackName: string) => {
      const firstToken = command.trim().split(/\s+/)[0] || ''
      const byToken = firstToken.split('/').pop() || ''
      return (byToken || fallbackName || '').trim().toLowerCase()
    }
    return normalize(currentCommand, currentName) === normalize(parentCommand, parentName)
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private probeTcpPort(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port })
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(1200)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
      socket.once('close', () => {
        if (!done) finish(false)
      })
    })
  }

  private async cleanupExternalConflictsBeforeStart(config: CommandConfig): Promise<{ killedRootPids: number[]; explicitPort?: number }> {
    const explicitPort = this.extractExplicitPort(config.command)
    const killedRootPids = new Set<number>()
    if (explicitPort) {
      const released = await this.releasePortIfOccupied(explicitPort)
      for (const pid of released.rootPids) killedRootPids.add(pid)
    }
    const cwd = this.extractLeadingCwd(config.command)
    if (cwd) {
      const relatedListenerPids = await this.findListenerPidsByCwd(cwd)
      const roots = await this.resolveTerminationRoots(relatedListenerPids)
      for (const pid of roots) {
        await terminateProcessTreeWithEscalation(pid, () => !this.isPidAlive(pid), 900)
        killedRootPids.add(pid)
      }
    }
    const killed = [...killedRootPids]
    return { killedRootPids: killed, explicitPort }
  }

  private extractExplicitPort(command: string): number | undefined {
    const matched = command.match(/\bPORT\s*=\s*(\d{2,5})\b/i)
    if (!matched) return undefined
    const port = Number.parseInt(matched[1], 10)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return undefined
    return port
  }

  private extractLeadingCwd(command: string): string | undefined {
    const matched = command.match(/^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s&;]+))\s*&&/)
    const raw = matched?.[2] || matched?.[3] || matched?.[4]
    return raw?.trim() || undefined
  }

  private async findListenerPidsByCwd(cwd: string): Promise<number[]> {
    const pids = await this.findPidsByCwd(cwd)
    const pidSet = new Set<number>()
    for (const pid of pids) {
      if (pid === process.pid) continue
      const info = await this.getProcessBasicInfo(pid, new Map())
      if (!info?.command) continue
      if (!this.containsPathInsensitive(info.command, cwd)) continue
      const ports = await this.findListeningPortsByPid(pid)
      if (ports.length > 0) pidSet.add(pid)
    }
    const allListeningPids = await this.findAllListeningPids()
    for (const pid of allListeningPids) {
      if (pid === process.pid) continue
      const processCwd = await this.getProcessCwdByPid(pid)
      if (!processCwd) continue
      if (!this.samePathInsensitive(processCwd, cwd)) continue
      pidSet.add(pid)
    }
    return [...pidSet]
  }

  private async findPidsByCwd(cwd: string): Promise<number[]> {
    const escaped = JSON.stringify(cwd)
    const { stdout } = await this.execAsync(`pgrep -fi -- ${escaped} 2>/dev/null || true`)
    return stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  }

  private async findAllListeningPids(): Promise<number[]> {
    try {
      const { stdout } = await this.execAsync('lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null || true')
      return stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0)
    } catch {
      return []
    }
  }

  private async findListeningPortsByPid(pid: number): Promise<number[]> {
    try {
      const { stdout } = await this.execAsync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null || true`)
      const portSet = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const matched = line.match(/:(\d{1,5})\s+\(LISTEN\)\s*$/)
        if (!matched) continue
        const port = Number.parseInt(matched[1], 10)
        if (Number.isFinite(port) && port > 0 && port <= 65535) portSet.add(port)
      }
      return [...portSet]
    } catch {
      return []
    }
  }

  private async getProcessCwdByPid(pid: number): Promise<string | undefined> {
    try {
      const { stdout } = await this.execAsync(`lsof -a -d cwd -p ${pid} 2>/dev/null || true`)
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const idx = trimmed.indexOf(' /')
        if (idx < 0) continue
        const cwd = trimmed.slice(idx + 1).trim()
        if (cwd.startsWith('/')) return cwd
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private containsPathInsensitive(text: string, path: string): boolean {
    return text.toLowerCase().includes(path.toLowerCase())
  }

  private samePathInsensitive(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }

}
