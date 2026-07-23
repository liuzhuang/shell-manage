import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureLangSmithEnvironment,
  isLangSmithTracingConfigured,
  resolveLangSmithSettings
} from './langsmith-env'

test('官方 LANGSMITH_* 环境变量覆盖 YAML 配置且不改写进程环境', () => {
  const resolved = resolveLangSmithSettings({
    apiKey: 'yaml-key',
    endpoint: 'https://yaml.example',
    project: 'yaml-project'
  }, {
    LANGSMITH_TRACING: 'true',
    LANGSMITH_API_KEY: 'env-key',
    LANGSMITH_ENDPOINT: 'https://env.example',
    LANGSMITH_PROJECT: 'env-project'
  })

  assert.deepEqual(resolved, {
    tracing: true,
    apiKey: 'env-key',
    endpoint: 'https://env.example',
    project: 'env-project'
  })
})

test('空环境变量回退到 YAML 配置', () => {
  assert.deepEqual(resolveLangSmithSettings({
    apiKey: 'yaml-key',
    endpoint: 'https://yaml.example',
    project: 'yaml-project'
  }, {
    LANGSMITH_API_KEY: ' ',
    LANGSMITH_ENDPOINT: '',
    LANGSMITH_PROJECT: ' '
  }), {
    apiKey: 'yaml-key',
    endpoint: 'https://yaml.example',
    project: 'yaml-project'
  })
})

test('环境 Key 与 endpoint 同源绑定，不回退到可编辑的 YAML endpoint', () => {
  assert.deepEqual(resolveLangSmithSettings({
    apiKey: 'yaml-key',
    endpoint: 'https://yaml.example',
    project: 'yaml-project'
  }, {
    LANGSMITH_API_KEY: 'env-key'
  }), {
    apiKey: 'env-key',
    endpoint: undefined,
    project: undefined
  })
})

test('主进程支持二次补齐登录 Shell 配置并立即移除环境变量', () => {
  const initialEnvironment = {
    LANGSMITH_TRACING: 'true',
    LANGSMITH_ENDPOINT: 'https://ignored.example',
    LANGSMITH_PROJECT: 'ignored-project'
  }
  captureLangSmithEnvironment(initialEnvironment)
  assert.deepEqual(initialEnvironment, {})

  const normalizedEnvironment = {
    LANGSMITH_TRACING: 'false',
    LANGSMITH_API_KEY: 'captured-key',
    LANGSMITH_ENDPOINT: 'https://captured.example',
    LANGSMITH_PROJECT: 'captured-project'
  }

  captureLangSmithEnvironment(normalizedEnvironment)
  assert.deepEqual(resolveLangSmithSettings(undefined), {
    tracing: false,
    apiKey: 'captured-key',
    endpoint: 'https://captured.example',
    project: 'captured-project'
  })
  assert.deepEqual(normalizedEnvironment, {})
})

test('有效 LangSmith API Key 默认开启追踪，无需额外开关', () => {
  assert.equal(isLangSmithTracingConfigured({ apiKey: 'trace-secret' }), true)
  assert.equal(isLangSmithTracingConfigured({ apiKey: 'lsv2_pt_real-secret-value' }), true)
  assert.equal(isLangSmithTracingConfigured({ tracing: false, apiKey: 'trace-secret' }), false)
})

test('空值和占位 Key 不开启追踪，也不把配置密钥写入进程环境', () => {
  const beforeModern = process.env.LANGSMITH_API_KEY
  const beforeLegacy = process.env.LANGCHAIN_API_KEY

  assert.equal(isLangSmithTracingConfigured(undefined), false)
  assert.equal(isLangSmithTracingConfigured({ apiKey: ' ' }), false)
  assert.equal(isLangSmithTracingConfigured({ apiKey: 'lsv2_pt_xxxxx' }), false)
  assert.equal(process.env.LANGSMITH_API_KEY, beforeModern)
  assert.equal(process.env.LANGCHAIN_API_KEY, beforeLegacy)
})
