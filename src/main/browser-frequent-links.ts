import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface BrowserFrequentLink {
  url: string
  title: string
  domain: string
  openCount: number
  visitCount: number
  score: number
  lastVisitedAt: number
}

interface BrowserFrequentLinkRecord {
  url: string
  title: string
  domain: string
  openCount: number
  visitCount: number
  lastVisitedAt: number
}

export class BrowserFrequentLinks {
  private readonly records = new Map<string, BrowserFrequentLinkRecord>()

  constructor(private readonly storagePath?: string) {
    this.load()
  }

  recordOpen(url: string, title?: string): void {
    this.record(url, title, 'openCount')
  }

  recordVisit(url: string, title?: string): void {
    this.record(url, title, 'visitCount')
  }

  list(limit = 6): BrowserFrequentLink[] {
    return [...this.records.values()]
      .map((record) => ({
        ...record,
        score: record.openCount + record.visitCount
      }))
      .sort((a, b) => b.score - a.score || b.lastVisitedAt - a.lastVisitedAt || a.title.localeCompare(b.title))
      .slice(0, limit)
  }

  private record(url: string, title: string | undefined, counter: 'openCount' | 'visitCount'): void {
    const normalizedUrl = normalizeFrequentLinkUrl(url)
    if (!normalizedUrl) return
    const existing = this.records.get(normalizedUrl)
    const now = Date.now()
    const displayTitle = cleanTitle(title) || domainFromUrl(normalizedUrl)
    if (existing) {
      existing[counter] += 1
      existing.title = displayTitle
      existing.lastVisitedAt = now
      this.save()
      return
    }
    this.records.set(normalizedUrl, {
      url: normalizedUrl,
      title: displayTitle,
      domain: domainFromUrl(normalizedUrl),
      openCount: counter === 'openCount' ? 1 : 0,
      visitCount: counter === 'visitCount' ? 1 : 0,
      lastVisitedAt: now
    })
    this.save()
  }

  private load(): void {
    if (!this.storagePath) return
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf-8')) as BrowserFrequentLinkRecord[]
      if (!Array.isArray(raw)) return
      for (const item of raw) {
        const url = normalizeFrequentLinkUrl(String(item.url || ''))
        if (!url) continue
        this.records.set(url, {
          url,
          title: cleanTitle(item.title) || domainFromUrl(url),
          domain: domainFromUrl(url),
          openCount: Math.max(0, Number(item.openCount) || 0),
          visitCount: Math.max(0, Number(item.visitCount) || 0),
          lastVisitedAt: Math.max(0, Number(item.lastVisitedAt) || 0)
        })
      }
    } catch {
      // Ignore missing or malformed cache; browsing still works.
    }
  }

  private save(): void {
    if (!this.storagePath) return
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true })
      writeFileSync(this.storagePath, JSON.stringify([...this.records.values()], null, 2))
    } catch {
      // Best effort; frequent links should never block navigation.
    }
  }
}

export function normalizeFrequentLinkUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith('shell-manage://browser/') || trimmed.startsWith('file://')) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    return parsed.href
  } catch {
    return null
  }
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function cleanTitle(title: string | undefined): string {
  return (title || '').trim().slice(0, 80)
}
