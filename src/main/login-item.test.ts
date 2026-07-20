import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLoginItemSettings } from './login-item-settings'

test('buildLoginItemSettings enables login item with hidden startup', () => {
  assert.deepEqual(buildLoginItemSettings(true), {
    openAtLogin: true,
    openAsHidden: true
  })
})

test('buildLoginItemSettings disables login item', () => {
  assert.deepEqual(buildLoginItemSettings(false), {
    openAtLogin: false,
    openAsHidden: false
  })
})
