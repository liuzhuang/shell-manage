import type { QueryAgentPhase } from './types'

export type QueryAgentStepRequest = {
  outputLines: string[]
  forceReply: boolean
}

export type QueryAgentStep =
  | { type: 'command'; command: string }
  | { type: 'reply' | 'clarify'; message: string }
  | { type: 'waiting_for_review' | 'failed' | 'cancelled'; message?: string }

export type QueryAgentExecutionResult = {
  status: 'completed'
  outputLines: string[]
} | {
  status: 'waiting_for_review' | 'failed' | 'cancelled'
  message?: string
}

export type QueryAgentReviewRequest = {
  command: string
  message?: string
}

export type QueryAgentRunResult = {
  phase: 'completed' | 'waiting_for_review' | 'failed' | 'cancelled'
  step?: QueryAgentStep
  executedCommandCount: number
}

export type RunQueryAgentOptions = {
  requestStep: (request: QueryAgentStepRequest) => Promise<QueryAgentStep>
  executeCommand: (command: string) => Promise<QueryAgentExecutionResult>
  reviewCommand?: (request: QueryAgentReviewRequest) => Promise<QueryAgentExecutionResult>
  onDuplicateCommand?: (command: string) => void | Promise<void>
  onPhase?: (phase: QueryAgentPhase) => void | Promise<void>
  shouldContinue?: () => boolean | Promise<boolean>
}

export type QueryAgentEffect =
  | { type: 'requestStep'; payload: QueryAgentStepRequest }
  | { type: 'executeCommand'; payload: { command: string } }
  | { type: 'reviewCommand'; payload: QueryAgentReviewRequest }
  | { type: 'duplicateCommand'; payload: { command: string } }
  | { type: 'phase'; payload: { phase: QueryAgentPhase } }
  | { type: 'shouldContinue'; payload: Record<string, never> }

export type QueryAgentEffectMessage = QueryAgentEffect & {
  bridgeId: string
  effectId: string
}

export type QueryAgentEffectResultMessage = {
  bridgeId: string
  effectId: string
  ok: boolean
  result?: unknown
  error?: string
}
