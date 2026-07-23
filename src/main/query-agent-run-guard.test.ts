import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryAgentRunGuard } from './query-agent-run-guard'

test('同一 Query Agent run 只接受严格递增的 1 到 4 步', () => {
  const guard = new QueryAgentRunGuard()

  assert.equal(guard.reserveStep('run-1', 2), false)
  assert.equal(guard.reserveStep('run-1', 1), true)
  assert.equal(guard.reserveStep('run-1', 1), false)
  assert.equal(guard.reserveStep('run-1', 3), false)
  assert.equal(guard.reserveStep('run-1', 2), true)
  assert.equal(guard.reserveStep('run-1', 3), true)
  assert.equal(guard.reserveStep('run-1', 4), true)
  assert.equal(guard.reserveStep('run-1', 4), false)
})

test('run 收口后可从第一步重新开始，过期状态也会失败关闭后重建', () => {
  const guard = new QueryAgentRunGuard(100)
  assert.equal(guard.reserveStep('run-finish', 1, 0), true)
  guard.finish('run-finish')
  assert.equal(guard.reserveStep('run-finish', 1, 1), true)

  assert.equal(guard.reserveStep('run-expired', 1, 0), true)
  assert.equal(guard.reserveStep('run-expired', 2, 100), false)
  assert.equal(guard.reserveStep('run-expired', 1, 100), true)
})
