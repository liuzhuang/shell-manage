import type { QueryAgentRunResult, RunQueryAgentOptions } from '../../shared/query-agent'

export type {
  QueryAgentExecutionResult,
  QueryAgentReviewRequest,
  QueryAgentRunResult,
  QueryAgentStep,
  QueryAgentStepRequest,
  RunQueryAgentOptions
} from '../../shared/query-agent'

export function runQueryAgent(options: RunQueryAgentOptions): Promise<QueryAgentRunResult> {
  return window.api.queryAgentRun(options)
}
