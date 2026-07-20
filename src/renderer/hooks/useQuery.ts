import { useEffect, useState } from 'react'
import type { QueryAiHistoryItem, QueryAiResponse, QueryAiStats, QueryAiStreamPayload } from '../../shared/types'
import { buildTerminalContextLines, redactTerminalLine } from '../lib/terminalContext'

interface TranslateContext {
  selectedCommand?: string
  terminalSessionId?: string
  terminalInstanceId?: string
  targetLogPath?: string
  sessionLogs: string[]
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
  const [currentRequestId, setCurrentRequestId] = useState('')
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

  useEffect(() => {
    const off = window.api.onQueryAiStream((payload: QueryAiStreamPayload) => {
      if (!currentRequestId || payload.requestId !== currentRequestId) return
      if (payload.phase === 'start') {
        setStreamingText('')
        setIsStreaming(true)
        return
      }
      if (payload.phase === 'chunk') {
        setStreamingText((prev) => `${prev}${payload.text || ''}`)
        return
      }
      if (payload.phase === 'error') {
        setIsStreaming(false)
        return
      }
      if (payload.phase === 'end') {
        setIsStreaming(false)
        if (payload.stats) setLastAiStats(payload.stats)
      }
    })
    return () => {
      void off?.()
    }
  }, [currentRequestId])

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
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setCurrentRequestId(requestId)
    setIsStreaming(true)
    setStreamingText('')
    setChatHistory((prev) => {
      const next = [...prev, { role: 'user' as const, content: input, at: Date.now() }]
      persistSnapshot({ chatHistory: next })
      return next
    })
    const history = chatHistory.map<QueryAiHistoryItem>((item) => ({ role: item.role, content: item.content }))
    const sessionLogContext = context.sessionLogs.slice(-120)
    try {
      const result = await window.api.queryAiChat({
        requestId,
        input,
        history,
        selectedCommand: context.selectedCommand,
        terminalSessionId: context.terminalSessionId,
        terminalInstanceId: context.terminalInstanceId,
        targetLogPath: context.targetLogPath?.trim() || undefined,
        sessionLogs: sessionLogContext,
        queryOutputLines: []
      })
      const answer = result.answer.trim()
      const generatedCommand = result.action.type === 'command' ? (result.action.command || '').trim() : ''
      if (generatedCommand) setCommandInput(generatedCommand)
      setStreamingText(answer)
      setChatHistory((prev) => {
        const next = [...prev, { role: 'assistant' as const, content: answer, action: result.action, at: Date.now() }]
        persistSnapshot({
          chatHistory: next,
          ...(generatedCommand ? { commandInput: generatedCommand } : {})
        })
        return next
      })
      setLastAiStats(result.stats)
      return result
    } finally {
      setIsStreaming(false)
    }
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

/**
 * 轮询并等待输出趋于稳定，再将新增输出交给 AI 分析。
 */
async function pollForExecutionOutput(commandName: string, beforeText: string, sessionId?: string): Promise<string> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
