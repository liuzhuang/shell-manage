import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CommandConfig, QueryAiAction, QueryAiHistoryItem, QueryAiResponse } from '../../shared/types'
import { XIcon } from '../components/icons/XIcon'
import { formatTerminalTuiEntry, type TerminalTuiTone } from '../lib/terminalTui'
import { buttonStyle, inputStyle } from '../lib/uiStyles'
import { buildTerminalContextLines } from '../lib/terminalContext'

type TimelineEntry = { key: string; at: number; role: 'user' | 'assistant'; content: string; action?: QueryAiAction }
type QueryExecutionTarget = {
  commandName: string
  sessionId: string
  instanceId?: string
  autoExecutionCapable?: boolean
  selectionEpoch: number
}
type AutoExecutionCapability = {
  supported: boolean | null
  capable: boolean
}

const CONFIRM_EXECUTE_STORAGE_KEY = 'query.ai.confirmExecute.v1'
const AUTO_EXECUTE_STORAGE_KEY = 'query.ai.autoExecuteLowRisk.v2'
const QUERY_TERMINAL_SOURCE = 'query'
const QUERY_AUTO_TERMINAL_SOURCE = 'query-auto'
const QUERY_TERMINAL_SESSION_PREFIX = 'query'
const SECTION_STYLE = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--panel)'
} as const

function compactButtonStyle(variant: 'primary' | 'muted' | 'outline' | 'warn' | 'danger', extra: CSSProperties = {}): CSSProperties {
  return {
    ...buttonStyle(variant),
    borderRadius: 'var(--radius-xs)',
    padding: '5px 10px',
    minHeight: 30,
    fontSize: 12,
    whiteSpace: 'nowrap',
    ...extra
  }
}

const selectStyle: CSSProperties = {
  minWidth: 0,
  height: 36,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--panel)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: 12,
  fontFamily: 'var(--font-ui)'
}

export function QueryPage(props: {
  queryInput: string
  commandInput: string
  setCommandInput: (text: string) => void
  chatHistory: Array<QueryAiHistoryItem & { at: number }>
  streamingText: string
  isStreaming: boolean
  commands: CommandConfig[]
  selectedCommand: string
  terminalBadgeState: 'running' | 'idle_with_cache' | 'idle_empty'
  setQueryInput: (text: string) => void
  clearChatHistory: () => void
  translate: (context: {
    sessionLogs: string[]
    terminalSessionId: string
    terminalInstanceId?: string
  }) => Promise<QueryAiResponse | undefined>
  selectCommand: (name: string) => void
  onActionError: (message: string) => void
  favoriteCommands: string[]
  fillCommandFromFavorite: (command: string) => void
  addFavoriteCommand: () => void
  removeFavoriteCommand: (command: string) => void
  active: boolean
  onTrackAction?: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const {
    queryInput,
    commandInput,
    setCommandInput,
    chatHistory,
    streamingText,
    isStreaming,
    commands,
    selectedCommand,
    terminalBadgeState,
    setQueryInput,
    clearChatHistory,
    translate,
    selectCommand,
    onActionError,
    active,
    onTrackAction
  } = props

  const [showHistoryPopover, setShowHistoryPopover] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<'ask' | 'command'>('ask')
  const [autoFollowTimeline, setAutoFollowTimeline] = useState(true)
  const [showTerminalFullscreen, setShowTerminalFullscreen] = useState(false)
  const [terminalSessionState, setTerminalSessionState] = useState<'running' | 'idle'>('idle')
  const [pendingAiCommand, setPendingAiCommand] = useState('')
  const [confirmBeforeExecute, setConfirmBeforeExecute] = useState<boolean>(() => loadConfirmBeforeExecute())
  const [autoExecuteLowRisk, setAutoExecuteLowRisk] = useState<boolean>(() => loadAutoExecuteLowRisk())
  const [autoExecutionSupported, setAutoExecutionSupported] = useState<boolean | null>(null)
  const [autoExecutionCapable, setAutoExecutionCapable] = useState(false)
  const [workbenchOffset, setWorkbenchOffset] = useState({ x: 0, y: 0 })
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const inlineHostRef = useRef<HTMLDivElement | null>(null)
  const workbenchRef = useRef<HTMLDivElement | null>(null)
  const workbenchOffsetRef = useRef(workbenchOffset)
  const workbenchDragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const composingRef = useRef(false)
  const terminalPrinterRef = useRef<((content: string) => void) | null>(null)
  const printedChatCountRef = useRef(0)
  const autoExecuteLowRiskRef = useRef(autoExecuteLowRisk)

  function moveWorkbench(x: number, y: number) {
    const panel = workbenchRef.current
    const bounds = panel?.parentElement?.getBoundingClientRect()
    if (!panel || !bounds) return
    const current = workbenchOffsetRef.current
    const rect = panel.getBoundingClientRect()
    const baseLeft = rect.left - current.x
    const baseTop = rect.top - current.y
    const next = {
      x: Math.min(bounds.right - baseLeft - rect.width, Math.max(bounds.left - baseLeft, x)),
      y: Math.min(bounds.bottom - baseTop - rect.height, Math.max(bounds.top - baseTop, y))
    }
    workbenchOffsetRef.current = next
    setWorkbenchOffset(next)
  }

  function startWorkbenchDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = workbenchOffsetRef.current
    workbenchDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: current.x,
      originY: current.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function dragWorkbench(event: ReactPointerEvent<HTMLElement>) {
    const drag = workbenchDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    moveWorkbench(drag.originX + event.clientX - drag.x, drag.originY + event.clientY - drag.y)
  }

  function stopWorkbenchDrag(event: ReactPointerEvent<HTMLElement>) {
    if (workbenchDragRef.current?.pointerId !== event.pointerId) return
    workbenchDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const liveAssistantText = isStreaming ? (streamingText.trim() || 'AI 正在分析中...') : ''
  const activeCommandText = (isStreaming ? streamingText : commandInput).trim()
  const queryTerminalSessionId = useMemo(() => createQueryTerminalSessionId(selectedCommand), [selectedCommand])
  const selectedCommandRef = useRef(selectedCommand)
  const queryTerminalSessionIdRef = useRef(queryTerminalSessionId)
  const executionTargetEpochRef = useRef(0)
  const timelineEntries = useMemo<TimelineEntry[]>(
    () =>
      chatHistory.map((item, idx) => ({
        key: `chat-${idx}-${item.at}`,
        at: item.at,
        role: item.role,
        content: item.content,
        action: item.action
      })),
    [chatHistory]
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIRM_EXECUTE_STORAGE_KEY, confirmBeforeExecute ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [confirmBeforeExecute])

  useEffect(() => {
    if (
      selectedCommandRef.current !== selectedCommand ||
      queryTerminalSessionIdRef.current !== queryTerminalSessionId
    ) {
      executionTargetEpochRef.current += 1
    }
    selectedCommandRef.current = selectedCommand
    queryTerminalSessionIdRef.current = queryTerminalSessionId
  }, [queryTerminalSessionId, selectedCommand])

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_EXECUTE_STORAGE_KEY, autoExecuteLowRisk ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [autoExecuteLowRisk])

  useEffect(() => {
    if (!showHistoryPopover) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowHistoryPopover(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [showHistoryPopover])

  useEffect(() => {
    if (!autoFollowTimeline) return
    const el = timelineRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [timelineEntries, liveAssistantText, autoFollowTimeline, showHistoryPopover])

  useTerminalSession({
    hostRef: inlineHostRef,
    commandName: selectedCommand,
    sessionId: queryTerminalSessionId,
    enabled: active,
    autoExecutionEnabled: autoExecuteLowRisk,
    onTerminalReady: (printer) => {
      terminalPrinterRef.current = printer
      if (printer) {
        printedChatCountRef.current = chatHistory.length
      }
    },
    onStatusChange: setTerminalSessionState,
    onAutoExecutionCapabilityChange: (capability) => {
      setAutoExecutionSupported(capability.supported)
      setAutoExecutionCapable(capability.capable)
    },
    onActionError
  })

  useEffect(() => {
    const printer = terminalPrinterRef.current
    if (!printer) return
    const start = printedChatCountRef.current
    if (chatHistory.length <= start) return
    const newEntries = chatHistory.slice(start)
    newEntries.forEach((entry) => {
      const line = formatTimelineTerminalLine(entry.role, entry.content, entry.at)
      if (!line) return
      printer(line)
    })
    printedChatCountRef.current = chatHistory.length
  }, [chatHistory])

  async function handleTranslate(): Promise<boolean> {
    if (!queryInput.trim() || isStreaming) return false
    try {
      const commandName = selectedCommandRef.current
      const sessionId = queryTerminalSessionIdRef.current
      const selectionEpoch = executionTargetEpochRef.current
      const terminalSnapshot = commandName
        ? await window.api.terminalGetBuffer(commandName, { sessionId })
        : undefined
      if (autoExecuteLowRiskRef.current && commandName && !terminalSnapshot?.autoExecutionCapable) {
        onTrackAction?.('query.ai.translate', 'click', 'fail')
        onActionError('自动执行的安全会话正在准备，请稍后再试。')
        return false
      }
      onTrackAction?.('query.ai.translate', 'click', 'success')
      const requestTarget = {
        commandName,
        sessionId,
        instanceId: terminalSnapshot?.instanceId,
        autoExecutionCapable: terminalSnapshot?.autoExecutionCapable,
        selectionEpoch
      }
      const result = await translate({
        sessionLogs: buildTerminalContextLines(terminalSnapshot?.text || ''),
        terminalSessionId: sessionId,
        terminalInstanceId: terminalSnapshot?.instanceId
      })
      if (result?.action.type === 'command') {
        await handleAutoExecute(result.action, requestTarget, result.autoExecutionToken)
      }
      return true
    } catch (error) {
      onTrackAction?.('query.ai.translate', 'click', 'fail')
      onActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async function handleRunDraftCommand(
    commandOverride?: string,
    source = QUERY_TERMINAL_SOURCE,
    expectedTarget?: QueryExecutionTarget,
    shouldContinue?: () => boolean,
    autoExecutionToken?: string
  ): Promise<boolean> {
    const commandToRun = (commandOverride ?? activeCommandText).trim()
    const currentCommandName = expectedTarget?.commandName || selectedCommandRef.current
    const currentSessionId = expectedTarget?.sessionId || queryTerminalSessionIdRef.current
    if ((expectedTarget && !isCurrentExecutionTarget(expectedTarget)) || (shouldContinue && !shouldContinue())) return false
    if (!currentCommandName) {
      onActionError('请先选择会话命令。')
      return false
    }
    if (!commandToRun) {
      onActionError('请先生成或填写待执行命令。')
      return false
    }
    try {
      const featureKey = source === QUERY_AUTO_TERMINAL_SOURCE ? 'query.command.auto_execute' : 'query.command.execute'
      if (source !== QUERY_AUTO_TERMINAL_SOURCE) {
        await window.api.terminalStart(currentCommandName, { source, sessionId: currentSessionId })
      } else if (!expectedTarget?.instanceId) {
        return false
      }
      if ((expectedTarget && !isCurrentExecutionTarget(expectedTarget)) || (shouldContinue && !shouldContinue())) return false
      const result = await window.api.terminalInput(currentCommandName, `${commandToRun}\n`, {
        source,
        sessionId: currentSessionId,
        expectedInstanceId: source === QUERY_AUTO_TERMINAL_SOURCE ? expectedTarget?.instanceId : undefined,
        autoExecutionToken: source === QUERY_AUTO_TERMINAL_SOURCE ? autoExecutionToken : undefined
      })
      if (!result.ok) throw new Error(result.message || '命令未通过执行检查。')
      onTrackAction?.(featureKey, 'run', 'success')
      setTerminalSessionState('running')
      return true
    } catch (error) {
      const featureKey = source === QUERY_AUTO_TERMINAL_SOURCE ? 'query.command.auto_execute' : 'query.command.execute'
      onTrackAction?.(featureKey, 'run', 'fail')
      onActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async function handleAutoExecute(
    action: QueryAiAction,
    requestTarget: QueryExecutionTarget,
    autoExecutionToken?: string
  ): Promise<void> {
    const command = (action.command || '').trim()
    if (!autoExecuteLowRiskRef.current || !command) return
    if (action.riskLevel !== 'safe') {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', `已跳过 · ${action.riskReason || 'AI 未将该命令判定为低风险。'}`, 'warning')
      )
      onTrackAction?.('query.command.auto_execute', `skip_agent_${action.riskLevel}`, 'unknown')
      return
    }
    if (!requestTarget.commandName) {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', '已跳过 · 未选择会话，命令已保留并等待手动执行。', 'warning')
      )
      onTrackAction?.('query.command.auto_execute', 'skip_no_session', 'unknown')
      return
    }
    if (!requestTarget.instanceId) {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', '已跳过 · 终端会话尚未就绪，命令已保留并等待手动执行。', 'warning')
      )
      onTrackAction?.('query.command.auto_execute', 'skip_session_not_ready', 'unknown')
      return
    }
    if (!requestTarget.autoExecutionCapable) {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', '已跳过 · 当前会话未启用可信的自动执行，命令已保留并等待手动确认。', 'warning')
      )
      onTrackAction?.('query.command.auto_execute', 'skip_session_unsupported', 'unknown')
      return
    }
    if (!isCurrentExecutionTarget(requestTarget)) {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', '已跳过 · AI 生成期间会话已切换，命令已保留并等待手动执行。', 'warning')
      )
      onTrackAction?.('query.command.auto_execute', 'skip_session_changed', 'unknown')
      return
    }
    try {
      const assessment = await window.api.queryAssessAutoExecution(command, autoExecutionToken)
      if (!autoExecuteLowRiskRef.current) return
      if (!isCurrentExecutionTarget(requestTarget)) {
        terminalPrinterRef.current?.(
          formatTerminalEventLine('AUTO', '已跳过 · AI 生成期间会话已切换，命令已保留并等待手动执行。', 'warning')
        )
        onTrackAction?.('query.command.auto_execute', 'skip_session_changed', 'unknown')
        return
      }
      if (!assessment.canAutoExecute) {
        terminalPrinterRef.current?.(formatTerminalEventLine('AUTO', `已跳过 · ${assessment.message}`, 'warning'))
        onTrackAction?.('query.command.auto_execute', `skip_${assessment.riskLevel}`, 'unknown')
        return
      }
      const executed = await handleRunDraftCommand(
        command,
        QUERY_AUTO_TERMINAL_SOURCE,
        requestTarget,
        () => autoExecuteLowRiskRef.current && isCurrentExecutionTarget(requestTarget),
        autoExecutionToken
      )
      if (executed) {
        terminalPrinterRef.current?.(
          formatTerminalEventLine('AUTO', `已执行 · Agent 判定低风险，本地危险规则未命中\n${command}`, 'success')
        )
      }
    } catch {
      terminalPrinterRef.current?.(
        formatTerminalEventLine('AUTO', '已取消 · 安全检查暂不可用，命令未执行。', 'danger')
      )
      onTrackAction?.('query.command.auto_execute', 'risk_check', 'fail')
    }
  }

  async function handleConfirmAiExecution(commandText: string): Promise<void> {
    const command = commandText.trim()
    if (!command) return
    setPendingAiCommand('')
    setCommandInput(command)
    await handleRunDraftCommand(command)
  }

  async function handleAiBubbleClick(commandText: string): Promise<void> {
    const command = commandText.trim()
    if (!command) return
    if (confirmBeforeExecute) {
      setPendingAiCommand((prev) => (prev === command ? '' : command))
      return
    }
    await handleConfirmAiExecution(command)
  }

  function toggleTerminalFullscreen(): void {
    setShowTerminalFullscreen((prev) => {
      const next = !prev
      onTrackAction?.('query.terminal.fullscreen', next ? 'open' : 'close', 'success')
      return next
    })
  }

  function toggleConfirmBeforeExecute(): void {
    setConfirmBeforeExecute((prev) => {
      const next = !prev
      onTrackAction?.('query.command.confirm_toggle', next ? 'enable' : 'disable', 'success')
      return next
    })
  }

  function toggleAutoExecuteLowRisk(): void {
    if (!autoExecuteLowRiskRef.current && autoExecutionSupported === false) {
      onActionError('当前会话不支持可信的自动执行。')
      return
    }
    const next = !autoExecuteLowRiskRef.current
    autoExecuteLowRiskRef.current = next
    setAutoExecuteLowRisk(next)
    onTrackAction?.('query.command.auto_execute_toggle', next ? 'enable' : 'disable', 'success')
  }

  function isCurrentExecutionTarget(target: QueryExecutionTarget): boolean {
    return (
      selectedCommandRef.current === target.commandName &&
      queryTerminalSessionIdRef.current === target.sessionId &&
      executionTargetEpochRef.current === target.selectionEpoch
    )
  }

  function renderTimelineContent() {
    return (
      <>
        {timelineEntries.length === 0 && !liveAssistantText ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>暂无会话记录。</div>
        ) : null}
        {timelineEntries.map((entry) => (
          <div
            key={entry.key}
            style={{
              justifySelf: entry.role === 'user' ? 'end' : 'start',
              width: entry.role === 'user' ? 'fit-content' : 'auto',
              maxWidth: '92%',
              padding: '6px 8px',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: entry.role === 'user' ? 'rgba(74, 222, 128, 0.1)' : 'var(--panel)',
              cursor: entry.action?.type === 'command' ? 'pointer' : 'default',
              textAlign: entry.role === 'user' ? 'right' : 'left'
            }}
            data-testid={entry.role === 'assistant' ? 'log-analysis-chat-bubble-ai' : 'log-analysis-chat-bubble-user'}
            onClick={() => {
              if (entry.action?.type !== 'command') return
              void handleAiBubbleClick(entry.action.command || '')
            }}
          >
            <div style={{ marginBottom: 2, fontSize: 10, color: 'var(--muted)' }}>{entry.role === 'user' ? '我' : 'AI'}</div>
            {entry.content}
          </div>
        ))}
        {liveAssistantText ? (
          <div style={{ width: '92%', padding: '6px 8px', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--panel)' }}>
            <div style={{ marginBottom: 2, fontSize: 10, color: 'var(--muted)' }}>AI（生成中）</div>
            {liveAssistantText}
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div data-testid="log-analysis-page" className="query-workspace">
      <div
        data-testid="log-analysis-terminal"
        className="query-terminal-panel"
        style={
          showTerminalFullscreen
            ? {
                position: 'fixed',
                inset: '4vh 4vw',
                zIndex: 90,
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-card)'
              }
            : undefined
        }
      >
        <div className="query-terminal-toolbar">
          <div style={{ minWidth: 0 }}>
            <div className="query-terminal-title">会话终端</div>
            <div className="query-terminal-subtitle">连接终端，查看输出并执行 AI 生成的命令</div>
          </div>
          <div className="query-terminal-controls">
            <div className="query-session-state" aria-label={terminalSessionState === 'running' ? '会话运行中' : '会话空闲'}>
              <span className={terminalSessionState === 'running' ? 'query-status-dot is-running' : 'query-status-dot'} />
              {terminalSessionState === 'running' ? '运行中' : '空闲'}
            </div>
            <SessionBadge state={terminalBadgeState} />
            <label data-testid="log-analysis-confirm-execute-toggle" className="query-confirm-toggle">
              <input
                type="checkbox"
                data-testid="log-analysis-confirm-before-execute"
                checked={confirmBeforeExecute}
                onChange={toggleConfirmBeforeExecute}
              />
              二次确认执行
            </label>
            <button
              type="button"
              aria-label="放大终端"
              title={showTerminalFullscreen ? '退出全屏' : '放大终端（可手动敲命令）'}
              style={compactButtonStyle('muted')}
              onClick={toggleTerminalFullscreen}
            >
              {showTerminalFullscreen ? '退出全屏' : '全屏终端'}
            </button>
          </div>
        </div>
        <div className="query-terminal-surface">
          <div ref={inlineHostRef} style={{ height: '100%', width: '100%' }} />
          <div data-testid="log-analysis-floating-console" className="query-floating-shell">
            {showHistoryPopover ? (
              <div
                id="log-analysis-history-popover"
                role="dialog"
                aria-label="历史对话"
                data-testid="log-analysis-history-popover"
                className="ui-popover query-history-popover"
                style={{ transform: `translate(${workbenchOffset.x}px, ${workbenchOffset.y}px)` }}
              >
                <div className="query-history-header">
                  <div style={{ fontSize: 14, fontWeight: 650 }}>历史对话</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      data-testid="log-analysis-clear-chat"
                      className="query-history-clear"
                      onClick={clearChatHistory}
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      aria-label="关闭历史对话"
                      title="关闭"
                      data-testid="log-analysis-close-history"
                      className="query-history-close"
                      onClick={() => setShowHistoryPopover(false)}
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                </div>
                <div
                  ref={timelineRef}
                  data-testid="log-analysis-chat-history"
                  onScroll={(event) => {
                    const el = event.currentTarget
                    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
                    setAutoFollowTimeline(distance < 40)
                  }}
                  style={{ flex: 1, minHeight: 120, overflow: 'auto', display: 'grid', alignContent: 'start', gap: 6, padding: 12 }}
                >
                  {renderTimelineContent()}
                </div>
              </div>
            ) : null}

            <div
              ref={workbenchRef}
              data-testid="log-analysis-workbench"
              className="query-floating-console"
              style={{ transform: `translate(calc(-50% + ${workbenchOffset.x}px), ${workbenchOffset.y}px)` }}
            >
              <div className="query-floating-toolbar">
                <div className="query-mode-switch" role="tablist" aria-label="AI 操作模式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={workspaceMode === 'ask'}
                    data-testid="log-analysis-mode-ask"
                    className={workspaceMode === 'ask' ? 'is-active' : ''}
                    onClick={() => setWorkspaceMode('ask')}
                  >
                    询问 AI
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={workspaceMode === 'command'}
                    data-testid="log-analysis-mode-command"
                    className={workspaceMode === 'command' ? 'is-active' : ''}
                    onClick={() => setWorkspaceMode('command')}
                  >
                    手动执行命令
                  </button>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  data-testid="log-analysis-workbench-drag-area"
                  className="query-workbench-drag-area"
                  aria-label="移动 AI 工作台"
                  onPointerDown={startWorkbenchDrag}
                  onPointerMove={dragWorkbench}
                  onPointerUp={stopWorkbenchDrag}
                  onPointerCancel={stopWorkbenchDrag}
                  onKeyDown={(event) => {
                    const step = 20
                    if (event.key === 'ArrowLeft') moveWorkbench(workbenchOffsetRef.current.x - step, workbenchOffsetRef.current.y)
                    else if (event.key === 'ArrowRight') moveWorkbench(workbenchOffsetRef.current.x + step, workbenchOffsetRef.current.y)
                    else if (event.key === 'ArrowUp') moveWorkbench(workbenchOffsetRef.current.x, workbenchOffsetRef.current.y - step)
                    else if (event.key === 'ArrowDown') moveWorkbench(workbenchOffsetRef.current.x, workbenchOffsetRef.current.y + step)
                    else return
                    event.preventDefault()
                  }}
                />
                <div className="query-floating-actions">
                  <label data-testid="log-analysis-session-picker" className="query-floating-session">
                    <span>会话</span>
                    <select
                      data-testid="log-analysis-command-select"
                      aria-label="选择会话命令"
                      value={selectedCommand}
                      onChange={(event) => selectCommand(event.target.value)}
                      style={selectStyle}
                    >
                      <option value="">未选择命令会话</option>
                      {commands.map((cmd) => (
                        <option key={cmd.name} value={cmd.name}>
                          {cmd.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="query-session-state">
                    <span className={terminalSessionState === 'running' ? 'query-status-dot is-running' : 'query-status-dot'} />
                    {terminalSessionState === 'running' ? '运行中' : '空闲'}
                  </div>
                  <button
                    type="button"
                    aria-label="历史对话"
                    title="历史对话"
                    data-testid="log-analysis-open-history"
                    aria-expanded={showHistoryPopover}
                    aria-controls="log-analysis-history-popover"
                    onClick={() => setShowHistoryPopover((prev) => !prev)}
                    style={compactButtonStyle('muted')}
                  >
                    历史对话
                  </button>
                  <label
                    data-testid="log-analysis-auto-execute-toggle"
                    className="query-auto-execute-toggle"
                    title="AI 回复完成后，仅在会话状态可验证时自动执行判定为低风险的命令；其余命令会保留，等待你确认。"
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="自动执行低风险命令"
                      data-testid="log-analysis-auto-execute-low-risk"
                      checked={autoExecuteLowRisk}
                      disabled={autoExecutionSupported === false}
                      onChange={toggleAutoExecuteLowRisk}
                    />
                    <span className="query-auto-execute-track" aria-hidden="true" />
                    <span className="query-auto-execute-copy">
                      <strong>自动执行</strong>
                      <small>
                        {autoExecutionSupported === false
                          ? '当前会话不支持'
                          : autoExecuteLowRisk && !autoExecutionCapable
                            ? '正在准备安全会话'
                            : '仅限低风险命令'}
                      </small>
                    </span>
                  </label>
                </div>
              </div>

              {workspaceMode === 'ask' ? (
                <div className="query-floating-editor">
                  <textarea
                    data-testid="log-analysis-input"
                    style={{
                      ...inputStyle,
                      marginTop: 0,
                      minHeight: 104,
                      resize: 'none',
                      lineHeight: 1.45,
                      background: 'var(--panel)',
                      borderColor: 'var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px 15px 46px',
                      fontSize: 13
                    }}
                    value={queryInput}
                    onChange={(event) => setQueryInput(event.target.value)}
                    onCompositionStart={() => {
                      composingRef.current = true
                    }}
                    onCompositionEnd={() => {
                      composingRef.current = false
                    }}
                    placeholder="向 AI 提问，或输入需求..."
                    onKeyDown={async (event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !isStreaming) {
                        const native = event.nativeEvent as KeyboardEvent
                        const isImeComposing =
                          composingRef.current ||
                          native.isComposing ||
                          (native as unknown as { keyCode?: number }).keyCode === 229
                        if (isImeComposing) return
                        event.preventDefault()
                        const sent = await handleTranslate()
                        if (sent) setQueryInput('')
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label="发送"
                    data-testid="log-analysis-translate"
                    onClick={handleTranslate}
                    disabled={isStreaming || !queryInput.trim()}
                    className="query-floating-primary"
                  >
                    {isStreaming ? '分析中...' : '询问 AI'}
                  </button>
                  <div className="query-floating-hint">Enter 发送 · Shift+Enter 换行</div>
                </div>
              ) : (
                <div className="query-floating-editor">
                  <textarea
                    data-testid="log-analysis-command-input"
                    value={commandInput}
                    onChange={(event) => setCommandInput(event.target.value)}
                    placeholder="例如：grep -i error app.log | tail -n 50"
                    style={{
                      minHeight: 104,
                      width: '100%',
                      resize: 'none',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      padding: '14px 15px 46px',
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                      lineHeight: 1.5
                    }}
                  />
                  <button
                    type="button"
                    data-testid="log-analysis-execute"
                    disabled={!selectedCommand || !activeCommandText.trim()}
                    className="query-floating-primary"
                    onClick={() => void handleRunDraftCommand()}
                  >
                    执行命令
                  </button>
                  <div className="query-floating-hint">{activeCommandText.length}/2000 · 执行前可继续编辑</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="log-analysis-fullscreen-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          zIndex: 80,
          opacity: showTerminalFullscreen ? 1 : 0,
          pointerEvents: showTerminalFullscreen ? 'auto' : 'none',
          transition: 'opacity 160ms ease',
          willChange: 'opacity'
        }}
        onClick={() => {
          if (!showTerminalFullscreen) return
          toggleTerminalFullscreen()
        }}
      />

      {pendingAiCommand ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 105
          }}
          onClick={() => setPendingAiCommand('')}
          data-testid="log-analysis-ai-execute-dialog-mask"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="log-analysis-ai-execute-dialog"
            style={{
              width: 'min(620px, 90vw)',
              borderRadius: 14,
              border: '1px solid var(--border-subtle)',
              background: 'var(--panel)',
              boxShadow: 'var(--shadow-card)',
              padding: 12
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>确认执行 AI 命令</div>
            <div
              style={{
                maxHeight: 180,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--panel-soft)',
                padding: '8px 10px'
              }}
            >
              {pendingAiCommand}
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                data-testid="log-analysis-ai-cancel-execute"
                style={buttonStyle('muted')}
                onClick={() => setPendingAiCommand('')}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="log-analysis-ai-confirm-execute"
                style={buttonStyle('primary')}
                onClick={() => void handleConfirmAiExecution(pendingAiCommand)}
              >
                确定执行
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  )
}

function useTerminalSession(args: {
  hostRef: React.RefObject<HTMLDivElement | null>
  commandName: string
  sessionId: string
  enabled: boolean
  autoExecutionEnabled: boolean
  onTerminalReady?: (printer: ((content: string) => void) | null) => void
  onStatusChange: (state: 'running' | 'idle') => void
  onAutoExecutionCapabilityChange: (capability: AutoExecutionCapability) => void
  onActionError: (message: string) => void
}) {
  const {
    hostRef,
    commandName,
    sessionId,
    enabled,
    autoExecutionEnabled,
    onTerminalReady,
    onStatusChange,
    onAutoExecutionCapabilityChange,
    onActionError
  } = args
  const terminalReadyRef = useRef(onTerminalReady)
  const statusChangeRef = useRef(onStatusChange)
  const actionErrorRef = useRef(onActionError)
  const autoExecutionCapabilityRef = useRef(onAutoExecutionCapabilityChange)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: -1, rows: -1 })
  const activeCommandRef = useRef('')
  const activeSessionIdRef = useRef('')
  const offDataRef = useRef<(() => void) | null>(null)
  const offStatusRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    terminalReadyRef.current = onTerminalReady
  }, [onTerminalReady])

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    autoExecutionCapabilityRef.current = onAutoExecutionCapabilityChange
  }, [onAutoExecutionCapabilityChange])

  useEffect(() => {
    const host = hostRef.current
    if (!enabled || !host) return
    if (terminalRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      convertEol: false,
      scrollback: 12000,
      theme: {
        background: '#090d14',
        foreground: '#d8dee9',
        cursor: '#7aa2f7'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    terminalReadyRef.current?.((content) => {
      terminalRef.current?.write(content)
    })

    const onResize = () => {
      const t = terminalRef.current
      const addon = fitAddonRef.current
      const activeCommand = activeCommandRef.current
      if (!t || !addon) return
      const dims = addon.proposeDimensions()
      if (!dims) return
      const nextCols = Math.max(20, Math.floor(dims.cols))
      const nextRows = Math.max(8, Math.floor(dims.rows))
      const last = lastSizeRef.current
      if (nextCols === last.cols && nextRows === last.rows) return
      lastSizeRef.current = { cols: nextCols, rows: nextRows }
      t.resize(nextCols, nextRows)
      if (activeCommand) {
        const activeSessionId = activeSessionIdRef.current.trim()
        void window.api.terminalResize(activeCommand, nextCols, nextRows, {
          sessionId: activeSessionId || undefined
        })
      }
    }
    const scheduleResize = () => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null
        onResize()
      })
    }
    scheduleResize()
    const resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(host)
    resizeObserverRef.current = resizeObserver
    window.addEventListener('resize', scheduleResize)

    const inputDisposable = terminal.onData((data) => {
      const activeCommand = activeCommandRef.current
      if (!activeCommand) return
      const activeSessionId = activeSessionIdRef.current.trim()
      void window.api.terminalInput(activeCommand, data, {
        source: QUERY_TERMINAL_SOURCE,
        sessionId: activeSessionId || undefined
      })
    })

    return () => {
      inputDisposable.dispose()
      offDataRef.current?.()
      offStatusRef.current?.()
      offDataRef.current = null
      offStatusRef.current = null
      activeCommandRef.current = ''
      activeSessionIdRef.current = ''
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      window.removeEventListener('resize', scheduleResize)
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      lastSizeRef.current = { cols: -1, rows: -1 }
      terminalReadyRef.current?.(null)
    }
  }, [enabled, hostRef])

  useEffect(() => {
    if (!enabled) return
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return

    offDataRef.current?.()
    offStatusRef.current?.()
    offDataRef.current = null
    offStatusRef.current = null
    activeCommandRef.current = commandName || ''
    activeSessionIdRef.current = sessionId || ''
    terminal.clear()
    terminal.reset()
    lastSizeRef.current = { cols: -1, rows: -1 }
    autoExecutionCapabilityRef.current({ supported: null, capable: false })

    if (!commandName) {
      statusChangeRef.current('idle')
      terminal.writeln('请选择命令后连接会话。')
      return
    }

    const resizeNow = () => {
      const dims = fitAddon.proposeDimensions()
      if (!dims) return
      const nextCols = Math.max(20, Math.floor(dims.cols))
      const nextRows = Math.max(8, Math.floor(dims.rows))
      const last = lastSizeRef.current
      if (nextCols === last.cols && nextRows === last.rows) return
      lastSizeRef.current = { cols: nextCols, rows: nextRows }
      terminal.resize(nextCols, nextRows)
      void window.api.terminalResize(commandName, nextCols, nextRows, { sessionId: sessionId || undefined })
    }

    const offData = window.api.onTerminalData((payload) => {
      if (payload.commandName !== commandName) return
      if ((payload.sessionId || '') !== (sessionId || '')) return
      terminal.write(payload.data)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.commandName !== commandName) return
      if ((payload.sessionId || '') !== (sessionId || '')) return
      statusChangeRef.current(payload.state)
      if (payload.state === 'idle' && typeof payload.exitCode === 'number') {
        terminal.write(`\r\n\r\n[会话已结束，状态码 ${payload.exitCode}]\r\n`)
      }
    })
    offDataRef.current = offData || null
    offStatusRef.current = offStatus || null

    let capabilityPollTimer: number | undefined
    const stopCapabilityPolling = () => {
      if (capabilityPollTimer === undefined) return
      window.clearInterval(capabilityPollTimer)
      capabilityPollTimer = undefined
    }
    const connect = async () => {
      let result = await window.api.terminalStart(commandName, {
        source: QUERY_TERMINAL_SOURCE,
        sessionId: sessionId || undefined,
        autoExecutionEnabled
      })
      if (
        autoExecutionEnabled &&
        result.autoExecutionSupported &&
        !result.autoExecutionPrepared &&
        !result.autoExecutionCapable
      ) {
        terminal.writeln('\r\n[shell-manage] 正在重建受控会话以启用自动执行。\r\n')
        await window.api.terminalStop(commandName, { sessionId: sessionId || undefined })
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const current = await window.api.terminalGetBuffer(commandName, { sessionId: sessionId || undefined })
          if (!current.instanceId) break
          await new Promise((resolve) => window.setTimeout(resolve, 100))
        }
        const stopped = await window.api.terminalGetBuffer(commandName, { sessionId: sessionId || undefined })
        if (stopped.instanceId) throw new Error('终端会话未能及时停止，自动执行未启用。')
        result = await window.api.terminalStart(commandName, {
          source: QUERY_TERMINAL_SOURCE,
          sessionId: sessionId || undefined,
          autoExecutionEnabled: true
        })
      }
      return result
    }

    void connect()
      .then((result) => {
        if (activeCommandRef.current !== commandName) return
        if (result.buffer) terminal.write(result.buffer)
        autoExecutionCapabilityRef.current({
          supported: Boolean(result.autoExecutionSupported),
          capable: Boolean(result.autoExecutionCapable)
        })
        if (autoExecutionEnabled && result.autoExecutionSupported && !result.autoExecutionCapable) {
          capabilityPollTimer = window.setInterval(() => {
            void window.api.terminalGetBuffer(commandName, { sessionId: sessionId || undefined }).then((current) => {
              if (activeCommandRef.current !== commandName) return
              autoExecutionCapabilityRef.current({
                supported: Boolean(current.autoExecutionSupported),
                capable: Boolean(current.autoExecutionCapable)
              })
              if (!current.instanceId) stopCapabilityPolling()
            })
          }, 500)
        }
        statusChangeRef.current(result.state || 'running')
        resizeNow()
      })
      .catch((error) => {
        if (activeCommandRef.current !== commandName) return
        autoExecutionCapabilityRef.current({ supported: false, capable: false })
        actionErrorRef.current(error instanceof Error ? error.message : String(error))
      })

    return () => {
      stopCapabilityPolling()
      offDataRef.current?.()
      offStatusRef.current?.()
      offDataRef.current = null
      offStatusRef.current = null
    }
  }, [autoExecutionEnabled, commandName, enabled, sessionId])
}

function loadConfirmBeforeExecute(): boolean {
  try {
    const raw = window.localStorage.getItem(CONFIRM_EXECUTE_STORAGE_KEY)
    if (raw === '0' || raw === 'false') return false
  } catch {
    // ignore storage errors
  }
  return true
}

function loadAutoExecuteLowRisk(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTO_EXECUTE_STORAGE_KEY)
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

function SessionBadge(props: { state: 'running' | 'idle_with_cache' | 'idle_empty' }) {
  const { state } = props
  const meta =
    state === 'running'
      ? { label: '运行中', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.45)', color: '#22c55e' }
      : state === 'idle_with_cache'
        ? { label: '已退出·有缓存', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.45)', color: '#f59e0b' }
        : { label: '无缓存', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.45)', color: '#94a3b8' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: 1.4,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.color
      }}
    >
      {meta.label}
    </span>
  )
}

function formatTimelineTerminalLine(role: 'user' | 'assistant', content: string, at: number): string {
  const text = content.trim()
  if (!text) return ''
  return formatTerminalTuiEntry({
    at,
    label: role === 'user' ? 'YOU' : 'AI',
    tone: role,
    content: text
  })
}

function createQueryTerminalSessionId(commandName: string): string {
  const normalized = commandName.trim()
  if (!normalized) return ''
  return `${QUERY_TERMINAL_SESSION_PREFIX}:${normalized}`
}

function formatTerminalEventLine(label: string, content: string, tone: TerminalTuiTone): string {
  return formatTerminalTuiEntry({ at: Date.now(), label, tone, content })
}
