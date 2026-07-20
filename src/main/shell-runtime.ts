import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

export async function normalizeRuntimeEnv(): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const { shellEnv } = (await import('shell-env')) as typeof import('shell-env')
    const resolvedEnv = await shellEnv()
    if (resolvedEnv.PATH) process.env.PATH = resolvedEnv.PATH
    if (!process.env.SHELL && resolvedEnv.SHELL) process.env.SHELL = resolvedEnv.SHELL
    for (const [key, value] of Object.entries(resolvedEnv)) {
      if (process.env[key] === undefined && typeof value === 'string') process.env[key] = value
    }
  } catch {
    // Best effort: env normalization should not block app startup.
  }
}

export function resolveShellExecutable(): string {
  if (process.platform === 'win32') return resolveWindowsShell()
  if (process.platform === 'linux') return resolveLinuxShell()
  return resolveUnixShell()
}

export function resolveTerminalArgs(shellExec: string, command: string): string[] {
  if (process.platform !== 'win32') {
    return ['-lc', injectLocalRcBootstrap(shellExec, command)]
  }
  const shellName = basename(shellExec).toLowerCase()
  if (shellName.includes('pwsh') || shellName.includes('powershell')) {
    return ['-NoLogo', '-NoExit', '-Command', command]
  }
  if (shellName.includes('cmd')) return ['/d', '/s', '/k', command]
  return ['/d', '/s', '/k', command]
}

export function resolveServiceArgs(shellExec: string, command: string): string[] {
  if (process.platform !== 'win32') return ['-lc', injectLocalRcBootstrap(shellExec, command)]
  const shellName = basename(shellExec).toLowerCase()
  if (shellName.includes('pwsh') || shellName.includes('powershell')) {
    return ['-NoLogo', '-NonInteractive', '-Command', command]
  }
  if (shellName.includes('cmd')) return ['/d', '/s', '/c', command]
  return ['/d', '/s', '/c', command]
}

function resolveWindowsShell(): string {
  const powershell7Candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'
  ]
  for (const candidate of powershell7Candidates) {
    if (existsSync(candidate)) return candidate
  }

  const runtimeCandidates = ['pwsh.exe', 'pwsh', 'powershell.exe', process.env.ComSpec, 'cmd.exe']
  for (const candidate of runtimeCandidates) {
    if (!candidate) continue
    if (canExecute(candidate)) return candidate
  }
  return 'cmd.exe'
}

function resolveLinuxShell(): string {
  const envShell = process.env.SHELL
  if (envShell && canExecute(envShell)) return envShell

  const getentShell = readShellFromGetent()
  if (getentShell) return getentShell

  for (const fallback of ['bash', 'sh']) {
    if (canExecute(fallback)) return fallback
  }
  return '/bin/sh'
}

function resolveUnixShell(): string {
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  for (const candidate of candidates) {
    if (!candidate) continue
    if (canExecute(candidate)) return candidate
  }
  return '/bin/sh'
}

function readShellFromGetent(): string | undefined {
  if (typeof process.getuid !== 'function') return undefined
  const uid = process.getuid()
  const getent = spawnSync('getent', ['passwd', String(uid)], { encoding: 'utf-8' })
  if (getent.status !== 0 || !getent.stdout) return undefined
  const fields = getent.stdout.trim().split(':')
  const shell = fields[6]
  if (!shell) return undefined
  return canExecute(shell) ? shell : undefined
}

function canExecute(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(checker, [command], { stdio: 'ignore' })
  return result.status === 0
}

/**
 * 仅 source 与当前 shell 匹配的 rc，避免 zsh / bash 同时 source 触发 nvm 等初始化跑两遍。
 * zsh -> ~/.zshrc，bash -> ~/.bashrc，其余 shell 不注入。
 */
function injectLocalRcBootstrap(shellExec: string, command: string): string {
  const shellName = basename(shellExec).toLowerCase()
  let rcPath: string | undefined
  if (shellName.includes('zsh')) rcPath = '$HOME/.zshrc'
  else if (shellName.includes('bash')) rcPath = '$HOME/.bashrc'
  if (!rcPath) return command
  const bootstrap = `if [ -f "${rcPath}" ]; then . "${rcPath}" >/dev/null 2>&1 || true; fi`
  return `${bootstrap}; ${command}`
}
