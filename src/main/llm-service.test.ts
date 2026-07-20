import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppConfig, QueryAiRequest } from '../shared/types'
import { LlmService, parseQueryAiAction, QUERY_AGENT_RESPONSE_SCHEMA } from './llm-service'

const config: AppConfig = {
  commands: [],
  presets: [],
  settings: {
    llm: { provider: 'openai', endpoint: '', apiKey: '', model: 'test' },
    logBufferLines: 1000
  }
}

const request: QueryAiRequest = {
  requestId: 'test',
  input: '查看支付失败',
  history: [],
  sessionLogs: [],
  queryOutputLines: []
}

test('Query Agent fails closed when the model is unavailable', async () => {
  await assert.rejects(new LlmService().chatToShell(request, config, () => undefined), /配置有效的 AI API Key/)
})

test('Query Agent 结构化响应必须包含风险判断', () => {
  assert.deepEqual(
    QUERY_AGENT_RESPONSE_SCHEMA.required,
    ['type', 'message', 'riskLevel', 'riskReason']
  )
})

test('Query Agent 使用 command 结构，并保留明确的风险理由', () => {
  assert.deepEqual(
    parseQueryAiAction({
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel: 'safe',
      riskReason: '只读取系统运行状态。'
    }),
    {
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel: 'safe',
      riskReason: '只读取系统运行状态。'
    }
  )
})

test('Query Agent 风险缺失或格式错误时降为手动确认，不生成 fallback 命令', () => {
  for (const riskLevel of [undefined, 'unknown']) {
    const action = parseQueryAiAction({
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel,
      riskReason: ''
    })
    assert.equal(action.command, 'uptime')
    assert.equal(action.riskLevel, 'review')
    assert.match(action.riskReason, /手动确认/)
  }
})

test('Query Agent 拒绝旧业务路由类型和无命令的 command action', () => {
  assert.throws(
    () => parseQueryAiAction({ type: 'propose_command', message: 'x', command: 'uptime', riskLevel: 'safe', riskReason: 'x' }),
    /未知操作/
  )
  assert.throws(
    () => parseQueryAiAction({ type: 'command', message: 'x', riskLevel: 'safe', riskReason: 'x' }),
    /单行命令/
  )
})
