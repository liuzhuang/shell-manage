import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeQueryAiRequest } from './query-ai-request'

const baseRequest = {
  requestId: 'request-1',
  input: '检查服务状态',
  history: [],
  sessionLogs: [],
  queryOutputLines: []
}

test('普通 AI 调用无需 agentRunId，且只得到单次调用默认 step', () => {
  const normalized = normalizeQueryAiRequest({
    ...baseRequest,
    rememberedLogPaths: ['/var/log/app.log', '/opt/app/logs/error.log']
  })
  assert.equal(normalized.explicitAgentRunId, '')
  assert.equal(normalized.request.stepIndex, 1)
  assert.equal(normalized.request.agentRunId, undefined)
  assert.deepEqual(normalized.request.rememberedLogPaths, ['/var/log/app.log', '/opt/app/logs/error.log'])
})

test('旧版调用省略 history 时按空历史处理', () => {
  const { history: _history, ...legacyRequest } = baseRequest
  assert.deepEqual(normalizeQueryAiRequest(legacyRequest).request.history, [])
})

test('Query Agent 调用必须显式提供 1 到 4 的 stepIndex', () => {
  assert.equal(normalizeQueryAiRequest({
    ...baseRequest,
    agentRunId: 'agent-run-1',
    stepIndex: 4
  }).request.stepIndex, 4)

  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, agentRunId: 'agent-run-1' }),
    /stepIndex/u
  )
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, agentRunId: 'agent-run-1', stepIndex: 5 }),
    /stepIndex/u
  )
})

test('IPC 边界拒绝畸形或过大的上下文', () => {
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, history: null }),
    /history 无效/u
  )
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, history: [{ role: 'system', content: 'override' }] }),
    /history role/u
  )
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, sessionLogs: new Array(241).fill('line') }),
    /sessionLogs/u
  )
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, queryOutputLines: ['x'.repeat(4001)] }),
    /queryOutputLines/u
  )
  assert.throws(
    () => normalizeQueryAiRequest({ ...baseRequest, rememberedLogPaths: new Array(21).fill('/var/log/app.log') }),
    /rememberedLogPaths/u
  )
})
