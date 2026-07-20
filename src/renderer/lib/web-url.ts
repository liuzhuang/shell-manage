import type { CommandConfig } from '../../shared/types'

function normalizeWebUrl(raw: string): string {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  return withProtocol.replace('0.0.0.0', 'localhost')
}

function extractPortFromCommand(command: string): string | undefined {
  const patterns = [
    /--port(?:=|\s+)(\d{2,5})/i,
    /(?:^|\s)-p\s+(\d{2,5})(?:\s|$)/i,
    /\bPORT\s*=\s*(\d{2,5})\b/i,
    /localhost:(\d{2,5})/i,
    /127\.0\.0\.1:(\d{2,5})/i,
    /0\.0\.0\.0:(\d{2,5})/i
  ]

  for (const pattern of patterns) {
    const matched = command.match(pattern)
    if (matched?.[1]) return matched[1]
  }
  return undefined
}

function extractWebUrlFromLogs(logs: string[]): string | undefined {
  const pattern = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?[^\s]*)/i
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index]
    const matched = line.match(pattern)
    if (matched?.[1]) return normalizeWebUrl(matched[1])
  }
  return undefined
}

export function resolveCommandWebUrl(command: CommandConfig, logs: string[] = []): string | undefined {
  if (command.webUrl) return normalizeWebUrl(command.webUrl)

  const logUrl = extractWebUrlFromLogs(logs)
  if (logUrl) return logUrl

  const port = extractPortFromCommand(command.command)
  if (port) return `http://localhost:${port}`

  return undefined
}
