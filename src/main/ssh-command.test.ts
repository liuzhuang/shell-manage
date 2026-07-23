import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SshKeyConfig } from '../shared/types'

const testHome = mkdtempSync(join(tmpdir(), 'shell-manage-ssh-test-'))
process.env.SHELL_MANAGE_HOME = testHome
const { injectSshIdentity, prepareManagedSshCommand, resolveCommandWithSshKey } = await import('./ssh-command')

test('injectSshIdentity adds -i for ssh commands', () => {
  const result = injectSshIdentity('ssh root@1.2.3.4', '/tmp/prod.pem')
  assert.equal(result, 'ssh -i "/tmp/prod.pem" root@1.2.3.4')
})

test('injectSshIdentity replaces existing -i path', () => {
  const result = injectSshIdentity('ssh -i /Users/alice/old.pem root@1.2.3.4', '/tmp/prod.pem')
  assert.equal(result, 'ssh -i "/tmp/prod.pem" root@1.2.3.4')
})

test('resolveCommandWithSshKey resolves configured key file', () => {
  const keysDir = join(testHome, '.shell-manage', 'keys')
  mkdirSync(keysDir, { recursive: true })
  writeFileSync(join(keysDir, 'prod.pem'), '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n')

  const keys: SshKeyConfig[] = [{ id: 'prod', label: '生产' }]
  const result = resolveCommandWithSshKey('ssh root@1.2.3.4', 'prod', keys)
  assert.match(result, /^ssh -i "/)
  assert.match(result, /prod\.pem" root@1\.2\.3\.4$/)
})

test('resolveCommandWithSshKey leaves non-ssh commands unchanged', () => {
  assert.equal(resolveCommandWithSshKey('npm run dev', 'prod', [{ id: 'prod', label: '生产' }]), 'npm run dev')
})

test('prepareManagedSshCommand enables a controlled interactive shell for SSH', () => {
  const result = prepareManagedSshCommand('ssh -i "/tmp/prod key.pem" root@example.com', 'trusted-prompt')

  assert.ok(result)
  assert.match(result, /^\/usr\/bin\/ssh -tt /u)
  assert.match(result, /'-i' '\/tmp\/prod key\.pem' 'root@example\.com'/u)
  assert.match(result, /trusted-prompt/u)
  assert.match(result, /\/bin\/sh -i/u)
})

test('prepareManagedSshCommand preserves common SSH connection options', () => {
  const result = prepareManagedSshCommand(
    'ssh -p 2222 -J bastion -o StrictHostKeyChecking=no ops@example.com',
    'trusted-prompt'
  )

  assert.ok(result)
  assert.match(result, /'-p' '2222' '-J' 'bastion' '-o' 'StrictHostKeyChecking=no' 'ops@example\.com'/u)
})

test('prepareManagedSshCommand rejects commands that bypass the controlled remote shell', () => {
  const unsupported = [
    'ssh root@example.com uptime',
    'ssh root@example.com; touch /tmp/unsafe',
    'ssh -T root@example.com',
    'ssh -o RemoteCommand=uptime root@example.com'
  ]

  unsupported.forEach((command) => assert.equal(prepareManagedSshCommand(command, 'trusted-prompt'), undefined))
})
