import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'

let terminalPageCache: {
  tabs: TerminalTabState[]
  activeTabId: string
  sessionStateBySessionId: Record<string, 'running' | 'idle'>
} | null = null
const paneStartInFlightByKey = new Map<
  string,
  Promise<{ ok: boolean; state?: 'running' | 'idle'; buffer?: string }>
>()
export function TerminalPage({
  commandName,
  commandDisplayNames,
  onBack,
  onActionError,
  onTrackAction
}: {
  commandName: string
  commandDisplayNames?: Record<string, string>
  onBack: () => void
  onActionError: (message: string) => void
  onTrackAction: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const actionErrorRef = useRef(onActionError)
  const initialTerminalRef = useRef<ReturnType<typeof resolveInitialTerminalState> | null>(null)
  if (initialTerminalRef.current === null) {
    initialTerminalRef.current = resolveInitialTerminalState(commandName)
  }
  const [tabs, setTabs] = useState<TerminalTabState[]>(() => initialTerminalRef.current!.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTerminalRef.current!.activeTabId)
  const [sessionStateBySessionId, setSessionStateBySessionId] = useState<Record<string, 'running' | 'idle'>>(
    () => initialTerminalRef.current!.sessionStateBySessionId
  )
  const [isLightTheme, setIsLightTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.dataset.theme === 'light'
  })

  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  )
  const activePane = useMemo(
    () => activeTab?.panes.find((item) => item.id === activeTab.activePaneId) || activeTab?.panes[0] || null,
    [activeTab]
  )
  const activeCommand = activePane?.commandName || ''
  const activeCommandLabel = (activeCommand && commandDisplayNames?.[activeCommand]) || activeCommand

  useEffect(() => {
    if (tabs.length === 0) {
      const first = createTab('会话 1', commandName || '')
      setTabs([first])
      setActiveTabId(first.id)
      return
    }
    if (!tabs.some((item) => item.id === activeTabId)) {
      setActiveTabId(tabs[0].id)
    }
  }, [tabs, activeTabId, commandName])

  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = () => setIsLightTheme(root.dataset.theme === 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!commandName || !activeTab) return
    const currentPane = activeTab.panes.find((pane) => pane.id === activeTab.activePaneId)
    if (!currentPane) return
    if (currentPane.commandName === commandName) return

    if (currentPane.commandName && currentPane.sessionId) {
      void window.api.terminalStop(currentPane.commandName, { sessionId: currentPane.sessionId })
    }
    const nextSessionId = ''
    setSessionStateBySessionId((prev) => {
      const next = { ...prev }
      delete next[resolveSessionStateKey(currentPane.commandName, currentPane.sessionId)]
      return next
    })
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab
        const nextPanes = tab.panes.map((pane) =>
          pane.id === tab.activePaneId ? { ...pane, commandName, sessionId: nextSessionId } : pane
        )
        return { ...tab, panes: nextPanes }
      })
    )
  }, [commandName, activeTab])

  useEffect(() => {
    terminalPageCache = {
      tabs,
      activeTabId,
      sessionStateBySessionId
    }
  }, [tabs, activeTabId, sessionStateBySessionId])

  function updateActiveTab(updater: (tab: TerminalTabState) => TerminalTabState) {
    if (!activeTab) return
    setTabs((prev) => prev.map((item) => (item.id === activeTab.id ? updater(item) : item)))
  }

  const visiblePanes = useMemo(() => {
    if (!activeTab) return []
    if (!activeTab.fullscreenPaneId) return activeTab.panes
    const fullscreenPane = activeTab.panes.find((pane) => pane.id === activeTab.fullscreenPaneId)
    return fullscreenPane ? [fullscreenPane] : activeTab.panes
  }, [activeTab])

  const gridTemplate = useMemo(() => {
    if (!activeTab) return { columns: '1fr', rows: '1fr' }
    if (activeTab.fullscreenPaneId) return { columns: '1fr', rows: '1fr' }
    // minmax 保证从全屏还原后行高一致，避免仅一侧被内容撑高导致左右/上下不对齐
    if (activeTab.layout === 'horizontal-2') return { columns: 'repeat(2, minmax(0, 1fr))', rows: 'minmax(0, 1fr)' }
    if (activeTab.layout === 'vertical-2') return { columns: '1fr', rows: 'repeat(2, minmax(0, 1fr))' }
    if (activeTab.layout === 'grid-4') return { columns: 'repeat(2, minmax(0, 1fr))', rows: 'repeat(2, minmax(0, 1fr))' }
    return { columns: '1fr', rows: 'minmax(0, 1fr)' }
  }, [activeTab])

  const shellPanelBaseStyle = useMemo(
    () =>
      ({
        background: isLightTheme ? '#0f131b' : '#000000',
        border: isLightTheme
          ? '1px solid color-mix(in srgb, #334155 62%, #0f131b)'
          : '1px solid color-mix(in srgb, var(--border-default) 78%, #000000)',
        boxShadow: isLightTheme
          ? 'inset 0 0 0 1px color-mix(in srgb, #64748b 28%, transparent)'
          : 'inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 35%, transparent)'
      }) as const,
    [isLightTheme]
  )

  const shellMutedColor = isLightTheme ? '#cbd5e1' : 'color-mix(in srgb, var(--muted) 45%, #cbd5e1)'
  const pageMetaTextStyle = { color: isLightTheme ? 'var(--muted)' : shellMutedColor } as const

  return (
    <div
      data-testid="terminal-page"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Panel
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <button
                data-testid="terminal-back-icon"
                onClick={onBack}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.96)'
                  onTrackAction('terminal.back_home', 'click', 'success')
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1.06)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, var(--panel))'
                  e.currentTarget.style.color = 'var(--accent)'
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.18)'
                  e.currentTarget.style.transform = 'scale(1.06)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-default)'
                  e.currentTarget.style.background = 'var(--panel-soft)'
                  e.currentTarget.style.color = 'var(--text-dim)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
                title="返回上一级"
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 28,
                  width: 48,
                  height: 48,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--panel-soft)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 22,
                  lineHeight: 1,
                  flexShrink: 0,
                  transition:
                    'transform 150ms ease, border-color 150ms ease, background-color 150ms ease, color 150ms ease, box-shadow 150ms ease'
                }}
              >
                ←
              </button>
              <div style={{ fontWeight: 700, fontSize: 14 }}>命令交互窗口 · {activeCommandLabel || '未选择命令'}</div>
            </div>
            <div style={{ fontSize: 12, ...pageMetaTextStyle }}>
              状态：{activeCommand && activePane && sessionStateBySessionId[resolveSessionStateKey(activePane.commandName, activePane.sessionId)] === 'running' ? '正在连接' : activeCommand ? '已结束' : '未选择'}（支持交互式命令，如
              tail -f）
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              data-testid="terminal-stop-session"
              style={buttonStyle('warn')}
              onClick={async () => {
                if (!activeCommand) return
                try {
                  onTrackAction('terminal.stop_session', 'click', 'success')
                  await window.api.terminalStop(activeCommand, { sessionId: activePane?.sessionId || undefined })
                  setSessionStateBySessionId((prev) => ({
                    ...prev,
                    [resolveSessionStateKey(activeCommand, activePane?.sessionId)]: 'idle'
                  }))
                } catch (error) {
                  onActionError(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              终止会话
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 10,
            flex: 1,
            minHeight: 0,
            alignItems: 'stretch'
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate.columns,
              gridTemplateRows: gridTemplate.rows,
              gap: 10,
              alignItems: 'stretch',
              minHeight: 0,
              height: '100%'
            }}
          >
            {visiblePanes.map((pane) => (
                <div
                  key={pane.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    height: '100%',
                    alignSelf: 'stretch'
                  }}
                  onClick={() => {
                    updateActiveTab((tab) => ({ ...tab, activePaneId: pane.id }))
                  }}
                >
                  <Panel
                    soft
                    data-testid="terminal-shell"
                    style={{
                      ...shellPanelBaseStyle,
                      padding: 0,
                      borderRadius: 0,
                      border: shellPanelBaseStyle.border,
                      minHeight: 0,
                      flex: 1,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <TerminalPane
                      paneId={pane.id}
                      commandName={pane.commandName}
                      sessionId={pane.sessionId}
                      onActionError={(message) => actionErrorRef.current(message)}
                      onStatus={(state) => {
                        setSessionStateBySessionId((prev) => ({
                          ...prev,
                          [resolveSessionStateKey(pane.commandName, pane.sessionId)]: state
                        }))
                      }}
                    />
                  </Panel>
                </div>
              ))}
          </div>
        </div>
      </Panel>
    </div>
  )
}

function TerminalPane({
  paneId,
  commandName,
  sessionId,
  onActionError,
  onStatus
}: {
  paneId: string
  commandName: string
  sessionId?: string
  onActionError: (message: string) => void
  onStatus: (state: 'running' | 'idle') => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const onActionErrorRef = useRef(onActionError)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onActionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      convertEol: false,
      scrollback: 8000
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(hostRef.current)
    fitAddon.fit()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    return () => {
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !fitAddonRef.current || !terminalRef.current || !commandName) return
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    const normalizedSessionId = sessionId?.trim() || undefined
    const paneMountKey = `${paneId}:${commandName}:${normalizedSessionId || 'default'}`
    const onResize = () => {
      fitAddon.fit()
      void window.api.terminalResize(commandName, terminal.cols, terminal.rows, { sessionId: normalizedSessionId })
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(host)
    window.addEventListener('resize', onResize)

    const inputDisposable = terminal.onData((data) => {
      void window.api.terminalInput(commandName, data, { sessionId: normalizedSessionId })
    })
    const offData = window.api.onTerminalData((payload) => {
      if ((payload.sessionId || '') !== (normalizedSessionId || '')) return
      if (payload.commandName !== commandName) return
      terminal.write(payload.data)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if ((payload.sessionId || '') !== (normalizedSessionId || '')) return
      if (payload.commandName !== commandName) return
      onStatusRef.current(payload.state)
      if (payload.state === 'idle' && typeof payload.exitCode === 'number') {
        terminal.write(`\r\n\r\n[会话已结束，状态码 (Exit Code) ${payload.exitCode}]\r\n`)
      }
    })
    /** 首页「打开窗口」会占用无 sessionId 的默认槽；进入交互页再启 Pane 会形成双 PTY，仅终止 Pane 时列表仍显示运行中。 */
    let disposed = false
    const startSession = async () => {
      let sharedStartPromise = paneStartInFlightByKey.get(paneMountKey)
      try {
        if (!sharedStartPromise) {
          sharedStartPromise = (async () => {
            if (normalizedSessionId) {
              try {
                await window.api.terminalStop(commandName)
              } catch {
                /* 无默认槽时忽略 */
              }
            }
            const { instances } = await window.api.terminalListInstances()
            const hasExistingSession = instances.some(
              (instance) =>
                instance.commandName === commandName &&
                (instance.sessionId || '').trim() === (normalizedSessionId || '')
            )
            return hasExistingSession
              ? {
                  ok: true,
                  state: 'running' as const,
                  buffer: (await window.api.terminalGetBuffer(commandName, { sessionId: normalizedSessionId })).text
                }
              : normalizedSessionId
                ? await window.api.terminalStart(commandName, { sessionId: normalizedSessionId })
                : await window.api.terminalStart(commandName)
          })()
          paneStartInFlightByKey.set(paneMountKey, sharedStartPromise)
        }
        const result = await sharedStartPromise
        if (disposed) return
        if (result.buffer) {
          terminal.write(result.buffer)
        }
        onStatusRef.current(result.state || 'running')
        if ((result.state || 'running') === 'running') {
          void window.api.terminalResize(commandName, terminal.cols, terminal.rows, { sessionId: normalizedSessionId })
        }
      } catch (error) {
        if (!disposed) {
          onActionErrorRef.current(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (sharedStartPromise && paneStartInFlightByKey.get(paneMountKey) === sharedStartPromise) {
          paneStartInFlightByKey.delete(paneMountKey)
        }
      }
    }
    void startSession()

    return () => {
      disposed = true
      inputDisposable.dispose()
      offData?.()
      offStatus?.()
      resizeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      terminal.reset()
    }
  }, [commandName, paneId, sessionId])

  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {commandName ? (
        <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--muted)',
            border: '1px dashed var(--border-default)',
            borderRadius: 0
          }}
        >
          请选择命令后开始会话
        </div>
      )}
    </div>
  )
}

type TerminalLayout = 'single' | 'horizontal-2' | 'vertical-2' | 'grid-4'

interface TerminalPaneState {
  id: string
  commandName: string
  sessionId?: string
}

interface TerminalTabState {
  id: string
  title: string
  layout: TerminalLayout
  panes: TerminalPaneState[]
  activePaneId: string
  fullscreenPaneId?: string
}

function createTab(title: string, initialCommand: string): TerminalTabState {
  const firstPane = { id: tabsafeId('pane'), commandName: initialCommand, sessionId: '' }
  return {
    id: tabsafeId('tab'),
    title,
    layout: 'single',
    panes: [firstPane],
    activePaneId: firstPane.id
  }
}

/** 恢复缓存前校验当前入口命令与活动 Pane 一致，避免二次进入时沿用旧命令导致串台。 */
function resolveInitialTerminalState(incomingCommand: string): {
  tabs: TerminalTabState[]
  activeTabId: string
  sessionStateBySessionId: Record<string, 'running' | 'idle'>
} {
  const cache = terminalPageCache
  if (cache?.tabs?.length) {
    const tab = cache.tabs.find((t) => t.id === cache.activeTabId) || cache.tabs[0]
    const pane = tab?.panes.find((p) => p.id === tab.activePaneId) || tab?.panes[0]
    if (pane && (!incomingCommand || pane.commandName === incomingCommand)) {
      return {
        tabs: cache.tabs,
        activeTabId: cache.activeTabId,
        sessionStateBySessionId: { ...cache.sessionStateBySessionId }
      }
    }
  }
  const first = createTab('会话 1', incomingCommand || '')
  return {
    tabs: [first],
    activeTabId: first.id,
    sessionStateBySessionId: {}
  }
}

function resolveSessionStateKey(commandName: string, sessionId?: string): string {
  return sessionId && sessionId.trim().length > 0 ? sessionId.trim() : `default:${commandName || 'unknown'}`
}

function tabsafeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
