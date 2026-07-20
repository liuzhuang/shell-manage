import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppConfig } from '../../shared/types'
import { getDashboardAgentCacheKey } from './deep-agent-intent'

function config(apiKey: string): AppConfig {
  return {
    commands: [],
    presets: [],
    settings: {
      llm: { provider: 'openai', endpoint: 'https://api.example/v1', apiKey, model: 'test-model' },
      logBufferLines: 100
    }
  }
}

test('Dashboard Agent 缓存随 API Key 指纹失效且不暴露原始密钥', () => {
  const first = getDashboardAgentCacheKey(config('tenant-a-secret'))
  const second = getDashboardAgentCacheKey(config('tenant-b-secret'))
  assert.notEqual(first, second)
  assert.equal(first.includes('tenant-a-secret'), false)
  assert.equal(second.includes('tenant-b-secret'), false)
})
