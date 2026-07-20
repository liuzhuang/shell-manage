import { spawn as cpSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveServiceArgs, resolveShellExecutable } from '../shell-runtime'

type RunProbeOptions = {
  sessionGroupKey?: string
}

const SSH_CONTROL_PERSIST_SEC = 180
const SSH_CONTROL_DIR = join(homedir(), '.shell-manage', 'ssh-control')
const INTERACTIVE_SESSION_IDLE_MS = 180_000
const INTERACTIVE_STDOUT_MAX = 1_000_000
const INTERACTIVE_STDERR_MAX = 500_000

type ProbeExecResult = {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

type InteractiveSession = {
  groupKey: string
  sshBaseCommand: string
  process?: ChildProcessWithoutNullStreams
  stdoutBuffer: string
  stderrBuffer: string
  tail: Promise<void>
  lastActiveAt: number
}

const interactiveSessionMap = new Map<string, InteractiveSession>()
let interactiveGcTimer: ReturnType<typeof setInterval> | undefined

function buildControlSocketPath(sessionGroupKey: string): string {
  mkdirSync(SSH_CONTROL_DIR, { recursive: true })
  const digest = createHash('sha1').update(sessionGroupKey).digest('hex').slice(0, 16)
  return join(SSH_CONTROL_DIR, `ctl-${digest}.sock`)
}

function splitQuotedRemote(command: string): { sshBase: string; remote: string } | null {
  const trimmed = command.trim()
  if (!/^\s*ssh(\s|$)/i.test(trimmed)) return null
  let firstQuote = -1
  let lastQuote = -1
  let escaped = false
  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      if (firstQuote < 0) firstQuote = index
      lastQuote = index
    }
  }
  if (firstQuote < 0 || lastQuote <= firstQuote) return null
  const sshBase = trimmed.slice(0, firstQuote).trim()
  const remote = trimmed.slice(firstQuote + 1, lastQuote)
  if (!/^\s*ssh(\s|$)/i.test(sshBase)) return null
  return { sshBase, remote }
}

function withSshControlOptions(sshBase: string, socketPath: string): string {
  const rest = sshBase.replace(/^\s*ssh\b/i, '').trim()
  return `ssh -o ControlMaster=auto -o ControlPersist=${SSH_CONTROL_PERSIST_SEC} -o ControlPath="${socketPath}" ${rest}`.trim()
}

function withSshInteractiveOptions(sshBase: string): string {
  const rest = sshBase.replace(/^\s*ssh\b/i, '').trim()
  return `ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 ${rest}`.trim()
}

function rewriteWithPersistentSsh(command: string, sessionGroupKey: string): string {
  const socketPath = buildControlSocketPath(sessionGroupKey)
  const wrapped = splitQuotedRemote(command)
  if (wrapped) {
    const base = withSshControlOptions(wrapped.sshBase, socketPath)
    return `${base} "${wrapped.remote}"`
  }
  if (/^\s*ssh(\s|$)/i.test(command)) {
    return withSshControlOptions(command, socketPath)
  }
  return command
}

function trimBuffer(buffer: string, maxSize: number): string {
  if (buffer.length <= maxSize) return buffer
  return buffer.slice(buffer.length - maxSize)
}

function ensureInteractiveGcLoop(): void {
  if (interactiveGcTimer) return
  interactiveGcTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, session] of interactiveSessionMap.entries()) {
      if (now - session.lastActiveAt < INTERACTIVE_SESSION_IDLE_MS) continue
      session.process?.kill('SIGTERM')
      interactiveSessionMap.delete(key)
    }
  }, 30_000)
}

function ensureInteractiveProcess(session: InteractiveSession): ChildProcessWithoutNullStreams {
  if (session.process && !session.process.killed) return session.process
  const shellExec = resolveShellExecutable()
  const shellArgs = resolveServiceArgs(shellExec, session.sshBaseCommand)
  const child = cpSpawn(shellExec, shellArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
  session.process = child
  child.stdout.on('data', (buf) => {
    session.stdoutBuffer = trimBuffer(`${session.stdoutBuffer}${String(buf)}`, INTERACTIVE_STDOUT_MAX)
  })
  child.stderr.on('data', (buf) => {
    session.stderrBuffer = trimBuffer(`${session.stderrBuffer}${String(buf)}`, INTERACTIVE_STDERR_MAX)
  })
  child.on('exit', () => {
    session.process = undefined
  })
  return child
}

function queueInSession<T>(session: InteractiveSession, task: () => Promise<T>): Promise<T> {
  const run = session.tail.then(task, task)
  session.tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function getOrCreateInteractiveSession(groupKey: string, sshBaseCommand: string): InteractiveSession {
  ensureInteractiveGcLoop()
  const existing = interactiveSessionMap.get(groupKey)
  if (existing) return existing
  const created: InteractiveSession = {
    groupKey,
    sshBaseCommand,
    stdoutBuffer: '',
    stderrBuffer: '',
    tail: Promise.resolve(),
    lastActiveAt: Date.now()
  }
  interactiveSessionMap.set(groupKey, created)
  return created
}

async function runInteractiveSshCommand(
  session: InteractiveSession,
  remoteCommand: string,
  timeoutMs: number
): Promise<ProbeExecResult> {
  return queueInSession(session, async () => {
    const child = ensureInteractiveProcess(session)
    const startedAt = Date.now()
    session.lastActiveAt = startedAt
    const stdoutStart = session.stdoutBuffer.length
    const stderrStart = session.stderrBuffer.length
    const marker = `__SM_DONE_${Date.now()}_${Math.random().toString(16).slice(2)}__`
    const markerPattern = `${marker}:`

    return new Promise((resolve) => {
      let settled = false
      let onExit: (() => void) | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: ProbeExecResult): void => {
        if (settled) return
        settled = true
        child.stdout.off('data', onData)
        if (onExit) child.off('exit', onExit)
        if (timer) clearTimeout(timer)
        session.lastActiveAt = Date.now()
        resolve(result)
      }

      const collectResult = (exitCode: number, timeoutSuffix?: string): ProbeExecResult => {
        const stdoutEnd = session.stdoutBuffer.length
        const stderrEnd = session.stderrBuffer.length
        const stdoutSlice = session.stdoutBuffer.slice(stdoutStart, stdoutEnd)
        const stderrSlice = session.stderrBuffer.slice(stderrStart, stderrEnd)
        const markerIndex = stdoutSlice.indexOf(markerPattern)
        const content = markerIndex >= 0 ? stdoutSlice.slice(0, markerIndex) : stdoutSlice
        const stderr = timeoutSuffix ? (stderrSlice ? `${stderrSlice}\n${timeoutSuffix}` : timeoutSuffix) : stderrSlice
        return {
          exitCode,
          stdout: content.trim(),
          stderr: stderr.trim(),
          durationMs: Date.now() - startedAt
        }
      }

      const tryResolveByMarker = (): void => {
        const stdoutSlice = session.stdoutBuffer.slice(stdoutStart)
        const markerIndex = stdoutSlice.indexOf(markerPattern)
        if (markerIndex < 0) return
        const afterMarker = stdoutSlice.slice(markerIndex + markerPattern.length)
        const match = afterMarker.match(/(-?\d+)/)
        if (!match) return
        finish(collectResult(Number(match[1])))
      }

      const onData = (): void => {
        tryResolveByMarker()
      }
      child.stdout.on('data', onData)
      onExit = () => {
        finish(collectResult(1, '交互会话已断开'))
      }
      child.once('exit', onExit)
      timer = setTimeout(() => {
        child.stdin.write('\x03')
        finish(collectResult(124, '命令执行超时'))
      }, Math.max(1000, timeoutMs))

      child.stdin.write(`${remoteCommand}\nprintf "${marker}:%s\\n" "$?"\n`)
      tryResolveByMarker()
    })
  })
}

async function runOneShotCommand(command: string, timeoutMs: number, sessionGroupKey?: string): Promise<ProbeExecResult> {
  const preparedCommand =
    /^\s*ssh(\s|$)/i.test(command) ? rewriteWithPersistentSsh(command, sessionGroupKey || `oneshot-${command}`) : command
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const shellExec = resolveShellExecutable()
    const shellArgs = resolveServiceArgs(shellExec, preparedCommand)
    const child = cpSpawn(shellExec, shellArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolve({
        exitCode: 124,
        stdout,
        stderr: stderr ? `${stderr}\n命令执行超时` : '命令执行超时',
        durationMs: Date.now() - startedAt
      })
    }, Math.max(500, timeoutMs))

    child.stdout?.on('data', (buf) => {
      stdout += String(buf)
    })
    child.stderr?.on('data', (buf) => {
      stderr += String(buf)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr ? `${stderr}\n${error.message}` : error.message,
        durationMs: Date.now() - startedAt
      })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      })
    })
  })
}

export async function runProbeCommand(command: string, timeoutMs: number, options?: RunProbeOptions): Promise<ProbeExecResult> {
  const groupKey = String(options?.sessionGroupKey || '').trim()
  const wrapped = splitQuotedRemote(command)
  if (groupKey && wrapped) {
    const session = getOrCreateInteractiveSession(groupKey, withSshInteractiveOptions(wrapped.sshBase))
    return runInteractiveSshCommand(session, wrapped.remote, timeoutMs)
  }
  return runOneShotCommand(command, timeoutMs, groupKey || undefined)
}
