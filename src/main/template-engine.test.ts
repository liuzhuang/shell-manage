import test from 'node:test'
import assert from 'node:assert/strict'
import { buildKnownSlotNames, DEFAULT_DEPLOY_TEMPLATE, previewDeployTemplate, renderTemplate } from './template-engine'

test('renderTemplate fills known slots and tracks missing values', () => {
  const knownSlots = buildKnownSlotNames([{ id: 'p1', name: 'demo', path: '/tmp/app' }], [])
  const result = renderTemplate(
    'cd {{demo}}',
    {
      demo: '/tmp/app'
    },
    knownSlots
  )
  assert.equal(result.rendered, 'cd /tmp/app')
  assert.deepEqual(result.missingSlots, [])
  assert.deepEqual(result.unknownSlots, [])
})

test('renderTemplate keeps unknown slots and marks missing values', () => {
  const knownSlots = buildKnownSlotNames([{ id: 'p1', name: 'demo', path: '/tmp/app' }], [])
  const result = renderTemplate(
    'cd {{demo}}\nuse {{unknownSlot}}',
    {
      demo: ''
    },
    knownSlots
  )
  assert.match(result.rendered, /{{demo}}/)
  assert.match(result.rendered, /{{unknownSlot}}/)
  assert.deepEqual(result.missingSlots, ['demo'])
  assert.deepEqual(result.unknownSlots, ['unknownSlot'])
})

test('previewDeployTemplate resolves slots from configured directories and keys', () => {
  const preview = previewDeployTemplate({
    template: 'cd {{App A}}\nssh -i {{生产密钥}} root@example.com',
    projectDirectories: [{ id: 'proj-a', name: 'App A', path: '/Users/alice/app-a' }],
    sshKeys: [{ id: 'prod-key', label: '生产密钥' }]
  })

  assert.ok(preview.knownSlots.includes('App A'))
  assert.ok(preview.knownSlots.includes('生产密钥'))
  assert.match(preview.rendered, /cd \/Users\/alice\/app-a/)
})

test('previewDeployTemplate fills ssh key slots from configured keys', () => {
  const preview = previewDeployTemplate({
    template: 'key={{生产密钥}}',
    projectDirectories: [{ id: 'proj-a', name: 'App A', path: '/Users/alice/app-a' }],
    sshKeys: [
      { id: 'prod-key', label: '生产密钥' },
      { id: 'dev-key', label: '开发密钥' }
    ]
  })

  assert.match(preview.slotValues['生产密钥'] || '', /prod-key\.pem$/)
  assert.match(preview.rendered, /key=/)
})

test('previewDeployTemplate resolves each slot name independently', () => {
  const preview = previewDeployTemplate({
    template: 'cd {{App A}}\ncd {{App B}}',
    projectDirectories: [
      { id: 'proj-a', name: 'App A', path: '/Users/alice/app-a' },
      { id: 'proj-b', name: 'App B', path: '/Users/alice/app-b' }
    ],
    sshKeys: [{ id: 'prod-key', label: '生产密钥' }]
  })

  assert.match(preview.rendered, /cd \/Users\/alice\/app-a/)
  assert.match(preview.rendered, /cd \/Users\/alice\/app-b/)
  assert.match(DEFAULT_DEPLOY_TEMPLATE, /插槽格式/)
})
