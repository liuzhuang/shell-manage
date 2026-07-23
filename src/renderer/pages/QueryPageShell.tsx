import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CommandConfig, QueryAgentPhase, QueryAiAction, QueryAiHistoryItem, QueryAiResponse } from '../../shared/types'
import { TerminalIcon } from '../components/icons/TerminalIcon'
import { XIcon } from '../components/icons/XIcon'
import type { QueryAgentExecutionResult, QueryAgentReviewRequest } from '../lib/query-agent-runner'
import { formatTerminalTuiEntry, type TerminalTuiTone } from '../lib/terminalTui'
import { buttonStyle, inputStyle } from '../lib/uiStyles'
import { buildTerminalContextLines } from '../lib/terminalContext'

type TimelineEntry = QueryAiHistoryItem & { key: string; at: number }
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
type DraftCommandExecutionResult =
  | { ok: true }
  | { ok: false; status: 'waiting_for_review' | 'failed' | 'cancelled'; message: string }
type PendingAgentReview = {
  request: QueryAgentReviewRequest
  target: QueryExecutionTarget
  executing: boolean
  resolve: (result: QueryAgentExecutionResult) => void
}

const CONFIRM_EXECUTE_STORAGE_KEY = 'query.ai.confirmExecute.v1'
const AUTO_EXECUTE_STORAGE_KEY = 'query.ai.autoExecuteLowRisk.v2'
const WORKBENCH_GEOMETRY_STORAGE_KEY = 'query.ai.workbenchGeometry.v3'
const QUERY_TERMINAL_SOURCE = 'query'
const QUERY_AUTO_TERMINAL_SOURCE = 'query-auto'
const QUERY_TERMINAL_SESSION_PREFIX = 'query'
const WORKBENCH_RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const
type WorkbenchResizeDirection = (typeof WORKBENCH_RESIZE_DIRECTIONS)[number]
type WorkbenchGeometry = { x: number; y: number; width?: number; height?: number }
type RectSnapshot = { top: number; right: number; bottom: number; left: number; width: number; height: number }
type WorkbenchResizeState = {
  pointerId: number
  direction: WorkbenchResizeDirection
  x: number
  y: number
  rect: RectSnapshot
  bounds: RectSnapshot
  geometry: WorkbenchGeometry
}
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
  padding: '0 10px 0 30px',
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
  agentPhase: QueryAgentPhase | null
  commands: CommandConfig[]
  selectedCommand: string
  terminalBadgeState: 'running' | 'idle_with_cache' | 'idle_empty'
  setQueryInput: (text: string) => void
  clearChatHistory: () => void
  cancel: () => Promise<void>
  translate: (context: {
    sessionLogs: string[]
    terminalSessionId: string
    terminalInstanceId?: string
    executeCommand: (response: QueryAiResponse) => Promise<QueryAgentExecutionResult>
    reviewCommand: (request: QueryAgentReviewRequest) => Promise<QueryAgentExecutionResult>
    shouldContinue: () => boolean
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
    agentPhase,
    commands,
    selectedCommand,
    terminalBadgeState,
    setQueryInput,
    clearChatHistory,
    cancel,
    translate,
    selectCommand,
    onActionError,
    active,
    onTrackAction
  } = props

  const [showHistoryPopover, setShowHistoryPopover] = useState(false)
  const [showMorePopover, setShowMorePopover] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<'ask' | 'command'>('ask')
  const [autoFollowTimeline, setAutoFollowTimeline] = useState(true)
  const [showTerminalFullscreen, setShowTerminalFullscreen] = useState(false)
  const [terminalSessionState, setTerminalSessionState] = useState<'connecting' | 'running' | 'idle'>('idle')
  const [pendingAiCommand, setPendingAiCommand] = useState('')
  const [confirmBeforeExecute, setConfirmBeforeExecute] = useState<boolean>(() => loadConfirmBeforeExecute())
  const [autoExecuteLowRisk, setAutoExecuteLowRisk] = useState<boolean>(() => loadAutoExecuteLowRisk())
  const [autoExecutionSupported, setAutoExecutionSupported] = useState<boolean | null>(null)
  const [autoExecutionCapable, setAutoExecutionCapable] = useState(false)
  const [workbenchGeometry, setWorkbenchGeometry] = useState<WorkbenchGeometry>(() => loadWorkbenchGeometry())
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const inlineHostRef = useRef<HTMLDivElement | null>(null)
  const workbenchRef = useRef<HTMLDivElement | null>(null)
  const morePopoverRef = useRef<HTMLDivElement | null>(null)
  const workbenchGeometryRef = useRef(workbenchGeometry)
  const workbenchDragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const workbenchResizeRef = useRef<WorkbenchResizeState | null>(null)
  const composingRef = useRef(false)
  const terminalPrinterRef = useRef<((content: string) => void) | null>(null)
  const printedChatCountRef = useRef(0)
  const printedExecutionSignaturesRef = useRef<string[]>([])
  const autoExecuteLowRiskRef = useRef(autoExecuteLowRisk)
  const pendingAgentReviewRef = useRef<PendingAgentReview | null>(null)

  function updateWorkbenchGeometry(next: WorkbenchGeometry, persist = false) {
    workbenchGeometryRef.current = next
    setWorkbenchGeometry(next)
    if (persist) saveWorkbenchGeometry(next)
  }

  function resetWorkbenchGeometry() {
    try {
      window.localStorage.removeItem(WORKBENCH_GEOMETRY_STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
    updateWorkbenchGeometry({ x: 0, y: 0 })
    setShowMorePopover(false)
  }

  function moveWorkbench(x: number, y: number, persist = false) {
    const panel = workbenchRef.current
    const bounds = panel?.parentElement?.getBoundingClientRect()
    if (!panel || !bounds) return
    const current = workbenchGeometryRef.current
    const rect = panel.getBoundingClientRect()
    const baseLeft = rect.left - current.x
    const baseTop = rect.top - current.y
    const next = {
      ...current,
      x: Math.min(bounds.right - baseLeft - rect.width, Math.max(bounds.left - baseLeft, x)),
      y: Math.min(bounds.bottom - baseTop - rect.height, Math.max(bounds.top - baseTop, y))
    }
    updateWorkbenchGeometry(next, persist)
  }

  function startWorkbenchDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = workbenchGeometryRef.current
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
    saveWorkbenchGeometry(workbenchGeometryRef.current)
  }

  function startWorkbenchResize(event: ReactPointerEvent<HTMLElement>, direction: WorkbenchResizeDirection) {
    const panel = workbenchRef.current
    const bounds = panel?.parentElement?.getBoundingClientRect()
    if (!panel || !bounds) return
    event.preventDefault()
    event.stopPropagation()
    workbenchResizeRef.current = {
      pointerId: event.pointerId,
      direction,
      x: event.clientX,
      y: event.clientY,
      rect: snapshotRect(panel.getBoundingClientRect()),
      bounds: snapshotRect(bounds),
      geometry: workbenchGeometryRef.current
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resizeWorkbench(event: ReactPointerEvent<HTMLElement>) {
    const resize = workbenchResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    updateWorkbenchGeometry(calculateWorkbenchResize(resize, event.clientX, event.clientY))
  }

  function stopWorkbenchResize(event: ReactPointerEvent<HTMLElement>) {
    if (workbenchResizeRef.current?.pointerId !== event.pointerId) return
    workbenchResizeRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    saveWorkbenchGeometry(workbenchGeometryRef.current)
  }

  function resizeWorkbenchWithKeyboard(event: ReactKeyboardEvent<HTMLElement>, direction: WorkbenchResizeDirection) {
    const panel = workbenchRef.current
    const bounds = panel?.parentElement?.getBoundingClientRect()
    if (!panel || !bounds) return
    const horizontal = event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0
    const vertical = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0
    if ((!horizontal || !/[ew]/u.test(direction)) && (!vertical || !/[ns]/u.test(direction))) return
    event.preventDefault()
    const resize: WorkbenchResizeState = {
      pointerId: -1,
      direction,
      x: 0,
      y: 0,
      rect: snapshotRect(panel.getBoundingClientRect()),
      bounds: snapshotRect(bounds),
      geometry: workbenchGeometryRef.current
    }
    updateWorkbenchGeometry(calculateWorkbenchResize(resize, horizontal, vertical), true)
  }

  const liveAssistantText = isStreaming ? (streamingText.trim() || formatQueryAgentPhase(agentPhase)) : ''
  const activeCommandText = commandInput.trim()
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
        action: item.action,
        execution: item.execution
      })),
    [chatHistory]
  )

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      const panel = workbenchRef.current
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      updateWorkbenchGeometry({
        ...workbenchGeometryRef.current,
        width: rect.width,
        height: rect.height
      })
      moveWorkbench(workbenchGeometryRef.current.x, workbenchGeometryRef.current.y, true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active])

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
    const pendingReview = pendingAgentReviewRef.current
    if (pendingReview && !isCurrentExecutionTarget(pendingReview.target)) {
      void cancelPendingAgentReview('等待确认期间会话已切换。')
    }
  }, [queryTerminalSessionId, selectedCommand])

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_EXECUTE_STORAGE_KEY, autoExecuteLowRisk ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [autoExecuteLowRisk])

  useEffect(() => {
    if (!showHistoryPopover && !showMorePopover) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowHistoryPopover(false)
      setShowMorePopover(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [showHistoryPopover, showMorePopover])

  useEffect(() => {
    if (!showMorePopover) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!morePopoverRef.current?.contains(event.target as Node)) setShowMorePopover(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [showMorePopover])

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
        printedExecutionSignaturesRef.current = chatHistory.map(executionSignature)
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
    if (chatHistory.length < printedChatCountRef.current) {
      printedChatCountRef.current = 0
      printedExecutionSignaturesRef.current = []
    }
    const newEntries = chatHistory.slice(printedChatCountRef.current)
    newEntries.forEach((entry) => printer(formatTimelineTerminalLines(entry)))
    chatHistory.slice(0, printedChatCountRef.current).forEach((entry, index) => {
      const signature = executionSignature(entry)
      if (signature !== printedExecutionSignaturesRef.current[index]) {
        printer(formatTerminalExecutionLine(entry))
      }
    })
    printedChatCountRef.current = chatHistory.length
    printedExecutionSignaturesRef.current = chatHistory.map(executionSignature)
  }, [chatHistory])

  async function handleTranslate(): Promise<boolean> {
    if (!queryInput.trim() || isStreaming) return false
    const submittedInput = queryInput
    setQueryInput('')
    try {
      const commandName = selectedCommandRef.current
      const sessionId = queryTerminalSessionIdRef.current
      const selectionEpoch = executionTargetEpochRef.current
      const terminalSnapshot = commandName
        ? await window.api.terminalGetBuffer(commandName, { sessionId })
        : undefined
      onTrackAction?.('query.ai.translate', 'click', 'success')
      const requestTarget = {
        commandName,
        sessionId,
        instanceId: terminalSnapshot?.instanceId,
        autoExecutionCapable: terminalSnapshot?.autoExecutionCapable,
        selectionEpoch
      }
      await translate({
        sessionLogs: buildTerminalContextLines(terminalSnapshot?.text || ''),
        terminalSessionId: sessionId,
        terminalInstanceId: terminalSnapshot?.instanceId,
        shouldContinue: () => isCurrentExecutionTarget(requestTarget),
        executeCommand: (response) => handleAutoExecute(response.action, requestTarget, response.autoExecutionToken),
        reviewCommand: (request) => waitForAgentReview(request, requestTarget)
      })
      return true
    } catch (error) {
      setQueryInput(submittedInput)
      onTrackAction?.('query.ai.translate', 'click', 'fail')
      onActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async function handleCancelAgent(): Promise<void> {
    executionTargetEpochRef.current += 1
    const pendingInterrupt = cancelPendingAgentReview('用户取消了等待确认的命令。')
    const commandName = selectedCommandRef.current
    const sessionId = queryTerminalSessionIdRef.current
    const tasks: Array<Promise<unknown>> = [cancel()]
    if (pendingInterrupt) {
      tasks.push(pendingInterrupt)
    } else if (agentPhase === 'executing' && commandName) {
      tasks.push(window.api.terminalInput(commandName, '\u0003', { source: QUERY_TERMINAL_SOURCE, sessionId }))
    }
    await Promise.allSettled(tasks)
    onTrackAction?.('query.ai.cancel', 'click', 'success')
  }

  async function handleRunDraftCommand(
    commandOverride?: string,
    source = QUERY_TERMINAL_SOURCE,
    expectedTarget?: QueryExecutionTarget,
    shouldContinue?: () => boolean,
    autoExecutionToken?: string
  ): Promise<DraftCommandExecutionResult> {
    const pendingReview = source === QUERY_TERMINAL_SOURCE ? pendingAgentReviewRef.current : null
    const executionTarget = pendingReview?.target || expectedTarget
    const commandToRun = (pendingReview?.request.command || commandOverride || activeCommandText).trim()
    const currentCommandName = executionTarget?.commandName || selectedCommandRef.current
    const currentSessionId = executionTarget?.sessionId || queryTerminalSessionIdRef.current
    if ((executionTarget && !isCurrentExecutionTarget(executionTarget)) || (shouldContinue && !shouldContinue())) {
      return { ok: false, status: 'cancelled', message: '执行目标已变化。' }
    }
    if (!currentCommandName) {
      const message = '请先选择会话命令。'
      onActionError(message)
      return { ok: false, status: 'failed', message }
    }
    if (!commandToRun) {
      const message = '请先生成或填写待执行命令。'
      onActionError(message)
      return { ok: false, status: 'failed', message }
    }
    try {
      const featureKey = source === QUERY_AUTO_TERMINAL_SOURCE ? 'query.command.auto_execute' : 'query.command.execute'
      if (source !== QUERY_AUTO_TERMINAL_SOURCE && !pendingReview) {
        await window.api.terminalStart(currentCommandName, { source, sessionId: currentSessionId })
      } else if (!expectedTarget?.instanceId) {
        if (!pendingReview?.target.instanceId) {
          return { ok: false, status: 'cancelled', message: '终端会话尚未就绪。' }
        }
      }
      if ((executionTarget && !isCurrentExecutionTarget(executionTarget)) || (shouldContinue && !shouldContinue())) {
        return { ok: false, status: 'cancelled', message: '执行目标已变化。' }
      }
      if (pendingReview?.executing) {
        return { ok: false, status: 'waiting_for_review', message: '人工确认命令正在执行。' }
      }
      const before = pendingReview
        ? await window.api.terminalGetBuffer(currentCommandName, { sessionId: currentSessionId })
        : undefined
      if (pendingReview) {
        if (
          pendingAgentReviewRef.current !== pendingReview ||
          !isCurrentExecutionTarget(pendingReview.target) ||
          (shouldContinue && !shouldContinue())
        ) {
          return { ok: false, status: 'cancelled', message: '执行目标已变化。' }
        }
        if (pendingReview.executing) {
          return { ok: false, status: 'waiting_for_review', message: '人工确认命令正在执行。' }
        }
        pendingReview.executing = true
      }
      const result = await window.api.terminalInput(currentCommandName, `${commandToRun}\n`, {
        source,
        sessionId: currentSessionId,
        expectedInstanceId: executionTarget?.instanceId,
        autoExecutionToken: source === QUERY_AUTO_TERMINAL_SOURCE ? autoExecutionToken : undefined,
        awaitCompletion: Boolean(pendingReview)
      })
      if (!result.ok) {
        const message = result.message || '命令未通过执行检查。'
        const status = result.executionFailed ? 'failed' : 'waiting_for_review'
        onTrackAction?.(featureKey, 'run', 'fail')
        onActionError(message)
        if (pendingReview) resolvePendingAgentReview({ status, message })
        return { ok: false, status, message }
      }
      onTrackAction?.(featureKey, 'run', 'success')
      setTerminalSessionState('running')
      if (pendingReview && before) {
        const after = await window.api.terminalGetBuffer(currentCommandName, { sessionId: currentSessionId })
        if (after.instanceId !== pendingReview.target.instanceId) {
          resolvePendingAgentReview({ status: 'cancelled', message: '命令执行后终端会话发生变化。' })
          return { ok: false, status: 'cancelled', message: '命令执行后终端会话发生变化。' }
        }
        const output = after.text.startsWith(before.text) ? after.text.slice(before.text.length) : after.text.slice(-12_000)
        const outputLines = buildTerminalContextLines(output)
        resolvePendingAgentReview({
          status: 'completed',
          outputLines: outputLines.length > 0 ? outputLines : ['命令执行完成，未产生可见输出。']
        })
      }
      return { ok: true }
    } catch (error) {
      const featureKey = source === QUERY_AUTO_TERMINAL_SOURCE ? 'query.command.auto_execute' : 'query.command.execute'
      onTrackAction?.(featureKey, 'run', 'fail')
      onActionError(error instanceof Error ? error.message : String(error))
      resolvePendingAgentReview({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      return {
        ok: false,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  function waitForAgentReview(
    request: QueryAgentReviewRequest,
    target: QueryExecutionTarget
  ): Promise<QueryAgentExecutionResult> {
    resolvePendingAgentReview({ status: 'cancelled', message: '已有新的命令等待确认。' })
    setCommandInput(request.command)
    return new Promise((resolve) => {
      pendingAgentReviewRef.current = { request, target, executing: false, resolve }
    })
  }

  function resolvePendingAgentReview(result: QueryAgentExecutionResult): void {
    const pendingReview = pendingAgentReviewRef.current
    if (!pendingReview) return
    pendingAgentReviewRef.current = null
    pendingReview.resolve(result)
  }

  function cancelPendingAgentReview(message: string): Promise<unknown> | undefined {
    const pendingReview = pendingAgentReviewRef.current
    if (!pendingReview) return undefined
    resolvePendingAgentReview({ status: 'cancelled', message })
    if (!pendingReview.executing) return undefined
    return window.api.terminalInput(pendingReview.target.commandName, '\u0003', {
      source: QUERY_TERMINAL_SOURCE,
      sessionId: pendingReview.target.sessionId,
      expectedInstanceId: pendingReview.target.instanceId
    })
  }

  async function handleAutoExecute(
    action: QueryAiAction,
    requestTarget: QueryExecutionTarget,
    autoExecutionToken?: string
  ): Promise<QueryAgentExecutionResult> {
    const command = (action.command || '').trim()
    if (!command) return { status: 'failed', message: 'Agent 未提供可执行命令。' }
    let assessment: Awaited<ReturnType<typeof window.api.queryAssessAutoExecution>>
    try {
      assessment = await window.api.queryAssessAutoExecution(command, autoExecutionToken)
    } catch {
      onTrackAction?.('query.command.auto_execute', 'risk_check', 'fail')
      return { status: 'waiting_for_review', message: '安全检查暂不可用，命令未执行。' }
    }
    if (!autoExecuteLowRiskRef.current) {
      return { status: 'waiting_for_review', message: '自动执行已关闭，命令等待人工确认。' }
    }
    if (action.riskLevel !== 'safe') {
      onTrackAction?.('query.command.auto_execute', `skip_agent_${action.riskLevel}`, 'unknown')
      return { status: 'waiting_for_review', message: action.riskReason || '命令需要人工确认。' }
    }
    if (!requestTarget.commandName) {
      onTrackAction?.('query.command.auto_execute', 'skip_no_session', 'unknown')
      return { status: 'waiting_for_review', message: '未选择可执行命令的会话。' }
    }
    if (!requestTarget.instanceId) {
      onTrackAction?.('query.command.auto_execute', 'skip_session_not_ready', 'unknown')
      return { status: 'waiting_for_review', message: '终端会话尚未就绪。' }
    }
    if (!requestTarget.autoExecutionCapable) {
      onTrackAction?.('query.command.auto_execute', 'skip_session_unsupported', 'unknown')
      return { status: 'waiting_for_review', message: '当前会话不能可信地自动执行。' }
    }
    if (!isCurrentExecutionTarget(requestTarget)) {
      onTrackAction?.('query.command.auto_execute', 'skip_session_changed', 'unknown')
      return { status: 'cancelled', message: 'AI 生成期间会话已切换。' }
    }
    try {
      if (!autoExecuteLowRiskRef.current) {
        return { status: 'cancelled', message: '自动执行已关闭。' }
      }
      if (!isCurrentExecutionTarget(requestTarget)) {
        onTrackAction?.('query.command.auto_execute', 'skip_session_changed', 'unknown')
        return { status: 'cancelled', message: 'AI 生成期间会话已切换。' }
      }
      if (!assessment.canAutoExecute) {
        onTrackAction?.('query.command.auto_execute', `skip_${assessment.riskLevel}`, 'unknown')
        return { status: 'waiting_for_review', message: assessment.message }
      }
      const before = await window.api.terminalGetBuffer(requestTarget.commandName, { sessionId: requestTarget.sessionId })
      const execution = await handleRunDraftCommand(
        command,
        QUERY_AUTO_TERMINAL_SOURCE,
        requestTarget,
        () => autoExecuteLowRiskRef.current && isCurrentExecutionTarget(requestTarget),
        autoExecutionToken
      )
      if (execution.ok) {
        const after = await window.api.terminalGetBuffer(requestTarget.commandName, { sessionId: requestTarget.sessionId })
        if (!isCurrentExecutionTarget(requestTarget) || after.instanceId !== requestTarget.instanceId) {
          return { status: 'cancelled', message: '命令执行后终端会话发生变化。' }
        }
        requestTarget.autoExecutionCapable = after.autoExecutionCapable
        const output = after.text.startsWith(before.text) ? after.text.slice(before.text.length) : after.text.slice(-12_000)
        const outputLines = buildTerminalContextLines(output)
        return {
          status: 'completed',
          outputLines: outputLines.length > 0 ? outputLines : ['命令执行完成，未产生可见输出。']
        }
      }
      if (!execution.ok && execution.status === 'failed') {
        return { status: 'failed', message: execution.message }
      }
      if (!execution.ok && execution.status === 'cancelled') {
        return { status: 'cancelled', message: execution.message }
      }
      if (!autoExecuteLowRiskRef.current || !isCurrentExecutionTarget(requestTarget)) {
        return { status: 'cancelled', message: '自动执行已取消。' }
      }
      return {
        status: 'waiting_for_review',
        message: execution.ok ? '命令未通过执行边界检查。' : execution.message
      }
    } catch {
      onTrackAction?.('query.command.auto_execute', 'risk_check', 'fail')
      return { status: 'waiting_for_review', message: '安全检查暂不可用，命令未执行。' }
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
            {entry.execution ? (
              <div className="query-history-command">
                <div className="query-history-command-header">
                  <span>CMD</span>
                  <span data-status={entry.execution.status}>{queryExecutionStatusLabel(entry.execution.status)}</span>
                </div>
                <code>{entry.execution.command}</code>
                {entry.execution.message ? <small>{entry.execution.message}</small> : null}
              </div>
            ) : null}
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
          {!selectedCommand || terminalSessionState !== 'running' ? (
            <div data-testid="log-analysis-connection-guide" className="query-connection-guide" role="region" aria-label="服务器连接引导">
              <div className="query-connection-guide-icon" aria-hidden="true">
                <TerminalIcon size={24} />
              </div>
              <div className="query-connection-guide-title">
                {!selectedCommand
                  ? '尚未连接服务器'
                  : terminalSessionState === 'connecting'
                    ? '正在连接服务器'
                    : '服务器会话已断开'}
              </div>
              <div className="query-connection-guide-description">
                {selectedCommand
                  ? `“${selectedCommand}”尚未建立连接，可切换其他会话后重试。`
                  : commands.length > 0
                  ? '选择一个会话命令，连接后即可查看输出并使用 AI 查日志。'
                  : '暂无可用的会话命令，请先在首页添加终端模式命令。'}
              </div>
              {commands.length > 0 ? (
                <select
                  data-testid="log-analysis-guide-command-select"
                  aria-label="选择要连接的服务器会话"
                  defaultValue=""
                  onChange={(event) => selectCommand(event.target.value)}
                >
                  <option value="" disabled>选择服务器会话…</option>
                  {commands.map((cmd) => (
                    <option key={cmd.name} value={cmd.name}>{cmd.name}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
          <div data-testid="log-analysis-floating-console" className="query-floating-shell">
            {showHistoryPopover ? (
              <div
                id="log-analysis-history-popover"
                role="dialog"
                aria-label="历史对话"
                data-testid="log-analysis-history-popover"
                className="ui-popover query-history-popover"
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
              style={{
                width: workbenchGeometry.width,
                height: workbenchGeometry.height,
                transform: `translate(calc(-50% + ${workbenchGeometry.x}px), ${workbenchGeometry.y}px)`
              }}
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
                    if (event.key === 'ArrowLeft') moveWorkbench(workbenchGeometryRef.current.x - step, workbenchGeometryRef.current.y, true)
                    else if (event.key === 'ArrowRight') moveWorkbench(workbenchGeometryRef.current.x + step, workbenchGeometryRef.current.y, true)
                    else if (event.key === 'ArrowUp') moveWorkbench(workbenchGeometryRef.current.x, workbenchGeometryRef.current.y - step, true)
                    else if (event.key === 'ArrowDown') moveWorkbench(workbenchGeometryRef.current.x, workbenchGeometryRef.current.y + step, true)
                    else return
                    event.preventDefault()
                  }}
                />
                <div className="query-floating-actions">
                  <label data-testid="log-analysis-session-picker" className="query-floating-session">
                    <span
                      className="query-floating-session-status"
                      aria-hidden="true"
                      title={terminalSessionState === 'running' ? '运行中' : '空闲'}
                    >
                      <span className={terminalSessionState === 'running' ? 'query-status-dot is-running' : 'query-status-dot'} />
                    </span>
                    <select
                      data-testid="log-analysis-command-select"
                      aria-label={`选择命令，当前状态：${terminalSessionState === 'running' ? '运行中' : '空闲'}`}
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
                  <div ref={morePopoverRef} className="query-more">
                    <button
                      type="button"
                      data-testid="log-analysis-more"
                      aria-label="更多操作"
                      aria-expanded={showMorePopover}
                      aria-controls="log-analysis-more-popover"
                      onClick={() => setShowMorePopover((prev) => !prev)}
                      style={compactButtonStyle('muted')}
                    >
                      更多
                    </button>
                    {showMorePopover ? (
                      <div
                        id="log-analysis-more-popover"
                        role="dialog"
                        aria-label="更多操作"
                        data-testid="log-analysis-more-popover"
                        className="ui-popover query-more-popover"
                      >
                        <button
                          type="button"
                          aria-label="历史对话"
                          data-testid="log-analysis-open-history"
                          aria-expanded={showHistoryPopover}
                          aria-controls="log-analysis-history-popover"
                          className="query-more-history"
                          onClick={() => {
                            setShowMorePopover(false)
                            setShowHistoryPopover(true)
                          }}
                        >
                          历史对话
                        </button>
                        <button
                          type="button"
                          data-testid="log-analysis-reset-workbench"
                          className="query-more-history"
                          onClick={resetWorkbenchGeometry}
                        >
                          恢复默认布局
                        </button>
                        <label
                          data-testid="log-analysis-auto-execute-toggle"
                          className="query-auto-execute-toggle query-more-auto-execute"
                          title="AI 回复完成后，仅在会话状态可验证时自动执行候选命令；其余命令会保留，等待你确认。"
                        >
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label="自动执行候选命令"
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
                                  : '仅限自动执行候选命令'}
                            </small>
                          </span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {workspaceMode === 'ask' ? (
                <div className="query-floating-editor">
                  <textarea
                    data-testid="log-analysis-input"
                    style={{
                      ...inputStyle,
                      marginTop: 0,
                      minHeight: 0,
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
                        await handleTranslate()
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={isStreaming ? '取消本轮查询' : '发送'}
                    data-testid="log-analysis-translate"
                    onClick={() => void (isStreaming ? handleCancelAgent() : handleTranslate())}
                    disabled={!isStreaming && !queryInput.trim()}
                    className="query-floating-primary"
                  >
                    {isStreaming ? '取消' : '询问 AI'}
                  </button>
                  <div className="query-floating-hint">Enter 发送 · Shift+Enter 换行</div>
                </div>
              ) : (
                <div className="query-floating-editor">
                  <textarea
                    data-testid="log-analysis-command-input"
                    value={commandInput}
                    onChange={(event) => setCommandInput(event.target.value)}
                    readOnly={agentPhase === 'waiting_for_review'}
                    placeholder="例如：grep -i error app.log | tail -n 50"
                    style={{
                      minHeight: 0,
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
                  <div className="query-floating-hint">
                    {activeCommandText.length}/2000 · {agentPhase === 'waiting_for_review' ? '待确认命令不可修改' : '执行前可继续编辑'}
                  </div>
                </div>
              )}
              {WORKBENCH_RESIZE_DIRECTIONS.map((direction) => (
                <span
                  key={direction}
                  role="button"
                  tabIndex={0}
                  aria-label={`调整 AI 工作台${resizeDirectionLabel(direction)}边缘`}
                  data-testid={`log-analysis-workbench-resize-${direction}`}
                  data-direction={direction}
                  className="query-resize-handle"
                  onPointerDown={(event) => startWorkbenchResize(event, direction)}
                  onPointerMove={resizeWorkbench}
                  onPointerUp={stopWorkbenchResize}
                  onPointerCancel={stopWorkbenchResize}
                  onKeyDown={(event) => resizeWorkbenchWithKeyboard(event, direction)}
                />
              ))}
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

function formatQueryAgentPhase(phase: QueryAgentPhase | null): string {
  if (phase === 'assessing_risk') return '正在判断命令风险...'
  if (phase === 'executing') return '正在执行查询命令...'
  if (phase === 'analyzing_result') return '正在分析查询结果...'
  if (phase === 'waiting_for_review') return '命令需要人工确认。'
  if (phase === 'cancelled') return '本轮查询已取消。'
  if (phase === 'failed') return '本轮查询失败。'
  return '正在生成查询...'
}

function useTerminalSession(args: {
  hostRef: React.RefObject<HTMLDivElement | null>
  commandName: string
  sessionId: string
  enabled: boolean
  autoExecutionEnabled: boolean
  onTerminalReady?: (printer: ((content: string) => void) | null) => void
  onStatusChange: (state: 'connecting' | 'running' | 'idle') => void
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
    terminalReadyRef.current?.((content) => terminalRef.current?.write(content))

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

    statusChangeRef.current('connecting')
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
        statusChangeRef.current('idle')
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

function loadWorkbenchGeometry(): WorkbenchGeometry {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_GEOMETRY_STORAGE_KEY) || '{}') as Partial<WorkbenchGeometry>
    return {
      x: finiteNumber(stored.x) ? stored.x : 0,
      y: finiteNumber(stored.y) ? stored.y : 0,
      width: finiteNumber(stored.width) && stored.width > 0 ? stored.width : undefined,
      height: finiteNumber(stored.height) && stored.height >= 160 ? stored.height : undefined
    }
  } catch {
    return { x: 0, y: 0 }
  }
}

function saveWorkbenchGeometry(geometry: WorkbenchGeometry) {
  try {
    window.localStorage.setItem(WORKBENCH_GEOMETRY_STORAGE_KEY, JSON.stringify({
      x: Math.round(geometry.x),
      y: Math.round(geometry.y),
      width: geometry.width ? Math.round(geometry.width) : undefined,
      height: geometry.height ? Math.round(geometry.height) : undefined
    }))
  } catch {
    // ignore storage errors
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function snapshotRect(rect: DOMRect): RectSnapshot {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
}

function calculateWorkbenchResize(resize: WorkbenchResizeState, clientX: number, clientY: number): WorkbenchGeometry {
  const dx = clientX - resize.x
  const dy = clientY - resize.y
  const minWidth = 1
  const minHeight = Math.min(200, resize.bounds.height)
  let { top, right, bottom, left } = resize.rect

  if (resize.direction.includes('e')) right = Math.min(resize.bounds.right, Math.max(left + minWidth, right + dx))
  if (resize.direction.includes('w')) left = Math.max(resize.bounds.left, Math.min(right - minWidth, left + dx))
  if (resize.direction.includes('s')) bottom = Math.min(resize.bounds.bottom, Math.max(top + minHeight, bottom + dy))
  if (resize.direction.includes('n')) top = Math.max(resize.bounds.top, Math.min(bottom - minHeight, top + dy))

  const width = right - left
  const height = bottom - top
  return {
    x: resize.geometry.x + left - resize.rect.left + (width - resize.rect.width) / 2,
    y: resize.geometry.y + top - resize.rect.top + height - resize.rect.height,
    width,
    height
  }
}

function resizeDirectionLabel(direction: WorkbenchResizeDirection): string {
  return direction.replace('n', '上').replace('s', '下').replace('e', '右').replace('w', '左')
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

function createQueryTerminalSessionId(commandName: string): string {
  const normalized = commandName.trim()
  if (!normalized) return ''
  return `${QUERY_TERMINAL_SESSION_PREFIX}:${normalized}`
}

function formatTimelineTerminalLines(entry: QueryAiHistoryItem & { at: number }): string {
  if (entry.role === 'user') {
    return formatTerminalTuiEntry({ at: entry.at, label: 'YOU', tone: 'user', content: entry.content })
  }

  const lines = [formatTerminalTuiEntry({ at: entry.at, label: 'AI', tone: 'assistant', content: entry.content })]
  if (entry.action?.type === 'command' && entry.action.command?.trim()) {
    const tone: TerminalTuiTone = entry.action.riskLevel === 'blocked'
      ? 'danger'
      : entry.action.riskLevel === 'review'
        ? 'warning'
        : 'success'
    lines.push(formatTerminalTuiEntry({ at: entry.at, label: 'AI Command', tone, content: entry.action.command }))
    if (entry.action.riskLevel !== 'safe') {
      lines.push(formatTerminalTuiEntry({
        at: entry.at,
        label: '风险',
        tone,
        content: entry.action.riskReason || '命令需要人工确认。'
      }))
    }
  }
  lines.push(formatTerminalExecutionLine(entry))
  return lines.join('')
}

function formatTerminalExecutionLine(entry: QueryAiHistoryItem & { at: number }): string {
  const execution = entry.execution
  if (!execution || !['waiting_for_review', 'failed', 'cancelled'].includes(execution.status)) return ''
  return formatTerminalTuiEntry({
    at: entry.at,
    label: queryExecutionStatusLabel(execution.status),
    tone: execution.status === 'waiting_for_review' ? 'warning' : 'danger',
    content: execution.message || '命令未执行。'
  })
}

function executionSignature(entry: QueryAiHistoryItem & { at: number }): string {
  const execution = entry.execution
  return execution ? `${execution.status}\u0000${execution.message || ''}` : ''
}

function queryExecutionStatusLabel(status: NonNullable<QueryAiHistoryItem['execution']>['status']): string {
  if (status === 'pending') return '等待执行'
  if (status === 'running') return '执行中'
  if (status === 'completed') return '执行完成'
  if (status === 'waiting_for_review') return '等待确认'
  if (status === 'cancelled') return '已取消'
  return '执行失败'
}
