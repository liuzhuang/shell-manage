import type {
  QueryAgentEffect,
  RunQueryAgentOptions
} from '../shared/query-agent'

export async function dispatchQueryAgentEffect(
  effect: QueryAgentEffect,
  options: RunQueryAgentOptions
): Promise<unknown> {
  switch (effect.type) {
    case 'requestStep':
      return options.requestStep(effect.payload)
    case 'executeCommand':
      return options.executeCommand(effect.payload.command)
    case 'reviewCommand':
      return options.reviewCommand
        ? options.reviewCommand(effect.payload)
        : { status: 'waiting_for_review', message: effect.payload.message }
    case 'duplicateCommand':
      return options.onDuplicateCommand?.(effect.payload.command)
    case 'phase':
      return options.onPhase?.(effect.payload.phase)
    case 'shouldContinue':
      return options.shouldContinue ? options.shouldContinue() : true
    default:
      return unsupportedEffect(effect)
  }
}

function unsupportedEffect(effect: never): never {
  throw new Error(`Unsupported query agent effect: ${String((effect as { type?: unknown }).type)}`)
}
