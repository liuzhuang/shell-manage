import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLangSmithEnvironment } from './langsmith-env'

test('LangSmith 配置关闭或字段移除后不会沿用上一次运行时配置', () => {
  const initial = {
    tracing: process.env.LANGCHAIN_TRACING_V2,
    endpoint: process.env.LANGCHAIN_ENDPOINT,
    apiKey: process.env.LANGCHAIN_API_KEY,
    project: process.env.LANGCHAIN_PROJECT
  }
  applyLangSmithEnvironment({
    tracingV2: true,
    endpoint: 'https://trace.example',
    apiKey: 'trace-secret',
    project: 'shell-manage'
  })
  assert.equal(process.env.LANGCHAIN_API_KEY, 'trace-secret')
  applyLangSmithEnvironment({ tracingV2: true })
  assert.equal(process.env.LANGCHAIN_ENDPOINT, initial.endpoint)
  assert.equal(process.env.LANGCHAIN_API_KEY, initial.apiKey)
  assert.equal(process.env.LANGCHAIN_PROJECT, initial.project)
  applyLangSmithEnvironment(undefined)
  assert.equal(process.env.LANGCHAIN_TRACING_V2, initial.tracing)
})
