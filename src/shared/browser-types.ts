export interface BrowserContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTabMeta {
  id: string
  url: string
  title: string
  favicon?: string
  referrerCommand?: string
  loading?: boolean
}

export interface BrowserCreateTabRequest {
  url?: string
  referrerCommand?: string
}

export type BrowserTheme = 'dark' | 'light'

export interface BrowserTabUpdatedPayload {
  id: string
  url?: string
  title?: string
  favicon?: string
  loading?: boolean
}

export interface BrowserActionResult {
  ok: boolean
  error?: string
  activeTabId?: string | null
}

export interface BrowserProfileSummary {
  id: string
  source: string
  appName: string
  profileName: string
}

export interface BrowserProfileListResult {
  supported: boolean
  profiles: BrowserProfileSummary[]
  error?: string
}

export interface BrowserProfileImportResult {
  ok: boolean
  profileId: string
  appName?: string
  profileName?: string
  imported: number
  skipped: number
  failed: number
  error?: string
}

export interface BrowserPageInfoPayload {
  activeTabId: string | null
  domain: string
  title: string
}

export type BrowserBossHideMode = 'switch-page' | 'tray'

export const BROWSER_INTERNAL_URL_PREFIX = 'shell-manage://browser/'

export const BROWSER_NEWTAB_URL = `${BROWSER_INTERNAL_URL_PREFIX}newtab`

export const BROWSER_PAGE_LABELS: Record<string, string> = {
  newtab: '起始页',
  tutorial: '快速教程',
  promo: '产品亮点'
}
