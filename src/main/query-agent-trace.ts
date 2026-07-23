import { Client, RunTree, type RunTreeConfig } from 'langsmith'
import type { QueryAgentPhase, QueryAiStats } from '../shared/types'
import { buildTerminalContextLines } from '../shared/terminal-context'
import { anonymizeLangSmithPayload } from './langsmith-tracing'

interface QueryTraceRunTree {
  client?: QueryTraceClient
  createChild(config: RunTreeConfig): QueryTraceRunTree
  end(
    outputs?: Record<string, unknown>,
    error?: string,
    endTime?: number,
    metadata?: Record<string, unknown>
  ): Promise<void>
  patchRun(): Promise<void>
  postRun(): Promise<void>
}

interface QueryTraceClient {
  awaitPendingTraceBatches(): Promise<void>
  cleanup?(): void
}

export interface QueryAgentTraceConnection {
  apiKey: string
  endpoint?: string
  project?: string
}

export interface QueryAgentTraceStart {
  agentRunId: string
  langsmithApiKey?: string
  langsmithEndpoint?: string
  langsmithProject?: string
  input?: string
  selectedCommand?: string
  provider?: string
  model?: string
}

export interface QueryAgentToolTrace {
  agentRunId: string
  stepIndex: number
  command: string
  output: string
  status: 'completed' | 'waiting_for_review' | 'failed' | 'cancelled'
  durationMs: number
}

export interface QueryAgentTraceFinish {
  agentRunId: string
  phase: QueryAgentPhase
  executedCommandCount: number
  stepCount?: number
  durationMs?: number
  stats?: QueryAiStats
  finalAnswer?: string
  error?: unknown
}

export type QueryAgentRunTreeFactory<TRunTree extends QueryTraceRunTree = RunTree> = (
  config: RunTreeConfig,
  connection: QueryAgentTraceConnection
) => TRunTree

export class QueryAgentTraceStore<TRunTree extends QueryTraceRunTree = RunTree> {
  private readonly roots = new Map<string, TRunTree>()
  private readonly lastToolStepByRunId = new Map<string, number>()
  private readonly clients = new Set<QueryTraceClient>()

  constructor(
    private readonly createRunTree: QueryAgentRunTreeFactory<TRunTree> = (
      (config: RunTreeConfig, connection: QueryAgentTraceConnection) => new RunTree({
        ...config,
        client: new Client({
          apiKey: connection.apiKey,
          ...(connection.endpoint ? { apiUrl: connection.endpoint } : {}),
          anonymizer: anonymizeLangSmithPayload,
          hideInputs: false,
          hideOutputs: false
        })
      })
    ) as unknown as QueryAgentRunTreeFactory<TRunTree>
  ) {}

  getRoot(agentRunId: string): TRunTree | undefined {
    return this.roots.get(agentRunId)
  }

  async start(input: QueryAgentTraceStart): Promise<TRunTree | undefined> {
    const apiKey = input.langsmithApiKey?.trim()
    if (!apiKey || apiKey.toLowerCase().includes('xxxxx')) return undefined

    const existing = this.roots.get(input.agentRunId)
    if (existing) return existing

    const connection: QueryAgentTraceConnection = {
      apiKey,
      ...(input.langsmithEndpoint?.trim() ? { endpoint: input.langsmithEndpoint.trim() } : {}),
      ...(input.langsmithProject?.trim() ? { project: input.langsmithProject.trim() } : {})
    }
    const root = this.createRunTree({
      name: 'shell-manage.query-agent',
      run_type: 'chain',
      tracingEnabled: true,
      ...(connection.project ? { project_name: connection.project } : {}),
      inputs: input.input ? { input: redactTraceText(input.input) } : undefined,
      tags: ['shell-manage', 'query-agent'],
      metadata: {
        agentRunId: redactTraceText(input.agentRunId),
        ...(input.selectedCommand ? { selectedCommand: redactTraceText(input.selectedCommand) } : {}),
        ...(input.provider ? { provider: redactTraceText(input.provider) } : {}),
        ...(input.model ? { model: redactTraceText(input.model) } : {})
      }
    }, connection)
    if (root.client) this.clients.add(root.client)
    this.roots.set(input.agentRunId, root)
    this.lastToolStepByRunId.set(input.agentRunId, 0)
    try {
      await root.postRun()
      return root
    } catch (error) {
      this.roots.delete(input.agentRunId)
      this.lastToolStepByRunId.delete(input.agentRunId)
      throw error
    }
  }

  async recordToolRun(input: QueryAgentToolTrace): Promise<boolean> {
    const root = this.roots.get(input.agentRunId)
    if (!root) return false
    const previousStep = this.lastToolStepByRunId.get(input.agentRunId) ?? 0
    if (input.stepIndex < 1 || input.stepIndex > 3 || input.stepIndex <= previousStep) return false
    this.lastToolStepByRunId.set(input.agentRunId, input.stepIndex)

    const child = root.createChild({
      name: 'shell-manage.query-agent.command',
      run_type: 'tool',
      inputs: { command: redactTraceText(input.command) }
    })
    const metadata = { status: input.status, durationMs: input.durationMs, stepIndex: input.stepIndex }
    await child.postRun()
    await child.end({
      output: redactTraceText(input.output),
      ...metadata
    }, undefined, undefined, metadata)
    await child.patchRun()
    return true
  }

  async finish(input: QueryAgentTraceFinish): Promise<boolean> {
    const root = this.roots.get(input.agentRunId)
    if (!root) return false
    this.roots.delete(input.agentRunId)
    this.lastToolStepByRunId.delete(input.agentRunId)

    const stats = sanitizeTraceStats(input.stats)
    const result = {
      phase: input.phase,
      executedCommandCount: input.executedCommandCount,
      ...(input.stepCount === undefined ? {} : { stepCount: input.stepCount }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(stats === undefined ? {} : { stats }),
      ...(input.finalAnswer === undefined ? {} : { finalAnswer: redactTraceText(input.finalAnswer) })
    }
    const metadata = {
      phase: input.phase,
      executedCommandCount: input.executedCommandCount,
      ...(input.stepCount === undefined ? {} : { stepCount: input.stepCount }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(stats === undefined ? {} : { stats })
    }
    try {
      await root.end(result, formatTraceError(input.error), undefined, metadata)
      await root.patchRun()
    } finally {
      if (root.client) {
        try {
          await root.client.awaitPendingTraceBatches()
        } finally {
          root.client.cleanup?.()
          this.clients.delete(root.client)
        }
      }
    }
    return true
  }

  async finishAll(reason: string): Promise<void> {
    const agentRunIds = [...this.roots.keys()]
    await Promise.allSettled(agentRunIds.map((agentRunId) => this.finish({
      agentRunId,
      phase: 'cancelled',
      executedCommandCount: 0,
      error: reason
    })))
  }

  async flushPending(): Promise<void> {
    const clients = [...this.clients]
    this.clients.clear()
    await Promise.allSettled(clients.map(async (client) => {
      await client.awaitPendingTraceBatches()
      client.cleanup?.()
    }))
  }
}

function redactTraceText(value: string): string {
  const withoutRecognizableKeys = value.replace(
    /\b(?:lsv2_(?:pt|sk)_|github_pat_|gh[pousr]_|AIza|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/giu,
    '[REDACTED]'
  )
  return buildTerminalContextLines(withoutRecognizableKeys).join('\n')
}

function formatTraceError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) return redactTraceText(`${error.name}: ${error.message}`)
  if (typeof error === 'string') return redactTraceText(error)
  try {
    return redactTraceText(JSON.stringify(error) ?? String(error))
  } catch {
    return redactTraceText(String(error))
  }
}

function sanitizeTraceStats(stats: QueryAiStats | undefined): QueryAiStats | undefined {
  if (!stats) return undefined
  const optionalCount = (value: number | undefined): number | undefined => (
    Number.isFinite(value) ? Math.max(0, value as number) : undefined
  )
  return {
    durationMs: Number.isFinite(stats.durationMs) ? Math.max(0, stats.durationMs) : 0,
    ...(optionalCount(stats.inputTokens) === undefined ? {} : { inputTokens: optionalCount(stats.inputTokens) }),
    ...(optionalCount(stats.outputTokens) === undefined ? {} : { outputTokens: optionalCount(stats.outputTokens) }),
    ...(optionalCount(stats.totalTokens) === undefined ? {} : { totalTokens: optionalCount(stats.totalTokens) }),
    ...(optionalCount(stats.estimatedTokens) === undefined ? {} : { estimatedTokens: optionalCount(stats.estimatedTokens) }),
    provider: stats.provider === 'deepseek' ? 'deepseek' : 'openai',
    model: typeof stats.model === 'string' ? redactTraceText(stats.model) : ''
  }
}
