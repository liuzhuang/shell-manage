import { parse as parseShellCommand } from 'shell-quote'
import type { DashboardRiskLevel, QueryCommandRiskAssessment } from '../../shared/types'

type ShellToken = string | { op?: string; pattern?: string; comment?: string; key?: string }
type ParsedWord = { value: string; expanded?: boolean }

const INVALID_INPUT = /[\u0000-\u0008\u000a-\u001f\u007f]/u
const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/u
const RISKY_ENVIRONMENT = /^(?:PATH|ENV|BASH_ENV|IFS|SHELLOPTS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.+|PYTHONPATH|PERL5OPT|RUBYOPT|NODE_OPTIONS)$/iu
const BLOCKED_COMMAND = /^(?:halt|mkfs(?:\..+)?|poweroff|reboot|rm|rmdir|sfdisk|shutdown|shred|unlink|wipefs)$/u
const WRITING_COMMAND = /^(?:chgrp|chmod|chown|cp|install|ln|mkdir|mv|rsync|scp|sponge|tee|touch|truncate)$/u
const SHELL_COMMAND = /^(?:ash|bash|csh|dash|fish|ksh|mksh|sh|tcsh|yash|zsh)$/u
const DYNAMIC_EXECUTION_COMMAND = /^(?:awk|bun|deno|gawk|groovy|java|jshell|kotlin|lua|luajit|mawk|nawk|node|nodejs|osascript|perl|php|powershell|pwsh|python(?:\d+(?:\.\d+)*)?|r|rscript|ruby|swift|tclsh(?:\d+(?:\.\d+)*)?|wish)$/u
const SHELL_PREFIX_KEYWORD = new Set(['!', '{', 'do', 'elif', 'else', 'if', 'then', 'until', 'while'])
const SHELL_COMPLEX_KEYWORD = new Set(['case', 'coproc', 'for', 'function', 'select'])
const AUTO_EXECUTE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const AUTO_EXECUTE_ENVIRONMENT = [
  `PATH=${AUTO_EXECUTE_PATH}`,
  'ENV=',
  'BASH_ENV=',
  'PS1=',
  'LD_PRELOAD=',
  'LD_LIBRARY_PATH=',
  'LD_AUDIT=',
  'DYLD_INSERT_LIBRARIES=',
  'DYLD_LIBRARY_PATH=',
  'NODE_OPTIONS=',
  'PYTHONPATH=',
  'PERL5OPT=',
  'RUBYOPT='
].join(' ')

const DOCKER_GLOBAL_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--context',
  '-H',
  '--host',
  '-l',
  '--log-level'
])
const DOCKER_COMPOSE_VALUE_OPTIONS = new Set([
  '--ansi',
  '--env-file',
  '-f',
  '--file',
  '--parallel',
  '-p',
  '--profile',
  '--progress',
  '--project-directory',
  '--project-name'
])
const KUBECTL_GLOBAL_VALUE_OPTIONS = new Set([
  '--as',
  '--as-group',
  '--cache-dir',
  '--certificate-authority',
  '--client-certificate',
  '--client-key',
  '--cluster',
  '--context',
  '--kubeconfig',
  '-n',
  '--namespace',
  '--password',
  '--profile',
  '--profile-output',
  '--request-timeout',
  '-s',
  '--server',
  '--tls-server-name',
  '--token',
  '--user',
  '--username',
  '-v',
  '--vmodule'
])
const SYSTEMCTL_GLOBAL_VALUE_OPTIONS = new Set(['-H', '--host', '-M', '--machine', '--root', '--image'])
const GIT_GLOBAL_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree'
])
const SSH_FLAGS = new Set('46AaCfGgKkMNnqTtVvXxYy')
const SSH_OPTIONS_WITH_VALUE = new Set('BbcdEeFIiJLlmoPpQRSWw')
const SIGNAL_NAMES = new Set([
  'ABRT',
  'ALRM',
  'BUS',
  'CHLD',
  'CONT',
  'FPE',
  'HUP',
  'ILL',
  'INT',
  'IO',
  'KILL',
  'PIPE',
  'POLL',
  'PROF',
  'PWR',
  'QUIT',
  'SEGV',
  'STKFLT',
  'STOP',
  'SYS',
  'TERM',
  'TRAP',
  'TSTP',
  'TTIN',
  'TTOU',
  'URG',
  'USR1',
  'USR2',
  'VTALRM',
  'WINCH',
  'XCPU',
  'XFSZ'
])

export function inferRiskLevel(command: string): DashboardRiskLevel {
  const raw = command.trim()
  if (!raw || raw.length > 2000 || INVALID_INPUT.test(raw)) return 'review'

  const syntax = inspectShellSyntax(raw)
  if (!syntax.valid) return 'review'

  const parsed = parseCommands(raw, syntax.dynamic ? 'review' : 'safe')
  return parsed.commands.reduce<DashboardRiskLevel>((risk, words) => {
    return maxRisk(risk, classifyCommand(words))
  }, parsed.riskLevel)
}

export function isCommandBlocked(command: string): boolean {
  return inferRiskLevel(command) === 'blocked'
}

export function combineRiskLevels(inferred: DashboardRiskLevel, declared: unknown): DashboardRiskLevel {
  const normalized = declared === 'safe' || declared === 'review' || declared === 'blocked' ? declared : 'review'
  return maxRisk(inferred, normalized)
}

export function assessCommandForAutoExecution(command: string, declaredRisk?: unknown): QueryCommandRiskAssessment {
  const riskLevel = combineRiskLevels(inferRiskLevel(command), declaredRisk)
  if (riskLevel === 'blocked') {
    return {
      canAutoExecute: false,
      riskLevel,
      message: '检测到明确的破坏性操作，已阻止自动执行。'
    }
  }
  if (riskLevel === 'review') {
    return {
      canAutoExecute: false,
      riskLevel,
      message: '检测到写入、状态变更或无法验证的动态执行，已保留并等待手动执行。'
    }
  }
  return {
    canAutoExecute: true,
    riskLevel,
    message: '已通过 Agent 风险判断与本地 denylist，可作为自动执行候选命令。'
  }
}

/** 使用固定 PATH 与 privileged mode 的非交互 Shell，隔离 alias、导出 function 与用户 PATH。 */
export function hardenCommandForAutoExecution(command: string): string | undefined {
  const raw = command.trim()
  if (inferRiskLevel(raw) !== 'safe') return undefined
  const quoted = raw.replace(/'/gu, "'\\''")
  const shell = `${AUTO_EXECUTE_ENVIRONMENT} /bin/sh`
  return `if ${shell} -p -c ':' >/dev/null 2>&1; then ${shell} -p -c '${quoted}'; else ${shell} -c '${quoted}'; fi`
}

function parseCommands(
  command: string,
  initialRisk: DashboardRiskLevel
): { commands: ParsedWord[][]; riskLevel: DashboardRiskLevel } {
  let tokens: ShellToken[]
  try {
    tokens = parseShellCommand(escapeLiteralHashes(command), (key) => ({ op: 'env', key })) as ShellToken[]
  } catch {
    return { commands: [], riskLevel: 'review' }
  }

  const commands: ParsedWord[][] = []
  let words: ParsedWord[] = []
  let riskLevel = initialRisk
  let skipRedirectionTarget = false
  const flush = () => {
    if (words.length > 0) commands.push(words)
    words = []
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (typeof token === 'string') {
      if (skipRedirectionTarget) skipRedirectionTarget = false
      else words.push({ value: token })
      continue
    }
    if ('comment' in token) break
    if (token.op === 'glob' || token.op === 'env') {
      if (skipRedirectionTarget) skipRedirectionTarget = false
      else {
        words.push({
          value: token.op === 'glob' ? token.pattern || '' : `$${token.key || ''}`,
          expanded: token.op === 'env' || words.length === 0
        })
      }
      continue
    }
    if (token.op === '>' || token.op === '>>') {
      riskLevel = maxRisk(riskLevel, 'review')
      skipRedirectionTarget = true
      continue
    }
    if (token.op === '>&') {
      const target = tokens[index + 1]
      if (typeof target !== 'string' || !/^(?:\d+|-)$/u.test(target)) {
        riskLevel = maxRisk(riskLevel, 'review')
      }
      skipRedirectionTarget = true
      continue
    }
    if (token.op === '<' || token.op === '<&' || token.op === '<<<') {
      skipRedirectionTarget = true
      continue
    }
    if (token.op === '|' || token.op === '|&' || token.op === '&&' || token.op === '||' || token.op === ';') {
      flush()
      continue
    }

    riskLevel = maxRisk(riskLevel, 'review')
    flush()
  }
  if (skipRedirectionTarget) riskLevel = maxRisk(riskLevel, 'review')
  flush()
  return { commands, riskLevel }
}

function classifyCommand(input: ParsedWord[], depth = 0): DashboardRiskLevel {
  if (depth > 8) return 'review'
  const words = [...input]
  let prefixRisk: DashboardRiskLevel = 'safe'
  while (words.length > 0) {
    const assignment = words[0].value.match(ENV_ASSIGNMENT)
    if (!assignment) break
    if (words[0].expanded || RISKY_ENVIRONMENT.test(assignment[1])) prefixRisk = 'review'
    words.shift()
  }
  while (words.length > 0 && SHELL_PREFIX_KEYWORD.has(words[0].value)) words.shift()
  if (words.length === 0) return prefixRisk
  const pathRisk: DashboardRiskLevel = /[/\\]/u.test(words[0].value) ? 'review' : 'safe'
  return maxRisk(prefixRisk, maxRisk(pathRisk, classifyExecutable(words, depth)))
}

function classifyExecutable(words: ParsedWord[], depth: number): DashboardRiskLevel {
  if (words[0].expanded) return 'review'

  const name = basename(words[0].value)
  const args = words.slice(1).map((word) => word.value)
  if (!name) return 'review'
  if (SHELL_COMPLEX_KEYWORD.has(name)) return 'review'
  if (name === 'fi' || name === 'done' || name === '}') return 'safe'

  if (/^(?:kill|killall|pkill)$/u.test(name)) return classifySignalCommand(name, args)
  if (BLOCKED_COMMAND.test(name)) return 'blocked'
  if (WRITING_COMMAND.test(name)) return 'review'
  if (DYNAMIC_EXECUTION_COMMAND.test(name)) return 'review'

  if (name === 'sudo' || name === 'doas') return classifyPrivilegeWrapper(words, depth)
  if (name === 'env') return classifyEnvWrapper(words, depth)
  if (name === 'command') return classifyCommandWrapper(words, depth)
  if (name === 'busybox' || name === 'toybox') {
    return words.length > 1 ? classifyCommand(words.slice(1), depth + 1) : 'safe'
  }
  if (SHELL_COMMAND.test(name)) return classifyShell(args)
  if (name === 'exec') return classifyExecWrapper(words, depth)
  if (name === 'nohup') return classifyNohupWrapper(words, depth)
  if (name === 'timeout') return classifyTimeoutWrapper(words, depth)
  if (name === 'nice') return classifyNiceWrapper(words, depth)
  if (name === 'time') return classifyTimeWrapper(words, depth)
  if (name === 'watch') return classifyWatchWrapper(words, depth)
  if (name === 'eval') return args.length > 0 ? inferRiskLevel(args.join(' ')) : 'review'
  if (name === 'source' || name === '.' || name === 'xargs') return 'review'
  if (name === 'ssh') return classifySshWrapper(words)
  if (name === 'chroot') return classifyChrootWrapper(words, depth)
  if (name === 'setsid') return classifySetsidWrapper(words, depth)

  if (name === 'find') return classifyFind(words, depth)
  if (name === 'dd') return classifyDd(args)
  if (name === 'fdisk') return args.some((arg) => arg === '-l' || arg === '--list') ? 'safe' : 'blocked'
  if (name === 'parted') return classifyParted(args)
  if (name === 'docker' || name === 'podman' || name === 'nerdctl') return classifyContainerCli(words)
  if (name === 'kubectl') return classifyKubectl(words)
  if (name === 'systemctl') return classifySystemctl(words)
  if (name === 'git') return classifyGit(words)

  if (name === 'curl' && curlWritesOrMutates(args)) return 'review'
  if (name === 'wget' && !wgetUsesStdout(args)) return 'review'
  if (name === 'sed' && args.some((arg) => /^-[^-]*i/u.test(arg) || arg.startsWith('--in-place'))) {
    return 'review'
  }
  if (name === 'date' && dateSetsClock(args)) return 'review'
  return 'safe'
}

function classifyPrivilegeWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  let prefixRisk: DashboardRiskLevel = 'safe'
  while (index < words.length) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '-i' || arg === '--login' || arg === '-s' || arg === '--shell' || arg === '-e' || arg === '--edit') {
      return 'review'
    }
    if (['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-D', '--chdir', '-R', '--chroot', '-T', '--command-timeout', '-U', '--other-user'].includes(arg)) {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (/^--(?:user|group|host|prompt|close-from|chdir|chroot|command-timeout|other-user)=/u.test(arg) || /^-[ughCpDRTU].+/u.test(arg)) {
      index += 1
      continue
    }
    if (arg === '-E' || arg === '--preserve-env' || arg.startsWith('--preserve-env=')) {
      prefixRisk = 'review'
      index += 1
      continue
    }
    if (['-A', '--askpass', '-b', '--background'].includes(arg)) {
      prefixRisk = 'review'
      index += 1
      continue
    }
    if (['-B', '--bell', '-H', '--set-home', '-n', '--non-interactive', '-P', '--preserve-groups', '-S', '--stdin', '-k', '-K'].includes(arg)) {
      index += 1
      continue
    }
    return 'review'
  }
  const nestedRisk = index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
  return maxRisk(prefixRisk, nestedRisk)
}

function classifyEnvWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  let prefixRisk: DashboardRiskLevel = 'safe'
  while (index < words.length) {
    const arg = words[index].value
    const assignment = arg.match(ENV_ASSIGNMENT)
    if (assignment) {
      if (words[index].expanded || RISKY_ENVIRONMENT.test(assignment[1])) prefixRisk = 'review'
      index += 1
      continue
    }
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '-S' || arg === '--split-string' || arg.startsWith('--split-string=')) return 'review'
    if (arg === '-u' || arg === '--unset' || arg === '-C' || arg === '--chdir' || arg === '-a' || arg === '--argv0') {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (/^--(?:unset|chdir|argv0)=/u.test(arg) || /^-[uCa].+/u.test(arg) || arg === '-i' || arg === '--ignore-environment' || arg === '-0' || arg === '--null' || arg === '-v' || arg === '--debug' || arg === '--list-signal-handling' || /^--(?:block-signal|default-signal|ignore-signal)(?:=|$)/u.test(arg)) {
      index += 1
      continue
    }
    return 'review'
  }
  const nestedRisk = index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
  return maxRisk(prefixRisk, nestedRisk)
}

function classifyCommandWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length && words[index].value.startsWith('-')) {
    const arg = words[index].value
    if (arg === '-v' || arg === '-V') return 'safe'
    if (arg !== '-p' && arg !== '--') return 'review'
    index += 1
    if (arg === '--') break
  }
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyTimeoutWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length && words[index].value.startsWith('-')) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (arg === '-k' || arg === '--kill-after' || arg === '-s' || arg === '--signal') {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (/^--(?:kill-after|signal)=/u.test(arg) || /^-[ks].+/u.test(arg) || ['--foreground', '--preserve-status', '--verbose'].includes(arg)) {
      index += 1
      continue
    }
    return 'review'
  }
  if (!words[index]) return 'safe'
  index += 1
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyExecWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '-a') {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (arg === '-c' || arg === '-l' || /^-[cl]+$/u.test(arg)) {
      index += 1
      continue
    }
    return 'review'
  }
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyNohupWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  if (words[index]?.value === '--') index += 1
  if (words[index]?.value === '--help' || words[index]?.value === '--version') return 'safe'
  if (words[index]?.value.startsWith('-')) return 'review'
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyNiceWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (arg === '-n' || arg === '--adjustment') {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (/^--adjustment=/u.test(arg) || /^-\d+$/u.test(arg)) {
      index += 1
      continue
    }
    if (arg.startsWith('-')) return 'review'
    break
  }
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyTimeWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  let prefixRisk: DashboardRiskLevel = 'safe'
  while (index < words.length) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '-o' || arg === '--output') {
      if (!words[index + 1]) return 'review'
      prefixRisk = 'review'
      index += 2
      continue
    }
    if (arg === '-f' || arg === '--format') {
      if (!words[index + 1]) return 'review'
      index += 2
      continue
    }
    if (arg.startsWith('--output=')) prefixRisk = 'review'
    if (arg === '-a' || arg === '--append') prefixRisk = 'review'
    index += 1
  }
  const nestedRisk = index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
  return maxRisk(prefixRisk, nestedRisk)
}

function classifyWatchWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  let directExec = false
  while (index < words.length) {
    const arg = words[index].value
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '-n' || arg === '--interval' || arg === '-t' || arg === '--errexit') {
      if ((arg === '-n' || arg === '--interval') && !words[index + 1]) return 'review'
      index += arg === '-n' || arg === '--interval' ? 2 : 1
      continue
    }
    if (arg.startsWith('--interval=')) {
      index += 1
      continue
    }
    if (arg === '-x' || arg === '--exec') directExec = true
    index += 1
  }
  if (index >= words.length) return 'safe'
  if (directExec) return classifyCommand(words.slice(index), depth + 1)
  return inferRiskLevel(words.slice(index).map((word) => word.value).join(' '))
}

function classifySshWrapper(words: ParsedWord[]): DashboardRiskLevel {
  let index = 1
  let prefixRisk: DashboardRiskLevel = 'safe'
  while (index < words.length) {
    const word = words[index]
    const arg = word.value
    if (word.expanded) return 'review'
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break

    const option = arg[1]
    if (SSH_OPTIONS_WITH_VALUE.has(option)) {
      let optionValue = arg.slice(2)
      if (arg.length === 2) {
        if (!words[index + 1] || words[index + 1].expanded) return 'review'
        optionValue = words[index + 1].value
        index += 2
      } else {
        index += 1
      }
      if (option === 'F') prefixRisk = maxRisk(prefixRisk, 'review')
      if (option === 'o') prefixRisk = maxRisk(prefixRisk, classifySshConfigOption(optionValue))
      continue
    }
    if ([...arg.slice(1)].every((flag) => SSH_FLAGS.has(flag))) {
      index += 1
      continue
    }
    return 'review'
  }

  if (!words[index] || words[index].expanded) {
    return words[index]?.expanded ? 'review' : prefixRisk
  }
  index += 1
  if (index >= words.length) return prefixRisk
  if (words.slice(index).some((word) => word.expanded)) return 'review'
  return maxRisk(prefixRisk, inferRiskLevel(words.slice(index).map((word) => word.value).join(' ')))
}

function classifySshConfigOption(value: string): DashboardRiskLevel {
  const match = value.match(/^([^=\s]+)(?:=|\s+)([\s\S]*)$/u)
  if (!match) return 'safe'
  const key = match[1].toLowerCase()
  if (key !== 'localcommand' && key !== 'proxycommand' && key !== 'remotecommand') return 'safe'
  const command = match[2].trim()
  return command && command.toLowerCase() !== 'none' ? inferRiskLevel(command) : 'safe'
}

function classifyChrootWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length) {
    const word = words[index]
    const arg = word.value
    if (word.expanded) return 'review'
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '--help' || arg === '--version') return 'safe'
    if (arg === '--userspec' || arg === '--groups') {
      if (!words[index + 1] || words[index + 1].expanded) return 'review'
      index += 2
      continue
    }
    if (arg === '--skip-chdir' || arg.startsWith('--userspec=') || arg.startsWith('--groups=')) {
      index += 1
      continue
    }
    return 'review'
  }
  if (!words[index] || words[index].expanded) return words[index]?.expanded ? 'review' : 'safe'
  index += 1
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifySetsidWrapper(words: ParsedWord[], depth: number): DashboardRiskLevel {
  let index = 1
  while (index < words.length) {
    const word = words[index]
    const arg = word.value
    if (word.expanded) return 'review'
    if (arg === '--') {
      index += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (arg === '--help' || arg === '--version') return 'safe'
    if (/^-[cfw]+$/u.test(arg) || ['--ctty', '--fork', '--wait'].includes(arg)) {
      index += 1
      continue
    }
    return 'review'
  }
  return index < words.length ? classifyCommand(words.slice(index), depth + 1) : 'safe'
}

function classifyShell(args: string[]): DashboardRiskLevel {
  const commandIndex = args.findIndex((arg) => arg === '-c' || /^-[^-]*c[^-]*$/u.test(arg))
  if (commandIndex < 0) {
    return args.length > 0 && args.every((arg) => ['--help', '--version', '-n'].includes(arg)) ? 'safe' : 'review'
  }
  const scriptIndex = args[commandIndex + 1] === '--' ? commandIndex + 2 : commandIndex + 1
  const script = args[scriptIndex]
  return script ? inferRiskLevel(script) : 'review'
}

function classifyFind(words: ParsedWord[], depth: number): DashboardRiskLevel {
  const args = words.slice(1)
  let risk: DashboardRiskLevel = 'safe'
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index].value
    if (arg === '-delete') return 'blocked'
    if (arg === '-fprint' || arg === '-fprintf' || arg === '-fls') risk = maxRisk(risk, 'review')
    if (arg !== '-exec' && arg !== '-execdir') continue
    const nested: ParsedWord[] = []
    for (index += 1; index < args.length; index += 1) {
      if (args[index].value === ';' || args[index].value === '+') break
      nested.push(args[index])
    }
    risk = maxRisk(risk, classifyCommand(nested, depth + 1))
  }
  return risk
}

function classifyDd(args: string[]): DashboardRiskLevel {
  const output = args.find((arg) => arg.startsWith('of='))?.slice(3)
  if (!output || output === '/dev/null' || output === '/dev/stdout' || output === '/dev/stderr') return 'safe'
  if (/^\/dev\/(?:disk\/|mapper\/|(?:sd|hd|vd|xvd|nvme|mmcblk|loop|md)[A-Za-z0-9._/-]*)/u.test(output)) {
    return 'blocked'
  }
  return 'review'
}

function classifyParted(args: string[]): DashboardRiskLevel {
  const blockedActions = new Set([
    'cp',
    'disk_set',
    'disk_toggle',
    'mkfs',
    'mklabel',
    'mktable',
    'mkpart',
    'mkpartfs',
    'move',
    'name',
    'rescue',
    'resize',
    'resizepart',
    'rm',
    'set',
    'toggle'
  ])
  if (args.some((arg) => blockedActions.has(arg.toLowerCase()))) return 'blocked'
  if (args.some((arg) => arg === 'print' || arg === 'list' || arg === '--help' || arg === '--version')) return 'safe'
  return 'review'
}

function classifyContainerCli(words: ParsedWord[]): DashboardRiskLevel {
  const located = locateSubcommand(words.slice(1), DOCKER_GLOBAL_VALUE_OPTIONS)
  if (located === 'review') return 'review'
  if (!located) return 'safe'

  const blocked = new Set(['delete', 'down', 'kill', 'prune', 'remove', 'rm', 'rmi'])
  const review = new Set([
    'commit',
    'connect',
    'cp',
    'create',
    'disconnect',
    'exec',
    'import',
    'load',
    'login',
    'logout',
    'pause',
    'pull',
    'push',
    'rename',
    'restart',
    'run',
    'start',
    'stop',
    'tag',
    'unpause',
    'update',
    'up'
  ])
  if (blocked.has(located.value)) return 'blocked'
  if (review.has(located.value)) return 'review'

  const groups = new Set(['builder', 'buildx', 'compose', 'container', 'context', 'image', 'network', 'node', 'plugin', 'secret', 'service', 'stack', 'system', 'volume'])
  if (!groups.has(located.value)) return 'safe'
  const nestedValueOptions = located.value === 'compose' ? DOCKER_COMPOSE_VALUE_OPTIONS : new Set<string>()
  const nested = locateSubcommand(words.slice(1 + located.index + 1), nestedValueOptions)
  if (nested === 'review') return 'review'
  if (!nested) return 'safe'
  if (blocked.has(nested.value)) return 'blocked'
  if (review.has(nested.value)) return 'review'
  return 'safe'
}

function classifyKubectl(words: ParsedWord[]): DashboardRiskLevel {
  const located = locateSubcommand(words.slice(1), KUBECTL_GLOBAL_VALUE_OPTIONS)
  if (located === 'review') return 'review'
  if (!located) return 'safe'
  if (located.value === 'delete') return 'blocked'

  const review = new Set([
    'annotate',
    'apply',
    'attach',
    'autoscale',
    'certificate',
    'cordon',
    'cp',
    'create',
    'drain',
    'edit',
    'exec',
    'expose',
    'label',
    'patch',
    'port-forward',
    'replace',
    'run',
    'scale',
    'set',
    'taint',
    'uncordon'
  ])
  if (review.has(located.value)) return 'review'
  if (located.value === 'rollout') {
    const nested = locateSubcommand(words.slice(1 + located.index + 1), new Set())
    if (nested && nested !== 'review' && ['pause', 'restart', 'resume', 'undo'].includes(nested.value)) return 'review'
  }
  if (located.value === 'config') {
    const nested = locateSubcommand(words.slice(1 + located.index + 1), new Set())
    if (nested && nested !== 'review' && !['current-context', 'get-contexts', 'view'].includes(nested.value)) return 'review'
  }
  return 'safe'
}

function classifySystemctl(words: ParsedWord[]): DashboardRiskLevel {
  const located = locateSubcommand(words.slice(1), SYSTEMCTL_GLOBAL_VALUE_OPTIONS)
  if (located === 'review') return 'review'
  if (!located) return 'safe'
  if (['clean', 'halt', 'kill', 'poweroff', 'reboot', 'soft-reboot'].includes(located.value)) return 'blocked'
  const stateChanges = new Set([
    'add-requires',
    'add-wants',
    'cancel',
    'daemon-reexec',
    'daemon-reload',
    'disable',
    'edit',
    'emergency',
    'enable',
    'exit',
    'freeze',
    'halt',
    'hibernate',
    'hybrid-sleep',
    'import-environment',
    'isolate',
    'kexec',
    'kill',
    'link',
    'mask',
    'poweroff',
    'preset',
    'preset-all',
    'reboot',
    'reenable',
    'reload',
    'reload-or-restart',
    'reset-failed',
    'restart',
    'revert',
    'set-default',
    'set-environment',
    'set-property',
    'sleep',
    'start',
    'stop',
    'suspend',
    'suspend-then-hibernate',
    'switch-root',
    'thaw',
    'try-restart',
    'unmask',
    'unset-environment'
  ])
  return stateChanges.has(located.value) ? 'review' : 'safe'
}

function classifyGit(words: ParsedWord[]): DashboardRiskLevel {
  let prefixRisk: DashboardRiskLevel = 'safe'
  for (let index = 1; index < words.length; index += 1) {
    const arg = words[index].value
    if (arg === '-c') {
      const config = words[index + 1]
      if (!config || config.expanded) return 'review'
      prefixRisk = maxRisk(prefixRisk, classifyGitConfig(config.value, false))
      index += 1
      continue
    }
    if (arg.startsWith('-c') && arg.length > 2) {
      prefixRisk = maxRisk(prefixRisk, classifyGitConfig(arg.slice(2), false))
      continue
    }
    if (arg === '--config-env') {
      const config = words[index + 1]
      if (!config || config.expanded) return 'review'
      prefixRisk = maxRisk(prefixRisk, classifyGitConfig(config.value, true))
      index += 1
      continue
    }
    if (arg.startsWith('--config-env=')) {
      prefixRisk = maxRisk(prefixRisk, classifyGitConfig(arg.slice('--config-env='.length), true))
    }
  }

  const located = locateSubcommand(words.slice(1), GIT_GLOBAL_VALUE_OPTIONS)
  if (located === 'review') return 'review'
  if (!located) return prefixRisk
  if (located.value === 'clean') return 'blocked'
  if (located.value === 'reset') {
    const args = words.slice(located.index + 2).map((word) => word.value)
    if (args.includes('--hard')) return 'blocked'
  }
  return prefixRisk
}

function classifyGitConfig(value: string, fromEnvironment: boolean): DashboardRiskLevel {
  const separator = value.indexOf('=')
  if (separator < 0) return fromEnvironment ? 'review' : 'safe'
  const key = value.slice(0, separator).trim().toLowerCase()
  if (!key.startsWith('alias.')) return 'safe'
  if (fromEnvironment) return 'review'
  const alias = value.slice(separator + 1).trim()
  if (!alias.startsWith('!')) return 'review'
  return alias.length > 1 ? inferRiskLevel(alias.slice(1)) : 'review'
}

function locateSubcommand(
  words: ParsedWord[],
  valueOptions: Set<string>
): { value: string; index: number } | 'review' | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const arg = word.value
    if (word.expanded) return 'review'
    if (arg === '--') {
      const next = words[index + 1]
      return next ? { value: next.value.toLowerCase(), index: index + 1 } : undefined
    }
    if (!arg.startsWith('-') || arg === '-') return { value: arg.toLowerCase(), index }
    if (valueOptions.has(arg)) {
      if (!words[index + 1]) return 'review'
      index += 1
      continue
    }
    if (arg.includes('=') || arg === '--help' || arg === '--version' || /^-[^-].+/u.test(arg)) continue
    if (arg.startsWith('--')) continue
    return 'review'
  }
  return undefined
}

function curlWritesOrMutates(args: string[]): boolean {
  const writeOptions = ['--config', '--cookie-jar', '--data', '--dump-header', '--form', '--json', '--output', '--remote-name', '--upload-file']
  if (args.some((arg) => writeOptions.some((option) => arg === option || arg.startsWith(`${option}=`)) || arg.startsWith('--data-'))) return true
  if (args.some((arg) => /^-[^-]*[cdDFKoOT]/u.test(arg))) return true
  return args.some((arg, index) => {
    if (arg === '-X' || arg === '--request') return !/^(?:GET|HEAD)$/iu.test(args[index + 1] || '')
    if (arg.startsWith('-X')) return !/^-X(?:GET|HEAD)$/iu.test(arg)
    if (arg.startsWith('--request=')) return !/^--request=(?:GET|HEAD)$/iu.test(arg)
    return false
  })
}

function wgetUsesStdout(args: string[]): boolean {
  if (args.includes('--spider')) return true
  return args.some((arg, index) => arg === '--output-document=-' || /^-[^-]*O-$/u.test(arg) || (arg === '-O' && args[index + 1] === '-'))
}

function classifySignalCommand(name: string, args: string[]): DashboardRiskLevel {
  if (args.length === 0) return 'blocked'
  if (args[0] === '--help' || args[0] === '--version' || args[0] === '-V') return 'safe'
  if ((name === 'kill' || name === 'killall') && (args[0] === '-l' || args[0] === '-L')) return 'safe'

  const signalValueOptions = name === 'pkill'
    ? new Set(['--signal'])
    : name === 'killall'
      ? new Set(['-s', '--signal'])
      : new Set(['-n', '-s', '--signal'])
  let sawZeroSignal = false
  let parsingOptions = true

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      parsingOptions = false
      continue
    }
    if (!parsingOptions) continue
    if (signalValueOptions.has(arg)) {
      const signal = args[index + 1]
      if (!signal || !isZeroSignal(signal)) return 'blocked'
      sawZeroSignal = true
      index += 1
      continue
    }
    if (arg.startsWith('--signal=')) {
      if (!isZeroSignal(arg.slice('--signal='.length))) return 'blocked'
      sawZeroSignal = true
      continue
    }
    if (arg === '-0') {
      sawZeroSignal = true
      continue
    }
    if (/^-\d+$/u.test(arg) || isNamedSignalOption(arg)) return 'blocked'
  }
  return sawZeroSignal ? 'safe' : 'blocked'
}

function isZeroSignal(value: string): boolean {
  return /^(?:0|SIG0)$/iu.test(value)
}

function isNamedSignalOption(value: string): boolean {
  const normalized = value.replace(/^-/, '').replace(/^SIG/iu, '').toUpperCase()
  return value.startsWith('-') && SIGNAL_NAMES.has(normalized)
}

function dateSetsClock(args: string[]): boolean {
  return args.some((arg, index) => {
    if (arg === '--set' || arg.startsWith('--set=') || arg === '-s' || /^-s.+/u.test(arg)) return true
    if (/^-I(?:date|hours|minutes|seconds|ns|s)?$/u.test(arg)) return false
    return /^-[^-]*s.+/u.test(arg) || (/^-[^-]*s$/u.test(arg) && Boolean(args[index + 1]))
  })
}

function basename(value: string): string {
  return (value.split('/').pop() || '').toLowerCase()
}

function maxRisk(left: DashboardRiskLevel, right: DashboardRiskLevel): DashboardRiskLevel {
  const rank: Record<DashboardRiskLevel, number> = { safe: 0, review: 1, blocked: 2 }
  return rank[right] > rank[left] ? right : left
}

function inspectShellSyntax(command: string): { valid: boolean; dynamic: boolean } {
  let quote: "'" | '"' | undefined
  let escaped = false
  let atWordStart = true
  let dynamic = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      escaped = false
      atWordStart = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else if (quote === '"' && (character === '`' || (character === '$' && command[index + 1] === '('))) dynamic = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      atWordStart = false
      continue
    }
    if (character === '#' && atWordStart) break
    if (character === '`' || (character === '$' && command[index + 1] === '(')) dynamic = true
    atWordStart = /\s|[|&;()<>]/u.test(character)
  }
  return { valid: quote === undefined && !escaped, dynamic }
}

function escapeLiteralHashes(command: string): string {
  let quote: "'" | '"' | undefined
  let escaped = false
  let atWordStart = true
  let result = ''
  for (const character of command) {
    if (escaped) {
      result += character
      escaped = false
      atWordStart = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      result += character
      escaped = true
      continue
    }
    if (quote) {
      result += character
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      result += character
      quote = character
      atWordStart = false
      continue
    }
    if (character === '#' && !atWordStart) result += '\\'
    result += character
    if (character === '#' && atWordStart) break
    atWordStart = /\s|[|&;()<>]/u.test(character)
  }
  return result
}
