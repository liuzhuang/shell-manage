import assert from 'node:assert/strict'
import test from 'node:test'
import { ReviewTokenStore } from './review-token-store'

test('审计授权在有效期内仅可用于同一不可变步骤并可供轮询复用', () => {
  const originalNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    const store = new ReviewTokenStore(100)
    const issued = store.issue('widget', 'step', 'echo status')
    assert.equal(store.validate(issued.tokenAuth, 'widget', 'step', 'echo status'), true)
    assert.equal(store.validate(issued.tokenAuth, 'widget', 'step', 'echo status'), true)
    assert.equal(store.validate(issued.tokenAuth, 'widget', 'step', 'echo changed'), false)
    now = 1_101
    assert.equal(store.validate(issued.tokenAuth, 'widget', 'step', 'echo status'), false)
  } finally {
    Date.now = originalNow
  }
})
