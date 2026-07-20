import type { WidgetSpec } from '../../shared/types'

export function parseProbeOutput(parserRule: WidgetSpec['parserRule'] | undefined, stdout: string): unknown {
  const raw = stdout || ''
  if (!parserRule) return raw

  if (parserRule.type === 'regex') {
    if (!parserRule.pattern) return raw
    try {
      const regex = new RegExp(parserRule.pattern)
      const match = raw.match(regex)
      if (!match) return null
      return match.length > 1 ? match.slice(1) : match[0]
    } catch {
      return null
    }
  }

  if (parserRule.type === 'json') {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  if (parserRule.type === 'awk-table') {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return []

    const columns =
      parserRule.keysMapping && parserRule.keysMapping.length > 0
        ? parserRule.keysMapping
        : lines[0].split(/\s{2,}|\t+/).filter(Boolean)
    const bodyStart = parserRule.keysMapping && parserRule.keysMapping.length > 0 ? 0 : 1
    return lines.slice(bodyStart).map((line) => {
      const cells = line.split(/\s{2,}|\t+/).filter(Boolean)
      const row: Record<string, string> = {}
      columns.forEach((key, index) => {
        row[key] = cells[index] ?? ''
      })
      return row
    })
  }

  return raw
}
