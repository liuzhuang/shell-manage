import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { devNull } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  CommandConfig,
  CommandPublicAccessProvider,
  CommandPublicAccessStatusPayload
} from '../shared/types'
import { buildChildProcessEnvironment } from './child-process-env'
import { ProcessManager } from './process-manager'
import { killProcessTree, terminateProcessTreeWithEscalation } from './process-tree'
import { extractLeadingWorkingDirectory } from './shell-runtime'

type StatusEmitter = (payload: CommandPublicAccessStatusPayload) => void

interface ActiveCli {
  child: ChildProcess
  commandName: string
  provider: CommandPublicAccessProvider
  sourceCommand?: string
  targetOrigin?: string
  exited: boolean
  expectedStop: boolean
  failureMessage?: string
}

interface PersistedVercelDeployment {
  projectRoot: string
  projectId: string
  orgId: string
  url: string
}

type VercelProjectLink = Pick<PersistedVercelDeployment, 'projectId' | 'orgId'>

const TUNNEL_START_TIMEOUT_MS = 30_000
const LOCAL_SERVICE_READY_TIMEOUT_MS = 3_000
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

export class CommandPublicAccessManager {
  private active = new Map<string, ActiveCli>()
  private statuses = new Map<string, CommandPublicAccessStatusPayload>()
  private commandsByName = new Map<string, CommandConfig>()
  private persistedVercelDeployments = new Map<string, PersistedVercelDeployment>()
  private restoredVercelStatusKeys = new Set<string>()

  constructor(
    private processManager: ProcessManager,
    private emitStatus: StatusEmitter,
    private storagePath?: string
  ) {
    this.loadPersistedVercelDeployments()
  }

  list(commandName?: string): CommandPublicAccessStatusPayload[] {
    return [...this.statuses.values()].filter((item) => !commandName || item.commandName === commandName)
  }

  start(command: CommandConfig, provider: CommandPublicAccessProvider): Promise<CommandPublicAccessStatusPayload> {
    if (provider === 'vercel') return this.deployVercel(command)
    return this.startTunnel(command, provider)
  }

  async stop(commandName: string, provider: CommandPublicAccessProvider): Promise<void> {
    if (provider === 'vercel') throw new Error('Vercel 是云端发布，发布后不依赖本机，不能通过停止本地进程撤回')
    const record = this.active.get(this.key(commandName, provider))
    if (!record || record.expectedStop) return
    record.expectedStop = true
    this.publish({ commandName, provider, phase: 'stopping', pid: record.child.pid, message: '正在停止临时链接…' })
    await this.terminate(record)
  }

  syncCommands(commands: CommandConfig[]): void {
    const commandsByName = new Map(commands.map((command) => [command.name, command]))
    this.commandsByName = commandsByName
    this.restoreVercelStatuses(commands)
    for (const record of this.active.values()) {
      if (record.provider === 'vercel' || record.expectedStop) continue
      const command = commandsByName.get(record.commandName)
      let targetOrigin: string | undefined
      try {
        if (command && (command.mode || 'service') === 'service') {
          targetOrigin = resolveLoopbackTarget(command).origin
        }
      } catch {
        // Invalid or removed targets must no longer remain publicly reachable.
      }
      if (command?.command !== record.sourceCommand || targetOrigin !== record.targetOrigin) {
        void this.stop(record.commandName, record.provider)
      }
    }
  }

  async stopTunnelsForCommand(commandName: string): Promise<void> {
    const records = [...this.active.values()].filter(
      (item) => item.commandName === commandName && item.provider !== 'vercel'
    )
    await Promise.allSettled(records.map((item) => this.stop(item.commandName, item.provider)))
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.active.values()].map(async (record) => {
        record.expectedStop = true
        if (record.provider === 'vercel') {
          const pid = record.child.pid
          if (pid) await terminateProcessTreeWithEscalation(pid, () => record.exited, 900)
          return
        }
        await this.terminate(record)
      })
    )
  }

  private async deployVercel(command: CommandConfig): Promise<CommandPublicAccessStatusPayload> {
    const key = this.key(command.name, 'vercel')
    if (this.active.has(key)) throw new Error('该命令正在发布到 Vercel')
    const projectRoot = resolveVercelProjectRoot(command.command)
    const projectLink = readVercelProjectLink(projectRoot)
    if (!projectLink) {
      throw new Error('项目尚未关联 Vercel。请先复制配置 Prompt 交给 AI 完成登录、检查与 link，ShellManage 不会自动创建项目。')
    }

    this.publish({ commandName: command.name, provider: 'vercel', phase: 'starting', message: '正在发布生产版本…' })
    const child = spawn(
      'vercel',
      ['deploy', '--prod', '--yes', '--non-interactive', '--no-color', '--format=json'],
      {
        cwd: projectRoot,
        env: buildChildProcessEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      }
    )
    const record: ActiveCli = {
      child,
      commandName: command.name,
      provider: 'vercel',
      exited: false,
      expectedStop: false
    }
    this.active.set(key, record)
    this.publish({ commandName: command.name, provider: 'vercel', phase: 'starting', pid: child.pid, message: '正在发布生产版本…' })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout = appendOutput(stdout, String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendOutput(stderr, String(chunk))
    })

    return await new Promise((resolve, reject) => {
      let settled = false
      const fail = (message: string) => {
        if (settled) return
        settled = true
        this.active.delete(key)
        const status = this.publish({ commandName: command.name, provider: 'vercel', phase: 'error', message })
        reject(new Error(status.message))
      }
      child.once('error', (error) => fail(formatSpawnError('vercel', error)))
      child.once('close', async (code) => {
        record.exited = true
        if (settled) return
        settled = true
        if (code !== 0) {
          this.active.delete(key)
          const message = summarizeCliError(stderr || stdout, `Vercel 发布失败（退出码 ${code ?? -1}）`)
          this.publish({ commandName: command.name, provider: 'vercel', phase: 'error', message })
          reject(new Error(message))
          return
        }
        const url = extractVercelUrl(stdout, stderr)
        if (!url) {
          this.active.delete(key)
          const message = 'Vercel 已结束，但没有返回部署链接'
          this.publish({ commandName: command.name, provider: 'vercel', phase: 'error', message })
          reject(new Error(message))
          return
        }
        if (record.expectedStop) {
          this.active.delete(key)
          reject(new Error('应用退出，已停止读取 Vercel 生产域名'))
          return
        }
        const alias = await inspectVercelAlias(projectRoot, url, (inspectChild) => {
          record.child = inspectChild
          record.exited = false
        })
        record.exited = true
        this.active.delete(key)
        if (record.expectedStop) {
          reject(new Error('应用退出，已停止读取 Vercel 生产域名'))
          return
        }
        if (!this.isCurrentVercelCommand(command.name, projectRoot, projectLink)) {
          const message = '命令的项目根目录已变更，本次 Vercel 链接未保存；请确认项目后重新发布'
          this.publish({ commandName: command.name, provider: 'vercel', phase: 'error', message })
          reject(new Error(message))
          return
        }
        const publicUrl = alias || url
        this.persistVercelDeployment(projectRoot, projectLink, publicUrl)
        const status = this.publish({
          commandName: command.name,
          provider: 'vercel',
          phase: 'succeeded',
          url: publicUrl,
          message: alias
            ? '云端生产版本已发布，电脑关闭后仍可访问'
            : '云端版本已发布，但未获取生产域名；当前显示部署地址'
        })
        this.restoredVercelStatusKeys.add(key)
        resolve(status)
      })
    })
  }

  private async startTunnel(
    command: CommandConfig,
    provider: Exclude<CommandPublicAccessProvider, 'vercel'>
  ): Promise<CommandPublicAccessStatusPayload> {
    if ((command.mode || 'service') !== 'service') throw new Error('临时公网链接只支持后台服务模式的命令')
    if (this.processManager.getState(command.name).state !== 'running') {
      throw new Error('请先启动本地服务，再开启临时公网链接')
    }
    const target = resolveLoopbackTarget(command)
    if (!(await waitForConnect(target.host, target.port))) throw new Error(`本地服务尚未监听 ${target.authority}`)
    if (!this.isCurrentTunnelCommand(command, target) || this.processManager.getState(command.name).state !== 'running') {
      throw new Error('命令配置或运行状态已变更，请确认后重新开启临时公网链接')
    }

    const key = this.key(command.name, provider)
    const existing = this.active.get(key)
    if (existing) {
      const status = this.statuses.get(key)
      if (status?.url) return status
      throw new Error(`${providerLabel(provider)} 正在启动`)
    }
    if (provider === 'cpolar') {
      const occupied = [...this.active.values()].find((item) => item.provider === 'cpolar')
      if (occupied) throw new Error(`cpolar 免费版只允许一个在线进程，请先停止「${occupied.commandName}」的国内临时链接`)
    }

    const executable = provider === 'cpolar' ? 'cpolar' : 'cloudflared'
    const args = provider === 'cpolar'
      ? ['http', '-region=cn', `-host-header=${target.authority}`, '-log=stdout', target.authority]
      : [
          'tunnel',
          '--config',
          devNull,
          '--no-autoupdate',
          '--grace-period',
          '2s',
          '--output',
          'json',
          '--http-host-header',
          target.authority,
          '--url',
          target.origin
        ]
    const child = spawn(executable, args, {
      env: buildChildProcessEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    const record: ActiveCli = {
      child,
      commandName: command.name,
      provider,
      sourceCommand: command.command,
      targetOrigin: target.origin,
      exited: false,
      expectedStop: false
    }
    this.active.set(key, record)
    this.publish({ commandName: command.name, provider, phase: 'starting', pid: child.pid, message: '正在获取临时公网链接…' })

    return await new Promise((resolve, reject) => {
      let output = ''
      let ready = false
      let completed = false
      const timer = setTimeout(() => {
        if (completed) return
        completed = true
        record.failureMessage = `30 秒内未获取到 ${providerLabel(provider)} 公网链接，请检查 CLI 登录和网络状态`
        this.publish({ commandName: command.name, provider, phase: 'error', message: record.failureMessage })
        void this.terminate(record)
        reject(new Error(record.failureMessage))
      }, TUNNEL_START_TIMEOUT_MS)
      const acceptOutput = (chunk: unknown) => {
        output = appendOutput(output, String(chunk))
        if (ready || completed) return
        const url = extractTunnelUrl(provider, output)
        if (!url) return
        ready = true
        completed = true
        clearTimeout(timer)
        const status = this.publish({
          commandName: command.name,
          provider,
          phase: 'running',
          pid: child.pid,
          url,
          message: `${providerLabel(provider)} 临时链接运行中，停止本地服务或关闭电脑后即失效`
        })
        resolve(status)
      }
      child.stdout?.on('data', acceptOutput)
      child.stderr?.on('data', acceptOutput)
      child.once('error', (error) => {
        clearTimeout(timer)
        record.exited = true
        this.active.delete(key)
        const message = formatSpawnError(executable, error)
        record.failureMessage = message
        this.publish({ commandName: command.name, provider, phase: 'error', message })
        if (!completed) {
          completed = true
          reject(new Error(message))
        }
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        record.exited = true
        this.active.delete(key)
        if (record.failureMessage) {
          this.publish({ commandName: command.name, provider, phase: 'error', message: record.failureMessage })
        } else if (record.expectedStop) {
          this.publish({ commandName: command.name, provider, phase: 'idle', message: '临时公网链接已停止' })
        } else {
          const message = summarizeCliError(output, `${providerLabel(provider)} 已退出（退出码 ${code ?? -1}）`)
          this.publish({ commandName: command.name, provider, phase: 'error', message })
        }
        if (!completed) {
          completed = true
          reject(new Error(this.statuses.get(key)?.message || `${providerLabel(provider)} 启动失败`))
        }
      })
    })
  }

  private async terminate(record: ActiveCli): Promise<void> {
    const pid = record.child.pid
    if (!pid || record.exited) return
    await killProcessTree(pid, 'SIGINT')
    if (!record.exited) {
      await Promise.race([
        new Promise<void>((resolve) => record.child.once('close', () => resolve())),
        delay(3000)
      ])
    }
    if (!record.exited) await terminateProcessTreeWithEscalation(pid, () => record.exited, 900)
  }

  private publish(payload: CommandPublicAccessStatusPayload): CommandPublicAccessStatusPayload {
    const key = this.key(payload.commandName, payload.provider)
    if (payload.provider === 'vercel') this.restoredVercelStatusKeys.delete(key)
    this.statuses.set(key, payload)
    this.emitStatus(payload)
    return payload
  }

  private restoreVercelStatuses(commands: CommandConfig[]): void {
    for (const key of this.restoredVercelStatusKeys) this.statuses.delete(key)
    this.restoredVercelStatusKeys.clear()
    for (const command of commands) {
      const key = this.key(command.name, 'vercel')
      if (this.statuses.has(key)) continue
      let projectRoot: string
      try {
        projectRoot = resolveVercelProjectRoot(command.command)
      } catch {
        continue
      }
      const projectLink = readVercelProjectLink(projectRoot)
      const deployment = this.persistedVercelDeployments.get(projectRoot)
      if (!projectLink || !deployment) continue
      if (deployment.projectId !== projectLink.projectId || deployment.orgId !== projectLink.orgId) continue
      const status: CommandPublicAccessStatusPayload = {
        commandName: command.name,
        provider: 'vercel',
        phase: 'succeeded',
        url: deployment.url,
        message: '已恢复上次记录的 Vercel 云端链接'
      }
      this.statuses.set(key, status)
      this.restoredVercelStatusKeys.add(key)
      this.emitStatus(status)
    }
  }

  private loadPersistedVercelDeployments(): void {
    if (!this.storagePath) return
    try {
      const records = JSON.parse(readFileSync(this.storagePath, 'utf8')) as PersistedVercelDeployment[]
      if (!Array.isArray(records)) return
      for (const record of records) {
        if (
          typeof record?.projectRoot !== 'string' ||
          typeof record?.projectId !== 'string' ||
          typeof record?.orgId !== 'string' ||
          typeof record?.url !== 'string'
        ) continue
        if (!isAbsolute(record.projectRoot) || !/^https:\/\//i.test(record.url)) continue
        let projectRoot: string
        try {
          projectRoot = realpathSync(record.projectRoot)
        } catch {
          continue
        }
        this.persistedVercelDeployments.set(projectRoot, { ...record, projectRoot })
      }
    } catch {
      // Missing or malformed cache must not block ShellManage startup.
    }
  }

  private persistVercelDeployment(projectRoot: string, projectLink: VercelProjectLink, url: string): void {
    this.persistedVercelDeployments.set(projectRoot, { projectRoot, ...projectLink, url })
    if (!this.storagePath) return
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true })
      writeFileSync(this.storagePath, JSON.stringify([...this.persistedVercelDeployments.values()], null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
    } catch {
      // Deployment succeeded remotely even if this best-effort local cache cannot be written.
    }
  }

  private key(commandName: string, provider: CommandPublicAccessProvider): string {
    return `${commandName}\u0000${provider}`
  }

  private isCurrentVercelCommand(
    commandName: string,
    projectRoot: string,
    projectLink: VercelProjectLink
  ): boolean {
    const current = this.commandsByName.get(commandName)
    if (!current) return false
    try {
      const currentRoot = resolveVercelProjectRoot(current.command)
      const currentLink = readVercelProjectLink(currentRoot)
      return currentRoot === projectRoot &&
        currentLink?.projectId === projectLink.projectId &&
        currentLink.orgId === projectLink.orgId
    } catch {
      return false
    }
  }

  private isCurrentTunnelCommand(
    command: CommandConfig,
    target: ReturnType<typeof resolveLoopbackTarget>
  ): boolean {
    const current = this.commandsByName.get(command.name)
    if (!current || current.command !== command.command || (current.mode || 'service') !== 'service') return false
    try {
      return resolveLoopbackTarget(current).origin === target.origin
    } catch {
      return false
    }
  }
}

export function resolveVercelProjectRoot(command: string): string {
  const cwd = extractLeadingWorkingDirectory(command)
  if (!cwd || !isAbsolute(cwd)) throw new Error('未识别到项目根目录。命令必须以 cd "项目绝对路径" && 开头')
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`项目根目录不存在：${cwd}`)
  return realpathSync(cwd)
}

function readVercelProjectLink(projectRoot: string): VercelProjectLink | undefined {
  try {
    const value = JSON.parse(readFileSync(join(projectRoot, '.vercel', 'project.json'), 'utf8')) as {
      projectId?: unknown
      orgId?: unknown
    }
    if (typeof value.projectId !== 'string' || !value.projectId) return undefined
    if (typeof value.orgId !== 'string' || !value.orgId) return undefined
    return { projectId: value.projectId, orgId: value.orgId }
  } catch {
    return undefined
  }
}

export function resolveLoopbackTarget(command: CommandConfig): {
  origin: string
  host: string
  authority: string
  port: number
} {
  if (!command.webUrl) throw new Error('请先在命令配置中填写带端口的本地 webUrl，再开启临时公网链接')
  let url: URL
  try {
    url = new URL(command.webUrl)
  } catch {
    throw new Error('webUrl 格式无效，示例：http://localhost:3000')
  }
  if (url.protocol !== 'http:' || url.username || url.password) {
    throw new Error('临时公网链接仅支持无账号密码的本地 HTTP 地址')
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('为避免误暴露远程服务，webUrl 必须使用 localhost、127.0.0.1 或 ::1')
  }
  if (!url.port) throw new Error('webUrl 必须明确填写端口，例如 http://localhost:3000')
  const port = Number.parseInt(url.port, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('webUrl 端口无效')
  const host = url.hostname === '[::1]' ? '::1' : url.hostname
  const authority = host === '::1' ? `[::1]:${port}` : `${host}:${port}`
  return { origin: `http://${authority}`, host, authority, port }
}

export function extractTunnelUrl(
  provider: Exclude<CommandPublicAccessProvider, 'vercel'>,
  output: string
): string | undefined {
  const text = stripAnsi(output)
  if (provider === 'cloudflare') return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0]
  const loggedUrl = text.match(/(?:"url"\s*:\s*"|\burl="?)(https:\/\/[^\s"]+)/i)?.[1]
  if (loggedUrl) return loggedUrl
  const matches = [...text.matchAll(/Forwarding\s+(https:\/\/[^\s]+)\s+->/gi)]
  const forwardingUrl = matches.at(-1)?.[1]
  if (forwardingUrl) return forwardingUrl
  const vendorUrls = [...text.matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.cpolar\.(?:cn|top|io)\b/gi)]
  return vendorUrls.at(-1)?.[0]
}

export function extractVercelUrl(output: string, progressOutput = ''): string | undefined {
  const aliases = [...stripAnsi(progressOutput).matchAll(/Aliased\s+(https:\/\/[^\s]+)/gi)]
  const alias = aliases.at(-1)?.[1]
  if (alias) return alias
  const text = stripAnsi(output).trim()
  const candidates = [text, ...text.split('\n').reverse()]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        url?: unknown
        deployment?: { url?: unknown; deployment?: { url?: unknown } }
      }
      const value = parsed.deployment?.url ?? parsed.deployment?.deployment?.url ?? parsed.url
      if (typeof value === 'string' && /^https:\/\//i.test(value)) return value
    } catch {
      // Older CLI versions return a bare URL.
    }
  }
  return text.match(/https:\/\/[^\s"']+/i)?.[0]
}

export function extractVercelAlias(output: string): string | undefined {
  try {
    const parsed = JSON.parse(stripAnsi(output)) as { aliases?: unknown }
    if (!Array.isArray(parsed.aliases)) return undefined
    const alias = parsed.aliases.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (!alias) return undefined
    return /^https:\/\//i.test(alias) ? alias : `https://${alias}`
  } catch {
    return undefined
  }
}

async function inspectVercelAlias(
  projectRoot: string,
  deploymentUrl: string,
  onSpawn: (child: ChildProcess) => void
): Promise<string | undefined> {
  const child = spawn(
    'vercel',
    ['inspect', deploymentUrl, '--format=json', '--non-interactive', '--no-color'],
    {
      cwd: projectRoot,
      env: buildChildProcessEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    }
  )
  onSpawn(child)
  let stdout = ''
  child.stdout?.on('data', (chunk) => {
    stdout = appendOutput(stdout, String(chunk))
  })
  return await new Promise((resolve) => {
    child.once('error', () => resolve(undefined))
    child.once('close', (code) => resolve(code === 0 ? extractVercelAlias(stdout) : undefined))
  })
}

function appendOutput(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > 64_000 ? next.slice(-64_000) : next
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '')
}

function summarizeCliError(output: string, fallback: string): string {
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.slice(-3).join(' · ').slice(0, 800) || fallback
}

function formatSpawnError(executable: string, error: Error & { code?: string }): string {
  if (error.code === 'ENOENT') return `未找到 ${executable}，请先复制配置 Prompt 交给 AI 完成安装`
  return `${executable} 启动失败：${error.message}`
}

function providerLabel(provider: Exclude<CommandPublicAccessProvider, 'vercel'>): string {
  return provider === 'cpolar' ? 'cpolar 国内线路' : 'Cloudflare 海外线路'
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(1500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitForConnect(host: string, port: number): Promise<boolean> {
  const deadline = Date.now() + LOCAL_SERVICE_READY_TIMEOUT_MS
  do {
    if (await canConnect(host, port)) return true
    await delay(100)
  } while (Date.now() < deadline)
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
