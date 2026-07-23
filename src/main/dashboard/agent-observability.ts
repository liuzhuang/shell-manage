import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'
import type { RunnableConfig } from '@langchain/core/runnables'

export const DASHBOARD_AGENT_NAMES = [
  'session-context-agent',
  'read-only-planner-agent',
  'security-executor-agent',
  'parser-narrator-agent',
  'audit-bridge-agent'
] as const

export type DashboardAgentName = (typeof DASHBOARD_AGENT_NAMES)[number]

export type DashboardAgentRoute = {
  name: `${Lowercase<'CREATE' | 'UPDATE'>}:${'resolve-context' | 'selected-context'}`
  expectedAgents: ReadonlyArray<DashboardAgentName>
}

export type DashboardAgentRunMetrics = {
  route: string
  expectedAgents: DashboardAgentName[]
  observedAgents: DashboardAgentName[]
  unexpectedAgents: string[]
  delegationCount: number
  matchedDelegationCount: number
  delegationHitRate: number
  completed: boolean
  repairAttempted: boolean
  repairSucceeded: boolean
  latencyMs: {
    total: number
    agentInit?: number
    invoke?: number
    repair?: number
  }
  modelCalls: {
    orchestrator: number
    delegated: number
    repair: number
    minimumTotal: number
    total?: number
    completed?: number
    usageReported?: number
  }
  usage: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    observedMessageCount: number
    source?: 'callback'
  }
}

type UnknownRecord = Record<string, unknown>

export type DashboardModelCallObservation = {
  totalCalls: number
  completedCalls: number
  usageReportedCalls: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null
}

function isAiMessage(value: unknown): boolean {
  const message = asRecord(value)
  if (!message) return false
  const type = String(message.type || message.role || '').toLowerCase()
  return type === 'ai' || type === 'assistant'
}

function latestTurnMessages(messages: unknown[]): unknown[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    const type = String(message?.type || message?.role || '').toLowerCase()
    if (type === 'human' || type === 'user') return messages.slice(index + 1)
  }
  return messages
}

function parseToolArgs(value: unknown): UnknownRecord | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return asRecord(value)
}

function taskAgentNames(messages: unknown[]): string[] {
  const names: string[] = []
  for (const messageValue of messages) {
    if (!isAiMessage(messageValue)) continue
    const message = asRecord(messageValue)
    if (!message) continue
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(message.toolCalls)
        ? message.toolCalls
        : []
    for (const toolCallValue of toolCalls) {
      const toolCall = asRecord(toolCallValue)
      if (!toolCall) continue
      const rawFunction = asRecord(toolCall.function)
      const toolName = String(toolCall.name || rawFunction?.name || '')
      if (toolName !== 'task') continue
      const args = parseToolArgs(toolCall.args ?? rawFunction?.arguments)
      const agentName = String(args?.subagent_type || '').trim()
      names.push(agentName || '(unknown)')
    }
  }
  return names
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function usageFromMessage(value: unknown): {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
} | null {
  if (!isAiMessage(value)) return null
  const message = asRecord(value)
  if (!message) return null
  const responseMetadata = asRecord(message.response_metadata ?? message.responseMetadata)
  const tokenUsage = asRecord(responseMetadata?.tokenUsage ?? responseMetadata?.usage)
  const usage = asRecord(message.usage_metadata ?? message.usageMetadata) || tokenUsage
  if (!usage) return null
  const inputTokens = finiteNumber(
    usage.input_tokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.promptTokens
  )
  const outputTokens = finiteNumber(
    usage.output_tokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.completionTokens
  )
  const totalTokens = finiteNumber(usage.total_tokens, usage.totalTokens)
    ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null
  return { inputTokens, outputTokens, totalTokens }
}

function aggregateVisibleUsage(messages: unknown[]): DashboardAgentRunMetrics['usage'] {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let hasInputTokens = false
  let hasOutputTokens = false
  let hasTotalTokens = false
  let observedMessageCount = 0
  for (const message of messages) {
    const usage = usageFromMessage(message)
    if (!usage) continue
    observedMessageCount += 1
    if (usage.inputTokens !== undefined) {
      inputTokens += usage.inputTokens
      hasInputTokens = true
    }
    if (usage.outputTokens !== undefined) {
      outputTokens += usage.outputTokens
      hasOutputTokens = true
    }
    if (usage.totalTokens !== undefined) {
      totalTokens += usage.totalTokens
      hasTotalTokens = true
    }
  }
  return {
    ...(hasInputTokens ? { inputTokens } : {}),
    ...(hasOutputTokens ? { outputTokens } : {}),
    ...(hasTotalTokens ? { totalTokens } : {}),
    observedMessageCount
  }
}

export function createDashboardModelCallCollector(): {
  callback: ReturnType<typeof BaseCallbackHandler.fromMethods>
  snapshot: () => DashboardModelCallObservation
} {
  const startedRunIds = new Set<string>()
  const completedRunIds = new Set<string>()
  let usageReportedCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let hasInputTokens = false
  let hasOutputTokens = false
  let hasTotalTokens = false

  const callback = BaseCallbackHandler.fromMethods({
    handleLLMStart(_model, _prompts, runId): void {
      startedRunIds.add(runId)
    },
    handleChatModelStart(_model, _messages, runId): void {
      startedRunIds.add(runId)
    },
    handleLLMEnd(output: LLMResult, runId: string): void {
      startedRunIds.add(runId)
      if (completedRunIds.has(runId)) return
      completedRunIds.add(runId)
      const messages = output.generations
        .flat()
        .map((generation) => asRecord(generation)?.message)
        .filter((message) => message !== undefined)
      const usage = aggregateVisibleUsage(messages)
      if (usage.observedMessageCount === 0) return
      usageReportedCalls += 1
      if (usage.inputTokens !== undefined) {
        inputTokens += usage.inputTokens
        hasInputTokens = true
      }
      if (usage.outputTokens !== undefined) {
        outputTokens += usage.outputTokens
        hasOutputTokens = true
      }
      if (usage.totalTokens !== undefined) {
        totalTokens += usage.totalTokens
        hasTotalTokens = true
      }
    }
  })

  return {
    callback,
    snapshot: () => ({
      totalCalls: startedRunIds.size,
      completedCalls: completedRunIds.size,
      usageReportedCalls,
      ...(hasInputTokens ? { inputTokens } : {}),
      ...(hasOutputTokens ? { outputTokens } : {}),
      ...(hasTotalTokens ? { totalTokens } : {})
    })
  }
}

export function selectDashboardAgentRoute(input: {
  actionType: 'CREATE' | 'UPDATE'
  selectedShellCommandName?: string
}): DashboardAgentRoute {
  const hasSelectedContext = Boolean(input.selectedShellCommandName?.trim())
  return {
    name: `${input.actionType.toLowerCase()}:${hasSelectedContext ? 'selected-context' : 'resolve-context'}` as DashboardAgentRoute['name'],
    expectedAgents: hasSelectedContext ? DASHBOARD_AGENT_NAMES.slice(1) : [...DASHBOARD_AGENT_NAMES]
  }
}

export function buildDashboardTraceConfig(input: {
  threadId: string
  agentName: string
  route: DashboardAgentRoute
  repair: boolean
  calls: number
}): RunnableConfig {
  const calls = Math.max(0, Math.trunc(input.calls))
  return {
    configurable: {
      thread_id: input.threadId
    },
    runName: input.agentName,
    tags: [
      'dashboard',
      `agentName:${input.agentName}`,
      `route:${input.route.name}`,
      `repair:${input.repair}`,
      `calls:${calls}`
    ],
    metadata: {
      agentName: input.agentName,
      route: input.route.name,
      repair: input.repair,
      calls,
      callCountKind: 'planned',
      expectedAgents: [...input.route.expectedAgents]
    }
  }
}

export function evaluateDashboardAgentRun(input: {
  route: DashboardAgentRoute
  messages?: unknown[]
  repairMessages?: unknown[]
  completed: boolean
  repairAttempted: boolean
  latencyMs: DashboardAgentRunMetrics['latencyMs']
  modelObservation?: DashboardModelCallObservation
}): DashboardAgentRunMetrics {
  const messages = latestTurnMessages(Array.isArray(input.messages) ? input.messages : [])
  const repairMessages = Array.isArray(input.repairMessages) ? input.repairMessages : []
  const taskAgents = taskAgentNames(messages)
  const expectedAgentSet = new Set<string>(input.route.expectedAgents)
  const observedAgents = [...new Set(taskAgents.filter((name): name is DashboardAgentName => expectedAgentSet.has(name)))]
  const unexpectedAgents = [...new Set(taskAgents.filter((name) => !expectedAgentSet.has(name)))]
  const orchestratorCalls = messages.filter(isAiMessage).length
  const repairCalls = Math.max(repairMessages.filter(isAiMessage).length, input.repairAttempted ? 1 : 0)
  const matchedDelegationCount = observedAgents.length
  const visibleUsage = aggregateVisibleUsage([...messages, ...repairMessages])
  const usage: DashboardAgentRunMetrics['usage'] = input.modelObservation
    ? {
        inputTokens: input.modelObservation.inputTokens ?? visibleUsage.inputTokens,
        outputTokens: input.modelObservation.outputTokens ?? visibleUsage.outputTokens,
        totalTokens: input.modelObservation.totalTokens ?? visibleUsage.totalTokens,
        observedMessageCount: input.modelObservation.usageReportedCalls,
        source: 'callback'
      }
    : visibleUsage

  return {
    route: input.route.name,
    expectedAgents: [...input.route.expectedAgents],
    observedAgents,
    unexpectedAgents,
    delegationCount: taskAgents.length,
    matchedDelegationCount,
    delegationHitRate: input.route.expectedAgents.length > 0
      ? matchedDelegationCount / input.route.expectedAgents.length
      : 1,
    completed: input.completed,
    repairAttempted: input.repairAttempted,
    repairSucceeded: input.repairAttempted && input.completed,
    latencyMs: { ...input.latencyMs },
    modelCalls: {
      orchestrator: orchestratorCalls,
      delegated: taskAgents.length,
      repair: repairCalls,
      minimumTotal: orchestratorCalls + taskAgents.length + repairCalls,
      ...(input.modelObservation ? {
        total: input.modelObservation.totalCalls,
        completed: input.modelObservation.completedCalls,
        usageReported: input.modelObservation.usageReportedCalls
      } : {})
    },
    usage
  }
}

export const DASHBOARD_AGENT_EVAL_CASES: ReadonlyArray<{
  id: string
  task: string
  expectedAgent: DashboardAgentName
}> = [
  {
    id: 'resolve-session-context',
    task: '从候选连接中选择目标数据源，并识别缺失或矛盾的环境信息。',
    expectedAgent: 'session-context-agent'
  },
  {
    id: 'plan-read-only-probes',
    task: '把看板需求拆为只读探针步骤和组件布局。',
    expectedAgent: 'read-only-planner-agent'
  },
  {
    id: 'review-probe-risk',
    task: '审查探针命令的风险等级与审计理由。',
    expectedAgent: 'security-executor-agent'
  },
  {
    id: 'select-parser-and-narrative',
    task: '根据探针输出选择解析规则并生成状态解释。',
    expectedAgent: 'parser-narrator-agent'
  },
  {
    id: 'map-audit-review-items',
    task: '把待授权命令稳定映射为 widgetId:stepId。',
    expectedAgent: 'audit-bridge-agent'
  }
]

export function buildDashboardDelegationInstructions(route: DashboardAgentRoute): string {
  const taskByAgent = new Map(
    DASHBOARD_AGENT_EVAL_CASES.map((item) => [item.expectedAgent, item.task])
  )
  return [
    `代理委派路由：route=${route.name}`,
    '请通过 task 工具委派下列职责，并在最终 JSON 中综合各 agent 结果：',
    ...route.expectedAgents.map((agentName) => `- ${agentName}: ${taskByAgent.get(agentName)}`),
    '不要委派给路由清单之外的 agent；彼此无依赖的任务可以并行。'
  ].join('\n')
}
