import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppConfig } from '../shared/types'
import {
  isDeployTerminalCommand,
  renderDeployScriptContent,
  resolveDeployScriptInput,
  toDeployTerminalCommandName
} from './deploy-script-runner'

const BASE_CONFIG: AppConfig = {
  commands: [],
  presets: [],
  settings: {
    llm: { endpoint: '', apiKey: '', model: '' },
    logBufferLines: 1000,
    sshKeys: [{ id: 'baidu-prod', label: '百度PROD' }]
  },
  projectDirectories: [{ id: 'proj-platform', name: 'platform', path: '/tmp/platform' }],
  deployScripts: [
    {
      id: 'deploy-1',
      name: '交互部署',
      content: 'cd "{{platform}}"\nSSH_KEY="{{百度PROD}}"'
    }
  ]
}

test('resolveDeployScriptInput merges draft content with saved script metadata', () => {
  const resolved = resolveDeployScriptInput(BASE_CONFIG, {
    scriptId: 'deploy-1',
    content: 'echo draft'
  })

  assert.equal(resolved.id, 'deploy-1')
  assert.equal(resolved.name, '交互部署')
  assert.equal(resolved.content, 'echo draft')
})

test('renderDeployScriptContent fills project slots and reports missing key files', () => {
  const rendered = renderDeployScriptContent(BASE_CONFIG, BASE_CONFIG.deployScripts![0])

  assert.match(rendered.rendered, /cd "\/tmp\/platform"/)
  assert.deepEqual(rendered.unknownSlots, [])
  assert.ok(rendered.missingSlots.includes('百度PROD'))
})

test('toDeployTerminalCommandName uses deploy prefix', () => {
  assert.equal(toDeployTerminalCommandName('deploy-1'), '__deploy__:deploy-1')
  assert.equal(isDeployTerminalCommand('__deploy__:deploy-1'), true)
  assert.equal(isDeployTerminalCommand('demo-terminal'), false)
})
