import type { QueryAiHistoryItem, QueryAiRequest } from '../shared/types'

const QUERY_AGENT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u
const MAX_ID_LENGTH = 256
const MAX_INPUT_LENGTH = 12_000
const MAX_HISTORY_ITEMS = 60
const MAX_HISTORY_ITEM_LENGTH = 12_000
const MAX_SESSION_LOG_LINES = 240
const MAX_QUERY_OUTPUT_LINES = 120
const MAX_REMEMBERED_LOG_PATHS = 20
const MAX_CONTEXT_LINE_LENGTH = 4_000

export type NormalizedQueryAiRequest = {
  request: QueryAiRequest
  explicitAgentRunId: string
}

export function isValidQueryAgentId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && QUERY_AGENT_ID_PATTERN.test(value)
}

export function normalizeQueryAiRequest(value: unknown): NormalizedQueryAiRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Query Agent 请求格式无效。')
  }
  const raw = value as Record<string, unknown>
  const requestId = requiredId(raw.requestId, 'requestId')
  const hasAgentRunId = Object.prototype.hasOwnProperty.call(raw, 'agentRunId') && raw.agentRunId !== undefined
  const explicitAgentRunId = hasAgentRunId ? requiredId(raw.agentRunId, 'agentRunId') : ''
  const stepIndex = normalizeStepIndex(raw.stepIndex, Boolean(explicitAgentRunId))
  const input = requiredString(raw.input, 'input', MAX_INPUT_LENGTH)
  const history = normalizeHistory(raw.history === undefined ? [] : raw.history)
  const sessionLogs = normalizeStringArray(
    raw.sessionLogs,
    'sessionLogs',
    MAX_SESSION_LOG_LINES,
    MAX_CONTEXT_LINE_LENGTH
  )
  const queryOutputLines = normalizeStringArray(
    raw.queryOutputLines,
    'queryOutputLines',
    MAX_QUERY_OUTPUT_LINES,
    MAX_CONTEXT_LINE_LENGTH
  )
  const selectedCommand = optionalString(raw.selectedCommand, 'selectedCommand', 1_000)
  const terminalSessionId = optionalString(raw.terminalSessionId, 'terminalSessionId', MAX_ID_LENGTH)
  const terminalInstanceId = optionalString(raw.terminalInstanceId, 'terminalInstanceId', MAX_ID_LENGTH)
  const targetLogPath = optionalString(raw.targetLogPath, 'targetLogPath', 4_096)
  const rememberedLogPaths = raw.rememberedLogPaths === undefined
    ? undefined
    : normalizeStringArray(raw.rememberedLogPaths, 'rememberedLogPaths', MAX_REMEMBERED_LOG_PATHS, 4_096)
  if (raw.forceReply !== undefined && typeof raw.forceReply !== 'boolean') {
    throw new Error('Query Agent forceReply 无效。')
  }

  return {
    explicitAgentRunId,
    request: {
      requestId,
      ...(explicitAgentRunId ? { agentRunId: explicitAgentRunId } : {}),
      stepIndex,
      input,
      history,
      ...(selectedCommand === undefined ? {} : { selectedCommand }),
      ...(terminalSessionId === undefined ? {} : { terminalSessionId }),
      ...(terminalInstanceId === undefined ? {} : { terminalInstanceId }),
      ...(targetLogPath === undefined ? {} : { targetLogPath }),
      ...(rememberedLogPaths === undefined ? {} : { rememberedLogPaths }),
      sessionLogs,
      queryOutputLines,
      ...(raw.forceReply === undefined ? {} : { forceReply: raw.forceReply })
    }
  }
}

function requiredId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!isValidQueryAgentId(normalized)) throw new Error(`Query Agent ${field} 无效。`)
  return normalized
}

function normalizeStepIndex(value: unknown, required: boolean): number {
  if (value === undefined && !required) return 1
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 4) {
    throw new Error('Query Agent stepIndex 无效。')
  }
  return value as number
}

function normalizeHistory(value: unknown): QueryAiHistoryItem[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ITEMS) {
    throw new Error('Query Agent history 无效。')
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Query Agent history 无效。')
    }
    const record = item as Record<string, unknown>
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw new Error('Query Agent history role 无效。')
    }
    return {
      role: record.role,
      content: requiredString(record.content, 'history content', MAX_HISTORY_ITEM_LENGTH)
    }
  })
}

function normalizeStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`Query Agent ${field} 无效。`)
  }
  return value.map((item) => {
    if (typeof item !== 'string' || item.length > maxItemLength) {
      throw new Error(`Query Agent ${field} 无效。`)
    }
    return item
  })
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Query Agent ${field} 无效。`)
  }
  return value
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Query Agent ${field} 无效。`)
  }
  return value
}
