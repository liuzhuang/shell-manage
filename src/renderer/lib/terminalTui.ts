export type TerminalTuiTone = 'user' | 'assistant' | 'info' | 'success' | 'warning' | 'danger'

export type TerminalTuiEntry = {
  at: number
  label: string
  tone: TerminalTuiTone
  content: string
}

const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2;90m'
const ROLE_COLUMN_WIDTH = 4
const TONE_COLOR: Record<TerminalTuiTone, string> = {
  user: '\x1b[1;36m',
  assistant: '\x1b[1;35m',
  info: '\x1b[1;34m',
  success: '\x1b[1;32m',
  warning: '\x1b[1;33m',
  danger: '\x1b[1;31m'
}

export function formatTerminalTuiEntry(entry: TerminalTuiEntry): string {
  const content = sanitizeTerminalText(entry.content).trim()
  if (!content) return ''

  const label = sanitizeTerminalText(entry.label)
    .replace(/\s/gu, '')
    .slice(0, ROLE_COLUMN_WIDTH)
    .toUpperCase()
    .padEnd(ROLE_COLUMN_WIDTH)
  const time = formatLocalTime(entry.at)
  const separator = `${ANSI_DIM}│${ANSI_RESET}`
  const firstPrefix = `${ANSI_DIM}${time}${ANSI_RESET} ${separator} ${TONE_COLOR[entry.tone]}${label}${ANSI_RESET} ${separator} `
  const continuationPrefix = `${' '.repeat(time.length + 1)}${separator} ${' '.repeat(ROLE_COLUMN_WIDTH)} ${separator} `
  const lines = content.split('\n')

  return `\r\n${firstPrefix}${lines[0]}${lines.slice(1).map((line) => `\r\n${continuationPrefix}${line}`).join('')}\r\n${ANSI_RESET}`
}

function formatLocalTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function sanitizeTerminalText(raw: string): string {
  return raw
    .replace(/\r\n/gu, '\n')
    .replace(/\x1b\][^\x07\r\n]*(?:\x07|\x1b\\)?/gu, '')
    .replace(/\x1b(?:P|X|\^|_)[\s\S]*?\x1b\\/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/\r/gu, '')
    .replace(/\t/gu, '  ')
}
