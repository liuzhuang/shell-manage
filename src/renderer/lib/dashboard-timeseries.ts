export type DashboardTimeseriesPoint = { label: string; value: number }

export function timeseriesPointsFromProbe(parsed: unknown, stdout: string): DashboardTimeseriesPoint[] {
  const source = isRecord(parsed) && Array.isArray(parsed.points) ? parsed.points : parsed
  if (Array.isArray(source)) {
    return source.flatMap((item, index) => pointFromValue(item, index))
  }
  const text = typeof source === 'string' ? source : stdout
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const cells = line.split(/[\s,]+/u)
      const value = Number(cells.at(-1))
      if (!Number.isFinite(value)) return []
      return [{ label: cells.slice(0, -1).join(' ') || String(index + 1), value }]
    })
}

function pointFromValue(value: unknown, index: number): DashboardTimeseriesPoint[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ label: String(index + 1), value }]
  }
  if (Array.isArray(value) && value.length >= 2) {
    const numericValue = Number(value.at(-1))
    if (!Number.isFinite(numericValue)) return []
    return [{ label: value.slice(0, -1).map(String).join(' ') || String(index + 1), value: numericValue }]
  }
  if (!isRecord(value)) return []
  const entries = Object.entries(value)
  const explicitValue = value.value ?? value.y
  const numericEntry = Number.isFinite(Number(explicitValue))
    ? ['value', explicitValue] as const
    : entries.find(([, item]) => Number.isFinite(Number(item)))
  if (!numericEntry) return []
  const explicitLabel = value.label ?? value.time ?? value.timestamp ?? value.x
  const fallbackEntry = entries.find(([key, item]) => key !== numericEntry[0] && typeof item === 'string')
  const fallbackLabel = typeof fallbackEntry?.[1] === 'string' ? fallbackEntry[1] : undefined
  return [{ label: explicitLabel === undefined ? fallbackLabel || String(index + 1) : String(explicitLabel), value: Number(numericEntry[1]) }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}
