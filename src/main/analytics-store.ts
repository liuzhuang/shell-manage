import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type {
  AnalyticsEvent,
  AnalyticsFailureTopItem,
  AnalyticsFlowTopItem,
  AnalyticsLowUsageCandidate,
  AnalyticsSummary3d,
  AnalyticsViewerSnapshot
} from '../shared/types'

const ANALYTICS_SCHEMA_VERSION = 1
const FLUSH_EVENT_COUNT = 20
const FLUSH_INTERVAL_MS = 2_000
const KEEP_EVENTS_DAYS = 30
const KEEP_SUMMARY_DAYS = 180
const LOW_USAGE_COUNT_THRESHOLD = 3
const LOW_USAGE_COVERAGE_THRESHOLD = 0.05
const LOW_USAGE_STALE_MS = 48 * 60 * 60 * 1000
const TOP_FEATURE_LIMIT = 20
const TOP_FAILURE_LIMIT = 10
const TOP_FLOW_LIMIT = 20
const CONTEXT_MAX_LENGTH = 200
const PROTECTED_FEATURES = ['home.command.stop', 'editor.config.save']

function toDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function toCompactDateKey(timestamp: number): string {
  return toDateKey(timestamp).replace(/-/g, '')
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeContext(
  context: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!context) return undefined
  const allowed = new Set(['errorCode', 'mode', 'itemCount', 'skippedCount', 'source', 'traceId'])
  const next: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(context)) {
    if (!allowed.has(key)) continue
    if (typeof value === 'string') {
      next[key] = value.slice(0, CONTEXT_MAX_LENGTH)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      next[key] = value
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export class AnalyticsStore {
  private readonly baseDir = join(homedir(), '.shell-manage', 'analytics')
  private readonly eventsDir = join(this.baseDir, 'events')
  private readonly summaryDir = join(this.baseDir, 'summary')
  private readonly queue: AnalyticsEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<void> = Promise.resolve()

  async track(event: Omit<AnalyticsEvent, 'schemaVersion' | 'eventId' | 'timestamp'> & { timestamp?: number }): Promise<void> {
    const normalized: AnalyticsEvent = {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      eventId: randomUUID(),
      eventType: event.eventType,
      featureKey: event.featureKey.trim(),
      action: event.action.trim(),
      timestamp: event.timestamp ?? Date.now(),
      sessionId: event.sessionId.trim(),
      page: event.page?.trim() || undefined,
      result: event.result || 'unknown',
      durationMs: safeNumber(event.durationMs),
      context: normalizeContext(event.context as Record<string, unknown> | undefined)
    }
    if (!normalized.featureKey || !normalized.action || !normalized.sessionId) return
    this.queue.push(normalized)
    if (this.queue.length >= FLUSH_EVENT_COUNT) {
      await this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush()
      }, FLUSH_INTERVAL_MS)
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.queue.length === 0) return
    const pending = this.queue.splice(0, this.queue.length)
    this.flushPromise = this.flushPromise.then(async () => {
      await mkdir(this.eventsDir, { recursive: true })
      const grouped = new Map<string, AnalyticsEvent[]>()
      for (const event of pending) {
        const dateKey = toDateKey(event.timestamp)
        const list = grouped.get(dateKey) || []
        list.push(event)
        grouped.set(dateKey, list)
      }
      for (const [dateKey, events] of grouped.entries()) {
        const filePath = join(this.eventsDir, `events-${dateKey}.jsonl`)
        let existing = ''
        try {
          existing = await readFile(filePath, 'utf8')
        } catch {
          existing = ''
        }
        const appendText = events.map((item) => JSON.stringify(item)).join('\n')
        const nextContent = existing ? `${existing.trimEnd()}\n${appendText}\n` : `${appendText}\n`
        await writeFile(filePath, nextContent, 'utf8')
      }
      await this.cleanup()
    })
    await this.flushPromise
  }

  async aggregate3d(nowMs = Date.now()): Promise<{ summary: AnalyticsSummary3d; outputPath: string }> {
    await this.flush()
    await mkdir(this.summaryDir, { recursive: true })
    const windowEnd = nowMs
    const windowStart = windowEnd - 72 * 60 * 60 * 1000
    const events = await this.loadEventsInWindow(windowStart, windowEnd)
    const summary = this.buildSummary(events, windowStart, windowEnd)
    const fileName = `summary-${toCompactDateKey(windowStart)}-${toCompactDateKey(windowEnd)}.json`
    const outputPath = join(this.summaryDir, fileName)
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    await this.cleanup()
    return { summary, outputPath }
  }

  async getViewerSnapshot(limit = 200): Promise<AnalyticsViewerSnapshot> {
    await this.flush()
    await mkdir(this.eventsDir, { recursive: true })
    await mkdir(this.summaryDir, { recursive: true })
    const [eventFiles, summaryFiles] = await Promise.all([readdir(this.eventsDir), readdir(this.summaryDir)])
    const summaryCandidates = summaryFiles.filter((name) => /^summary-\d{8}-\d{8}\.json$/.test(name)).sort()
    let latestSummary: AnalyticsSummary3d | null = null
    if (summaryCandidates.length > 0) {
      const latestName = summaryCandidates[summaryCandidates.length - 1]
      if (latestName) {
        try {
          const text = await readFile(join(this.summaryDir, latestName), 'utf8')
          latestSummary = JSON.parse(text) as AnalyticsSummary3d
        } catch {
          latestSummary = null
        }
      }
    }
    const recentEvents = await this.loadRecentEvents(limit)
    return {
      latestSummary,
      recentEvents,
      eventFileCount: eventFiles.filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).length,
      summaryFileCount: summaryCandidates.length
    }
  }

  async shutdown(): Promise<void> {
    await this.flush()
  }

  private async cleanup(): Promise<void> {
    const now = Date.now()
    const eventExpire = now - KEEP_EVENTS_DAYS * 24 * 60 * 60 * 1000
    const summaryExpire = now - KEEP_SUMMARY_DAYS * 24 * 60 * 60 * 1000
    await this.cleanupByAge(this.eventsDir, /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/, eventExpire)
    await this.cleanupByAge(this.summaryDir, /^summary-(\d{8})-(\d{8})\.json$/, summaryExpire)
  }

  private async cleanupByAge(dir: string, pattern: RegExp, expireAt: number): Promise<void> {
    let files: string[] = []
    try {
      files = await readdir(dir)
    } catch {
      return
    }
    for (const fileName of files) {
      const matched = fileName.match(pattern)
      if (!matched) continue
      const raw = matched[1]
      const at = raw.includes('-')
        ? new Date(`${raw}T00:00:00.000Z`).getTime()
        : new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`).getTime()
      if (!Number.isFinite(at) || at >= expireAt) continue
      await rm(join(dir, fileName), { force: true })
    }
  }

  private async loadEventsInWindow(startAt: number, endAt: number): Promise<AnalyticsEvent[]> {
    let files: string[] = []
    try {
      files = await readdir(this.eventsDir)
    } catch {
      return []
    }
    const targetFiles = files.filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()
    const result: AnalyticsEvent[] = []
    for (const fileName of targetFiles) {
      const fullPath = join(this.eventsDir, fileName)
      let text = ''
      try {
        text = await readFile(fullPath, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as AnalyticsEvent
          if (parsed.timestamp < startAt || parsed.timestamp > endAt) continue
          result.push(parsed)
        } catch {
          // ignore broken line
        }
      }
    }
    result.sort((a, b) => a.timestamp - b.timestamp)
    return result
  }

  private async loadRecentEvents(limit: number): Promise<AnalyticsEvent[]> {
    let files: string[] = []
    try {
      files = await readdir(this.eventsDir)
    } catch {
      return []
    }
    const targetFiles = files.filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().reverse()
    const result: AnalyticsEvent[] = []
    for (const fileName of targetFiles) {
      if (result.length >= limit) break
      const fullPath = join(this.eventsDir, fileName)
      let text = ''
      try {
        text = await readFile(fullPath, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
      for (let i = lines.length - 1; i >= 0 && result.length < limit; i -= 1) {
        const line = lines[i]
        if (!line) continue
        try {
          result.push(JSON.parse(line) as AnalyticsEvent)
        } catch {
          // ignore
        }
      }
    }
    return result.sort((a, b) => b.timestamp - a.timestamp)
  }

  private buildSummary(events: AnalyticsEvent[], startAt: number, endAt: number): AnalyticsSummary3d {
    const sessionSet = new Set<string>()
    const featureStats = new Map<
      string,
      { count: number; sessions: Set<string>; success: number; fail: number; unknown: number; lastSeenAt?: number }
    >()
    const failStats = new Map<string, { featureKey: string; errorCode: string; count: number; featureTotal: number }>()
    const flowStats = new Map<string, number>()
    const bySession = new Map<string, AnalyticsEvent[]>()
    let successCount = 0
    let failCount = 0

    for (const event of events) {
      sessionSet.add(event.sessionId)
      const fs = featureStats.get(event.featureKey) || {
        count: 0,
        sessions: new Set<string>(),
        success: 0,
        fail: 0,
        unknown: 0,
        lastSeenAt: undefined
      }
      fs.count += 1
      fs.sessions.add(event.sessionId)
      if (event.result === 'success') {
        fs.success += 1
        successCount += 1
      } else if (event.result === 'fail') {
        fs.fail += 1
        failCount += 1
      } else {
        fs.unknown += 1
      }
      fs.lastSeenAt = Math.max(fs.lastSeenAt || 0, event.timestamp)
      featureStats.set(event.featureKey, fs)

      const list = bySession.get(event.sessionId) || []
      list.push(event)
      bySession.set(event.sessionId, list)
    }

    for (const [sessionId, list] of bySession.entries()) {
      const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp)
      bySession.set(sessionId, sorted)
      for (let i = 1; i < sorted.length; i += 1) {
        const from = sorted[i - 1]?.featureKey
        const to = sorted[i]?.featureKey
        if (!from || !to || from === to) continue
        const key = `${from} -> ${to}`
        flowStats.set(key, (flowStats.get(key) || 0) + 1)
      }
    }

    for (const event of events) {
      if (event.result !== 'fail') continue
      const errorCode =
        typeof event.context?.errorCode === 'string' && event.context.errorCode.trim().length > 0
          ? event.context.errorCode
          : 'UNKNOWN'
      const key = `${event.featureKey}::${errorCode}`
      const prev = failStats.get(key) || { featureKey: event.featureKey, errorCode, count: 0, featureTotal: 0 }
      prev.count += 1
      prev.featureTotal += featureStats.get(event.featureKey)?.count || 0
      failStats.set(key, prev)
    }

    const totalSessions = sessionSet.size || 1
    const featureUsageTop = [...featureStats.entries()]
      .map(([featureKey, stat]) => {
        const knownResults = stat.success + stat.fail
        const successRate = knownResults > 0 ? stat.success / knownResults : 1
        const idleRate = stat.count > 0 ? stat.unknown / stat.count : 0
        return {
          featureKey,
          count: stat.count,
          sessionCoverage: Number((stat.sessions.size / totalSessions).toFixed(4)),
          successRate: Number(successRate.toFixed(4)),
          ...(stat.unknown > 0 ? { idleRate: Number(idleRate.toFixed(4)) } : {})
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_FEATURE_LIMIT)

    const featureLowUsageCandidates: AnalyticsLowUsageCandidate[] = [...featureStats.entries()]
      .map(([featureKey, stat]) => {
        const coverage = stat.sessions.size / totalSessions
        const stale = (stat.lastSeenAt || 0) <= endAt - LOW_USAGE_STALE_MS
        const isProtected = PROTECTED_FEATURES.includes(featureKey)
        const lowUsage = stat.count < LOW_USAGE_COUNT_THRESHOLD && coverage < LOW_USAGE_COVERAGE_THRESHOLD
        return {
          featureKey,
          count: stat.count,
          sessionCoverage: Number(coverage.toFixed(4)),
          lastSeenAt: stat.lastSeenAt,
          protected: isProtected,
          reason: lowUsage && stale ? '3天内触发和覆盖均偏低，且最近48小时无活跃' : '未命中低使用阈值'
        }
      })
      .filter((item) => !item.protected && item.reason.startsWith('3天内'))
      .sort((a, b) => a.count - b.count)
      .slice(0, TOP_FEATURE_LIMIT)

    const failureTop: AnalyticsFailureTopItem[] = [...failStats.values()]
      .map((item) => ({
        featureKey: item.featureKey,
        errorCode: item.errorCode,
        count: item.count,
        failRate: Number((item.featureTotal > 0 ? item.count / item.featureTotal : 0).toFixed(4))
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_FAILURE_LIMIT)

    const flowTop: AnalyticsFlowTopItem[] = [...flowStats.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split(' -> ')
        return { from, to, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_FLOW_LIMIT)

    const totalEvents = events.length
    const totalKnownResult = successCount + failCount
    const overallSuccessRate = totalKnownResult > 0 ? successCount / totalKnownResult : 0

    return {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      generatedAt: Date.now(),
      window: {
        startAt,
        endAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        days: 3
      },
      overview: {
        totalEvents,
        totalSessions: sessionSet.size,
        activeFeatures: featureStats.size,
        overallSuccessRate: Number(overallSuccessRate.toFixed(4))
      },
      featureUsageTop,
      featureLowUsageCandidates,
      failureTop,
      flowTop,
      protectedFeatures: [...PROTECTED_FEATURES]
    }
  }
}
