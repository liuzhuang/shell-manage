import { BrowserWindow, WebContentsView, app, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  BrowserActionResult,
  BrowserContentBounds,
  BrowserCreateTabRequest,
  BrowserProfileImportResult,
  BrowserProfileListResult,
  BrowserTabMeta,
  BrowserTheme
} from '../shared/browser-types'
import {
  BrowserNavigationError,
  domainFromBrowserUrl,
  isBrowserInternalUrl,
  resolveBrowserPageUrl,
  resolveFilePathToInternalUrl,
  titleFromBrowserUrl,
  type BrowserResolvedUrl
} from './browser-pages'
import { BrowserFrequentLinks } from './browser-frequent-links'
import { BrowserProfileImporter } from './browser-profile-importer'

type BrowserBroadcast = (channel: string, payload: unknown) => void
const PRIVACY_BLUR_CSS = `
  :root {
    filter: blur(18px) !important;
    transform: scale(1.04) !important;
    transform-origin: center !important;
    pointer-events: none !important;
  }
`

interface BrowserTabEntry {
  view: WebContentsView
  meta: BrowserTabMeta
}

function normalizeNavigationUrl(raw: string): BrowserResolvedUrl {
  return resolveBrowserPageUrl(raw || 'about:blank')
}

function displayUrlFromNavigation(navigationUrl: string): string {
  if (navigationUrl.startsWith('file://')) {
    try {
      const filePath = decodeURIComponent(new URL(navigationUrl).pathname)
      const internal = resolveFilePathToInternalUrl(filePath)
      if (internal) return internal
    } catch {
      // keep raw navigation url
    }
  }
  return navigationUrl
}

export class BrowserManager {
  constructor(private readonly emit: BrowserBroadcast) {
    this.configureSession()
  }

  private readonly browserSession = session.fromPartition('persist:shell-manage-browser')
  private readonly profileImporter = new BrowserProfileImporter()
  private readonly tabs = new Map<string, BrowserTabEntry>()
  private activeTabId: string | null = null
  private bounds: BrowserContentBounds | null = null
  private moduleActive = false
  private shuttingDown = false
  private privacyBlurred = false
  private readonly privacyCssKeys = new Map<string, string>()
  private privacyUpdate = Promise.resolve()
  private theme: BrowserTheme = 'dark'
  private readonly frequentLinks = new BrowserFrequentLinks(join(app.getPath('userData'), 'browser-frequent-links.json'))

  private getMainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  }

  listTabs(): BrowserTabMeta[] {
    return [...this.tabs.values()].map((entry) => ({ ...entry.meta }))
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getState(): { tabs: BrowserTabMeta[]; activeTabId: string | null; moduleActive: boolean; privacyBlurred: boolean } {
    return {
      tabs: this.listTabs(),
      activeTabId: this.activeTabId,
      moduleActive: this.moduleActive,
      privacyBlurred: this.privacyBlurred
    }
  }

  listImportableProfiles(): Promise<BrowserProfileListResult> {
    return this.profileImporter.list()
  }

  async importProfile(profileId: string): Promise<BrowserProfileImportResult> {
    const result = await this.profileImporter.import(profileId, this.browserSession)
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    if (result.imported > 0 && active && !isBrowserInternalUrl(active.meta.url)) active.view.webContents.reload()
    return result
  }

  setTheme(theme: BrowserTheme): void {
    this.theme = theme
    for (const entry of this.tabs.values()) {
      this.injectTheme(entry.view)
    }
  }

  setModuleActive(active: boolean): void {
    this.moduleActive = active
    if (!active) {
      for (const entry of this.tabs.values()) {
        entry.view.setVisible(false)
      }
      return
    }
    this.applyActiveBounds()
  }

  async setPrivacyBlur(blurred: boolean): Promise<void> {
    this.privacyBlurred = blurred
    await this.refreshPrivacyBlur()
  }

  setContentBounds(bounds: BrowserContentBounds): void {
    this.bounds = bounds
    this.applyActiveBounds()
  }

  async createTab(request: BrowserCreateTabRequest = {}): Promise<string> {
    const id = randomUUID()
    let resolved: BrowserResolvedUrl
    try {
      resolved = normalizeNavigationUrl(request.url || 'about:blank')
    } catch {
      resolved = normalizeNavigationUrl('about:blank')
    }
    const view = new WebContentsView({
      webPreferences: {
        session: this.browserSession,
        sandbox: true
      }
    })

    const meta: BrowserTabMeta = {
      id,
      url: resolved.kind === 'internal' ? resolved.displayUrl : resolved.url,
      title: resolved.kind === 'internal' ? titleFromBrowserUrl(resolved.displayUrl) : domainFromBrowserUrl(resolved.url),
      referrerCommand: request.referrerCommand,
      loading: true
    }
    if (resolved.kind === 'external') this.frequentLinks.recordOpen(resolved.url, meta.title)

    this.tabs.set(id, { view, meta })
    this.attachView(view)
    this.wireWebContents(view, id)
    if (resolved.kind === 'internal') await this.loadResolved(view, resolved).catch(() => undefined)
    else void this.loadResolved(view, resolved).catch(() => undefined)

    this.setActiveTab(id)

    this.emit('browser:tab-created', { ...meta })
    this.emitPageInfo()
    this.injectFrequentLinksToInternalPages()
    return id
  }

  closeTab(tabId: string): BrowserActionResult {
    const entry = this.tabs.get(tabId)
    if (!entry) return { ok: false, error: '标签页不存在', activeTabId: this.activeTabId }
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(entry.view)
      } catch {
        // view may already be detached
      }
    }
    entry.view.webContents.close()
    this.tabs.delete(tabId)
    this.privacyCssKeys.delete(tabId)
    if (!this.shuttingDown) this.emit('browser:tab-closed', { tabId })

    if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.keys()]
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null
      if (this.activeTabId) this.setActiveTab(this.activeTabId)
      else this.emitPageInfo()
    }
    return { ok: true, activeTabId: this.activeTabId }
  }

  setActiveTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return
    for (const entry of this.tabs.values()) {
      entry.view.setVisible(false)
    }
    this.activeTabId = tabId
    const active = this.tabs.get(tabId)
    if (active && this.moduleActive) {
      active.view.setVisible(true)
      this.applyBoundsToView(active.view)
    }
    this.emitPageInfo()
  }

  async navigate(tabId: string, url: string): Promise<BrowserActionResult> {
    const entry = this.tabs.get(tabId)
    if (!entry) return { ok: false, error: '标签页不存在', activeTabId: this.activeTabId }
    this.setActiveTab(tabId)
    let resolved: BrowserResolvedUrl
    try {
      resolved = normalizeNavigationUrl(url)
    } catch (error) {
      const message =
        error instanceof BrowserNavigationError
          ? error.message
          : error instanceof Error
            ? error.message
            : '无法打开该地址'
      this.patchMeta(tabId, { loading: false })
      return { ok: false, error: message, activeTabId: this.activeTabId }
    }
    const displayUrl = resolved.kind === 'internal' ? resolved.displayUrl : resolved.url
    this.patchMeta(tabId, {
      url: displayUrl,
      title: titleFromBrowserUrl(displayUrl),
      loading: true
    })
    if (resolved.kind === 'internal') {
      try {
        await this.loadResolved(entry.view, resolved)
      } catch {
        this.patchMeta(tabId, { loading: false })
        return { ok: false, error: '无法打开内部页面', activeTabId: this.activeTabId }
      }
    } else {
      void this.loadResolved(entry.view, resolved).catch(() => undefined)
    }
    return { ok: true, activeTabId: this.activeTabId }
  }

  goBack(tabId: string): void {
    const entry = this.tabs.get(tabId)
    const wc = entry?.view.webContents
    if (!wc?.canGoBack()) return
    wc.goBack()
  }

  goForward(tabId: string): void {
    const entry = this.tabs.get(tabId)
    const wc = entry?.view.webContents
    if (!wc?.canGoForward()) return
    wc.goForward()
  }

  reload(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    this.patchMeta(tabId, { loading: true })
    entry.view.webContents.reload()
  }

  bossHide(mode: 'switch-page' | 'tray'): void {
    this.setModuleActive(false)
    if (mode === 'tray') {
      const win = this.getMainWindow()
      if (!win || win.isDestroyed()) return
      win.hide()
      if (process.platform === 'darwin') app.dock.hide()
    }
  }

  async destroyAll(): Promise<void> {
    this.shuttingDown = true
    for (const tabId of [...this.tabs.keys()]) {
      this.closeTab(tabId)
    }
    this.activeTabId = null
    this.bounds = null
    this.moduleActive = false
    this.privacyBlurred = false
    this.privacyCssKeys.clear()
  }

  private configureSession(): void {
    this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  }

  private async loadResolved(view: WebContentsView, resolved: BrowserResolvedUrl): Promise<void> {
    if (resolved.kind === 'internal') {
      await view.webContents.loadFile(resolved.filePath, { query: { theme: this.theme } })
      this.injectTheme(view)
      this.injectFrequentLinks(view)
      return
    }
    await view.webContents.loadURL(resolved.url)
  }

  private injectTheme(view: WebContentsView): void {
    if (!view.webContents.getURL().startsWith('file://')) return
    const theme = this.theme
    void view.webContents
      .executeJavaScript(
        `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.body?.setAttribute('data-theme', ${JSON.stringify(theme)});`,
        true
      )
      .catch(() => undefined)
  }

  private injectFrequentLinks(view: WebContentsView): void {
    if (!view.webContents.getURL().startsWith('file://')) return
    const links = this.frequentLinks.list(6)
    void view.webContents
      .executeJavaScript(
        `window.__SHELL_MANAGE_FREQUENT_LINKS__ = ${JSON.stringify(links)}; window.__SHELL_MANAGE_SET_FREQUENT_LINKS__?.(window.__SHELL_MANAGE_FREQUENT_LINKS__);`,
        true
      )
      .catch(() => undefined)
  }

  private injectFrequentLinksToInternalPages(): void {
    for (const entry of this.tabs.values()) {
      this.injectFrequentLinks(entry.view)
    }
  }

  private attachView(view: WebContentsView): void {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.contentView.addChildView(view)
    view.setVisible(false)
  }

  private applyActiveBounds(): void {
    if (!this.moduleActive || !this.activeTabId) return
    const entry = this.tabs.get(this.activeTabId)
    if (!entry) return
    entry.view.setVisible(true)
    this.applyBoundsToView(entry.view)
  }

  private applyBoundsToView(view: WebContentsView): void {
    if (!this.bounds || this.bounds.width <= 0 || this.bounds.height <= 0) return
    view.setBounds({
      x: Math.round(this.bounds.x),
      y: Math.round(this.bounds.y),
      width: Math.round(this.bounds.width),
      height: Math.round(this.bounds.height)
    })
  }

  private wireWebContents(view: WebContentsView, tabId: string): void {
    const wc = view.webContents

    wc.setWindowOpenHandler(({ url }) => {
      if (url) void this.createTab({ url }).catch(() => undefined)
      return { action: 'deny' }
    })

    wc.on('did-start-loading', () => {
      this.patchMeta(tabId, { loading: true })
    })

    wc.on('did-stop-loading', () => {
      this.patchMeta(tabId, { loading: false })
    })

    wc.on('did-finish-load', () => {
      void this.refreshPrivacyBlur()
    })

    wc.on('did-navigate', (_event, navigationUrl) => {
      const displayUrl = displayUrlFromNavigation(navigationUrl)
      const title = wc.getTitle() || titleFromBrowserUrl(displayUrl)
      this.patchMeta(tabId, { url: displayUrl, title })
      this.frequentLinks.recordVisit(displayUrl, title)
      this.injectFrequentLinksToInternalPages()
    })

    wc.on('did-navigate-in-page', (_event, navigationUrl) => {
      const displayUrl = displayUrlFromNavigation(navigationUrl)
      this.patchMeta(tabId, { url: displayUrl })
    })

    wc.on('page-title-updated', (_event, title) => {
      const entry = this.tabs.get(tabId)
      const displayUrl = entry?.meta.url || ''
      if (isBrowserInternalUrl(displayUrl)) {
        this.patchMeta(tabId, { title: titleFromBrowserUrl(displayUrl) })
        return
      }
      this.patchMeta(tabId, { title: title || wc.getTitle() })
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      this.patchMeta(tabId, { favicon: favicons.find(Boolean) })
    })

    wc.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.patchMeta(tabId, { loading: true, favicon: undefined })
    })
  }

  private refreshPrivacyBlur(): Promise<void> {
    this.privacyUpdate = this.privacyUpdate.then(async () => {
      await Promise.all([...this.tabs.entries()].map(([tabId, entry]) => this.applyPrivacyBlur(tabId, entry)))
    })
    return this.privacyUpdate
  }

  private async applyPrivacyBlur(tabId: string, entry?: BrowserTabEntry): Promise<void> {
    const previousKey = this.privacyCssKeys.get(tabId)
    if (previousKey && entry && !entry.view.webContents.isDestroyed()) {
      await entry.view.webContents.removeInsertedCSS(previousKey).catch(() => undefined)
    }
    this.privacyCssKeys.delete(tabId)
    if (!this.privacyBlurred || !entry || entry.view.webContents.isDestroyed()) return
    const key = await entry.view.webContents.insertCSS(PRIVACY_BLUR_CSS).catch(() => '')
    if (!key) return
    if (this.privacyBlurred && this.tabs.get(tabId) === entry) {
      this.privacyCssKeys.set(tabId, key)
      return
    }
    await entry.view.webContents.removeInsertedCSS(key).catch(() => undefined)
  }

  private patchMeta(tabId: string, patch: Partial<Omit<BrowserTabMeta, 'id'>>): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    entry.meta = { ...entry.meta, ...patch, id: tabId }
    this.emit('browser:tab-updated', { id: tabId, ...patch })
    if (tabId === this.activeTabId) this.emitPageInfo()
  }

  private emitPageInfo(): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId)?.meta : undefined
    this.emit('browser:page-info', {
      activeTabId: this.activeTabId,
      domain: active ? domainFromBrowserUrl(active.url) : '',
      title: active?.title || ''
    })
  }
}
