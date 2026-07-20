import type {
  AppConfig,
  CommandConfig,
  CommandReviewItem,
  DashboardIntentProgressPayload,
  DashboardIntentRequest,
  DashboardIntentResponse,
  DashboardTab,
  ProbePlanStep
} from '../../shared/types'
import { inferRiskLevel } from './security-gate'
import { buildDashboardIntentByDeepAgents } from './deep-agent-intent'

type SelectedShellCommand = Pick<CommandConfig, 'name' | 'command' | 'tags'>

function normalizeText(text: string): string {
  return text.trim().toLowerCase()
}

export function resolveSelectedShellCommand(
  selectedShellCommandName: string | undefined,
  commands: CommandConfig[]
): SelectedShellCommand | undefined {
  const selectedName = normalizeText(selectedShellCommandName || '')
  if (!selectedName) return undefined
  const selected = commands.find((item) => normalizeText(item.name) === selectedName)
  if (!selected) return undefined
  return {
    name: selected.name,
    command: selected.command,
    tags: selected.tags || []
  }
}

export function resolveDashboardShellCommand(
  selectedShellCommandName: string | undefined,
  agentContextLabel: string,
  commands: CommandConfig[]
): SelectedShellCommand | undefined {
  const explicit = resolveSelectedShellCommand(selectedShellCommandName, commands)
  if (explicit) return explicit
  const selectedByAgent = resolveSelectedShellCommand(agentContextLabel, commands)
  if (selectedByAgent) return selectedByAgent
  if (commands.length === 0) return undefined
  throw new Error('Agent 未从候选连接中选择有效目标，探针未执行。请明确选择连接后重试。')
}

function escapeForDoubleQuoteShell(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
}

function buildRemoteStepCommand(step: ProbePlanStep): string {
  if (step.shellType === 'mysql') {
    return `mysql -N -e "${escapeForDoubleQuoteShell(step.command)}"`
  }
  if (step.shellType === 'redis') {
    return `redis-cli ${step.command}`
  }
  return step.command
}

export function composeStepCommand(baseCommand: string, step: ProbePlanStep): string {
  const trimmed = baseCommand.trim()
  if (!trimmed) return step.command
  if (/^\s*ssh(\s|$)/i.test(trimmed)) {
    const remote = buildRemoteStepCommand(step)
    return `${trimmed} "${escapeForDoubleQuoteShell(remote)}"`
  }
  return `${trimmed} && ${step.command}`
}

function applyConnectionCommand(dashboard: DashboardTab, selectedShell?: SelectedShellCommand): DashboardTab {
  if (!selectedShell?.command) return dashboard
  const datasourceId = selectedShell.name || dashboard.contextLabel
  return {
    ...dashboard,
    contextLabel: datasourceId,
    updatedAt: Date.now(),
    widgets: dashboard.widgets.map((widget) => ({
      ...widget,
      datasourceId,
      probe: {
        ...widget.probe,
        steps: widget.probe.steps.map((step) => ({
          ...step,
          command: composeStepCommand(selectedShell.command, step)
        }))
      }
    }))
  }
}

function sanitizeDashboardForAgent(dashboard: DashboardTab | null | undefined): DashboardTab | null | undefined {
  if (!dashboard) return dashboard
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) => ({
      ...widget,
      probe: {
        ...widget.probe,
        steps: widget.probe.steps.map((step) => ({ ...step, command: '' }))
      }
    }))
  }
}

function assessRenderability(dashboard: DashboardTab): {
  widgetsCount: number
  gridLayoutCount: number
  renderedWidgetCount: number
  layoutMatch: boolean
  isBlankCanvas: boolean
} {
  const widgetIds = new Set(dashboard.widgets.map((item) => item.id))
  const layoutIds = dashboard.gridLayout.map((item) => item.i)
  const renderedWidgetCount = layoutIds.filter((id) => widgetIds.has(id)).length
  const layoutMatch =
    dashboard.widgets.length === renderedWidgetCount &&
    dashboard.gridLayout.length === dashboard.widgets.length &&
    new Set(layoutIds).size === layoutIds.length
  return {
    widgetsCount: dashboard.widgets.length,
    gridLayoutCount: dashboard.gridLayout.length,
    renderedWidgetCount,
    layoutMatch,
    isBlankCanvas: dashboard.widgets.length > 0 && renderedWidgetCount === 0
  }
}

export async function buildDashboardIntent(
  request: DashboardIntentRequest,
  config: AppConfig,
  onProgress?: (payload: DashboardIntentProgressPayload) => void
): Promise<DashboardIntentResponse> {
  const startedAt = Date.now()
  const creationMode = request.creationMode || 'chat'
  const resolvedUserQuery =
    creationMode === 'auto'
      ? request.userQuery.trim() || '请基于当前上下文生成运维看板。'
      : request.userQuery
  const selectedShell = resolveSelectedShellCommand(request.context.selectedShellCommandName, config.commands)
  const enrichedRequest: DashboardIntentRequest = {
    ...request,
    userQuery: resolvedUserQuery,
    context: {
      ...request.context,
      selectedShellCommandName: selectedShell?.name,
      currentDashboardState: sanitizeDashboardForAgent(request.context.currentDashboardState),
      availableShellCommands: config.commands.map((item) => ({
        name: item.name,
        tags: item.tags || []
      }))
    }
  }
  console.info('[dashboard][intent] shell context resolved', {
    selectedShellCommandName: selectedShell?.name || '(none)',
    uploadedCommands: config.commands.length,
    threadId: request.threadId || '(none)'
  })
  console.info('[dashboard][intent] last generation feedback', {
    threadId: request.threadId || '(none)',
    parse: enrichedRequest.context.lastGenerationFeedback?.parse || null,
    render: enrichedRequest.context.lastGenerationFeedback?.render || null
  })
  const hasKey = Boolean(config.settings.llm.apiKey && !config.settings.llm.apiKey.includes('xxxxx'))
  const intentEngine = 'deepagents'
  console.info('[dashboard][intent] incoming request', {
    actionType: enrichedRequest.actionType,
    queryPreview: enrichedRequest.userQuery.slice(0, 80),
    queryLength: enrichedRequest.userQuery.length,
    threadId: request.threadId || '(none)',
    hasHistory: Boolean(enrichedRequest.history?.length),
    historyLength: enrichedRequest.history?.length || 0,
    hasApiKey: hasKey,
    model: config.settings.llm.model,
    provider: config.settings.llm.provider || 'openai',
    engine: intentEngine
  })
  if (!hasKey) {
    throw new Error('未配置可用 LLM API Key，无法调用 DeepAgents 生成看板。')
  }
  const intentResult = await buildDashboardIntentByDeepAgents(enrichedRequest, config, onProgress)
  console.info('[dashboard][intent] engine done', {
    threadId: intentResult.threadId || request.threadId || '(none)',
    engine: 'deepagents',
    assistantPreview: (intentResult.assistantReply || '').slice(0, 200),
    model: intentResult.stats?.model || config.settings.llm.model,
    provider: intentResult.stats?.provider || (config.settings.llm.provider || 'openai'),
    parsedBy: intentResult.diagnostics?.parsedBy,
    repairAttempted: intentResult.diagnostics?.repairAttempted,
    semanticErrorCount: intentResult.diagnostics?.semanticErrorCount
  })
  const effectiveShell = resolveDashboardShellCommand(
    selectedShell?.name,
    intentResult.dashboard.contextLabel,
    config.commands
  )
  const draftDashboard = applyConnectionCommand(intentResult.dashboard, effectiveShell)
  const renderability = assessRenderability(draftDashboard)
  const { assistantReply, stats, threadId } = intentResult
  const commandsToReview: CommandReviewItem[] = []

  draftDashboard.widgets.forEach((widget) => {
    widget.probe.steps.forEach((step) => {
      const inferred = inferRiskLevel(step.command)
      if (step.riskLevel !== 'blocked' && inferred === 'blocked') {
        step.riskLevel = 'blocked'
      } else if (step.riskLevel === 'safe' && inferred === 'review') {
        step.riskLevel = 'review'
      }
      if (step.riskLevel === 'review' || step.riskLevel === 'blocked') {
        commandsToReview.push({
          widgetTitle: widget.title,
          widgetId: widget.id,
          stepId: step.stepId,
          commandToExecute: step.command,
          riskLevel: step.riskLevel,
          riskReason: step.riskLevel === 'blocked' ? '命中高危命令策略，默认拦截。' : '该命令可能产生较高负载，请确认后执行。'
        })
      }
    })
  })

  console.info('[dashboard][intent] response ready', {
    threadId: threadId || request.threadId || '(none)',
    widgets: draftDashboard.widgets.length,
    widgetIds: draftDashboard.widgets.map((item) => item.id),
    totalSteps: draftDashboard.widgets.reduce((sum, item) => sum + item.probe.steps.length, 0),
    renderability,
    commandsToReview: commandsToReview.length,
    durationMs: stats?.durationMs,
    totalElapsedMs: Date.now() - startedAt
  })

  return {
    success: true,
    draftDashboard,
    commandsToReview,
    threadId,
    assistantReply:
      effectiveShell?.name && assistantReply
        ? `${assistantReply}\n\n已使用连接命令：${effectiveShell.name}`
        : assistantReply,
    stats,
    intentDiagnostics: {
      engine: 'deepagents',
      parsedBy: intentResult.diagnostics?.parsedBy,
      repairAttempted: intentResult.diagnostics?.repairAttempted || false,
      semanticErrorCount: intentResult.diagnostics?.semanticErrorCount || 0,
      semanticErrors: intentResult.diagnostics?.semanticErrors || [],
      localFixCount: intentResult.diagnostics?.localFixCount || 0,
      localFixes: intentResult.diagnostics?.localFixes || []
    }
  }
}
