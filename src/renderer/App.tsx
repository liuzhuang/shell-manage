import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { useConfigState } from './hooks/useConfig'
import { useNavigation, type AppPage } from './hooks/useNavigation'
import { useProcessState } from './hooks/useProcess'
import { useQueryState } from './hooks/useQuery'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { EditorPage } from './pages/EditorPage'
import { SshKeysPage } from './pages/SshKeysPage'
import { CollaborationPage } from './pages/CollaborationPage'
import { LogPage } from './pages/LogPage'
import { MultiLogPage } from './pages/MultiLogPage'
import { MonitoringPage } from './pages/MonitoringPage'
import { BrowserPage } from './pages/BrowserPage'
import { Toast } from './components/Toast'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { PresetProgressOverlay } from './components/PresetProgressOverlay'
import { projectKey } from './components/ImportProjectsPanel'
import { DEMO_COMMAND_NAMES, DEMO_COMMANDS, DEMO_PRESETS, DEMO_PRESET_NAMES } from './lib/demoCommands'
import { BatchLogModal } from './components/BatchLogModal'
import {
  CommandFormModal,
  joinInteractiveCommands,
  splitInteractiveCommands,
  type CommandCreateStep,
  type CommandFormDraft,
  type CommandFormState
} from './components/CommandFormModal'
import { resolveCommandWebUrl } from './lib/web-url'
import { appendProjectsFromImportSelection } from './lib/project-directories'
import { createGenieOverlayRoot, runCanvasGenieMinimizeAnimation } from './lib/genieMinimize'
import type { RecentCommandPageItem } from './components/Sidebar'
import type {
  AnalyticsEventType,
  AnalyticsResult,
  AppConfig,
  AppUpdateBroadcastPayload,
  AppUpdateDisabledReason,
  CommandConfig,
  DetectedProject,
  LogViewPreset,
  ProcessStatusPayload,
  PresetProgressPayload
} from '../shared/types'
import type { ThemeName, ThemePresetId } from './styles/tokens'
import {
  applyTheme,
  applyThemePreset,
  persistTheme,
  persistThemePreset,
  resolveInitialTheme,
  resolveInitialThemePreset
} from './styles/theme'

type ToastTone = 'success' | 'warn' | 'error' | 'info'
const TICKER_EVENT_LIMIT = 200

const DEMO_HINT_SEEN_KEY = 'home.demoHintSeen'
const AI_PROMPT_AFTER_FIRST_RUN_KEY = 'home.aiPromptGuideAfterFirstRun.seen'
const TERMINAL_AUTO_RETURN_HOME_KEY = 'terminal.autoReturnHome.v1'
const TERMINAL_SHORT_TASK_MS = 30_000
const RECENT_COMMAND_PAGES_LIMIT = 8
const QueryPage = lazy(() => import('./pages/QueryPageShell').then((mod) => ({ default: mod.QueryPage })))
const TerminalPage = lazy(() => import('./pages/TerminalPage').then((mod) => ({ default: mod.TerminalPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((mod) => ({ default: mod.DashboardPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((mod) => ({ default: mod.AnalyticsPage })))

type SecondaryCommandPage = 'log' | 'terminal'
type RectSnapshot = { left: number; top: number; width: number; height: number }

function toSafeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function rectFromElement(element: Element): RectSnapshot | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
}

function createAnalyticsSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function mapProcessStateToAnalyticsResult(state: ProcessStatusPayload['state']): AnalyticsResult {
  switch (state) {
    case 'running':
      return 'success'
    case 'error':
      return 'fail'
    case 'idle':
      return 'unknown'
    case 'restarting':
      return 'unknown'
    default: {
      const exhaustiveCheck: never = state
      return exhaustiveCheck
    }
  }
}

export default function App() {
  const { page, setPage, selectedCommand, setSelectedCommand } = useNavigation()
  const previousPageRef = useRef<AppPage>('home')
  const hasEnteredQueryOnceRef = useRef(false)
  const {
    config,
    editorRaw,
    setEditorRaw,
    editorError,
    setEditorError,
    saveEditor,
    keyword,
    setKeyword,
    activeTag,
    setActiveTag,
    tags,
    filteredCommands
  } = useConfigState()
  const { statusMap, logMap, clearProcessLogs, colorByState } = useProcessState(config.settings.logBufferLines)
  const [terminalStatusMap, setTerminalStatusMap] = useState<Record<string, 'running' | 'idle'>>({})
  const [terminalPreviewByName, setTerminalPreviewByName] = useState<Record<string, string>>({})
  const [terminalInstanceCount, setTerminalInstanceCount] = useState(0)
  const [deployTerminalTitles, setDeployTerminalTitles] = useState<Record<string, string>>({})
  const {
    queryInput,
    setQueryInput,
    commandInput,
    setCommandInput,
    chatHistory,
    streamingText,
    isStreaming,
    agentPhase,
    clearChatHistory,
    favoriteCommands,
    fillCommandFromFavorite,
    addFavoriteCommand,
    removeFavoriteCommand,
    translate,
    cancelTranslation
  } =
    useQueryState()
  const [toast, setToast] = useState<{ text: string; tone: ToastTone }>({ text: '', tone: 'info' })
  const [tickerEvents, setTickerEvents] = useState<string[]>([])
  const [updateUi, setUpdateUi] = useState<AppUpdateBroadcastPayload | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [presetProgress, setPresetProgress] = useState<PresetProgressPayload | null>(null)
  const [locateLine, setLocateLine] = useState<number | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commandName: string } | null>(null)
  const [commandForm, setCommandForm] = useState<CommandFormState | null>(null)
  const [showDemoHint, setShowDemoHint] = useState<boolean>(() => window.localStorage.getItem(DEMO_HINT_SEEN_KEY) !== '1')
  const [showBatchLogModal, setShowBatchLogModal] = useState(false)
  const [multiLogCommands, setMultiLogCommands] = useState<string[]>([])
  const [recentCommandPages, setRecentCommandPages] = useState<RecentCommandPageItem[]>([])
  const [browserLaunch, setBrowserLaunch] = useState<{ url?: string; referrerCommand?: string } | null>(null)
  const dockMinimizeRunningRef = useRef(false)
  const seenTickerEventRef = useRef<Set<string>>(new Set())
  const analyticsSessionIdRef = useRef<string>(createAnalyticsSessionId())
  const pageRef = useRef<AppPage>(page)
  const selectedCommandRef = useRef(selectedCommand)
  const recentCommandPagesRef = useRef(recentCommandPages)
  const terminalRunStartedAtRef = useRef<Map<string, number>>(new Map())
  const hasPromptedAiGuideAfterFirstRunRef = useRef<boolean>(
    (() => {
      try {
        return window.localStorage.getItem(AI_PROMPT_AFTER_FIRST_RUN_KEY) === '1'
      } catch {
        return false
      }
    })()
  )
  const [importPreview, setImportPreview] = useState<{
    rootPath: string
    projects: DetectedProject[]
    selectedKeys: Record<string, boolean>
    confirming: boolean
  } | null>(null)
  const [importDetecting, setImportDetecting] = useState(false)
  const [demoConfirming, setDemoConfirming] = useState(false)
  const selectedCommandConfig = config.commands.find((cmd) => cmd.name === selectedCommand)
  const terminalCommands = useMemo(
    () => config.commands.filter((cmd) => (cmd.mode || 'service') === 'terminal'),
    [config.commands]
  )
  const logViewPresets = useMemo(() => normalizeLogViewPresets(config.settings.logViewPresets), [config.settings.logViewPresets])

  const selectedSessionBufferText = selectedCommand ? terminalPreviewByName[selectedCommand] || '' : ''
  const querySessionBadgeState = useMemo<'running' | 'idle_with_cache' | 'idle_empty'>(() => {
    if (!selectedCommand) return 'idle_empty'
    if (terminalStatusMap[selectedCommand] === 'running') return 'running'
    return selectedSessionBufferText.trim().length > 0 ? 'idle_with_cache' : 'idle_empty'
  }, [selectedCommand, terminalStatusMap, selectedSessionBufferText])
  const [theme, setTheme] = useState<ThemeName>(() => resolveInitialTheme())
  const [themePreset, setThemePreset] = useState<ThemePresetId>(() => resolveInitialThemePreset())

  useLayoutEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    selectedCommandRef.current = selectedCommand
  }, [selectedCommand])

  useEffect(() => {
    recentCommandPagesRef.current = recentCommandPages
  }, [recentCommandPages])

  useEffect(() => {
    if (pageRef.current !== 'browser') void window.api.browserSetModuleActive(false)
  }, [])

  useEffect(() => {
    const offReload = window.api.onAppReloadRequest(({ force }) => {
      void (async () => {
        if (pageRef.current === 'browser') {
          const state = await window.api.browserGetState()
          if (state.activeTabId) await window.api.browserReload(state.activeTabId)
          return
        }
        await window.api.reloadMainWindow({ force })
      })()
    })
    return () => {
      offReload?.()
    }
  }, [])

  const trackEvent = useCallback(
    (payload: {
      eventType: AnalyticsEventType
      featureKey: string
      action: string
      result?: AnalyticsResult
      page?: string
      durationMs?: number
      context?: Record<string, string | number | boolean | null>
    }) => {
      void window.api.analyticsTrack({
        eventType: payload.eventType,
        featureKey: payload.featureKey,
        action: payload.action,
        result: payload.result || 'unknown',
        page: payload.page || pageRef.current,
        durationMs: payload.durationMs,
        context: payload.context,
        sessionId: analyticsSessionIdRef.current
      })
    },
    []
  )
  const trackFeatureAction = useCallback(
    (
      featureKey: string,
      action: string,
      result: AnalyticsResult = 'unknown',
      context?: Record<string, string | number | boolean | null>
    ) => {
      trackEvent({
        eventType: 'feature_usage',
        featureKey,
        action,
        result,
        context
      })
    },
    [trackEvent]
  )
  const runningOverview = useMemo(() => {
    const runningNames = config.commands
      .filter((command) => {
        const mode = command.mode || 'service'
        if (mode === 'terminal') return terminalStatusMap[command.name] === 'running'
        const state = statusMap[command.name]?.state
        return state === 'running' || state === 'restarting'
      })
      .map((command) => command.name)
    return {
      runningCount: runningNames.length,
      totalCount: config.commands.length,
      names: runningNames
    }
  }, [config.commands, statusMap, terminalStatusMap])
  const pushTickerEvent = useCallback((text: string) => {
    const normalized = normalizeTickerText(text)
    if (!normalized) return
    if (seenTickerEventRef.current.has(normalized)) return
    seenTickerEventRef.current.add(normalized)
    setTickerEvents((prev) => [...prev, normalized].slice(-TICKER_EVENT_LIMIT))
  }, [])

  /** 终端页 Pane 带 sessionId，状态广播曾被忽略；按主进程实例列表汇总，避免首页卡片停在「运行中」。 */
  const syncTerminalStatusFromInstances = useCallback(async () => {
    const terminalNames = config.commands.filter((c) => (c.mode || 'service') === 'terminal').map((c) => c.name)
    if (terminalNames.length === 0) return
    try {
      const { instances } = await window.api.terminalListInstances()
      setTerminalStatusMap((prev) => {
        const next = { ...prev }
        for (const name of terminalNames) {
          next[name] = instances.some((i) => i.commandName === name) ? 'running' : 'idle'
        }
        return next
      })
    } catch {
      /* ignore */
    }
  }, [config.commands])

  function notify(text: string, tone: ToastTone = 'info') {
    pushTickerEvent(text)
    setToast({ text, tone })
  }

  const maybePromptAiGuideAfterFirstRun = useCallback(() => {
    if (hasPromptedAiGuideAfterFirstRunRef.current) return
    hasPromptedAiGuideAfterFirstRunRef.current = true
    try {
      window.localStorage.setItem(AI_PROMPT_AFTER_FIRST_RUN_KEY, '1')
    } catch {
      /* ignore */
    }
    trackFeatureAction('home.ai_prompt_guide.trigger', 'auto_after_first_run', 'success')
    const suggestedTags = activeTag !== '全部' ? activeTag : ''
    setCommandForm({
      mode: 'create',
      createStep: 'ai',
      draft: {
        name: '',
        command: '',
        commandSegments: [''],
        allowTrailingEmptySegment: false,
        tags: suggestedTags,
        mode: 'service',
        autoRestart: false,
        webUrl: ''
      }
    })
  }, [trackFeatureAction, activeTag])

  const handleExecuteDeploy = useCallback(
    async (payload: { scriptId: string; content: string; scriptName: string }) => {
      try {
        const result = await window.api.deployExecuteScript({
          scriptId: payload.scriptId,
          content: payload.content
        })
        setDeployTerminalTitles((prev) => ({
          ...prev,
          [result.terminalCommandName]: result.scriptName || payload.scriptName
        }))
        setSelectedCommand(result.terminalCommandName)
        setPage('terminal')
        await window.api.terminalStart(result.terminalCommandName)
        trackFeatureAction('deploy-script.execute', 'click', 'success', { source: payload.scriptId })
        notify(`已启动部署脚本：${result.scriptName || payload.scriptName}`, 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      }
    },
    [notify, setPage, setSelectedCommand, trackFeatureAction]
  )

  const removeRecentCommandPage = useCallback((commandName: string) => {
    const normalized = commandName.trim()
    if (!normalized) return
    setRecentCommandPages((prev) => prev.filter((item) => item.commandName !== normalized))
  }, [])

  const openRecentCommandPage = useCallback(
    (target: RecentCommandPageItem) => {
      const exists = config.commands.some((item) => item.name === target.commandName)
      if (!exists) {
        removeRecentCommandPage(target.commandName)
        notify(`命令不存在，已移除最近入口：${target.commandName}`, 'warn')
        return
      }
      setSelectedCommand(target.commandName)
      setPage(target.page)
    },
    [config.commands, notify, removeRecentCommandPage, setPage, setSelectedCommand]
  )

  const navigateToPage = useCallback(
    (nextPage: AppPage) => {
      if (nextPage === 'home') setLocateLine(undefined)
      trackEvent({
        eventType: 'ui_action',
        featureKey: `nav.${nextPage}.enter`,
        action: 'open',
        result: 'success',
        page: nextPage
      })
      setPage(nextPage)
    },
    [setPage, trackEvent]
  )

  const navigateByMenuShortcut = useCallback(
    (target: AppPage) => {
      navigateToPage(target)
    },
    [navigateToPage]
  )

  const openInBrowser = useCallback(
    (request?: { url?: string; referrerCommand?: string }) => {
      setBrowserLaunch(request ?? {})
      navigateToPage('browser')
      trackFeatureAction('browser.open', 'navigate', 'success', {
        hasUrl: Boolean(request?.url),
        referrerCommand: request?.referrerCommand || null
      })
    },
    [navigateToPage, trackFeatureAction]
  )

  const handleBrowserBossEscape = useCallback(() => {
    void window.api.browserBossHide('switch-page')
    trackFeatureAction('browser.boss.escape', 'keydown', 'success')
    const recentLog = recentCommandPages.find((item) => item.page === 'log')
    if (recentLog) {
      setSelectedCommand(recentLog.commandName)
      setPage('log')
      return
    }
    setPage('home')
  }, [recentCommandPages, setPage, setSelectedCommand, trackFeatureAction])

  const focusHomeSearch = useCallback(() => {
    setPage('home')
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="home-search"]')
      input?.focus()
      input?.select()
    }, 0)
  }, [setPage])

  const runDockMinimizeAnimation = useCallback(
    async (sourcePage: SecondaryCommandPage, commandName: string) => {
      if (dockMinimizeRunningRef.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const normalizedName = commandName.trim()
      if (!normalizedName) return
      const hasRecentTarget = recentCommandPages.some((item) => item.commandName === normalizedName && item.page === sourcePage)
      if (!hasRecentTarget) return
      const sourceTestId = sourcePage === 'log' ? 'log-page' : 'terminal-page'
      const targetTestId = `sidebar-recent-item-${toSafeTestId(normalizedName)}`
      const sourceElement = document.querySelector(`[data-testid="${sourceTestId}"]`)
      const targetElement = document.querySelector(`[data-testid="${targetTestId}"]`)
      if (!(sourceElement instanceof HTMLElement) || !targetElement) return
      const fromRect = rectFromElement(sourceElement)
      const toRect = rectFromElement(targetElement)
      if (!fromRect || !toRect) return
      dockMinimizeRunningRef.current = true
      const overlay = createGenieOverlayRoot()
      document.body.appendChild(overlay)
      try {
        await runCanvasGenieMinimizeAnimation({
          sourceElement,
          fromRect,
          toRect,
          overlayRoot: overlay
        })
      } finally {
        overlay.remove()
        dockMinimizeRunningRef.current = false
      }
    },
    [recentCommandPages]
  )

  const handleBackToHome = useCallback(
    (sourcePage: SecondaryCommandPage) => {
      if (dockMinimizeRunningRef.current) return
      void (async () => {
        await runDockMinimizeAnimation(sourcePage, selectedCommand)
        setPage('home')
      })()
    },
    [runDockMinimizeAnimation, selectedCommand, setPage]
  )

  const openCommandContextMenu = useCallback(
    async (payload: { x: number; y: number; commandName: string; preferNative?: boolean }) => {
      const items = buildMenuItems({
        commandName: payload.commandName,
        commands: config.commands,
        terminalStatusMap,
        setPage,
        setSelectedCommand,
        notify,
        setLocateLine,
        editorRaw,
        commandLogs: logMap[payload.commandName] || [],
        onTrackAction: trackFeatureAction,
        onEditCommand: openCommandFormForEdit,
        onDeleteCommand: deleteCommandFromConfig,
        onOpenInBrowser: openInBrowser
      })
      if (payload.preferNative && window.api.getPlatform() === 'darwin') {
        try {
          const result = await window.api.showCommandContextMenu(
            items.map((item) => ({
              key: item.key,
              label: item.label,
              group: item.group
            }))
          )
          if (result.key) {
            const action = items.find((item) => item.key === result.key)
            await action?.onClick()
          }
          return
        } catch {
          // fallback to in-app menu
        }
      }
      setContextMenu({
        x: payload.x,
        y: payload.y,
        commandName: payload.commandName
      })
    },
    [config.commands, deleteCommandFromConfig, editorRaw, logMap, notify, openCommandFormForEdit, openInBrowser, setPage, setSelectedCommand, terminalStatusMap, trackFeatureAction]
  )

  useEffect(() => {
    void window.api.analyticsTrack({
      eventType: 'feature_usage',
      featureKey: 'app.lifecycle.open',
      action: 'open',
      result: 'success',
      page: pageRef.current,
      sessionId: analyticsSessionIdRef.current
    })
    const onBeforeUnload = () => {
      void window.api.analyticsFlush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(() => {
    void window.api.getAppVersion().then(setAppVersion).catch(() => setAppVersion(''))
  }, [])

  useEffect(() => {
    return window.api.onAppUpdate((payload) => {
      const tickerText = formatUpdateTickerText(payload)
      if (tickerText) pushTickerEvent(tickerText)
      if (payload.phase === 'not-available' && !payload.fromManual) {
        setUpdateUi(null)
        return
      }
      if (payload.phase === 'not-available' && payload.fromManual) {
        setUpdateUi(payload)
        setToast({ text: '当前已是最新版本', tone: 'success' })
        window.setTimeout(() => setUpdateUi(null), 2200)
        return
      }
      setUpdateUi(payload)
    })
  }, [pushTickerEvent])

  useEffect(() => {
    const offNavigate = window.api.onAppNavigate(({ target }) => navigateByMenuShortcut(target))
    const offFocusSearch = window.api.onAppFocusHomeSearch(() => focusHomeSearch())
    const offCheckUpdate = window.api.onAppCheckUpdate(() => {
      void handleCheckUpdate()
    })
    return () => {
      offNavigate?.()
      offFocusSearch?.()
      offCheckUpdate?.()
    }
  }, [focusHomeSearch, navigateByMenuShortcut])

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (
        pageRef.current === 'browser' &&
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        handleBrowserBossEscape()
        return
      }

      if (
        (pageRef.current === 'log' || pageRef.current === 'terminal') &&
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        handleBackToHome(pageRef.current)
        return
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === '1') {
        event.preventDefault()
        navigateByMenuShortcut('home')
        return
      }
      if (key === '2') {
        event.preventDefault()
        navigateByMenuShortcut('query')
        return
      }
      if (key === '3') {
        event.preventDefault()
        navigateByMenuShortcut('monitoring')
        return
      }
      if (key === '4') {
        event.preventDefault()
        navigateByMenuShortcut('editor')
        return
      }
      if (key === '5') {
        event.preventDefault()
        navigateByMenuShortcut('ssh-keys')
        return
      }
      if (key === '6') {
        event.preventDefault()
        navigateByMenuShortcut('browser')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        focusHomeSearch()
        return
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [focusHomeSearch, handleBackToHome, handleBrowserBossEscape, navigateByMenuShortcut])

  async function handleCheckUpdate() {
    const r = await window.api.updateCheck({ manual: true })
    if (!r.ok && 'reason' in r) {
      notify(`自动更新未启用：${formatUpdateDisabledReason(r.reason)}`, 'info')
    } else if (!r.ok && 'error' in r) {
      notify(`检查更新失败：${r.error}`, 'error')
    }
  }

  async function handleDownloadUpdate() {
    const r = await window.api.updateDownload()
    if (!r.ok && 'reason' in r) {
      notify(`当前环境不支持下载更新：${formatUpdateDisabledReason(r.reason)}`, 'info')
    }
    // 失败时主进程会广播 phase: error，顶栏会显示原因，此处不再重复 Toast
  }

  function dismissDemoHint() {
    setShowDemoHint(false)
    window.localStorage.setItem(DEMO_HINT_SEEN_KEY, '1')
  }

  const demoPresetInstalled = useMemo(() => config.commands.some((cmd) => DEMO_COMMAND_NAMES.includes(cmd.name)), [config.commands])

  async function importDemoCommands() {
    const raw = await window.api.configRead()
    const parsed = yaml.load(raw) as AppConfig
    if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
      throw new Error('当前配置结构异常，无法导入演示命令')
    }
    const existingCommands = new Set(parsed.commands.map((cmd) => cmd.name))
    const existingPresets = new Set(parsed.presets.map((preset) => preset.name))

    parsed.commands = [...DEMO_COMMANDS.filter((cmd) => !existingCommands.has(cmd.name)), ...parsed.commands]
    parsed.presets = [...DEMO_PRESETS.filter((preset) => !existingPresets.has(preset.name)), ...parsed.presets]
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
    setEditorRaw(nextRaw)
    dismissDemoHint()
    notify('演示命令已导入，可直接在首页启动体验', 'success')
  }

  async function cleanupDemoCommands() {
    const raw = await window.api.configRead()
    const parsed = yaml.load(raw) as AppConfig
    if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
      throw new Error('当前配置结构异常，无法清理演示命令')
    }
    parsed.commands = parsed.commands.filter((cmd) => !DEMO_COMMAND_NAMES.includes(cmd.name))
    parsed.presets = parsed.presets.filter((preset) => !DEMO_PRESET_NAMES.includes(preset.name))
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
    setEditorRaw(nextRaw)
    notify('演示命令已清理', 'info')
  }

  function createEmptyCommandFormDraft(): CommandFormDraft {
    const suggestedTags = activeTag !== '全部' ? activeTag : ''
    return {
      name: '',
      command: '',
      commandSegments: [''],
      allowTrailingEmptySegment: false,
      tags: suggestedTags,
      mode: 'service',
      autoRestart: false,
      webUrl: ''
    }
  }

  async function detectProjectsFromDirectory() {
    const startedAt = Date.now()
    const e2eRootPath = window.localStorage.getItem('__e2e_import_root_path') || ''
    const detected = await window.api.pickDirectoryAndDetectProjects(
      e2eRootPath ? { rootPath: e2eRootPath } : undefined
    )
    if (detected.canceled) {
      return { canceled: true as const, projects: [], rootPath: '' }
    }
    if (detected.projects.length === 0) {
      trackEvent({
        eventType: 'feature_usage',
        featureKey: 'home.import.directory',
        action: 'detect',
        result: 'fail',
        durationMs: Date.now() - startedAt,
        context: { itemCount: 0, errorCode: 'NO_PROJECT_DETECTED' }
      })
      notify('未识别到可导入项目，请确认目录结构', 'warn')
      return { canceled: false as const, projects: [], rootPath: detected.rootPath || '' }
    }
    trackEvent({
      eventType: 'feature_usage',
      featureKey: 'home.import.directory',
      action: 'detect',
      result: 'success',
      durationMs: Date.now() - startedAt,
      context: { itemCount: detected.projects.length }
    })
    return detected
  }

  async function beginImportDirectoryFromCreate(entry: 'pick' | 'shortcut') {
    trackEvent({
      eventType: 'feature_usage',
      featureKey: 'home.import_directory.trigger',
      action: 'click',
      result: 'success',
      context: { entry }
    })
    if (entry === 'pick' && !commandForm) {
      openCommandFormForCreate('pick')
    }
    setImportDetecting(true)
    try {
      const detected = await detectProjectsFromDirectory()
      if (detected.canceled || detected.projects.length === 0) return
      const selectedKeys: Record<string, boolean> = {}
      for (const project of detected.projects) {
        selectedKeys[projectKey(project)] = true
      }
      setImportPreview({
        rootPath: detected.rootPath || '',
        projects: detected.projects,
        selectedKeys,
        confirming: false
      })
      setCommandForm({
        mode: 'create',
        createStep: 'import',
        draft: createEmptyCommandFormDraft()
      })
    } finally {
      setImportDetecting(false)
    }
  }

  function beginDemoImportFromCreate(entry: 'pick' | 'shortcut') {
    trackEvent({
      eventType: 'feature_usage',
      featureKey: 'home.demo_import.trigger',
      action: 'click',
      result: 'success',
      context: { entry }
    })
    if (entry === 'pick' && !commandForm) {
      openCommandFormForCreate('pick')
    }
    setCommandForm({
      mode: 'create',
      createStep: 'demo',
      draft: createEmptyCommandFormDraft()
    })
  }

  async function confirmDemoImportFromCreate() {
    setDemoConfirming(true)
    try {
      trackFeatureAction('home.demo.import', 'click', 'success')
      await importDemoCommands()
      setCommandForm(null)
    } catch (error) {
      notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setDemoConfirming(false)
    }
  }

  async function cleanupDemoFromCreate() {
    setDemoConfirming(true)
    try {
      trackFeatureAction('home.demo.cleanup', 'click', 'success')
      await cleanupDemoCommands()
      setCommandForm(null)
    } catch (error) {
      notify(`清理失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setDemoConfirming(false)
    }
  }

  async function mutateAndSaveConfig(mutator: (parsed: AppConfig) => void): Promise<void> {
    const raw = await window.api.configRead()
    const parsed = yaml.load(raw) as AppConfig
    if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
      throw new Error('当前配置结构异常，无法保存排序')
    }
    mutator(parsed)
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
    setEditorRaw(nextRaw)
  }

  function openMultiLogWithValidation(commandNames: string[]) {
    const serviceCommandNameSet = new Set(config.commands.filter((item) => (item.mode || 'service') === 'service').map((item) => item.name))
    const normalized = Array.from(new Set(commandNames.map((item) => item.trim()).filter(Boolean)))
    const valid = normalized.filter((item) => serviceCommandNameSet.has(item))
    const invalidCount = normalized.length - valid.length
    if (valid.length === 0) {
      notify('预设内命令已失效，请更新预设后重试', 'warn')
      return
    }
    if (invalidCount > 0) {
      notify(`已自动忽略 ${invalidCount} 个失效命令`, 'info')
    }
    setMultiLogCommands(valid)
    setPage('multiLog')
  }

  function openLogViewPreset(presetName: string) {
    const target = logViewPresets.find((item) => item.name === presetName)
    if (!target) {
      notify(`未找到日志预设：${presetName}`, 'warn')
      return
    }
    openMultiLogWithValidation(target.commandNames)
  }

  async function saveLogViewPreset(presetName: string, commandNames: string[]) {
    const name = presetName.trim()
    if (!name) {
      notify('预设名称不能为空', 'warn')
      return
    }
    const normalizedCommandNames = Array.from(new Set(commandNames.map((item) => item.trim()).filter(Boolean)))
    if (normalizedCommandNames.length === 0) {
      notify('请至少选择一个命令后再保存预设', 'warn')
      return
    }
    const existing = logViewPresets.find((item) => item.name === name)
    if (existing) {
      const confirmed = window.confirm(`预设「${name}」已存在，是否覆盖？`)
      if (!confirmed) return
    }
    try {
      await mutateAndSaveConfig((parsed) => {
        const list = Array.isArray(parsed.settings.logViewPresets) ? parsed.settings.logViewPresets : []
        const nextPreset: LogViewPreset = {
          name,
          commandNames: normalizedCommandNames,
          updatedAt: new Date().toISOString()
        }
        const idx = list.findIndex((item) => item.name === name)
        if (idx >= 0) list.splice(idx, 1, nextPreset)
        else list.unshift(nextPreset)
        parsed.settings.logViewPresets = list
      })
      notify(existing ? `已覆盖日志预设：${name}` : `已保存日志预设：${name}`, 'success')
    } catch (error) {
      notify(`保存日志预设失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function deleteLogViewPreset(presetName: string) {
    const target = presetName.trim()
    if (!target) return
    const confirmed = window.confirm(`确认删除日志预设「${target}」吗？`)
    if (!confirmed) return
    try {
      await mutateAndSaveConfig((parsed) => {
        const list = Array.isArray(parsed.settings.logViewPresets) ? parsed.settings.logViewPresets : []
        parsed.settings.logViewPresets = list.filter((item) => item.name !== target)
      })
      notify(`已删除日志预设：${target}`, 'success')
    } catch (error) {
      notify(`删除日志预设失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function renameLogViewPreset(presetName: string, nextName: string) {
    const sourceName = presetName.trim()
    const targetName = nextName.trim()
    if (!sourceName || !targetName) {
      notify('预设名称不能为空', 'warn')
      return
    }
    if (sourceName === targetName) return
    const duplicated = logViewPresets.some((item) => item.name === targetName)
    if (duplicated) {
      notify(`预设名称已存在：${targetName}`, 'warn')
      return
    }
    try {
      await mutateAndSaveConfig((parsed) => {
        const list = Array.isArray(parsed.settings.logViewPresets) ? parsed.settings.logViewPresets : []
        const idx = list.findIndex((item) => item.name === sourceName)
        if (idx < 0) return
        const prev = list[idx]
        list.splice(idx, 1, { ...prev, name: targetName, updatedAt: new Date().toISOString() })
        parsed.settings.logViewPresets = list
      })
      notify(`日志预设已重命名：${sourceName} -> ${targetName}`, 'success')
    } catch (error) {
      notify(`重命名日志预设失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function reorderHomeCommands(draggedCommandName: string, targetCommandName: string): Promise<void> {
    await mutateAndSaveConfig((parsed) => {
      const fromIndex = parsed.commands.findIndex((item) => item.name === draggedCommandName)
      const toIndex = parsed.commands.findIndex((item) => item.name === targetCommandName)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const [moved] = parsed.commands.splice(fromIndex, 1)
      if (!moved) return
      parsed.commands.splice(toIndex, 0, moved)
    })
    notify('命令列表排序已保存', 'success')
  }

  async function reorderHomeTags(draggedTag: string, targetTag: string): Promise<void> {
    if (draggedTag === '全部' || targetTag === '全部') return
    await mutateAndSaveConfig((parsed) => {
      const tagSet = new Set<string>()
      parsed.commands.forEach((cmd) => cmd.tags.forEach((tag) => tagSet.add(tag)))
      const available = Array.from(tagSet)
      const configuredOrder = Array.isArray(parsed.settings.tagOrder) ? parsed.settings.tagOrder.filter((tag) => tagSet.has(tag)) : []
      const unordered = available.filter((tag) => !configuredOrder.includes(tag))
      const orderedTags = [...configuredOrder, ...unordered]
      const fromIndex = orderedTags.indexOf(draggedTag)
      const toIndex = orderedTags.indexOf(targetTag)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const [moved] = orderedTags.splice(fromIndex, 1)
      if (!moved) return
      orderedTags.splice(toIndex, 0, moved)
      parsed.settings.tagOrder = orderedTags
    })
    notify('标签排序已保存', 'success')
  }

  async function deleteCommandFromConfig(commandName: string): Promise<void> {
    await mutateAndSaveConfig((parsed) => {
      const target = commandName.trim()
      if (!target) return
      parsed.commands = parsed.commands.filter((item) => item.name !== target)
      parsed.presets = parsed.presets
        .map((preset) => ({
          ...preset,
          sequence: preset.sequence.filter((step) => step.command !== target)
        }))
        .filter((preset) => preset.sequence.length > 0)
      const logViewPresets = Array.isArray(parsed.settings.logViewPresets) ? parsed.settings.logViewPresets : []
      parsed.settings.logViewPresets = logViewPresets
        .map((preset) => ({
          ...preset,
          commandNames: preset.commandNames.filter((item) => item !== target)
        }))
        .filter((preset) => preset.commandNames.length > 0)
    })
    if (selectedCommand === commandName) {
      setSelectedCommand('')
      setPage('home')
    }
    notify(`命令已删除：${commandName}`, 'success')
  }

  function openCommandFormForCreate(createStep: CommandCreateStep = 'pick') {
    setCommandForm({
      mode: 'create',
      createStep,
      draft: createEmptyCommandFormDraft()
    })
  }

  function openCommandFormForEdit(commandName: string) {
    const target = config.commands.find((item) => item.name === commandName)
    if (!target) {
      notify(`未找到可编辑命令：${commandName}`, 'warn')
      return
    }
    setCommandForm({
      mode: 'edit',
      createStep: 'manual',
      draft: {
        originalName: target.name,
        name: target.name,
        command: target.command,
        commandSegments: splitInteractiveCommands(target.command),
        allowTrailingEmptySegment: false,
        tags: target.tags.join(', '),
        mode: target.mode || 'service',
        autoRestart: Boolean(target.autoRestart),
        webUrl: target.webUrl || '',
        sshKeyId: target.sshKeyId,
        iconDataUrl: target.iconDataUrl,
        iconFilePath: target.iconFilePath
      }
    })
  }

  async function submitCommandForm() {
    if (!commandForm) return
    const draft = commandForm.draft
    const name = draft.name.trim()
    const commandSource = draft.mode === 'terminal' ? joinInteractiveCommands(draft.commandSegments || splitInteractiveCommands(draft.command)) : draft.command
    const command = normalizeCommandForSave(commandSource, draft.mode)
    if (!name) {
      notify('请输入命令名称', 'warn')
      return
    }
    if (!command) {
      notify('请输入启动命令', 'warn')
      return
    }
    const nextTags = normalizeTagsInput(draft.tags)
    const nextWebUrl = draft.webUrl.trim()
    let nextIconDataUrl = draft.iconDataUrl
    let nextIconFilePath = draft.iconFilePath
    const isCreate = commandForm.mode === 'create'
    if (nextWebUrl && !nextIconDataUrl) {
      try {
        const fetched = await window.api.fetchWebsiteIcon({ url: nextWebUrl })
        nextIconDataUrl = fetched.iconDataUrl
        nextIconFilePath = fetched.iconFilePath
      } catch {
        // keep save flow even if favicon fetch fails
      }
    }
    try {
      await mutateAndSaveConfig((parsed) => {
        const duplicated = parsed.commands.some((item) => item.name === name && (!draft.originalName || item.name !== draft.originalName))
        if (duplicated) {
          throw new Error(`命令名称已存在：${name}`)
        }
        if (isCreate) {
          const nextCommand: CommandConfig = {
            name,
            command,
            tags: nextTags,
            mode: draft.mode,
            autoRestart: draft.autoRestart
          }
          if (nextWebUrl) nextCommand.webUrl = nextWebUrl
          if (nextIconDataUrl) nextCommand.iconDataUrl = nextIconDataUrl
          if (nextIconFilePath) nextCommand.iconFilePath = nextIconFilePath
          if (draft.sshKeyId) nextCommand.sshKeyId = draft.sshKeyId
          parsed.commands = [nextCommand, ...parsed.commands]
          return
        }
        const targetIndex = parsed.commands.findIndex((item) => item.name === draft.originalName)
        if (targetIndex < 0) {
          throw new Error(`未找到可编辑命令：${draft.originalName || name}`)
        }
        const current = parsed.commands[targetIndex]
        const updated: CommandConfig = {
          ...current,
          name,
          command,
          tags: nextTags,
          mode: draft.mode,
          autoRestart: draft.autoRestart
        }
        if (nextWebUrl) updated.webUrl = nextWebUrl
        else delete updated.webUrl
        if (nextIconDataUrl) updated.iconDataUrl = nextIconDataUrl
        else delete updated.iconDataUrl
        if (nextIconFilePath) updated.iconFilePath = nextIconFilePath
        else delete updated.iconFilePath
        if (draft.sshKeyId) updated.sshKeyId = draft.sshKeyId
        else delete updated.sshKeyId
        parsed.commands.splice(targetIndex, 1, updated)
      })
      setCommandForm(null)
      trackEvent({
        eventType: 'feature_usage',
        featureKey: isCreate ? 'home.command.create' : 'home.command.edit',
        action: 'submit',
        result: 'success',
        context: { mode: draft.mode }
      })
      notify(isCreate ? '命令已添加并保存到配置文件' : '命令已更新并保存到配置文件', 'success')
    } catch (error) {
      trackEvent({
        eventType: 'feature_usage',
        featureKey: isCreate ? 'home.command.create' : 'home.command.edit',
        action: 'submit',
        result: 'fail',
        context: { mode: draft.mode, errorCode: 'SAVE_COMMAND_FAILED' }
      })
      notify(`保存命令失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function pickMacosAppForCommandForm() {
    if (!commandForm) return
    try {
      const e2eAppPath = window.localStorage.getItem('__e2e_macos_app_path') || ''
      const picked = await window.api.pickMacosApplication(e2eAppPath ? { appPath: e2eAppPath } : undefined)
      if (picked.canceled) return
      if (!picked.launchCommand || !picked.appName) {
        throw new Error('未能生成应用启动命令')
      }
      const { appName, iconDataUrl, iconFilePath } = picked
      setCommandForm((prev) => {
        if (!prev) return prev
        const shouldAutofillName = prev.mode === 'create' && !prev.draft.name.trim()
        const shouldAutofillTags = prev.mode === 'create' && !prev.draft.tags.trim()
        return {
          ...prev,
          draft: {
            ...prev.draft,
            command: buildMacosOpenAppCommand(appName),
            commandSegments: splitInteractiveCommands(buildMacosOpenAppCommand(appName)),
            allowTrailingEmptySegment: false,
            name: shouldAutofillName ? appName : prev.draft.name,
            tags: shouldAutofillTags ? 'macOS, app' : prev.draft.tags,
            iconDataUrl,
            iconFilePath
          }
        }
      })
      notify(`已选择应用：${appName}`, 'success')
    } catch (error) {
      notify(`选择应用失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function fetchWebsiteIconForCommandForm() {
    if (!commandForm) return
    const url = commandForm.draft.webUrl.trim()
    if (!url) {
      notify('请先填写 Web 地址', 'warn')
      return
    }
    try {
      const fetched = await window.api.fetchWebsiteIcon({ url })
      if (!fetched.iconDataUrl) {
        notify('未读取到网站图标', 'warn')
        return
      }
      setCommandForm((prev) =>
        prev
          ? {
              ...prev,
              draft: {
                ...prev.draft,
                iconDataUrl: fetched.iconDataUrl,
                iconFilePath: fetched.iconFilePath
              }
            }
          : prev
      )
      notify('网站图标读取成功', 'success')
    } catch (error) {
      notify(`读取网站图标失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function confirmImportProjects() {
    if (!importPreview) return
    const selectedProjects = importPreview.projects.filter((project) => importPreview.selectedKeys[projectKey(project)] !== false)
    if (selectedProjects.length === 0) {
      notify('请至少勾选一项再导入', 'warn')
      return
    }
    setImportPreview((prev) => (prev ? { ...prev, confirming: true } : prev))
    try {
      const raw = await window.api.configRead()
      const parsed = yaml.load(raw) as AppConfig
      if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
        throw new Error('当前配置结构异常，无法导入目录命令')
      }
      const existingNames = new Set(parsed.commands.map((cmd) => cmd.name))
      const normalizeCommand = (text: string) => text.replace(/\s+/g, ' ').trim()
      const existingCommands = new Set(parsed.commands.map((cmd) => normalizeCommand(cmd.command)))

      const imported: CommandConfig[] = []
      let skipped = 0
      for (const project of selectedProjects) {
        if (existingCommands.has(normalizeCommand(project.command))) {
          skipped += 1
          continue
        }
        const nextName = uniqueCommandName(project.name, existingNames)
        existingNames.add(nextName)
        existingCommands.add(normalizeCommand(project.command))
        imported.push({
          name: nextName,
          command: project.command,
          tags: [],
          mode: project.mode || 'service',
          autoRestart: false
        })
      }
      if (imported.length === 0) {
        trackEvent({
          eventType: 'feature_usage',
          featureKey: 'home.import.directory',
          action: 'confirm',
          result: 'fail',
          context: { itemCount: 0, skippedCount: skipped, errorCode: 'ALL_DUPLICATED' }
        })
        notify(`未导入新命令，已跳过 ${skipped} 条重复项`, 'info')
        setImportPreview(null)
        setCommandForm(null)
        return
      }
      parsed.commands = [...imported, ...parsed.commands]
      const registryResult = await appendProjectsFromImportSelection(parsed, selectedProjects)
      const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
      await window.api.configSave(nextRaw)
      setEditorRaw(nextRaw)
      trackEvent({
        eventType: 'feature_usage',
        featureKey: 'home.import.directory',
        action: 'confirm',
        result: 'success',
        context: { itemCount: imported.length, skippedCount: skipped }
      })
      notify(`已导入 ${imported.length} 条命令，跳过 ${skipped} 条重复项；项目目录新增 ${registryResult.added} 项`, 'success')
      setImportPreview(null)
      setCommandForm(null)
    } catch (error) {
      trackEvent({
        eventType: 'feature_usage',
        featureKey: 'home.import.directory',
        action: 'confirm',
        result: 'fail',
        context: { errorCode: 'IMPORT_DIRECTORY_FAILED' }
      })
      notify(`导入目录失败：${error instanceof Error ? error.message : String(error)}`, 'error')
      setImportPreview((prev) => (prev ? { ...prev, confirming: false } : prev))
    }
  }

  useEffect(() => {
    const w = window as unknown as { __shellE2ENavigate?: (p: AppPage) => void }
    w.__shellE2ENavigate = (p) => setPage(p)
    return () => {
      delete w.__shellE2ENavigate
    }
  }, [setPage])

  useEffect(() => {
    const previousPage = previousPageRef.current
    if (page === 'query' && previousPage !== 'query') {
      if (!hasEnteredQueryOnceRef.current && selectedCommand) {
        // 仅在冷启动后首次进入 AI 日志页时清空，避免回连旧命令。
        setSelectedCommand('')
      }
      hasEnteredQueryOnceRef.current = true
    }
    previousPageRef.current = page
  }, [page, selectedCommand, setSelectedCommand])

  useEffect(() => {
    const off = window.api.onTerminalData((payload) => {
      if (payload.sessionId) return
      setTerminalPreviewByName((prev) => {
        const cur = prev[payload.commandName] || ''
        const next = `${cur}${payload.data}`.slice(-200_000)
        return { ...prev, [payload.commandName]: next }
      })
    })
    return () => {
      void off?.()
    }
  }, [])

  useEffect(() => {
    if (page !== 'query' || !selectedCommand) return
    const cmd = config.commands.find((c) => c.name === selectedCommand)
    if ((cmd?.mode || 'service') !== 'terminal') return
    void window.api.terminalGetBuffer(selectedCommand).then(({ text }) => {
      setTerminalPreviewByName((prev) => ({ ...prev, [selectedCommand]: text }))
    })
  }, [page, selectedCommand, config.commands])

  useEffect(() => {
    if (page !== 'query') return
    const names = new Set(terminalCommands.map((c) => c.name))
    if (!selectedCommand) return
    if (!names.has(selectedCommand)) setSelectedCommand('')
  }, [page, terminalCommands, selectedCommand, setSelectedCommand])

  useEffect(() => {
    void window.api
      .terminalGetInstanceCount()
      .then((payload) => setTerminalInstanceCount(payload.count))
      .catch(() => setTerminalInstanceCount(0))
    void syncTerminalStatusFromInstances()
  }, [syncTerminalStatusFromInstances])

  useEffect(() => {
    if (!(page === 'log' || page === 'terminal' || page === 'monitoring')) return
    const commandName = selectedCommand.trim()
    if (!commandName) return
    const exists = config.commands.some((item) => item.name === commandName)
    if (!exists) return
    setRecentCommandPages((prev) => {
      const nextItem: RecentCommandPageItem = {
        commandName,
        page,
        updatedAt: Date.now()
      }
      const existingIndex = prev.findIndex((item) => item.commandName === commandName)
      if (existingIndex >= 0) {
        // 保持已有顺序，仅更新条目内容，不做重排序。
        return prev.map((item, index) => (index === existingIndex ? nextItem : item))
      }
      // 新条目尾部追加，超出上限时裁剪最旧项。
      return [...prev, nextItem].slice(-RECENT_COMMAND_PAGES_LIMIT)
    })
  }, [config.commands, page, selectedCommand])

  useEffect(() => {
    const offConfigError = window.api.onConfigError(({ error }) => {
      notify(`配置文件加载失败：${error}`, 'error')
    })
    const offProcessStatus = window.api.onProcessStatus((payload) => {
      const commandText = config.commands.find((item) => item.name === payload.commandName)?.command
      const tickerText = formatProcessTickerText(payload, commandText)
      if (tickerText) pushTickerEvent(tickerText)
      trackEvent({
        eventType: 'command_lifecycle',
        featureKey: `command.${payload.commandName}`,
        action: payload.state,
        result: mapProcessStateToAnalyticsResult(payload.state),
        context: {
          hasMessage: Boolean(payload.message),
          hasExitCode: typeof payload.exitCode === 'number'
        }
      })
      if (!payload.message) return
      const tone: ToastTone = payload.state === 'error' ? 'error' : payload.state === 'restarting' ? 'warn' : 'info'
      notify(`${payload.commandName}：${payload.message}`, tone)
    })
    const offPreset = window.api.onPresetProgress((payload) => {
      setPresetProgress(payload)
    })
    const offTerminalStatus = window.api.onTerminalStatus((payload) => {
      void window.api
        .terminalGetInstanceCount()
        .then((result) => setTerminalInstanceCount(result.count))
        .catch(() => {})
      void syncTerminalStatusFromInstances()
      const sessionKey = `${payload.commandName}::${payload.sessionId || ''}`
      let isShortTask = false
      if (payload.state === 'running') {
        terminalRunStartedAtRef.current.set(sessionKey, Date.now())
      } else if (payload.state === 'idle') {
        const startedAt = terminalRunStartedAtRef.current.get(sessionKey)
        terminalRunStartedAtRef.current.delete(sessionKey)
        const durationMs = startedAt ? Date.now() - startedAt : undefined
        isShortTask = durationMs !== undefined && durationMs < TERMINAL_SHORT_TASK_MS
        if (isShortTask) {
          const seconds = Math.max(1, Math.round(durationMs! / 1000))
          notify(`${payload.commandName} 短任务已完成（${seconds}s）`, 'success')
          try {
            if (window.localStorage.getItem(TERMINAL_AUTO_RETURN_HOME_KEY) === '1' && pageRef.current === 'terminal') {
              setPage('home')
            }
          } catch {
            /* ignore */
          }
        }
      }
      trackEvent({
        eventType: 'command_lifecycle',
        featureKey: `terminal.${payload.commandName}`,
        action: payload.state,
        result: payload.state === 'running' ? 'success' : 'unknown',
        context: {
          hasSessionId: Boolean(payload.sessionId),
          hasExitCode: typeof payload.exitCode === 'number'
        }
      })
      if (!payload.message || isShortTask) return
      const tone: ToastTone = payload.exitCode && payload.exitCode !== 0 ? 'warn' : 'info'
      notify(`${payload.commandName}：${payload.message}`, tone)
    })
    return () => {
      offConfigError?.()
      offProcessStatus?.()
      offPreset?.()
      offTerminalStatus?.()
    }
  }, [config.commands, pushTickerEvent, syncTerminalStatusFromInstances, trackEvent, notify, setPage])

  useEffect(() => {
    applyThemePreset(themePreset)
    applyTheme(theme)
    persistTheme(theme)
    persistThemePreset(themePreset)
    void window.api.browserSetTheme(theme)
  }, [theme, themePreset])

  useEffect(() => {
    if (!toast.text) return
    const durationByTone: Record<ToastTone, number> = {
      success: 2400,
      info: 2800,
      warn: 3600,
      error: 4800
    }
    const timer = window.setTimeout(() => {
      setToast((prev) => (prev.text === toast.text ? { text: '', tone: prev.tone } : prev))
    }, durationByTone[toast.tone])
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!presetProgress) return
    if (presetProgress.index + 1 < presetProgress.total) return
    const doneTimer = window.setTimeout(() => {
      setPresetProgress((prev) => {
        if (!prev) return null
        if (prev.presetName !== presetProgress.presetName) return prev
        if (prev.index !== presetProgress.index) return prev
        return null
      })
    }, 1100)
    return () => window.clearTimeout(doneTimer)
  }, [presetProgress])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--bg)',
        overflow: 'visible'
      }}
    >
      <Sidebar
        page={page}
        onChange={navigateToPage}
        theme={theme}
        onToggleTheme={() =>
          setTheme((prev) => {
            const next = prev === 'dark' ? 'light' : 'dark'
            notify(next === 'dark' ? '已切换为暗色模式' : '已切换为浅色模式', 'info')
            return next
          })
        }
        updateUi={updateUi}
        appVersion={appVersion}
        onCheckUpdate={handleCheckUpdate}
        onDownloadUpdate={handleDownloadUpdate}
        onQuitAndInstall={() => void window.api.updateQuitAndInstall()}
        tickerEvents={tickerEvents}
        recentCommandPages={recentCommandPages}
        onOpenRecentCommandPage={openRecentCommandPage}
        onRemoveRecentCommandPage={removeRecentCommandPage}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--bg)'
        }}
      >
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: page === 'browser' ? 0 : '0 16px 16px' }}>
      {page !== 'browser' && (
        <div
          data-testid="window-top-drag-region"
          className="window-top-drag-region"
          onDoubleClick={() => void window.api.toggleWindowMaximize()}
        />
      )}
      <Suspense
        fallback={
          <div data-testid="app-page-loading" style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>
            正在加载页面...
          </div>
        }
      >
      {page === 'home' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <HomePage
          config={config}
          statusMap={statusMap}
          terminalStatusMap={terminalStatusMap}
          tags={tags}
          activeTag={activeTag}
          keyword={keyword}
          filteredCommands={filteredCommands}
          colorByState={colorByState}
          onTagChange={setActiveTag}
          onKeywordChange={(text) => {
            const normalized = text.trim().toLowerCase()
            if (normalized === 'mmm') {
              trackFeatureAction('home.search.hidden_analytics', 'trigger', 'success')
              setKeyword('')
              setPage('analytics')
              return
            }
            setKeyword(text)
          }}
          onOpenLog={(name) => {
            trackEvent({
              eventType: 'ui_action',
              featureKey: 'home.command.open_log',
              action: 'click',
              result: 'success',
              context: { source: 'home_card' }
            })
            setSelectedCommand(name)
            setPage('log')
          }}
          onOpenTerminal={(name) => {
            trackEvent({
              eventType: 'ui_action',
              featureKey: 'home.command.open_terminal',
              action: 'click',
              result: 'success',
              context: { source: 'home_card' }
            })
            setSelectedCommand(name)
            setPage('terminal')
          }}
          onMarkActiveCommand={(name) => setSelectedCommand(name)}
          onOpenContextMenu={(payload) => {
            trackFeatureAction('home.command.context_menu', 'open', 'success')
            void openCommandContextMenu(payload)
          }}
          onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          onBeginImportDirectory={beginImportDirectoryFromCreate}
          onBeginDemoImport={beginDemoImportFromCreate}
          importDetecting={importDetecting}
          onOpenAddLogDashboard={() => {
            trackEvent({
              eventType: 'feature_usage',
              featureKey: 'home.batch_logs.add_open',
              action: 'open',
              result: 'success'
            })
            setShowBatchLogModal(true)
          }}
          onOpenCommandFormForCreate={(step = 'pick') => {
            if (step === 'pick') {
              trackFeatureAction('home.command.create_modal', 'open', 'success')
            } else if (step === 'manual') {
              trackFeatureAction('home.command.create_modal', 'open', 'success', { shortcut: 'menu' })
            } else {
              trackEvent({
                eventType: 'feature_usage',
                featureKey: 'home.ai_prompt_guide.open',
                action: 'open',
                result: 'success',
                context: { shortcut: 'menu' }
              })
            }
            openCommandFormForCreate(step)
          }}
          showDemoHint={showDemoHint && !demoPresetInstalled}
          onDismissDemoHint={dismissDemoHint}
          onReorderCommands={reorderHomeCommands}
          onReorderTags={reorderHomeTags}
          logViewPresets={logViewPresets}
          onOpenPreset={(presetName) => openLogViewPreset(presetName)}
          onRenamePreset={(oldName, nextName) => { void renameLogViewPreset(oldName, nextName) }}
          onDeletePreset={(name) => { void deleteLogViewPreset(name) }}
          onTrackAction={trackFeatureAction}
          onAfterCommandRun={maybePromptAiGuideAfterFirstRun}
        />
        </div>
      )}

      {page === 'log' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <LogPage
          selectedCommand={selectedCommand}
          status={statusMap[selectedCommand]}
          lines={(logMap[selectedCommand] || []).slice(-500)}
          webUrl={selectedCommandConfig ? resolveCommandWebUrl(selectedCommandConfig, logMap[selectedCommand] || []) : undefined}
          onClearLogs={(commandName) => {
            clearProcessLogs(commandName)
            notify(`已清空 ${commandName} 的日志内容`, 'success')
          }}
          onBack={() => handleBackToHome('log')}
          onOpenInBrowser={(url) => openInBrowser({ url, referrerCommand: selectedCommand })}
          onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          onActionSuccess={(message) => notify(message, 'success')}
          onTrackAction={trackFeatureAction}
        />
        </div>
      )}

      {page === 'browser' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <BrowserPage
            launch={browserLaunch}
            onLaunchConsumed={() => setBrowserLaunch(null)}
            onTrackAction={trackFeatureAction}
          />
        </div>
      )}

      {page === 'multiLog' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <MultiLogPage
            commandNames={multiLogCommands}
            statusMap={statusMap}
            logMap={logMap}
            onBack={() => setPage('home')}
            onRemoveCommand={(name) => {
              const next = multiLogCommands.filter((n) => n !== name)
              setMultiLogCommands(next)
              if (next.length === 0) setPage('home')
            }}
            onOpenCommandLog={(name) => {
              setSelectedCommand(name)
              setPage('log')
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: page === 'query' ? 'flex' : 'none' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <QueryPage
            queryInput={queryInput}
            commandInput={commandInput}
            setCommandInput={setCommandInput}
            chatHistory={chatHistory}
            streamingText={streamingText}
            isStreaming={isStreaming}
            agentPhase={agentPhase}
            commands={terminalCommands}
            selectedCommand={selectedCommand}
            terminalBadgeState={querySessionBadgeState}
            setQueryInput={setQueryInput}
            clearChatHistory={clearChatHistory}
            favoriteCommands={favoriteCommands}
            fillCommandFromFavorite={fillCommandFromFavorite}
            addFavoriteCommand={addFavoriteCommand}
            removeFavoriteCommand={removeFavoriteCommand}
            active={page === 'query'}
            cancel={cancelTranslation}
            translate={(context) =>
              translate({
                selectedCommand,
                ...context
              })
            }
            selectCommand={setSelectedCommand}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
            onTrackAction={trackFeatureAction}
          />
        </div>
      </div>

      {page === 'dashboard' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DashboardPage />
        </div>
      )}
      {page === 'analytics' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <AnalyticsPage
            onBack={() => {
              trackFeatureAction('analytics.viewer.back_home', 'click', 'success')
              setPage('home')
            }}
            onTrack={trackFeatureAction}
          />
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          visibility: page === 'editor' ? 'visible' : 'hidden',
          pointerEvents: page === 'editor' ? 'auto' : 'none'
        }}
      >
        <EditorPage
          editorRaw={editorRaw}
          editorError={editorError}
          setEditorRaw={setEditorRaw}
          saveEditor={async () => {
            try {
              const result = await saveEditor()
              if (result.ok) {
                trackEvent({
                  eventType: 'feature_usage',
                  featureKey: 'editor.config.save',
                  action: 'submit',
                  result: 'success'
                })
                notify('配置已保存并重新加载', 'success')
              } else {
                trackEvent({
                  eventType: 'feature_usage',
                  featureKey: 'editor.config.save',
                  action: 'submit',
                  result: 'fail',
                  context: { errorCode: 'CONFIG_VALIDATE_FAILED' }
                })
                setEditorError(result.error || 'YAML 格式错误')
                notify(`保存失败：${result.error || '格式校验不通过'}`, 'error')
              }
              return result
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              trackEvent({
                eventType: 'feature_usage',
                featureKey: 'editor.config.save',
                action: 'submit',
                result: 'fail',
                context: { errorCode: 'CONFIG_SAVE_EXCEPTION' }
              })
              setEditorError(message)
              notify(`保存失败：${message}`, 'error')
              return { ok: false, error: message }
            }
          }}
          reloadEditor={async () => {
            try {
              const raw = await window.api.configRead()
              setEditorRaw(raw)
              setEditorError('')
              notify('已重载配置文件', 'info')
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              setEditorError(message)
              notify(`读取配置文件失败：${message}`, 'error')
            }
          }}
          locateLine={locateLine}
          onLocated={() => setLocateLine(undefined)}
        />
      </div>
      {page === 'ssh-keys' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <SshKeysPage
            sshKeys={config.settings.sshKeys || []}
            onConfigChanged={async () => {
              const raw = await window.api.configRead()
              setEditorRaw(raw)
            }}
          />
        </div>
      )}
      {page === 'collaboration' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <CollaborationPage
            projectDirectories={config.projectDirectories || []}
            deployScripts={config.deployScripts || []}
            sshKeys={config.settings.sshKeys || []}
            onConfigChanged={async () => {
              const raw = await window.api.configRead()
              setEditorRaw(raw)
            }}
            onNotify={notify}
            onExecuteDeploy={handleExecuteDeploy}
            onTrackAction={trackFeatureAction}
          />
        </div>
      )}
      {page === 'terminal' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TerminalPage
            commandName={selectedCommand}
            commandDisplayNames={deployTerminalTitles}
            onBack={() => handleBackToHome('terminal')}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          onTrackAction={trackFeatureAction}
          />
        </div>
      )}
      {page === 'monitoring' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <MonitoringPage
            commandName={selectedCommand}
            commands={terminalCommands.map((item) => ({
              name: item.name,
              command: item.command,
              sshKeyId: item.sshKeyId
            }))}
            onSelectCommand={setSelectedCommand}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
            onMonitoringEvent={pushTickerEvent}
            theme={theme}
          />
        </div>
      )}
      </Suspense>
      </div>

      <Toast text={toast.text} tone={toast.tone} />
      {presetProgress && (
        <PresetProgressOverlay
          presetName={presetProgress.presetName}
          action={presetProgress.action}
          index={presetProgress.index}
          total={presetProgress.total}
          commandName={presetProgress.commandName}
          sequence={presetProgress.sequence}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={buildMenuItems({
            commandName: contextMenu.commandName,
            commands: config.commands,
            terminalStatusMap,
            setPage,
            setSelectedCommand,
            notify,
            setLocateLine,
            editorRaw,
            commandLogs: logMap[contextMenu.commandName] || [],
            onTrackAction: trackFeatureAction,
            onEditCommand: openCommandFormForEdit,
            onDeleteCommand: deleteCommandFromConfig,
            onOpenInBrowser: openInBrowser
          })}
        />
      )}
      {showBatchLogModal && (
        <BatchLogModal
          commands={filteredCommands}
          logViewPresets={logViewPresets}
          statusMap={statusMap}
          onSavePreset={(presetName, selectedNames) => {
            void saveLogViewPreset(presetName, selectedNames)
          }}
          onClose={() => setShowBatchLogModal(false)}
        />
      )}
      {commandForm && (
        <CommandFormModal
          form={commandForm}
          config={config}
          existingCommandNames={config.commands.map((command) => command.name)}
          onClose={() => {
            setCommandForm(null)
            setImportPreview(null)
          }}
          onCreateStepChange={(step) => setCommandForm((prev) => (prev ? { ...prev, createStep: step } : prev))}
          onFormChange={(updater) => setCommandForm((prev) => (prev ? updater(prev) : prev))}
          onSubmit={() => void submitCommandForm()}
          onPickMacosApp={() => void pickMacosAppForCommandForm()}
          onFetchWebIcon={() => void fetchWebsiteIconForCommandForm()}
          onCopyError={(message) => notify(`复制失败：${message}`, 'error')}
          importPreview={importPreview}
          importDetecting={importDetecting}
          onBeginImportDirectory={(entry) => void beginImportDirectoryFromCreate(entry)}
          onImportToggle={(key) =>
            setImportPreview((prev) =>
              prev
                ? {
                    ...prev,
                    selectedKeys: {
                      ...prev.selectedKeys,
                      [key]: !(prev.selectedKeys[key] !== false)
                    }
                  }
                : prev
            )
          }
          onConfirmImport={() => void confirmImportProjects()}
          demoPresetInstalled={demoPresetInstalled}
          demoConfirming={demoConfirming}
          onBeginDemoImport={beginDemoImportFromCreate}
          onConfirmDemoImport={() => void confirmDemoImportFromCreate()}
          onCleanupDemoCommands={() => void cleanupDemoFromCreate()}
        />
      )}
      </div>
    </div>
  )
}

function uniqueCommandName(baseName: string, existing: Set<string>): string {
  const sanitized = (baseName || 'auto-import').trim()
  if (!existing.has(sanitized)) return sanitized
  let index = 1
  while (existing.has(`${sanitized}-${index}`)) index += 1
  return `${sanitized}-${index}`
}

function formatUpdateDisabledReason(reason: AppUpdateDisabledReason): string {
  if (reason === 'not-packaged') return '当前为开发模式（未打包）'
  return '当前平台暂不支持自动更新'
}

function normalizeTickerText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function formatUpdateTickerText(payload: AppUpdateBroadcastPayload): string | null {
  if (payload.phase === 'checking') return '系统正在检查更新'
  if (payload.phase === 'available') return `发现新版本 ${payload.version}`
  if (payload.phase === 'downloading') return '正在下载更新'
  if (payload.phase === 'installing') return '正在安装更新，应用即将重启'
  if (payload.phase === 'downloaded') return `新版本 ${payload.version} 已下载完成`
  if (payload.phase === 'error') {
    const short = payload.message.slice(0, 48)
    return `更新失败：${short}${payload.message.length > 48 ? '…' : ''}`
  }
  if (payload.phase === 'not-available') {
    return payload.fromManual ? '当前已是最新版本' : '自动检查更新：当前已是最新版本'
  }
  return null
}

function formatProcessTickerText(payload: ProcessStatusPayload, commandText?: string): string | null {
  const commandPreview = formatCommandPreview(commandText)
  if (payload.state === 'running' && !payload.message) {
    return commandPreview ? `执行命令：${commandPreview}` : `${payload.commandName}：已启动`
  }
  if (payload.message) {
    if (commandPreview) return `命令事件：${commandPreview} ｜ ${payload.message}`
    return `${payload.commandName}：${payload.message}`
  }
  if (payload.state === 'restarting') return commandPreview ? `命令重启：${commandPreview}` : `${payload.commandName}：重启中`
  if (payload.state === 'error') return commandPreview ? `命令异常：${commandPreview}` : `${payload.commandName}：异常退出`
  if (payload.state === 'idle') return commandPreview ? `命令结束：${commandPreview}` : `${payload.commandName}：已停止`
  return null
}

function formatCommandPreview(commandText?: string): string {
  if (!commandText) return ''
  const normalized = commandText.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 72)}...`
}

function normalizeTagsInput(input: string): string[] {
  const pieces = input
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(pieces))
}

function normalizeCommandForSave(command: string, mode: CommandFormDraft['mode']): string {
  if (mode !== 'terminal') return command.trim()
  const normalized = splitInteractiveCommands(command).filter((item) => item.length > 0)
  return normalized.join(' ||| ')
}

function normalizeLogViewPresets(input?: LogViewPreset[]): LogViewPreset[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const result: LogViewPreset[] = []
  for (const preset of input) {
    const name = typeof preset?.name === 'string' ? preset.name.trim() : ''
    if (!name || seen.has(name)) continue
    const commandNames = Array.isArray(preset.commandNames)
      ? Array.from(new Set(preset.commandNames.map((item) => String(item || '').trim()).filter(Boolean)))
      : []
    result.push({
      name,
      commandNames,
      updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : undefined
    })
    seen.add(name)
  }
  return result
}

function buildMacosOpenAppCommand(appName: string): string {
  const escaped = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `open -gj -a "${escaped}"`
}

function buildMenuItems(params: {
  commandName: string
  commands: CommandConfig[]
  terminalStatusMap: Record<string, 'running' | 'idle'>
  setPage: (page: AppPage) => void
  setSelectedCommand: (name: string) => void
  notify: (text: string, tone?: ToastTone) => void
  onTrackAction: (featureKey: string, action: string, result?: AnalyticsResult) => void
  setLocateLine: (line?: number) => void
  editorRaw: string
  commandLogs: string[]
  onEditCommand: (commandName: string) => void
  onDeleteCommand: (commandName: string) => Promise<void>
  onOpenInBrowser: (request: { url?: string; referrerCommand?: string }) => void
}): ContextMenuItem[] {
  const {
    commandName,
    commands,
    terminalStatusMap,
    setPage,
    setSelectedCommand,
    notify,
    onTrackAction,
    setLocateLine,
    editorRaw,
    commandLogs,
    onEditCommand,
    onDeleteCommand,
    onOpenInBrowser
  } = params
  const commandConfig = commands.find((item) => item.name === commandName)
  const terminalRunning = terminalStatusMap[commandName] === 'running'
  const commandContent = commandConfig?.command || commandName
  const webUrl = commandConfig ? resolveCommandWebUrl(commandConfig, commandLogs) : undefined

  const items: ContextMenuItem[] = [
    {
      key: 'run',
      label: commandConfig?.mode === 'terminal' ? (terminalRunning ? '进入终端窗口' : '开启新终端') : '启动任务',
      group: '快捷运行',
      onClick: async () => {
        try {
          onTrackAction('context_menu.command.run', 'click', 'success')
          setSelectedCommand(commandName)
          if (commandConfig?.mode === 'terminal') {
            if (terminalRunning) {
              setPage('terminal')
              return
            }
            await window.api.terminalStart(commandName)
            return
          }
          await window.api.processStart(commandName)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    ...(commandConfig?.mode === 'terminal'
      ? []
      : [
          {
            key: 'view-log',
            label: '查看运行日志',
            group: '快捷运行',
            onClick: () => {
              setSelectedCommand(commandName)
              setPage('log')
            }
          } satisfies ContextMenuItem
        ]),
    {
      key: 'open-web',
      label: '打开网站（Chrome）',
      group: '快捷运行',
      onClick: async () => {
        onTrackAction('context_menu.command.open_web', 'click', webUrl ? 'success' : 'fail')
        if (!webUrl) {
          notify('未检测到该命令的 Web 地址。请在配置中添加 webUrl。', 'warn')
          return
        }
        try {
          await window.api.openExternal(webUrl)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    {
      key: 'open-web-builtin',
      label: '内置打开',
      group: '快捷运行',
      onClick: () => {
        onTrackAction('context_menu.command.open_web_builtin', 'click', webUrl ? 'success' : 'fail')
        if (!webUrl) {
          notify('未检测到该命令的 Web 地址。请在配置中添加 webUrl。', 'warn')
          return
        }
        setSelectedCommand(commandName)
        onOpenInBrowser({ url: webUrl, referrerCommand: commandName })
      }
    },
    {
      key: 'stop',
      label: '强制停止',
      group: '快捷运行',
      onClick: async () => {
        try {
          onTrackAction('context_menu.command.stop', 'click', 'success')
          if (commandConfig?.mode === 'terminal') await window.api.terminalStopAllForCommand(commandName)
          else await window.api.processStop(commandName)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      },
      tone: 'warn'
    },
    ...(commandConfig?.mode === 'terminal'
      ? []
      : [
          {
            key: 'restart',
            label: '立即重启',
            group: '快捷运行',
            onClick: async () => {
              try {
                onTrackAction('context_menu.command.restart', 'click', 'success')
                await window.api.processRestart(commandName)
              } catch (error) {
                notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
              }
            },
            tone: 'warn'
          } satisfies ContextMenuItem
        ]),
    {
      key: 'copy',
      label: '复制原始指令',
      group: '配置管理',
      onClick: async () => {
        try {
          onTrackAction('context_menu.command.copy', 'click', 'success')
          await navigator.clipboard.writeText(commandContent)
          notify(`指令已复制：${commandName}`, 'success')
        } catch (error) {
          notify(`复制失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    {
      key: 'edit',
      label: '编辑命令',
      group: '配置管理',
      onClick: () => {
        onTrackAction('context_menu.command.edit', 'click', 'success')
        onEditCommand(commandName)
      }
    },
    {
      key: 'locate',
      label: '在配置文件中查看',
      group: '配置管理',
      onClick: () => {
        onTrackAction('context_menu.command.locate', 'click', 'success')
        const line = findCommandLine(editorRaw, commandName)
        setPage('editor')
        if (!line) {
          notify(`配置中找不到该命令：${commandName}`, 'warn')
          return
        }
        setLocateLine(line)
      }
    },
    {
      key: 'delete-command',
      label: '删除命令',
      group: '更多设置',
      tone: 'danger',
      onClick: async () => {
        const confirmed = window.confirm(`确认删除命令「${commandName}」吗？此操作会同步更新配置文件。`)
        if (!confirmed) return
        try {
          onTrackAction('context_menu.command.delete', 'click', 'success')
          await onDeleteCommand(commandName)
        } catch (error) {
          notify(`删除失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    }
  ]
  return items
}

function findCommandLine(raw: string, commandName: string): number | undefined {
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalized = line.replace(/\s+/g, '')
    if (normalized.includes(`-name:${commandName}`) || normalized.includes(`name:${commandName}`)) {
      return index + 1
    }
    if (line.includes(`name: "${commandName}"`) || line.includes(`name: '${commandName}'`)) {
      return index + 1
    }
  }
  return undefined
}
