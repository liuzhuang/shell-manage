import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const BROWSER_PAGE_IDS = ['newtab', 'tutorial', 'promo'] as const
export type BrowserPageId = (typeof BROWSER_PAGE_IDS)[number]

const BROWSER_PAGE_TITLES: Record<BrowserPageId, string> = {
  newtab: '起始页',
  tutorial: '快速教程',
  promo: '产品亮点'
}

const INTERNAL_URL_PREFIX = 'shell-manage://browser/'

export type BrowserResolvedUrl =
  | { kind: 'internal'; pageId: BrowserPageId; displayUrl: string; filePath: string }
  | { kind: 'external'; url: string }

export class BrowserNavigationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserNavigationError'
  }
}

export function browserPageDisplayUrl(pageId: BrowserPageId): string {
  return `${INTERNAL_URL_PREFIX}${pageId}`
}

export function browserPageTitle(pageId: BrowserPageId): string {
  return BROWSER_PAGE_TITLES[pageId]
}

export function isBrowserInternalUrl(url: string): boolean {
  return url.startsWith(INTERNAL_URL_PREFIX)
}

export function resolveBrowserPagePath(pageId: BrowserPageId): string {
  const fileName = `${pageId}.html`
  const packaged = join(process.resourcesPath, 'browser-pages', fileName)
  if (app.isPackaged && existsSync(packaged)) return packaged
  const dev = join(process.cwd(), 'resources', 'browser-pages', fileName)
  if (existsSync(dev)) return dev
  return packaged
}

function parseInternalPageId(input: string): BrowserPageId | null {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'about:blank' || trimmed === '') return 'newtab'
  if (trimmed.startsWith(INTERNAL_URL_PREFIX)) {
    const id = trimmed.slice(INTERNAL_URL_PREFIX.length).replace(/\/$/, '') as BrowserPageId
    if (BROWSER_PAGE_IDS.includes(id)) return id
  }
  return null
}

export function resolveBrowserPageUrl(raw: string): BrowserResolvedUrl {
  const pageId = parseInternalPageId(raw)
  if (pageId) {
    return {
      kind: 'internal',
      pageId,
      displayUrl: browserPageDisplayUrl(pageId),
      filePath: resolveBrowserPagePath(pageId)
    }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    const fallback: BrowserPageId = 'newtab'
    return {
      kind: 'internal',
      pageId: fallback,
      displayUrl: browserPageDisplayUrl(fallback),
      filePath: resolveBrowserPagePath(fallback)
    }
  }

  if (/^https?:\/\//i.test(trimmed)) return { kind: 'external', url: trimmed }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new BrowserNavigationError('仅支持 http/https 网页地址，其他协议请使用系统浏览器打开。')
  }
  if (trimmed.startsWith('localhost') || /^[\w.-]+:\d+/.test(trimmed)) {
    return { kind: 'external', url: `http://${trimmed}` }
  }
  return { kind: 'external', url: `https://${trimmed}` }
}

export function resolveFilePathToInternalUrl(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  for (const pageId of BROWSER_PAGE_IDS) {
    if (normalized.endsWith(`/browser-pages/${pageId}.html`) || normalized.endsWith(`/${pageId}.html`)) {
      return browserPageDisplayUrl(pageId)
    }
  }
  return null
}

export function domainFromBrowserUrl(url: string): string {
  if (isBrowserInternalUrl(url)) return 'ShellManage'
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function titleFromBrowserUrl(url: string, fallbackTitle?: string): string {
  if (isBrowserInternalUrl(url)) {
    const id = url.slice(INTERNAL_URL_PREFIX.length).replace(/\/$/, '') as BrowserPageId
    if (BROWSER_PAGE_IDS.includes(id)) return browserPageTitle(id)
  }
  return fallbackTitle || domainFromBrowserUrl(url)
}
