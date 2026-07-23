import { ipcRenderer } from 'electron'
import type {
  QueryAgentEffectMessage,
  QueryAgentEffectResultMessage,
  QueryAgentRunResult,
  RunQueryAgentOptions
} from '../shared/query-agent'
import { dispatchQueryAgentEffect } from './query-agent-effect'

export async function runQueryAgent(options: RunQueryAgentOptions): Promise<QueryAgentRunResult> {
  const bridgeId = `query-agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const handleEffect = async (_event: unknown, effect: QueryAgentEffectMessage) => {
    if (effect.bridgeId !== bridgeId) return
    const response: QueryAgentEffectResultMessage = { bridgeId, effectId: effect.effectId, ok: true }
    try {
      response.result = await dispatchQueryAgentEffect(effect, options)
    } catch (error) {
      response.ok = false
      response.error = error instanceof Error ? error.message : String(error)
    }
    ipcRenderer.send('query:agent-effect-result', response)
  }

  ipcRenderer.on('query:agent-effect', handleEffect)
  try {
    return await ipcRenderer.invoke('query:agent-run', bridgeId) as QueryAgentRunResult
  } finally {
    ipcRenderer.removeListener('query:agent-effect', handleEffect)
  }
}
