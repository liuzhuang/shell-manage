import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anonymizeLangSmithPayload,
  buildLangSmithClientConfig,
  createLangSmithTracer
} from './langsmith-tracing'

test('LangSmith Client 始终绑定当前配置，Key 与 endpoint 切换不会复用首次值', () => {
  const first = buildLangSmithClientConfig({
    apiKey: 'first-key',
    endpoint: 'https://first.example',
    project: 'first-project'
  }, {})
  const second = buildLangSmithClientConfig({
    apiKey: 'second-key',
    endpoint: 'https://second.example',
    project: 'second-project'
  }, {})

  assert.deepEqual({ ...first, anonymizer: typeof first?.anonymizer }, {
    apiKey: 'first-key',
    apiUrl: 'https://first.example',
    anonymizer: 'function',
    hideInputs: false,
    hideOutputs: false
  })
  assert.deepEqual({ ...second, anonymizer: typeof second?.anonymizer }, {
    apiKey: 'second-key',
    apiUrl: 'https://second.example',
    anonymizer: 'function',
    hideInputs: false,
    hideOutputs: false
  })
  assert.notDeepEqual(second, first)
})

test('LangSmith Client 接受官方环境变量配置', () => {
  const result = buildLangSmithClientConfig(undefined, {
    LANGSMITH_API_KEY: 'env-key',
    LANGSMITH_ENDPOINT: 'https://env.example',
    LANGSMITH_PROJECT: 'env-project'
  })

  assert.deepEqual({ ...result, anonymizer: typeof result?.anonymizer }, {
    apiKey: 'env-key',
    apiUrl: 'https://env.example',
    anonymizer: 'function',
    hideInputs: false,
    hideOutputs: false
  })
})

test('显式 tracer 等待后台回调，根 trace 结束前完成子 span', () => {
  const tracer = createLangSmithTracer(undefined, {
    LANGSMITH_API_KEY: 'env-key',
    LANGSMITH_ENDPOINT: 'https://env.example',
    LANGSMITH_PROJECT: 'env-project'
  })

  assert.equal(tracer?.awaitHandlers, true)
})

test('详细 trace 保留普通字段，同时脱敏 provider key、常见令牌和嵌套凭据', () => {
  const result = anonymizeLangSmithPayload({
    input: '检查 ghp_abcdefghijklmnopqrstuvwxyz123456',
    inputTokens: 42,
    nested: {
      apiKey: 'provider-secret',
      totalTokens: 99,
      message: 'password=database-secret'
    }
  })

  assert.deepEqual(result, {
    input: '检查 [REDACTED]',
    inputTokens: 42,
    nested: {
      apiKey: '[REDACTED]',
      totalTokens: 99,
      message: 'password=[REDACTED]'
    }
  })
})

test('无效或占位 LangSmith Key 不创建 Client 配置', () => {
  assert.equal(buildLangSmithClientConfig(undefined, {}), undefined)
  assert.equal(buildLangSmithClientConfig({ apiKey: ' ' }, {}), undefined)
  assert.equal(buildLangSmithClientConfig({ apiKey: 'lsv2_pt_xxxxx' }, {}), undefined)
  assert.equal(buildLangSmithClientConfig({ tracing: false, apiKey: 'valid-key' }, {}), undefined)
})
