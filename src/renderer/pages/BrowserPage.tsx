import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  BROWSER_INTERNAL_URL_PREFIX,
  BROWSER_NEWTAB_URL,
  BROWSER_PAGE_LABELS,
  type BrowserProfileSummary,
  type BrowserTabMeta
} from '../../shared/browser-types'
import { XIcon } from '../components/icons/XIcon'

const PRIVACY_BLUR_SETTING_KEY = 'browser.privacyBlurOnBlur.v1'
const LAST_ACTIVE_URL_KEY = 'browser.lastActiveUrl.v1'
const BROWSER_SESSION_KEY = 'browser.session.v1'

interface StoredBrowserSession {
  urls: string[]
  activeIndex: number
}

type BrowserState = Awaited<ReturnType<typeof window.api.browserGetState>>
let browserInitializationTail: Promise<void> = Promise.resolve()

function readStoredBrowserSession(): StoredBrowserSession | null {
  try {
    const raw = window.localStorage.getItem(BROWSER_SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { urls?: unknown; activeIndex?: unknown }
      if (Array.isArray(parsed.urls)) {
        const urls = parsed.urls
          .filter((url): url is string => typeof url === 'string')
          .map((url) => url.trim())
          .filter((url) => url && url !== BROWSER_NEWTAB_URL && url !== 'about:blank')
        if (urls.length > 0) {
          const activeIndex = Number.isInteger(parsed.activeIndex) ? Number(parsed.activeIndex) : urls.length - 1
          return { urls, activeIndex: Math.max(0, Math.min(activeIndex, urls.length - 1)) }
        }
      }
    }
  } catch {
    // Fall back to the legacy single-tab value below.
  }

  const legacyUrl = window.localStorage.getItem(LAST_ACTIVE_URL_KEY)?.trim()
  return legacyUrl && legacyUrl !== BROWSER_NEWTAB_URL && legacyUrl !== 'about:blank'
    ? { urls: [legacyUrl], activeIndex: 0 }
    : null
}

function saveBrowserSession(tabs: BrowserTabMeta[], activeTabId: string): void {
  const restorable = tabs.filter((tab) => tab.url && tab.url !== BROWSER_NEWTAB_URL && tab.url !== 'about:blank')
  window.localStorage.removeItem(LAST_ACTIVE_URL_KEY)
  if (restorable.length === 0) {
    window.localStorage.removeItem(BROWSER_SESSION_KEY)
    return
  }
  const activeIndex = restorable.findIndex((tab) => tab.id === activeTabId)
  window.localStorage.setItem(BROWSER_SESSION_KEY, JSON.stringify({
    urls: restorable.map((tab) => tab.url),
    activeIndex: activeIndex >= 0 ? activeIndex : restorable.length - 1
  }))
}

function initializeBrowserTabs(storedSession: StoredBrowserSession | null): Promise<BrowserState> {
  const initialization = browserInitializationTail.then(async () => {
    const state = await window.api.browserGetState()
    if (state.tabs.length > 0) return state

    const restoredIds: string[] = []
    for (const url of storedSession?.urls ?? []) {
      const { tabId } = await window.api.browserCreateTab({ url })
      restoredIds.push(tabId)
    }
    if (restoredIds.length === 0) {
      const { tabId } = await window.api.browserCreateTab()
      restoredIds.push(tabId)
    }
    const active = restoredIds[storedSession?.activeIndex ?? 0] ?? restoredIds[restoredIds.length - 1]
    await window.api.browserSetActiveTab(active)
    return window.api.browserGetState()
  })
  browserInitializationTail = initialization.then(() => undefined, () => undefined)
  return initialization
}

export interface BrowserLaunchRequest {
  url?: string
  referrerCommand?: string
}

let browserPageCache: {
  tabs: BrowserTabMeta[]
  activeTabId: string
  urlDraft: string
} | null = null

function syncCache(tabs: BrowserTabMeta[], activeTabId: string, urlDraft: string) {
  browserPageCache = { tabs, activeTabId, urlDraft }
}

function tabLabel(tab: BrowserTabMeta): string {
  if (tab.title && tab.title !== tab.url && tab.title !== '新标签页') return tab.title
  if (tab.url.startsWith(BROWSER_INTERNAL_URL_PREFIX)) {
    const pageId = tab.url.slice(BROWSER_INTERNAL_URL_PREFIX.length).replace(/\/$/, '')
    return BROWSER_PAGE_LABELS[pageId] || tab.title || '起始页'
  }
  if (tab.url === 'about:blank') return '起始页'
  try {
    return new URL(tab.url).host || tab.url
  } catch {
    return tab.title || '新标签页'
  }
}

function addressLabel(url: string): string {
  if (url.startsWith(BROWSER_INTERNAL_URL_PREFIX)) {
    const pageId = url.slice(BROWSER_INTERNAL_URL_PREFIX.length).replace(/\/$/, '')
    return BROWSER_PAGE_LABELS[pageId] || '起始页'
  }
  if (url === 'about:blank') return '起始页'
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function BrowserPage({
  launch,
  onLaunchConsumed,
  onPageInfo,
  onTrackAction
}: {
  launch?: BrowserLaunchRequest | null
  onLaunchConsumed?: () => void
  onPageInfo?: (info: { domain: string; title: string }) => void
  onTrackAction?: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const launchHandledRef = useRef<string | null>(null)

  const [tabs, setTabs] = useState<BrowserTabMeta[]>(() => browserPageCache?.tabs ?? [])
  const [activeTabId, setActiveTabId] = useState(() => browserPageCache?.activeTabId ?? '')
  const activeTabIdRef = useRef(activeTabId)
  const [urlDraft, setUrlDraft] = useState(() => browserPageCache?.urlDraft ?? '')
  const [storedSession] = useState(readStoredBrowserSession)
  const [sessionReady, setSessionReady] = useState(false)
  const [urlEditing, setUrlEditing] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [loading, setLoading] = useState(false)
  const [profilePanelOpen, setProfilePanelOpen] = useState(false)
  const [profiles, setProfiles] = useState<BrowserProfileSummary[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profileImporting, setProfileImporting] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileResult, setProfileResult] = useState('')
  const [privacyBlurEnabled, setPrivacyBlurEnabled] = useState(
    () => window.localStorage.getItem(PRIVACY_BLUR_SETTING_KEY) === '1'
  )
  const [privacyBlurred, setPrivacyBlurred] = useState(false)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const reportBounds = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    void window.api.browserSetContentBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
  }, [])

  const selectTab = useCallback(async (tabId: string) => {
    setUrlError('')
    setActiveTabId(tabId)
    await window.api.browserSetActiveTab(tabId)
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) setUrlDraft(tab.url)
    reportBounds()
  }, [reportBounds, tabs])

  const createTab = useCallback(async (request?: { url?: string; referrerCommand?: string }) => {
    setUrlError('')
    const { tabId } = await window.api.browserCreateTab(request)
    await window.api.browserSetActiveTab(tabId)
    setActiveTabId(tabId)
    setUrlDraft(request?.url?.trim() || BROWSER_NEWTAB_URL)
    onTrackAction?.('browser.tab.open', 'create', 'success')
    reportBounds()
    return tabId
  }, [onTrackAction, reportBounds])

  const closeTab = useCallback(async (tabId: string) => {
    if (tabs.length <= 1) return
    const result = await window.api.browserCloseTab(tabId)
    if (!result.ok) {
      setUrlError(result.error || '关闭标签页失败')
      return
    }
    const state = await window.api.browserGetState()
    setTabs(state.tabs)
    const nextActive = result.activeTabId || state.activeTabId || ''
    setActiveTabId(nextActive)
    const tab = state.tabs.find((item) => item.id === nextActive)
    if (tab) setUrlDraft(tab.url)
    setUrlError('')
    onTrackAction?.('browser.tab.close', 'click', 'success')
  }, [onTrackAction, tabs.length])

  const toggleProfileImporter = async () => {
    if (profilePanelOpen) {
      setProfilePanelOpen(false)
      return
    }
    setProfilePanelOpen(true)
    setProfilesLoading(true)
    setProfileError('')
    setProfileResult('')
    try {
      const result = await window.api.browserListProfiles()
      setProfiles(result.profiles)
      setSelectedProfileId((current) =>
        result.profiles.some((profile) => profile.id === current) ? current : result.profiles[0]?.id || ''
      )
      if (result.error) setProfileError(result.error)
    } catch (error) {
      setProfiles([])
      setSelectedProfileId('')
      setProfileError(error instanceof Error ? error.message : '无法读取浏览器 Profile。')
    } finally {
      setProfilesLoading(false)
    }
  }

  const importSelectedProfile = async () => {
    if (!selectedProfileId || profileImporting) return
    setProfileImporting(true)
    setProfileError('')
    setProfileResult('')
    try {
      const result = await window.api.browserImportProfile(selectedProfileId)
      const details = [
        `已导入 ${result.imported} 个 Cookie`,
        result.skipped > 0 ? `跳过 ${result.skipped} 个` : '',
        result.failed > 0 ? `失败 ${result.failed} 个` : ''
      ].filter(Boolean)
      setProfileResult(details.join('，'))
      if (result.error) setProfileError(result.error)
      onTrackAction?.('browser.profile.import', 'submit', result.imported > 0 ? 'success' : 'fail')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '浏览器 Profile 导入失败。')
      onTrackAction?.('browser.profile.import', 'submit', 'fail')
    } finally {
      setProfileImporting(false)
    }
  }

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    syncCache(tabs, activeTabId, urlDraft)
    if (sessionReady) saveBrowserSession(tabs, activeTabId)
  }, [tabs, activeTabId, urlDraft, sessionReady])

  useEffect(() => {
    let focusEvents = 0
    const applyWindowFocus = (focused: boolean) => {
      const blurred = privacyBlurEnabled && !focused
      setPrivacyBlurred(blurred)
      void window.api.browserSetPrivacyBlur(blurred)
    }
    const offFocusChanged = window.api.onWindowFocusChanged(({ focused }) => {
      focusEvents += 1
      applyWindowFocus(focused)
    })
    void window.api.getWindowFocused().then(({ focused }) => {
      if (focusEvents === 0) applyWindowFocus(focused)
    })
    return () => {
      offFocusChanged()
      void window.api.browserSetPrivacyBlur(false)
    }
  }, [privacyBlurEnabled])

  useEffect(() => {
    let mounted = true
    void window.api.browserSetModuleActive(true)

    const offCreated = window.api.onBrowserTabCreated((payload) => {
      setTabs((prev) => (prev.some((t) => t.id === payload.id) ? prev : [...prev, payload]))
    })
    const offUpdated = window.api.onBrowserTabUpdated((payload) => {
      setTabs((prev) => prev.map((t) => (t.id === payload.id ? { ...t, ...payload } : t)))
      if (payload.id === activeTabIdRef.current) {
        if (payload.url) setUrlDraft(payload.url)
        if (payload.loading !== undefined) setLoading(payload.loading)
      }
    })
    const offClosed = window.api.onBrowserTabClosed(({ tabId }) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId)
        if (activeTabIdRef.current === tabId && next.length > 0) {
          const fallback = next[next.length - 1].id
          setActiveTabId(fallback)
          void window.api.browserSetActiveTab(fallback)
          setUrlDraft(next[next.length - 1].url)
        }
        return next
      })
    })
    const offPageInfo = window.api.onBrowserPageInfo((info) => {
      onPageInfo?.({ domain: info.domain, title: info.title })
    })

    const el = viewportRef.current
    const observer = el ? new ResizeObserver(() => reportBounds()) : undefined
    if (el && observer) observer.observe(el)
    window.addEventListener('resize', reportBounds)

    void initializeBrowserTabs(storedSession).then(async (state) => {
      if (!mounted) return
      const active = state.activeTabId && state.tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : state.tabs[0]?.id || ''
      setTabs(state.tabs)
      setActiveTabId(active)
      const tab = state.tabs.find((item) => item.id === active)
      if (tab) setUrlDraft(tab.url)
      if (active) await window.api.browserSetActiveTab(active)
      setSessionReady(true)
      reportBounds()
    })

    return () => {
      mounted = false
      offCreated()
      offUpdated()
      offClosed()
      offPageInfo()
      observer?.disconnect()
      window.removeEventListener('resize', reportBounds)
      void window.api.browserSetModuleActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount lifecycle only
  }, [onPageInfo, reportBounds])

  useEffect(() => {
    if (!launch || !sessionReady) return
    const key = `${launch.url || ''}:${launch.referrerCommand || ''}`
    if (launchHandledRef.current === key) return
    launchHandledRef.current = key
    void (async () => {
      if (launch.url) {
        const existing = tabs.find((t) => t.url === launch.url)
        if (existing) await selectTab(existing.id)
        else await createTab({ url: launch.url, referrerCommand: launch.referrerCommand })
      } else {
        await createTab({ referrerCommand: launch.referrerCommand })
      }
      onLaunchConsumed?.()
    })()
  }, [createTab, launch, onLaunchConsumed, selectTab, sessionReady, tabs])

  useEffect(() => {
    if (activeTab?.loading !== undefined) setLoading(activeTab.loading)
  }, [activeTab?.loading])

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 't') {
        event.preventDefault()
        void createTab().then(() => {
          window.setTimeout(() => urlInputRef.current?.focus(), 0)
        })
        return
      }
      if (meta && event.key.toLowerCase() === 'w' && !event.shiftKey) {
        if (tabs.length > 0 && activeTabId) {
          event.preventDefault()
          event.stopPropagation()
          void closeTab(activeTabId)
        }
        return
      }
      if (meta && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        urlInputRef.current?.focus()
        urlInputRef.current?.select()
        return
      }
      if (meta && event.key === '[') {
        event.preventDefault()
        if (activeTabId) void window.api.browserGoBack(activeTabId)
        return
      }
      if (meta && event.key === ']') {
        event.preventDefault()
        if (activeTabId) void window.api.browserGoForward(activeTabId)
        return
      }
      if (meta && !event.shiftKey && event.key >= '1' && event.key <= '9') {
        const index = Number.parseInt(event.key, 10) - 1
        const tab = tabs[index]
        if (tab) {
          event.preventDefault()
          event.stopPropagation()
          void selectTab(tab.id)
        }
      }
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [activeTabId, closeTab, createTab, selectTab, tabs])

  const submitUrl = async (): Promise<boolean> => {
    const trimmed = urlDraft.trim()
    if (!trimmed) return false
    setUrlError('')
    let tabId = activeTabId
    if (!tabId) {
      tabId = await createTab({ url: trimmed })
      return true
    }
    await window.api.browserSetActiveTab(tabId)
    const result = await window.api.browserNavigate(tabId, trimmed)
    if (!result.ok) {
      setUrlError(result.error || '无法打开该地址')
      onTrackAction?.('browser.navigate', 'submit', 'fail')
      return false
    }
    const state = await window.api.browserGetState()
    const active = state.tabs.find((tab) => tab.id === state.activeTabId)
    if (active) setUrlDraft(active.url)
    onTrackAction?.('browser.navigate', 'submit', 'success')
    return true
  }

  const navBtnStyle: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0
  }

  const tabBaseStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 28,
    minWidth: 72,
    padding: '0 10px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--text)' : 'var(--muted)',
    background: active ? 'var(--bg-hover)' : 'transparent',
    border: '1px solid transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    maxWidth: 160,
    flexShrink: 0
  })

  return (
    <div
      data-testid="browser-page"
      data-privacy-blurred={privacyBlurred}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div
        data-testid="browser-chrome"
        style={{
          flexShrink: 0,
          position: 'relative',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border-subtle)',
          filter: privacyBlurred ? 'blur(18px)' : 'none',
          transform: privacyBlurred ? 'scale(1.04)' : 'none',
          transformOrigin: 'center',
          pointerEvents: privacyBlurred ? 'none' : 'auto'
        }}
      >
        <div
          data-testid="browser-tab-row"
          role="tablist"
          aria-label="网站标签页"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 50,
            padding: '9px 4px 13px',
            overflowX: 'auto',
            overflowY: 'hidden'
          }}
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                className="browser-tab"
                tabIndex={0}
                data-testid={`browser-tab-item-${index}`}
                onClick={() => void selectTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void selectTab(tab.id)
                  }
                }}
                style={tabBaseStyle(active)}
                title={tab.url}
              >
                {tab.favicon && (
                  <img
                    data-testid={`browser-tab-favicon-${index}`}
                    src={tab.favicon}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true
                    }}
                    onLoad={(event) => {
                      event.currentTarget.hidden = false
                    }}
                    style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}
                  />
                )}
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tabLabel(tab)}</span>
                {tabs.length > 1 && active && (
                  <button
                    type="button"
                    aria-label={`关闭 ${tabLabel(tab)}`}
                    className="browser-tab-close"
                    data-testid={`browser-tab-close-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void closeTab(tab.id)
                    }}
                    style={{
                      width: 16,
                      height: 20,
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: 0,
                      opacity: active ? 0.65 : 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                    title="关闭标签页"
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            )
          })}
          <button
            type="button"
            className="browser-chrome-button"
            data-testid="browser-new-tab"
            title="新建标签页"
            onClick={() => {
              void createTab().then(() => {
                window.setTimeout(() => urlInputRef.current?.focus(), 0)
              })
            }}
            style={{
              ...navBtnStyle,
              width: 30,
              height: 28,
              marginLeft: 2,
              fontSize: 20
            }}
          >
            +
          </button>
        </div>

        {loading && (
          <div style={{ position: 'absolute', zIndex: 1, left: 0, right: 0, bottom: 0, height: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: '40%',
                background: 'var(--accent)',
                animation: 'browser-progress 1.2s ease infinite'
              }}
            />
          </div>
        )}

        <div
          data-testid="browser-toolbar"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(100px, 1fr) minmax(220px, 2fr) minmax(100px, 1fr)',
            alignItems: 'center',
            gap: 12,
            height: 36,
            padding: '2px 6px 4px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, justifySelf: 'start' }}>
            <button
              type="button"
              aria-label="后退"
              className="browser-chrome-button"
              style={navBtnStyle}
              title="后退"
              onClick={() => activeTabId && void window.api.browserGoBack(activeTabId)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="前进"
              className="browser-chrome-button"
              style={navBtnStyle}
              title="前进"
              onClick={() => activeTabId && void window.api.browserGoForward(activeTabId)}
            >
              →
            </button>
            <button
              type="button"
              aria-label="刷新"
              className="browser-chrome-button"
              style={{ ...navBtnStyle, fontSize: 18 }}
              title="刷新"
              onClick={() => activeTabId && void window.api.browserReload(activeTabId)}
            >
              ↻
            </button>
          </div>
          <div
            style={{
              position: 'relative',
              justifySelf: 'center',
              width: 'min(100%, 520px)',
              minWidth: 0,
              height: 30
            }}
          >
            <input
              ref={urlInputRef}
              data-testid="browser-url-bar"
              aria-label="网址"
              disabled={!activeTabId}
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onFocus={() => setUrlEditing(true)}
              onBlur={() => setUrlEditing(false)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const input = e.currentTarget
                void submitUrl().then((success) => {
                  if (success) input.blur()
                })
              }}
              placeholder="输入 URL 后回车"
              style={{
                width: '100%',
                minWidth: 0,
                height: 30,
                borderRadius: 9,
                border: `1px solid ${urlEditing ? 'var(--border-default)' : 'transparent'}`,
                background: urlEditing ? 'var(--panel-soft)' : 'transparent',
                color: urlEditing ? 'var(--text)' : 'transparent',
                WebkitTextFillColor: urlEditing ? 'var(--text)' : 'transparent',
                caretColor: 'var(--text)',
                fontSize: 13,
                fontFamily: 'var(--font-ui)',
                textAlign: 'center',
                padding: '0 12px',
                outline: 'none',
                transition: 'none'
              }}
            />
            {!urlEditing && (
              <span
                data-testid="browser-address-display"
                aria-hidden="true"
                title={activeTab?.url || urlDraft}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 12px',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  pointerEvents: 'none'
                }}
              >
                {addressLabel(activeTab?.url || urlDraft)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' }}>
            <label
              title="切换到其他应用时模糊网页内容"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)', fontSize: 12 }}
            >
              <input
                data-testid="browser-privacy-blur-toggle"
                type="checkbox"
                checked={privacyBlurEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked
                  setPrivacyBlurEnabled(enabled)
                  window.localStorage.setItem(PRIVACY_BLUR_SETTING_KEY, enabled ? '1' : '0')
                  if (!enabled) void window.api.browserSetPrivacyBlur(false)
                }}
              />
              离开时模糊
            </label>
            <button
              type="button"
              className="browser-chrome-button"
              data-testid="browser-profile-import-open"
              title="从其他浏览器导入登录状态"
              onClick={() => void toggleProfileImporter()}
              style={{
                ...navBtnStyle,
                width: 'auto',
                padding: '0 8px',
                color: 'var(--text-dim)',
                fontSize: 12,
                fontWeight: 500
              }}
            >
              导入登录状态
            </button>
          </div>
        </div>
        {profilePanelOpen && (
          <div
            data-testid="browser-profile-import-panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '10px 12px 12px',
              borderTop: '1px solid var(--border-default)',
              background: 'var(--panel-soft)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="browser-profile-import-select" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                来源
              </label>
              <select
                id="browser-profile-import-select"
                data-testid="browser-profile-import-select"
                value={selectedProfileId}
                disabled={profilesLoading || profileImporting || profiles.length === 0}
                onChange={(event) => {
                  setSelectedProfileId(event.target.value)
                  setProfileError('')
                  setProfileResult('')
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 30,
                  borderRadius: 7,
                  border: '1px solid var(--border-default)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  padding: '0 8px'
                }}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.appName} · {profile.profileName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="browser-profile-import-submit"
                disabled={!selectedProfileId || profilesLoading || profileImporting}
                onClick={() => void importSelectedProfile()}
                style={{ ...navBtnStyle, width: 'auto', padding: '0 12px', color: 'var(--text)', fontSize: 12 }}
              >
                {profileImporting ? '正在导入…' : '导入 Cookie'}
              </button>
              <button
                type="button"
                title="关闭"
                onClick={() => setProfilePanelOpen(false)}
                style={navBtnStyle}
              >
                ×
              </button>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>
              {profilesLoading
                ? '正在查找浏览器 Profile…'
                : profiles.length === 0
                  ? '未找到可导入 Cookie 的浏览器 Profile。'
                  : '支持 Chrome、Edge、Brave、Arc、Chromium、Vivaldi、Opera、Atlas 与 Firefox。导入前请彻底退出源浏览器。'}
            </div>
            {profileResult && (
              <div data-testid="browser-profile-import-result" role="status" style={{ color: 'var(--ok)', fontSize: 11 }}>
                {profileResult}
              </div>
            )}
            {profileError && (
              <div role="alert" style={{ color: 'var(--warn)', fontSize: 11 }}>
                {profileError}
              </div>
            )}
          </div>
        )}
        {urlError && (
          <div
            data-testid="browser-url-error"
            style={{
              padding: '0 12px 8px 96px',
              color: 'var(--warn)',
              fontSize: 11,
              lineHeight: 1.4
            }}
          >
            {urlError}
          </div>
        )}
      </div>

      <div
        ref={viewportRef}
        data-testid="browser-viewport"
        style={{
          flex: 1,
          minHeight: 0,
          background: 'var(--bg)',
          position: 'relative'
        }}
      >
        {tabs.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 13,
              pointerEvents: 'none'
            }}
          >
            正在加载起始页…
          </div>
        )}
      </div>

      <style>{`
        @keyframes browser-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .browser-tab:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: -2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .browser-tab:hover {
            background: var(--bg-hover) !important;
          }
          .browser-tab:hover .browser-tab-close {
            opacity: 0.65 !important;
          }
          .browser-chrome-button:hover {
            border-color: transparent !important;
            background: var(--bg-hover) !important;
            color: var(--text) !important;
          }
        }
      `}</style>
    </div>
  )
}
