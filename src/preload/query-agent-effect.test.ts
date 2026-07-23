import assert from 'node:assert/strict'
import test from 'node:test'
import type { QueryAgentEffect, RunQueryAgentOptions } from '../shared/query-agent'
import { dispatchQueryAgentEffect } from './query-agent-effect'

const options: RunQueryAgentOptions = {
  requestStep: async () => ({ type: 'reply', message: 'done' }),
  executeCommand: async () => ({ status: 'completed', outputLines: [] })
}

test('未知 Query Agent effect 失败关闭', async () => {
  const unknownEffect = { type: 'unknown', payload: {} } as unknown as QueryAgentEffect

  await assert.rejects(
    dispatchQueryAgentEffect(unknownEffect, options),
    /Unsupported query agent effect: unknown/
  )
})
