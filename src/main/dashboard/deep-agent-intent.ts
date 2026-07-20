import { AIMessage, HumanMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type { SubAgent } from 'deepagents'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AppConfig,
  DashboardIntentProgressPayload,
  DashboardIntentRequest,
  DashboardTab,
  QueryAiStats
} from '../../shared/types'
import { applyLangSmithEnvironment } from '../langsmith-env'

type DashboardIntentPayload = {
  assistantReply: string
  dashboard: DashboardTab
}

type SemanticValidationResult = {
  ok: boolean
  errors: string[]
}

type LocalSemanticRepairResult = {
  dashboard: DashboardTab
  fixes: string[]
}

const INVOKE_TIMEOUT_MS = 90_000
const INVOKE_HEARTBEAT_MS = 10_000
const GRID_COLS = 24
const MODEL_TIMEOUT_MS = Number(process.env.DASHBOARD_DEEPAGENT_MODEL_TIMEOUT_MS || 45_000)
const MODEL_MAX_RETRIES = Number(process.env.DASHBOARD_DEEPAGENT_MODEL_MAX_RETRIES || 0)

const dashboardSubagents: SubAgent[] = [
  {
    name: 'session-context-agent',
    description: '收敛目标主机、连接上下文与数据源标识，避免在目标不明确时盲目生成命令。',
    systemPrompt: [
      '你是 SessionContextAgent。',
      '目标：提炼 targetDatasourceId、候选连接名称与 envInfo。',
      '如果上下文缺失或矛盾，必须明确指出并要求澄清。',
      '禁止生成执行命令，仅输出结构化上下文建议。'
    ].join('\n')
  },
  {
    name: 'read-only-planner-agent',
    description: '将需求转换为只读探针计划（支持 multi-step）并给出组件布局建议。',
    systemPrompt: [
      '你是 ReadOnlyPlannerAgent。',
      '你只能设计只读运维探针，不允许写操作、删除、重启、变更配置。',
      '根据用户目标和上下文自主选择观测信号，不要擅自补齐固定指标清单。',
      '必要时使用 multi-step 并给出 dependsOn。'
    ].join('\n')
  },
  {
    name: 'security-executor-agent',
    description: '从安全角度审视 probe steps，标注 safe/review/blocked 并给出审计原因。',
    systemPrompt: [
      '你是 SecurityExecutorAgent。',
      '你需要审查命令风险，并输出可审计的风险理由。',
      '高危行为必须 blocked；不确定但可能影响较大则 review；常规只读查询可 safe。'
    ].join('\n')
  },
  {
    name: 'parser-narrator-agent',
    description: '为每个组件选择 parserRule，并生成面向用户的状态解释文案。',
    systemPrompt: [
      '你是 ParserNarratorAgent。',
      '目标：为每个 widget 选择合适 parserRule（regex/json/awk-table）。',
      '请保证规则与命令输出形态一致，并给出简洁可读的解释文案建议。'
    ].join('\n')
  },
  {
    name: 'audit-bridge-agent',
    description: '确保右侧审计面板可映射 widgetId:stepId，突出待授权命令。',
    systemPrompt: [
      '你是 AuditBridgeAgent。',
      '你负责确保审计信息可稳定映射到 widgetId:stepId。',
      '对 review/blocked 命令必须可追溯，并提供清晰的风险提示。'
    ].join('\n')
  }
]

type DeepAgentLike = {
  invoke: (...args: any[]) => Promise<any>
}

const agentCache = new Map<string, DeepAgentLike>()
let deepAgentsModulePromise: Promise<typeof import('deepagents')> | null = null
let sqliteSaverPromise: Promise<unknown> | null = null

function emitProgress(
  onProgress: ((payload: DashboardIntentProgressPayload) => void) | undefined,
  payload: Omit<DashboardIntentProgressPayload, 'at'>
): void {
  if (!onProgress) return
  onProgress({
    ...payload,
    at: Date.now()
  })
}

function maskEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) return '(default)'
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '(invalid-url)'
  }
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack || ''}`
  return String(error)
}

function createModel(config: AppConfig): ChatOpenAI {
  const provider = config.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
  const endpoint = String(config.settings.llm.endpoint || '').trim() || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : '')
  const rawApiKey = String(config.settings.llm.apiKey || '')
  console.info('[dashboard][intent][deepagents] llm config', {
    provider,
    endpoint: maskEndpoint(endpoint),
    model: config.settings.llm.model,
    apiKeyConfigured: Boolean(rawApiKey.trim()),
    timeoutMs: MODEL_TIMEOUT_MS,
    maxRetries: MODEL_MAX_RETRIES
  })
  return new ChatOpenAI({
    model: config.settings.llm.model,
    apiKey: rawApiKey,
    temperature: 0.1,
    maxRetries: MODEL_MAX_RETRIES,
    timeout: MODEL_TIMEOUT_MS,
    streamUsage: false,
    configuration: endpoint ? { baseURL: endpoint } : undefined
  })
}

function createThreadId(): string {
  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getDashboardAgentCacheKey(config: AppConfig): string {
  const apiKeyFingerprint = createHash('sha256').update(config.settings.llm.apiKey || '').digest('hex')
  return [
    config.settings.llm.provider || 'openai',
    config.settings.llm.endpoint || '',
    config.settings.llm.model || '',
    apiKeyFingerprint
  ].join('::')
}

async function loadDeepAgentsModule(): Promise<typeof import('deepagents')> {
  if (!deepAgentsModulePromise) {
    console.info('[dashboard][intent][deepagents] loading deepagents module...')
    deepAgentsModulePromise = import('deepagents')
  }
  return deepAgentsModulePromise
}

function resolveShellManageHome(): string {
  const fromEnv = (process.env.SHELL_MANAGE_HOME || '').trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.shell-manage')
}

function resolveCheckpointSqlitePath(): string {
  const root = resolveShellManageHome()
  mkdirSync(root, { recursive: true })
  return join(root, 'dashboard-langgraph-checkpoints.sqlite')
}

async function getSqliteSaver(): Promise<unknown> {
  if (!sqliteSaverPromise) {
    const connPath = resolveCheckpointSqlitePath()
    console.info('[dashboard][intent][deepagents] init sqlite checkpointer', {
      dbPath: connPath
    })
    sqliteSaverPromise = Promise.resolve().then(() => {
      // Use require for compatibility with current Electron CJS main runtime.
      const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite') as {
        SqliteSaver: { fromConnString: (connStringOrLocalPath: string) => unknown }
      }
      return SqliteSaver.fromConnString(connPath)
    })
  }
  return sqliteSaverPromise
}

async function getAgent(config: AppConfig): Promise<DeepAgentLike> {
  applyLangSmithEnvironment(config.settings.langsmith)
  const key = getDashboardAgentCacheKey(config)
  const existing = agentCache.get(key)
  if (existing) {
    console.info('[dashboard][intent][deepagents] reuse cached agent', {
      provider: config.settings.llm.provider || 'openai',
      model: config.settings.llm.model,
      endpoint: maskEndpoint(config.settings.llm.endpoint || '')
    })
    return existing
  }

  const { createDeepAgent } = await loadDeepAgentsModule()
  const sqliteSaver = await getSqliteSaver()
  console.info('[dashboard][intent][deepagents] create new agent', {
    provider: config.settings.llm.provider || 'openai',
    model: config.settings.llm.model,
    endpoint: maskEndpoint(config.settings.llm.endpoint || ''),
    checkpointer: 'SqliteSaver'
  })
  const agent = createDeepAgent({
    model: createModel(config),
    checkpointer: sqliteSaver as any,
    subagents: dashboardSubagents,
    systemPrompt: [
      '你是“可视化看板”的主编排 Agent，负责将用户意图转换为 DashboardTab JSON。',
      '你必须遵守以下规则：',
      '1) 仅输出 JSON，不输出 Markdown；',
      '1.1) 不要输出推理过程、计划过程、解释过程；只返回最终 JSON。',
      '2) 命令默认只读，禁止破坏性动作；',
      '3) 允许 multi-step 探针并使用 dependsOn；',
      '4) 风险等级仅 safe/review/blocked；',
      '5) kind 仅 metric/table/timeseries/event；',
      '6) parserRule.type 仅 regex/json/awk-table；',
      '7) 先在内部完成上下文澄清、规划和安全审查，再直接输出最终 JSON。',
      '8) 除非必须，不要调用 task/write_todos/filesystem 相关工具。',
      '9) context.availableShellCommands 只包含候选连接的名称与标签；优先使用 context.selectedShellCommandName。未指定时由你选择，并将 dashboard.contextLabel 设为候选名称；probe.steps[].command 仅输出探针本体，不要拼接连接命令。',
      '10) 为避免泄露凭据，context.currentDashboardState 中已有 command 可能为空；更新看板时请依据组件语义重新生成只读探针。'
    ].join('\n')
  })
  agentCache.set(key, agent)
  return agent
}

function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part.type === 'text' && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
}

function extractLastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message instanceof AIMessage) return contentToText(message.content).trim()
    if (
      message &&
      typeof message === 'object' &&
      'content' in message &&
      'type' in message &&
      typeof (message as { type?: unknown }).type === 'string' &&
      String((message as { type?: string }).type).toLowerCase() === 'ai'
    ) {
      return contentToText((message as { content: MessageContent }).content).trim()
    }
  }
  return ''
}

function parseIntentPayload(text: string): DashboardIntentPayload | null {
  const cleaned = text
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim()
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const asObj = parsed as Record<string, unknown>
    if (asObj.dashboard && typeof asObj.dashboard === 'object') {
      const dashboard = asObj.dashboard as DashboardTab
      if (!Array.isArray(dashboard.widgets) || !Array.isArray(dashboard.gridLayout)) return null
      const assistantReply =
        typeof asObj.assistantReply === 'string' && asObj.assistantReply.trim().length > 0
          ? asObj.assistantReply
          : `已生成看板草稿（组件 ${dashboard.widgets.length} 个）。`
      return { assistantReply, dashboard }
    }
    const dashboard = parsed as DashboardTab
    if (!Array.isArray(dashboard.widgets) || !Array.isArray(dashboard.gridLayout)) return null
    return {
      assistantReply: `已生成看板草稿（组件 ${dashboard.widgets.length} 个）。`,
      dashboard
    }
  } catch {
    return null
  }
}

function minSpanByKind(kind: DashboardTab['widgets'][number]['kind']): { w: number; h: number } {
  if (kind === 'metric') return { w: 6, h: 3 }
  if (kind === 'table') return { w: 8, h: 4 }
  if (kind === 'timeseries') return { w: 8, h: 4 }
  return { w: 8, h: 4 }
}

function isRiskLevel(value: unknown): value is 'safe' | 'review' | 'blocked' {
  return value === 'safe' || value === 'review' || value === 'blocked'
}

function isShellType(value: unknown): value is 'bash' | 'zsh' | 'mysql' | 'redis' {
  return value === 'bash' || value === 'zsh' || value === 'mysql' || value === 'redis'
}

function isOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function findNonOverlappingRect(
  candidate: { x: number; y: number; w: number; h: number },
  placed: Array<{ x: number; y: number; w: number; h: number }>
): { x: number; y: number; w: number; h: number } {
  const maxX = Math.max(0, GRID_COLS - candidate.w)
  const startX = Math.min(Math.max(0, candidate.x), maxX)
  const startY = Math.max(0, candidate.y)
  for (let y = startY; y <= 200; y += 1) {
    const xBegin = y === startY ? startX : 0
    for (let x = xBegin; x <= maxX; x += 1) {
      const rect = { x, y, w: candidate.w, h: candidate.h }
      if (!placed.some((item) => isOverlap(rect, item))) {
        return rect
      }
    }
  }
  const fallbackY = placed.reduce((max, item) => Math.max(max, item.y + item.h), 0)
  return { x: 0, y: fallbackY, w: candidate.w, h: candidate.h }
}

function validateDashboardSemantics(dashboard: DashboardTab): SemanticValidationResult {
  const errors: string[] = []
  const widgets = Array.isArray(dashboard.widgets) ? dashboard.widgets : []
  const gridLayout = Array.isArray(dashboard.gridLayout) ? dashboard.gridLayout : []

  const widgetIds: string[] = []
  const widgetIdSet = new Set<string>()
  for (const widget of widgets) {
    const widgetId = String(widget?.id || '').trim()
    if (!widgetId) {
      errors.push('存在空的 widget.id')
      continue
    }
    if (widgetIdSet.has(widgetId)) errors.push(`widget.id 重复: ${widgetId}`)
    widgetIdSet.add(widgetId)
    widgetIds.push(widgetId)

    const steps = Array.isArray(widget.probe?.steps) ? widget.probe.steps : []
    if (steps.length === 0) {
      errors.push(`widget(${widgetId}) 缺少 probe.steps`)
      continue
    }
    const stepIdSet = new Set<string>()
    for (const step of steps) {
      const stepId = String(step?.stepId || '').trim()
      if (!stepId) {
        errors.push(`widget(${widgetId}) 存在空的 stepId`)
        continue
      }
      const command = String(step?.command || '').trim()
      if (!command) errors.push(`widget(${widgetId}) step(${stepId}) 缺少 command`)
      if (!isRiskLevel((step as { riskLevel?: unknown }).riskLevel)) {
        errors.push(`widget(${widgetId}) step(${stepId}) riskLevel 非法: ${String((step as { riskLevel?: unknown }).riskLevel)}`)
      }
      if (!isShellType((step as { shellType?: unknown }).shellType)) {
        errors.push(`widget(${widgetId}) step(${stepId}) shellType 非法: ${String((step as { shellType?: unknown }).shellType)}`)
      }
      const timeoutMs = Number((step as { timeoutMs?: unknown }).timeoutMs)
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        errors.push(`widget(${widgetId}) step(${stepId}) timeoutMs 非法: ${String((step as { timeoutMs?: unknown }).timeoutMs)}`)
      }
      const dependsOn = (step as { dependsOn?: unknown }).dependsOn
      if (
        dependsOn !== undefined &&
        (!Array.isArray(dependsOn) || dependsOn.some((dependency) => typeof dependency !== 'string' || !dependency.trim()))
      ) {
        errors.push(`widget(${widgetId}) step(${stepId}) dependsOn 格式非法`)
      }
      if (stepIdSet.has(stepId)) errors.push(`widget(${widgetId}) 内 stepId 重复: ${stepId}`)
      stepIdSet.add(stepId)
    }
    for (const step of steps) {
      const dependsOn = (step as { dependsOn?: unknown }).dependsOn
      if (!Array.isArray(dependsOn)) continue
      for (const dependency of dependsOn) {
        if (typeof dependency === 'string' && !stepIdSet.has(dependency)) {
          errors.push(`widget(${widgetId}) step(${String(step.stepId || '')}) 依赖不存在: ${dependency}`)
        }
      }
    }
  }

  const layoutIds: string[] = []
  const layoutIdSet = new Set<string>()
  const layoutRects: Array<{ i: string; x: number; y: number; w: number; h: number }> = []
  for (const item of gridLayout) {
    const i = String(item?.i || '').trim()
    if (!i) {
      errors.push('存在空的 gridLayout.i')
      continue
    }
    if (layoutIdSet.has(i)) errors.push(`gridLayout.i 重复: ${i}`)
    layoutIdSet.add(i)
    layoutIds.push(i)
    if (![item.x, item.y, item.w, item.h].every((n) => Number.isFinite(n))) {
      errors.push(`gridLayout(${i}) 坐标含非数字`)
      continue
    }
    if (item.w <= 0 || item.h <= 0) errors.push(`gridLayout(${i}) 宽高必须 > 0`)
    if (item.x < 0 || item.y < 0) errors.push(`gridLayout(${i}) 坐标不能为负数`)
    if (item.x + item.w > GRID_COLS) errors.push(`gridLayout(${i}) 超出栅格边界(${GRID_COLS})`)
    const matchedWidget = widgets.find((widget) => String(widget.id || '').trim() === i)
    if (matchedWidget) {
      const minSpan = minSpanByKind(matchedWidget.kind)
      if (item.w < minSpan.w || item.h < minSpan.h) {
        errors.push(`gridLayout(${i}) 尺寸过小，${matchedWidget.kind} 最小为 ${minSpan.w}x${minSpan.h}`)
      }
    }
    layoutRects.push({ i, x: item.x, y: item.y, w: item.w, h: item.h })
  }

  for (let index = 0; index < layoutRects.length; index += 1) {
    for (let next = index + 1; next < layoutRects.length; next += 1) {
      if (isOverlap(layoutRects[index], layoutRects[next])) {
        errors.push(`gridLayout 存在重叠: ${layoutRects[index].i} <-> ${layoutRects[next].i}`)
      }
    }
  }

  for (const widgetId of widgetIds) {
    if (!layoutIdSet.has(widgetId)) errors.push(`gridLayout 缺少 widget 映射: ${widgetId}`)
  }
  for (const layoutId of layoutIds) {
    if (!widgetIdSet.has(layoutId)) errors.push(`gridLayout 存在无效 i: ${layoutId}`)
  }

  return {
    ok: errors.length === 0,
    errors
  }
}

function applyLocalSemanticRepair(dashboard: DashboardTab): LocalSemanticRepairResult {
  const fixes: string[] = []
  const widgets = Array.isArray(dashboard.widgets)
    ? dashboard.widgets.map((widget) => ({
        ...widget,
        probe: {
          ...widget.probe,
          steps: Array.isArray(widget.probe?.steps) ? [...widget.probe.steps] : []
        }
      }))
    : []
  const repaired: DashboardTab = {
    ...dashboard,
    widgets,
    gridLayout: Array.isArray(dashboard.gridLayout) ? [...dashboard.gridLayout] : []
  }

  const widgetById = new Map(repaired.widgets.map((widget) => [String(widget.id || '').trim(), widget]))
  const existingLayout = new Map(
    repaired.gridLayout
      .map((item) => ({
        i: String(item?.i || '').trim(),
        x: Number.isFinite(item?.x) ? Math.floor(item.x) : 0,
        y: Number.isFinite(item?.y) ? Math.floor(item.y) : 0,
        w: Number.isFinite(item?.w) ? Math.floor(item.w) : 6,
        h: Number.isFinite(item?.h) ? Math.floor(item.h) : 3
      }))
      .filter((item) => item.i)
      .map((item) => [item.i, item])
  )
  const placed: Array<{ i: string; x: number; y: number; w: number; h: number }> = []
  const nextLayout: Array<{ i: string; x: number; y: number; w: number; h: number }> = []

  for (const widget of repaired.widgets) {
    const widgetId = String(widget.id || '').trim()
    if (!widgetId) continue
    const minSpan = minSpanByKind(widget.kind)
    const raw = existingLayout.get(widgetId)
    if (!raw) {
      fixes.push(`补全布局: widget(${widgetId}) 缺少 gridLayout，自动放置。`)
    }
    let w = Math.max(minSpan.w, raw?.w ?? minSpan.w)
    let h = Math.max(minSpan.h, raw?.h ?? minSpan.h)
    w = Math.min(Math.max(1, w), GRID_COLS)
    const sanitized = {
      x: Math.max(0, raw?.x ?? 0),
      y: Math.max(0, raw?.y ?? 0),
      w,
      h: Math.max(1, h)
    }
    if ((raw?.x ?? 0) < 0 || (raw?.y ?? 0) < 0 || (raw?.x ?? 0) + (raw?.w ?? 0) > GRID_COLS || (raw?.w ?? 0) < minSpan.w || (raw?.h ?? 0) < minSpan.h) {
      fixes.push(`修正布局尺寸: widget(${widgetId}) -> x=${sanitized.x}, y=${sanitized.y}, w=${sanitized.w}, h=${sanitized.h}`)
    }
    const placedRect = findNonOverlappingRect(sanitized, placed)
    if (placedRect.x !== sanitized.x || placedRect.y !== sanitized.y) {
      fixes.push(`修正布局重叠: widget(${widgetId}) 重新定位到 x=${placedRect.x}, y=${placedRect.y}`)
    }
    const finalItem = {
      i: widgetId,
      ...placedRect
    }
    placed.push(finalItem)
    nextLayout.push(finalItem)
  }

  for (const layoutId of existingLayout.keys()) {
    if (!widgetById.has(layoutId)) {
      fixes.push(`移除无效布局项: ${layoutId}`)
    }
  }
  repaired.gridLayout = nextLayout

  return { dashboard: repaired, fixes }
}

function estimateTokens(input: string, output: string): number {
  return Math.max(1, Math.ceil((input.length + output.length) / 3))
}

function extractJsonCandidate(text: string): string | null {
  const cleaned = text.trim()
  if (!cleaned) return null
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!objectMatch) return null
  return objectMatch[0]
}

function promptPreviewFromRequest(request: DashboardIntentRequest): string {
  const summary = {
    actionType: request.actionType,
    creationMode: request.creationMode,
    userQuery: request.userQuery,
    selectedShellCommandName: request.context.selectedShellCommandName || '',
    targetDatasourceId: request.context.targetDatasourceId || '',
    historyLength: request.history?.length || 0,
    currentWidgets: request.context.currentDashboardState?.widgets?.length || 0,
    hasLastGenerationFeedback: Boolean(request.context.lastGenerationFeedback)
  }
  return JSON.stringify(summary).slice(0, 600)
}

async function repairPayloadByModel(
  request: DashboardIntentRequest,
  config: AppConfig,
  rawText: string,
  semanticErrors: string[] = []
): Promise<DashboardIntentPayload | null> {
  const model = createModel(config)
  const repairPrompt = [
    '你是 JSON 修复器。请把输入文本转换为合法 JSON。',
    '只输出 JSON，不要解释，不要 markdown，不要代码块。',
    '输出格式必须是：{"assistantReply":"string","dashboard":{...DashboardTab...}}',
    '约束：riskLevel=safe|review|blocked；kind=metric|table|timeseries|event；shellType=bash|zsh|mysql|redis。',
    '语义约束：dashboard.widgets[].id 必须与 dashboard.gridLayout[].i 一一对应，且无重复、无缺失。',
    `布局约束：24列栅格，x>=0,y>=0,w>0,h>0,x+w<=${GRID_COLS}，任意项不能重叠；metric 最小 6x3；table/timeseries/event 最小 8x4。`,
    '',
    '用户请求：',
    request.userQuery,
    '',
    '语义错误列表（必须全部修复）：',
    semanticErrors.length > 0 ? semanticErrors.map((item) => `- ${item}`).join('\n') : '- 无（结构修复）',
    '',
    '上一次生成反馈（用于避免重复失败）：',
    JSON.stringify(request.context.lastGenerationFeedback || null),
    '',
    '输入文本：',
    rawText
  ].join('\n')
  const repairResult = await model.invoke([new HumanMessage(repairPrompt)])
  const repairText = contentToText(repairResult.content)
  return parseIntentPayload(repairText) || parseIntentPayload(extractJsonCandidate(repairText) || '')
}

async function invokeWithDiagnostics(
  agent: DeepAgentLike,
  payload: unknown,
  config: unknown,
  threadId: string,
  onProgress?: (payload: DashboardIntentProgressPayload) => void
): Promise<unknown> {
  const invokeStartedAt = Date.now()
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error(`DeepAgents invoke timeout after ${INVOKE_TIMEOUT_MS}ms`))
    }, INVOKE_TIMEOUT_MS)
  })

  try {
    emitProgress(onProgress, {
      threadId,
      phase: 'invoke_start',
      message: 'DeepAgents 开始执行推理。'
    })
    heartbeatTimer = setInterval(() => {
      console.info('[dashboard][intent][deepagents] invoke in progress', {
        threadId,
        elapsedMs: Date.now() - invokeStartedAt
      })
      emitProgress(onProgress, {
        threadId,
        phase: 'invoke_heartbeat',
        message: `DeepAgents 执行中，已耗时 ${Date.now() - invokeStartedAt}ms。`
      })
    }, INVOKE_HEARTBEAT_MS)
    console.info('[dashboard][intent][deepagents] invoke start', {
      threadId,
      timeoutMs: INVOKE_TIMEOUT_MS
    })
    const result = await Promise.race([agent.invoke(payload as any, config as any), timeoutPromise])
    console.info('[dashboard][intent][deepagents] invoke done', {
      threadId,
      elapsedMs: Date.now() - invokeStartedAt
    })
    return result
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
}

export async function buildDashboardIntentByDeepAgents(
  request: DashboardIntentRequest,
  config: AppConfig,
  onProgress?: (payload: DashboardIntentProgressPayload) => void
): Promise<{
  dashboard: DashboardTab
  assistantReply: string
  stats: QueryAiStats
  threadId: string
  diagnostics: {
    parsedBy?: string
    repairAttempted: boolean
    semanticErrorCount: number
    semanticErrors?: string[]
    localFixCount?: number
    localFixes?: string[]
  }
}> {
  const provider = config.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
  const startedAt = Date.now()
  const threadId = request.threadId?.trim() || createThreadId()
  const phaseDurations: {
    agentInitMs?: number
    invokeMs?: number
    repairMs?: number
  } = {}
  let semanticValidation = {
    ok: false,
    errors: [] as string[]
  }
  let repairAttempted = false
  let localFixCount = 0
  const localFixes: string[] = []
  console.info('[dashboard][intent][deepagents] start', {
    threadId,
    actionType: request.actionType,
    queryPreview: request.userQuery.slice(0, 80),
    queryLength: request.userQuery.length,
    historyLength: request.history?.length || 0,
    currentWidgets: request.context.currentDashboardState?.widgets?.length || 0,
    model: config.settings.llm.model,
    provider,
    endpoint: maskEndpoint(config.settings.llm.endpoint || '')
  })
  emitProgress(onProgress, {
    threadId,
    phase: 'start',
    message: '已接收看板生成请求，准备构建 DeepAgents 输入。',
    inputPreview: promptPreviewFromRequest(request)
  })
  const agentInitStartedAt = Date.now()
  const agent = await getAgent(config)
  phaseDurations.agentInitMs = Date.now() - agentInitStartedAt
  console.info('[dashboard][intent][deepagents] phase done', {
    threadId,
    phase: 'agentInit',
    elapsedMs: phaseDurations.agentInitMs
  })
  emitProgress(onProgress, {
    threadId,
    phase: 'agent_init',
    message: 'DeepAgents 初始化完成，开始生成看板。'
  })
  const prompt = [
    '请根据输入生成最终 JSON，格式如下：',
    '{',
    '  "assistantReply": "string",',
    '  "dashboard": { ...DashboardTab... }',
    '}',
    '',
    '字段约束：',
    '- riskLevel 仅 safe/review/blocked',
    '- kind 仅 metric/table/timeseries/event',
    '- probe.mode 仅 single/multi-step',
    '- shellType 仅 bash/zsh/mysql/redis',
    '- 每个 probe step 必须包含：stepId, command, shellType, timeoutMs(>0), riskLevel',
    '- dashboard.widgets[].id 必须与 dashboard.gridLayout[].i 一一对应，且无重复、无缺失',
    '- gridLayout 使用 24 列栅格：x>=0,y>=0,w>0,h>0 且 x+w<=24',
    '- 任意两个 gridLayout 项不能重叠',
    '- metric 最小尺寸 6x3；table/timeseries/event 最小尺寸 8x4，禁止过窄卡片',
    '',
    '上一次生成反馈（用于纠错）：',
    JSON.stringify(request.context.lastGenerationFeedback || null),
    '',
    '输入上下文（JSON）：',
    JSON.stringify(request)
  ].join('\n')

  try {
    const invokePayload = {
      messages: [new HumanMessage(prompt)]
    }
    const invokeConfig = {
      configurable: {
        thread_id: threadId
      }
    }
    const invokeStartedAt = Date.now()
    const result = await invokeWithDiagnostics(agent, invokePayload, invokeConfig, threadId, onProgress)
    phaseDurations.invokeMs = Date.now() - invokeStartedAt
    console.info('[dashboard][intent][deepagents] phase done', {
      threadId,
      phase: 'invoke',
      elapsedMs: phaseDurations.invokeMs
    })

    const parsedFromStructured = parseIntentPayload(
      JSON.stringify((result as { structuredResponse?: unknown }).structuredResponse || null)
    )
    const assistantText = extractLastAssistantText((result as { messages?: BaseMessage[] }).messages)
    console.info('[dashboard][intent][deepagents] raw assistant output', {
      threadId,
      textLength: assistantText.length,
      textPreview: assistantText.slice(0, 320)
    })
    emitProgress(onProgress, {
      threadId,
      phase: 'raw_output',
      message: '已收到 DeepAgents 原始输出，正在解析与校验。',
      outputPreview: assistantText.slice(0, 240)
    })
    const parsedFromText = parseIntentPayload(assistantText)
    const parsedFromCandidate = parseIntentPayload(extractJsonCandidate(assistantText) || '')
    let parsed = parsedFromStructured || parsedFromText || parsedFromCandidate
    let parsedBy = parsedFromStructured ? 'structuredResponse' : parsedFromText ? 'assistantText' : parsedFromCandidate ? 'jsonCandidate' : ''
    if (parsed) {
      const localRepair = applyLocalSemanticRepair(parsed.dashboard)
      parsed.dashboard = localRepair.dashboard
      localFixCount += localRepair.fixes.length
      if (localRepair.fixes.length > 0) {
        localFixes.push(...localRepair.fixes)
        console.info('[dashboard][intent][deepagents] local semantic repair applied', {
          threadId,
          fixes: localRepair.fixes
        })
        emitProgress(onProgress, {
          threadId,
          phase: 'local_repair',
          message: `命中本地语义修复 ${localRepair.fixes.length} 项。`,
          localFixes: localRepair.fixes
        })
      }
      semanticValidation = validateDashboardSemantics(parsed.dashboard)
      if (!semanticValidation.ok) {
        console.warn('[dashboard][intent][deepagents] semantic validation failed, start repair', {
          threadId,
          errors: semanticValidation.errors
        })
      }
    }
    if (!parsed || !semanticValidation.ok) {
      repairAttempted = true
      console.warn('[dashboard][intent][deepagents] parse primary failed, start repair', {
        threadId,
        durationMs: Date.now() - startedAt,
        structuredResponseType: typeof (result as { structuredResponse?: unknown }).structuredResponse,
        assistantPreview: assistantText.slice(0, 240),
        semanticErrors: semanticValidation.errors
      })
      const repairStartedAt = Date.now()
      emitProgress(onProgress, {
        threadId,
        phase: 'llm_repair_start',
        message: '语义校验未通过，正在请求模型进行修复。'
      })
      parsed = await repairPayloadByModel(request, config, assistantText, semanticValidation.errors)
      if (parsed) {
        const localRepair = applyLocalSemanticRepair(parsed.dashboard)
        parsed.dashboard = localRepair.dashboard
        localFixCount += localRepair.fixes.length
        if (localRepair.fixes.length > 0) {
          localFixes.push(...localRepair.fixes)
          console.info('[dashboard][intent][deepagents] local semantic repair applied after llm repair', {
            threadId,
            fixes: localRepair.fixes
          })
          emitProgress(onProgress, {
            threadId,
            phase: 'local_repair',
            message: `修复结果再次命中本地语义修复 ${localRepair.fixes.length} 项。`,
            localFixes: localRepair.fixes
          })
        }
        semanticValidation = validateDashboardSemantics(parsed.dashboard)
      }
      phaseDurations.repairMs = Date.now() - repairStartedAt
      console.info('[dashboard][intent][deepagents] phase done', {
        threadId,
        phase: 'repair',
        elapsedMs: phaseDurations.repairMs,
        repaired: Boolean(parsed),
        semanticOkAfterRepair: parsed ? semanticValidation.ok : false,
        semanticErrorsAfterRepair: parsed ? semanticValidation.errors : ['repair parse failed']
      })
      emitProgress(onProgress, {
        threadId,
        phase: 'llm_repair_done',
        message: parsed
          ? semanticValidation.ok
            ? '模型修复完成且语义校验通过。'
            : `模型修复完成但仍有语义问题：${semanticValidation.errors.join('；')}`
          : '模型修复未产出可解析结果。'
      })
      parsedBy = parsed ? 'repairModel' : ''
    }
    if (!parsed || !semanticValidation.ok) {
      console.error('[dashboard][intent][deepagents] parse failed', {
        threadId,
        durationMs: Date.now() - startedAt,
        structuredResponseType: typeof (result as { structuredResponse?: unknown }).structuredResponse,
        assistantPreview: assistantText.slice(0, 240),
        semanticErrors: semanticValidation.errors
      })
      throw new Error(`deepagents 结果语义校验失败：${semanticValidation.errors.join('；') || '无法解析为合法 Dashboard JSON'}`)
    }

    console.info('[dashboard][intent][deepagents] success', {
      threadId,
      durationMs: Date.now() - startedAt,
      parsedBy,
      widgets: parsed.dashboard.widgets.length,
      widgetIds: parsed.dashboard.widgets.map((item) => item.id),
      totalSteps: parsed.dashboard.widgets.reduce((sum, item) => sum + item.probe.steps.length, 0),
      assistantPreview: parsed.assistantReply.slice(0, 200),
      localFixCount,
      phaseDurations
    })
    emitProgress(onProgress, {
      threadId,
      phase: 'done',
      message: `看板生成完成，组件 ${parsed.dashboard.widgets.length} 个。`,
      localFixes: localFixes.length > 0 ? localFixes : undefined
    })

    return {
      dashboard: parsed.dashboard,
      assistantReply: parsed.assistantReply,
      threadId,
      stats: {
        durationMs: Date.now() - startedAt,
        estimatedTokens: estimateTokens(request.userQuery, JSON.stringify(parsed.dashboard).slice(0, 2000)),
        provider,
        model: config.settings.llm.model
      },
      diagnostics: {
        parsedBy,
        repairAttempted,
        semanticErrors: semanticValidation.errors,
        semanticErrorCount: semanticValidation.errors.length,
        ...(localFixCount > 0 ? { localFixCount } : {}),
        ...(localFixes.length > 0 ? { localFixes } : {})
      }
    }
  } catch (error) {
    console.error('[dashboard][intent][deepagents] failed', {
      threadId,
      durationMs: Date.now() - startedAt,
      phaseDurations,
      error: toErrorText(error)
    })
    emitProgress(onProgress, {
      threadId,
      phase: 'error',
      message: `DeepAgents 执行失败：${error instanceof Error ? error.message : String(error)}`
    })
    throw error
  }
}
