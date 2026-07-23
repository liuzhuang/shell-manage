import { useEffect, useRef, useState } from 'react'
import type {
  QueryAgentPhase,
  QueryAgentToolTraceRequest,
  QueryAiHistoryItem,
  QueryAiProgressPayload,
  QueryAiResponse,
  QueryAiStats
} from '../../shared/types'
import {
  runQueryAgent,
  type QueryAgentExecutionResult,
  type QueryAgentReviewRequest
} from '../lib/query-agent-runner'
import { buildTerminalContextLines, redactTerminalLine } from '../lib/terminalContext'

interface TranslateContext {
  selectedCommand?: string
  terminalSessionId?: string
  terminalInstanceId?: string
  sessionLogs: string[]
  executeCommand?: (response: QueryAiResponse) => Promise<QueryAgentExecutionResult>
  reviewCommand?: (request: QueryAgentReviewRequest) => Promise<QueryAgentExecutionResult>
  shouldContinue?: () => boolean
}

interface ExecuteContext {
  selectedCommand?: string
  terminalSessionId?: string
}

const STORAGE_KEY = 'query.ai.session.v1'
const LAST_LOG_PATH_STORAGE_KEY = 'query.ai.lastLogPath.v1'
const MAX_FAVORITES = 50
const MAX_LOG_PATH_HISTORY = 20

interface PersistedSession {
  queryInput: string
  commandInput: string
  logPathInput: string
  logPathHistory: string[]
  chatHistory: Array<QueryAiHistoryItem & { at: number }>
  favoriteCommands: string[]
}

export interface QueryExecutionEvent {
  id: string
  at: number
  commandName: string
  command: string
  status: 'running' | 'done' | 'error'
  outputLines: string[]
  summary: string
}

export function useQueryState() {
  const persisted = loadPersistedSession()
  const [queryInput, setQueryInput] = useState(persisted.queryInput)
  const [commandInput, setCommandInput] = useState(persisted.commandInput)
  const [logPathInput, setLogPathInput] = useState(persisted.logPathInput)
  const [logPathHistory, setLogPathHistory] = useState<string[]>(persisted.logPathHistory)
  const [chatHistory, setChatHistory] = useState<Array<QueryAiHistoryItem & { at: number }>>(persisted.chatHistory)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [agentPhase, setAgentPhase] = useState<QueryAgentPhase | null>(null)
  const currentRequestIdRef = useRef('')
  const currentRunIdRef = useRef('')
  const [lastAiStats, setLastAiStats] = useState<QueryAiStats | null>(null)
  const [executionSummary, setExecutionSummary] = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [favoriteCommands, setFavoriteCommands] = useState<string[]>(persisted.favoriteCommands)
  const [executionEvents, setExecutionEvents] = useState<QueryExecutionEvent[]>([])

  function persistSnapshot(overrides: Partial<PersistedSession> = {}): void {
    savePersistedSession({
      queryInput: overrides.queryInput ?? queryInput,
      commandInput: overrides.commandInput ?? commandInput,
      logPathInput: overrides.logPathInput ?? logPathInput,
      logPathHistory: (overrides.logPathHistory ?? logPathHistory).slice(0, MAX_LOG_PATH_HISTORY),
      chatHistory: (overrides.chatHistory ?? chatHistory).slice(-60),
      favoriteCommands: (overrides.favoriteCommands ?? favoriteCommands).slice(0, MAX_FAVORITES)
    })
  }

  function updateCommandExecution(
    command: string,
    status: NonNullable<QueryAiHistoryItem['execution']>['status'],
    message?: string
  ) {
    setChatHistory((prev) => {
      let targetIndex = -1
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        const execution = prev[index].execution
        if (execution?.command !== command || !['pending', 'running', 'waiting_for_review'].includes(execution.status)) continue
        targetIndex = index
        break
      }
      if (targetIndex < 0) return prev
      const next = prev.map((item, index) => (
        index === targetIndex ? { ...item, execution: { command, status, message } } : item
      ))
      persistSnapshot({ chatHistory: next })
      return next
    })
  }

  useEffect(() => {
    const off = window.api.onQueryAiProgress((payload: QueryAiProgressPayload) => {
      if (!currentRequestIdRef.current || payload.requestId !== currentRequestIdRef.current) return
      setAgentPhase(payload.phase)
      if (payload.phase === 'completed') {
        if (payload.stats) setLastAiStats(payload.stats)
        return
      }
    })
    return () => {
      void off?.()
    }
  }, [])

  useEffect(() => {
    savePersistedSession({
      queryInput,
      commandInput,
      logPathInput,
      logPathHistory: logPathHistory.slice(0, MAX_LOG_PATH_HISTORY),
      chatHistory: chatHistory.slice(-60),
      favoriteCommands: favoriteCommands.slice(0, MAX_FAVORITES)
    })
  }, [queryInput, commandInput, logPathInput, logPathHistory, chatHistory, favoriteCommands])

  async function translate(context: TranslateContext): Promise<QueryAiResponse | undefined> {
    const input = queryInput.trim()
    if (!input || isStreaming) return undefined
    const runId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const runStartedAt = Date.now()
    currentRunIdRef.current = runId
    setIsStreaming(true)
    setAgentPhase('generating_query')
    setStreamingText('')
    setChatHistory((prev) => {
      const next = [...prev, { role: 'user' as const, content: input, at: Date.now() }]
      persistSnapshot({ chatHistory: next })
      return next
    })
    const rememberedLogPaths = collectRememberedLogPaths(input, chatHistory, logPathHistory)
    if (rememberedLogPaths.join('\n') !== logPathHistory.join('\n')) setLogPathHistory(rememberedLogPaths)
    let modelHistory: QueryAiHistoryItem[] = []
    const sessionLogContext = context.sessionLogs.slice(-120)
    let lastResult: QueryAiResponse | undefined
    let aggregateStats: QueryAiStats | null = null
    let requestIndex = 0
    let executedCommandCount = 0
    let pendingReviewMessage = ''
    let finalPhase: Extract<QueryAgentPhase, 'completed' | 'waiting_for_review' | 'cancelled' | 'failed'> = 'failed'
    let finalError: string | undefined
    const shouldContinue = () => (
      currentRunIdRef.current === runId && (context.shouldContinue?.() ?? true)
    )
    try {
      const runResult = await runQueryAgent({
        shouldContinue,
        onPhase: (phase) => {
          if (!shouldContinue()) return
          setAgentPhase(phase)
          if (phase === 'waiting_for_review' && lastResult?.action.type === 'command') {
            updateCommandExecution(
              lastResult.action.command || '',
              'waiting_for_review',
              pendingReviewMessage || lastResult.action.riskReason || '命令需要人工确认。'
            )
          }
        },
        requestStep: async ({ outputLines, forceReply }) => {
          requestIndex += 1
          const requestId = `${runId}-${requestIndex}`
          currentRequestIdRef.current = requestId
          const stepInput = requestIndex === 1
            ? input
            : forceReply
              ? `本次原始请求：${input}\n请仅根据已有命令输出给出最终结论；已有结果足够或命令重复，不得继续生成命令。`
              : `本次原始请求：${input}\n请分析最新命令输出，并继续处理本次请求。`
          const result = await window.api.queryAiChat({
            requestId,
            agentRunId: runId,
            stepIndex: requestIndex,
            input: stepInput,
            history: modelHistory,
            selectedCommand: context.selectedCommand,
            terminalSessionId: context.terminalSessionId,
            terminalInstanceId: context.terminalInstanceId,
            rememberedLogPaths,
            sessionLogs: sessionLogContext,
            queryOutputLines: buildTerminalContextLines(outputLines.join('\n')),
            forceReply
          })
          if (!shouldContinue()) throw createQueryAgentCancellationError()
          lastResult = result
          aggregateStats = mergeQueryAiStats(aggregateStats, result.stats)
          const answer = result.answer.trim()
          const generatedCommand = result.action.type === 'command' ? (result.action.command || '').trim() : ''
          if (generatedCommand) setCommandInput(generatedCommand)
          setStreamingText(answer)
          setChatHistory((prev) => {
            const next = [
              ...prev,
              {
                role: 'assistant' as const,
                content: answer,
                action: result.action,
                execution: generatedCommand
                  ? { command: generatedCommand, status: 'pending' as const }
                  : undefined,
                at: Date.now()
              }
            ]
            persistSnapshot({
              chatHistory: next,
              ...(generatedCommand ? { commandInput: generatedCommand } : {})
            })
            return next
          })
          modelHistory = [
            ...modelHistory,
            { role: 'user', content: stepInput },
            { role: 'assistant', content: answer, action: result.action }
          ]
          if (result.action.type === 'command') return { type: 'command', command: generatedCommand }
          return { type: result.action.type, message: answer }
        },
        executeCommand: async (command) => {
          const toolStartedAt = Date.now()
          if (!lastResult || lastResult.action.type !== 'command' || lastResult.action.command?.trim() !== command.trim()) {
            const message = 'Agent 执行步骤与模型响应不一致。'
            await recordQueryAgentToolTrace({
              agentRunId: runId,
              stepIndex: requestIndex,
              command,
              output: message,
              status: 'failed',
              durationMs: Date.now() - toolStartedAt
            })
            return { status: 'failed', message }
          }
          updateCommandExecution(command, 'running')
          let execution: QueryAgentExecutionResult
          try {
            execution = context.executeCommand
              ? await context.executeCommand(lastResult)
              : { status: 'waiting_for_review', message: '命令已保留并等待人工执行。' }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            updateCommandExecution(command, 'failed', message)
            await recordQueryAgentToolTrace({
              agentRunId: runId,
              stepIndex: requestIndex,
              command,
              output: message,
              status: 'failed',
              durationMs: Date.now() - toolStartedAt
            })
            throw error
          }
          if (execution.status === 'waiting_for_review') {
            pendingReviewMessage = execution.message || ''
            if (context.reviewCommand) return execution
          }
          updateCommandExecution(command, execution.status, execution.status === 'completed' ? undefined : execution.message)
          await recordQueryAgentToolTrace({
            agentRunId: runId,
            stepIndex: requestIndex,
            command,
            output: execution.status === 'completed'
              ? execution.outputLines.join('\n')
              : execution.message || '',
            status: execution.status,
            durationMs: Date.now() - toolStartedAt
          })
          if (execution.status === 'completed') executedCommandCount += 1
          return execution
        },
        reviewCommand: context.reviewCommand
          ? async (request) => {
              const toolStartedAt = Date.now()
              let execution: QueryAgentExecutionResult
              try {
                const reviewedExecution = context.reviewCommand!(request)
                execution = await reviewedExecution
              } catch (error) {
                execution = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
              }
              updateCommandExecution(
                request.command,
                execution.status,
                execution.status === 'completed' ? undefined : execution.message
              )
              await recordQueryAgentToolTrace({
                agentRunId: runId,
                stepIndex: requestIndex,
                command: request.command,
                output: execution.status === 'completed'
                  ? execution.outputLines.join('\n')
                  : execution.message || '',
                status: execution.status,
                durationMs: Date.now() - toolStartedAt
              })
              return execution
            }
          : undefined,
        onDuplicateCommand: (command) => {
          updateCommandExecution(command, 'cancelled', '与本轮已执行命令重复，已跳过并改为总结现有结果。')
        }
      })
      if (!shouldContinue()) {
        finalPhase = 'cancelled'
        return lastResult
      }
      finalPhase = runResult.phase
      executedCommandCount = runResult.executedCommandCount
      setAgentPhase(runResult.phase)
      if (aggregateStats) setLastAiStats(aggregateStats)
      if (runResult.phase === 'failed' && runResult.executedCommandCount === 3 && runResult.step?.type === 'command') {
        const message = '已达到三条命令执行上限，模型仍请求继续执行；本轮已停止。'
        setStreamingText(message)
        setChatHistory((prev) => {
          const next = [...prev, { role: 'assistant' as const, content: message, at: Date.now() }]
          persistSnapshot({ chatHistory: next })
          return next
        })
      }
      return lastResult
    } catch (error) {
      if (currentRunIdRef.current !== runId) {
        finalPhase = 'cancelled'
        return lastResult
      }
      finalPhase = 'failed'
      finalError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      setAgentPhase('failed')
      throw error
    } finally {
      if (currentRunIdRef.current === runId) {
        currentRunIdRef.current = ''
        currentRequestIdRef.current = ''
        setIsStreaming(false)
      }
      try {
        await window.api.queryAgentTraceFinish({
          agentRunId: runId,
          phase: finalPhase,
          executedCommandCount,
          stepCount: requestIndex,
          durationMs: Date.now() - runStartedAt,
          stats: aggregateStats || undefined,
          finalAnswer: lastResult?.answer,
          error: finalError
        })
      } catch {
        // 追踪服务不可用不能影响 Query Agent 的主流程。
      }
    }
  }

  async function cancelTranslation(): Promise<void> {
    const requestId = currentRequestIdRef.current
    currentRunIdRef.current = ''
    currentRequestIdRef.current = ''
    setAgentPhase('cancelled')
    setIsStreaming(false)
    if (requestId) await window.api.queryCancel(requestId)
  }

  function fillCommandFromFavorite(text: string) {
    setStreamingText('')
    setCommandInput(text)
  }

  function addFavoriteCommand() {
    const raw = (streamingText || commandInput).trim()
    if (!raw) return
    setFavoriteCommands((prev) => {
      return [raw, ...prev.filter((item) => item !== raw)].slice(0, MAX_FAVORITES)
    })
  }

  function removeFavoriteCommand(text: string) {
    setFavoriteCommands((prev) => prev.filter((item) => item !== text))
  }

  async function execute(context: ExecuteContext) {
    if (!context.selectedCommand) throw new Error('请先选择项目')
    const sessionId = context.terminalSessionId?.trim() || undefined
    const command = commandInput.trim()
    if (!command) throw new Error('请先生成或填写待执行命令。')
    const before = await window.api.terminalGetBuffer(context.selectedCommand, { sessionId })
    await window.api.terminalStart(context.selectedCommand, { source: 'query', sessionId })
    const eventId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const eventAt = Date.now()
    setExecutionEvents((prev) => [
      ...prev,
      {
        id: eventId,
        at: eventAt,
        commandName: context.selectedCommand || '',
        command,
        status: 'running',
        outputLines: [],
        summary: ''
      }
    ])
    await window.api.terminalInput(context.selectedCommand, `${command}\n`, { source: 'query', sessionId })
    setIsSummarizing(true)
    void summarizeExecutionResult(eventId, context.selectedCommand, command, before.text, sessionId)
  }

  async function summarizeExecutionResult(
    eventId: string,
    commandName: string,
    command: string,
    beforeText: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const output = await pollForExecutionOutput(commandName, beforeText, sessionId)
      const lines = sanitizeOutputLines(output).slice(-220)
      if (lines.length === 0) {
        setExecutionSummary('暂无可总结的新增输出。')
        setExecutionEvents((prev) =>
          prev.map((item) =>
            item.id === eventId
              ? {
                  ...item,
                  status: 'done',
                  outputLines: [],
                  summary: '暂无可总结的新增输出。'
                }
              : item
          )
        )
        return
      }
      const summary = await summarizeLinesByAi(commandName, command, lines, 'auto')
      setExecutionSummary(summary)
      setExecutionEvents((prev) =>
        prev.map((item) => (item.id === eventId ? { ...item, status: 'done', outputLines: lines, summary } : item))
      )
    } catch {
      setExecutionSummary('执行结果总结失败，请稍后重试。')
      setExecutionEvents((prev) =>
        prev.map((item) => (item.id === eventId ? { ...item, status: 'error', summary: '执行结果总结失败，请稍后重试。' } : item))
      )
    } finally {
      setIsSummarizing(false)
    }
  }

  async function retryAnalyzeVisibleLogs(commandName?: string, visibleLogs: string[] = []): Promise<void> {
    if (!commandName) throw new Error('请先选择项目')
    const lines = sanitizeOutputLines(visibleLogs.join('\n')).slice(-220)
    if (lines.length === 0) {
      setExecutionSummary('当前屏幕暂无可分析输出。')
      return
    }
    setIsSummarizing(true)
    try {
      const commandHint = commandInput.trim() || '（当前屏幕输出全量重试）'
      const summary = await summarizeLinesByAi(commandName, commandHint, lines, 'retry')
      setExecutionSummary(summary)
    } catch {
      setExecutionSummary('重新分析失败，请稍后重试。')
    } finally {
      setIsSummarizing(false)
    }
  }

  async function retryAnalyzeExecutionEvent(eventId: string): Promise<void> {
    const event = executionEvents.find((item) => item.id === eventId)
    if (!event) throw new Error('找不到对应的执行记录。')
    if (event.outputLines.length === 0) throw new Error('该执行记录暂无可重新分析的输出。')
    setIsSummarizing(true)
    setExecutionEvents((prev) => prev.map((item) => (item.id === eventId ? { ...item, status: 'running' } : item)))
    try {
      const summary = await summarizeLinesByAi(event.commandName, event.command, event.outputLines.slice(-220), 'retry')
      setExecutionSummary(summary)
      setExecutionEvents((prev) =>
        prev.map((item) => (item.id === eventId ? { ...item, status: 'done', summary } : item))
      )
    } catch {
      const fallback = '重新分析失败，请稍后重试。'
      setExecutionSummary(fallback)
      setExecutionEvents((prev) =>
        prev.map((item) => (item.id === eventId ? { ...item, status: 'error', summary: fallback } : item))
      )
    } finally {
      setIsSummarizing(false)
    }
  }

  return {
    queryInput,
    setQueryInput,
    commandInput,
    setCommandInput,
    logPathInput,
    setLogPathInput,
    logPathHistory,
    fillLogPathFromHistory: (path: string) => setLogPathInput(path),
    chatHistory,
    streamingText,
    isStreaming,
    agentPhase,
    lastAiStats,
    executionSummary,
    isSummarizing,
    clearChatHistory: () => {
      setChatHistory([])
      setExecutionEvents([])
      setExecutionSummary('')
    },
    favoriteCommands,
    fillCommandFromFavorite,
    addFavoriteCommand,
    removeFavoriteCommand,
    executionEvents,
    translate,
    cancelTranslation,
    execute,
    retryAnalyzeVisibleLogs,
    retryAnalyzeExecutionEvent
  }
}

function loadPersistedSession(): PersistedSession {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        queryInput: '',
        commandInput: '',
        logPathInput: loadLastLogPath(),
        logPathHistory: [],
        chatHistory: [],
        favoriteCommands: []
      }
    }
    const parsed = JSON.parse(raw) as PersistedSession
    if (!Array.isArray(parsed.chatHistory)) {
      return {
        queryInput: '',
        commandInput: '',
        logPathInput: loadLastLogPath(),
        logPathHistory: [],
        chatHistory: [],
        favoriteCommands: []
      }
    }
    const restoredLogPath = typeof parsed.logPathInput === 'string' ? parsed.logPathInput : ''
    return {
      queryInput: typeof parsed.queryInput === 'string' ? parsed.queryInput : '',
      commandInput: typeof parsed.commandInput === 'string' ? parsed.commandInput : '',
      logPathInput: restoredLogPath || loadLastLogPath(),
      logPathHistory: Array.isArray(parsed.logPathHistory)
        ? parsed.logPathHistory.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_LOG_PATH_HISTORY)
        : [],
      chatHistory: parsed.chatHistory.slice(-60),
      favoriteCommands: Array.isArray(parsed.favoriteCommands)
        ? parsed.favoriteCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_FAVORITES)
        : []
    }
  } catch {
    return { queryInput: '', commandInput: '', logPathInput: loadLastLogPath(), logPathHistory: [], chatHistory: [], favoriteCommands: [] }
  }
}

function savePersistedSession(session: PersistedSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    const logPath = session.logPathInput.trim()
    if (logPath) window.localStorage.setItem(LAST_LOG_PATH_STORAGE_KEY, logPath)
  } catch {
    // ignore quota or disabled storage
  }
}

function loadLastLogPath(): string {
  try {
    const raw = window.localStorage.getItem(LAST_LOG_PATH_STORAGE_KEY)
    return typeof raw === 'string' ? raw.trim() : ''
  } catch {
    return ''
  }
}

function collectRememberedLogPaths(
  input: string,
  history: Array<QueryAiHistoryItem & { at: number }>,
  existing: string[]
): string[] {
  // ponytail: remembers conventional shell paths; add shell-token parsing if quoted paths with spaces become common.
  const paths = [
    ...extractAbsolutePaths(input),
    ...history.slice().reverse().flatMap((item) => item.role === 'user' ? extractAbsolutePaths(item.content) : []),
    ...existing
  ]
  return Array.from(new Set(paths)).slice(0, MAX_LOG_PATH_HISTORY)
}

function extractAbsolutePaths(text: string): string[] {
  return text.match(/(?<![:/])\/[A-Za-z0-9._~@%+=:,/-]+/gu) || []
}

/**
 * 轮询并等待输出趋于稳定，再将新增输出交给 AI 分析。
 */
export async function pollForExecutionOutput(commandName: string, beforeText: string, sessionId?: string): Promise<string> {
  const pollMs = 320
  const stableNeeded = 5
  const maxPolls = 120

  let latest = beforeText
  let stableCount = 0
  let lastLen = -1
  let sawEnoughDelta = false

  await sleep(280)

  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(pollMs)
    const current = await window.api.terminalGetBuffer(commandName, { sessionId })
    latest = current.text
    const delta = latest.startsWith(beforeText) ? latest.slice(beforeText.length) : latest.slice(-12000)
    if (!sawEnoughDelta && delta.length >= 32) {
      sawEnoughDelta = true
      lastLen = latest.length
      stableCount = 0
    }

    if (sawEnoughDelta) {
      if (latest.length === lastLen) {
        stableCount += 1
        if (stableCount >= stableNeeded) break
      } else {
        lastLen = latest.length
        stableCount = 0
      }
    } else {
      lastLen = latest.length
    }
  }

  if (latest.startsWith(beforeText)) return latest.slice(beforeText.length)
  return latest.slice(-8000)
}

async function summarizeLinesByAi(
  commandName: string,
  command: string,
  lines: string[],
  mode: 'auto' | 'retry'
): Promise<string> {
  const tip = mode === 'retry' ? '这是一键重试分析，请忽略历史结论并重新判断。' : '请按当前输出直接总结。'
  const result = await window.api.queryAiChat({
    requestId: `sum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    input: `请用最多3条要点总结以下命令执行结果，并判断是否成功。\n${tip}\n命令：${redactTerminalLine(command)}`,
    history: [],
    selectedCommand: commandName,
    sessionLogs: lines,
    queryOutputLines: []
  })
  return result.answer.trim()
}

function sanitizeOutputLines(text: string): string[] {
  return buildTerminalContextLines(text)
}

function mergeQueryAiStats(current: QueryAiStats | null, next: QueryAiStats): QueryAiStats {
  if (!current) return { ...next }
  const sum = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined && right === undefined) return undefined
    return (left || 0) + (right || 0)
  }
  return {
    provider: next.provider,
    model: next.model,
    durationMs: current.durationMs + next.durationMs,
    inputTokens: sum(current.inputTokens, next.inputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens),
    estimatedTokens: sum(current.estimatedTokens, next.estimatedTokens)
  }
}

async function recordQueryAgentToolTrace(payload: QueryAgentToolTraceRequest): Promise<void> {
  try {
    await window.api.queryAgentTraceTool(payload)
  } catch {
    // 追踪服务不可用不能影响 Query Agent 的主流程。
  }
}

function createQueryAgentCancellationError(): Error {
  const error = new Error('Query Agent 已取消。')
  error.name = 'AbortError'
  return error
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
