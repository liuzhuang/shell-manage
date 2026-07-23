import '@langchain/core/context'
import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted
} from '@langchain/langgraph'
import type { QueryAgentPhase } from '../shared/types'
import type {
  QueryAgentExecutionResult,
  QueryAgentReviewRequest,
  QueryAgentRunResult,
  QueryAgentStep,
  RunQueryAgentOptions
} from '../shared/query-agent'

const MAX_OUTPUT_LINES_PER_STEP = 40

export async function runQueryAgent({
  requestStep,
  executeCommand,
  reviewCommand,
  onDuplicateCommand = () => {},
  onPhase = () => {},
  shouldContinue = () => true
}: RunQueryAgentOptions): Promise<QueryAgentRunResult> {
  const QueryAgentState = Annotation.Root({
    outputLines: Annotation<string[]>({ reducer: (current, next) => current.concat(next), default: () => [] }),
    executedCommandCount: Annotation<number>({ reducer: (_current, next) => next, default: () => 0 }),
    executedCommands: Annotation<string[]>({ reducer: (_current, next) => next, default: () => [] }),
    forceReply: Annotation<boolean>({ reducer: (_current, next) => next, default: () => false }),
    forceReplyNext: Annotation<boolean>({ reducer: (_current, next) => next, default: () => false }),
    step: Annotation<QueryAgentStep | undefined>({ reducer: (_current, next) => next, default: () => undefined }),
    execution: Annotation<QueryAgentExecutionResult | undefined>({ reducer: (_current, next) => next, default: () => undefined }),
    phase: Annotation<QueryAgentPhase>({ reducer: (_current, next) => next, default: () => 'generating_query' })
  })
  const graph = new StateGraph(QueryAgentState)
    .addNode('request', async (state) => {
      if (!await shouldContinue()) return { step: { type: 'cancelled' as const }, phase: 'cancelled' as const }
      const forceReply = state.executedCommandCount === 3 || state.forceReplyNext
      const step = await requestStep({ outputLines: state.outputLines, forceReply })
      if (!await shouldContinue()) return { step: { type: 'cancelled' as const }, phase: 'cancelled' as const }
      return { step, forceReply, forceReplyNext: false }
    })
    .addNode('finishStep', async (state) => {
      const phase = state.step?.type === 'reply' || state.step?.type === 'clarify'
        ? 'completed'
        : state.step?.type === 'waiting_for_review' || state.step?.type === 'failed' || state.step?.type === 'cancelled'
          ? state.step.type
          : 'failed'
      await onPhase(phase)
      return { phase }
    })
    .addNode('forcedFailure', async () => {
      await onPhase('failed')
      return { phase: 'failed' as const }
    })
    .addNode('duplicate', async (state) => {
      const command = state.step?.type === 'command' ? state.step.command.trim() : ''
      await onDuplicateCommand(command)
      return { forceReplyNext: true }
    })
    .addNode('execute', async (state) => {
      if (!await shouldContinue()) return { execution: { status: 'cancelled' as const }, phase: 'cancelled' as const }
      await onPhase('executing')
      const command = state.step?.type === 'command' ? state.step.command.trim() : ''
      const execution = await executeCommand(command)
      if (!await shouldContinue()) return { execution: { status: 'cancelled' as const }, phase: 'cancelled' as const }
      return { execution }
    })
    .addNode('review', (state) => {
      const command = state.step?.type === 'command' ? state.step.command.trim() : ''
      return {
        execution: interrupt<QueryAgentReviewRequest, QueryAgentExecutionResult>({
          command,
          message: state.execution?.status === 'waiting_for_review' ? state.execution.message : undefined
        })
      }
    })
    .addNode('finishExecution', async (state) => {
      const phase = state.execution?.status === 'waiting_for_review' || state.execution?.status === 'failed' || state.execution?.status === 'cancelled'
        ? state.execution.status
        : 'failed'
      await onPhase(phase)
      return { phase }
    })
    .addNode('analyze', async (state) => {
      if (!await shouldContinue()) {
        await onPhase('cancelled')
        return { phase: 'cancelled' as const }
      }
      const command = state.step?.type === 'command' ? state.step.command.trim() : ''
      const outputLines = state.execution?.status === 'completed'
        ? state.execution.outputLines.slice(-MAX_OUTPUT_LINES_PER_STEP)
        : []
      await onPhase('analyzing_result')
      return {
        outputLines,
        executedCommandCount: state.executedCommandCount + 1,
        executedCommands: [...state.executedCommands, command],
        phase: 'analyzing_result' as const
      }
    })
    .addEdge(START, 'request')
    .addConditionalEdges('request', (state) => {
      if (state.step?.type !== 'command') return 'finishStep'
      if (state.forceReply) return 'forcedFailure'
      return state.executedCommands.includes(state.step.command.trim()) ? 'duplicate' : 'execute'
    })
    .addEdge('finishStep', END)
    .addEdge('forcedFailure', END)
    .addEdge('duplicate', 'request')
    .addConditionalEdges('execute', (state) => {
      if (state.execution?.status === 'completed') return 'analyze'
      if (state.execution?.status === 'waiting_for_review') return 'review'
      return 'finishExecution'
    })
    .addConditionalEdges('review', (state) => {
      if (state.execution?.status === 'completed') return 'analyze'
      if (state.execution?.status === 'waiting_for_review') return 'review'
      return 'finishExecution'
    })
    .addEdge('finishExecution', END)
    .addConditionalEdges('analyze', (state) => state.phase === 'cancelled' ? END : 'request')
    .compile({ checkpointer: new MemorySaver() })

  const config = { configurable: { thread_id: `query-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } }
  await onPhase('generating_query')
  let state = await graph.invoke({}, config)
  while (isInterrupted<QueryAgentReviewRequest>(state)) {
    const review = state[INTERRUPT][0]?.value
    if (!reviewCommand || !review) {
      await onPhase('waiting_for_review')
      return { phase: 'waiting_for_review', step: state.step, executedCommandCount: state.executedCommandCount }
    }
    const reviewExecution = reviewCommand(review)
    await onPhase('waiting_for_review')
    state = await graph.invoke(new Command({ resume: await reviewExecution }), config)
  }

  const phase = state.phase === 'completed' || state.phase === 'waiting_for_review' || state.phase === 'failed' || state.phase === 'cancelled'
    ? state.phase
    : 'failed'
  return { phase, step: state.step, executedCommandCount: state.executedCommandCount }
}
