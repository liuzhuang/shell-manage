const MAX_CONTEXT_LINES = 120
const MAX_CONTEXT_CHARS = 12_000
const MAX_LINE_CHARS = 1_000

export function buildTerminalContextLines(raw: string): string[] {
  const sanitized = redactSensitiveText(raw)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')

  const lines = sanitized
    .split(/\r?\n/u)
    .map((line) => line.replace(/\r/gu, '').trim().slice(-MAX_LINE_CHARS))
    .filter(Boolean)
    .slice(-MAX_CONTEXT_LINES)

  const result: string[] = []
  let remaining = MAX_CONTEXT_CHARS
  for (let index = lines.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const line = lines[index]
    const clipped = line.length <= remaining ? line : line.slice(-remaining)
    result.unshift(clipped)
    remaining -= clipped.length + 1
  }
  return result
}

export function redactSensitiveText(raw: string): string {
  return raw
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/giu, '[PRIVATE KEY REDACTED]')
    .replace(
      /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|lsv2_(?:pt|sk)_[A-Za-z0-9_-]{12,}|ls__[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,})\b/gu,
      '[REDACTED]'
    )
    .split(/\r?\n/u)
    .map(redactTerminalLine)
    .join('\n')
}

export function redactTerminalLine(line: string): string {
  return line
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/gu, '[REDACTED]')
    .replace(
      /(\b(?:database|db|redis|mongodb?)[_-]?(?:url|uri)\b["']?\s*[:=]\s*|\b(?:connection[_-]?string|dsn)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/giu,
      '$1[REDACTED]'
    )
    .replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^@\s]+@/gu, '$1[REDACTED]@')
    .replace(/(\b(?:set-cookie|cookie)\b\s*:\s*).*/giu, '$1[REDACTED]')
    .replace(
      /(\bcurl\b[^\r\n]*?(?:\s-u(?:=|\s+)?|\s--(?:user|proxy-user)(?:=|\s+)))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(
      /(\bsshpass\b[^\r\n]*?\s-p(?:=|\s+)?)(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(
      /(\bdocker\s+login\b[^\r\n]*?(?:\s-p(?:=|\s+)?|\s--password(?:=|\s+)))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(
      /(\bredis-cli\b[^\r\n]*?(?:\s-a(?:=|\s+)?|\s--pass(?:=|\s+)))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(
      /(\bmysql\b[^\r\n]*?(?:\s-p(?:=|\s+)?|\s--password(?:=|\s+)))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(
      /(\b(?:MYSQL_PWD|REDISCLI_AUTH|SSHPASS|PGPASSWORD)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gu,
      '$1[REDACTED]'
    )
    .replace(
      /(\s--(?:password|passwd|token|api[_-]?key|client[_-]?secret|secret[_-]?access[_-]?key|cookie)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      '$1[REDACTED]'
    )
    .replace(/(\b[A-Za-z0-9_]*authorization[A-Za-z0-9_]*\b["']?\s*[:=]\s*).*/giu, '$1[REDACTED]')
    .replace(
      /(\b[A-Za-z0-9_]*(?:password|passwd|token|secret|api[_-]?key|cookie|session[_-]?id|credential|private[_-]?key)[A-Za-z0-9_]*\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/giu,
      '$1[REDACTED]'
    )
}
