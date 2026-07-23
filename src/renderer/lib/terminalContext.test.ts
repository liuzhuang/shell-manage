import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTerminalContextLines } from './terminalContext'

test('终端上下文脱敏、去控制符并限制长度', () => {
  const lines = buildTerminalContextLines(
    `\x1b[31merror\x1b[0m\napi_key=sk-abcdefghijklmnopqrstuvwxyz\npassword="hello world"\nAWS_SECRET_ACCESS_KEY=top-secret\nAuthorization: Bearer test-token`
  )
  assert.deepEqual(lines, [
    'error',
    'api_key=[REDACTED]',
    'password=[REDACTED]',
    'AWS_SECRET_ACCESS_KEY=[REDACTED]',
    'Authorization: [REDACTED]'
  ])
  assert.ok(lines.join('\n').length <= 12_000)
})

test('终端上下文隐藏连接 URI、会话 Cookie 与命令行凭据', () => {
  const lines = buildTerminalContextLines([
    'DATABASE_URL=postgres://alice:s3cr3t@db.internal/app',
    'remote=https://oauth-token@api.example.test/v1',
    'Set-Cookie: sid=abc123; HttpOnly',
    'SESSION_ID=session-value',
    'curl -u alice:s3cr3t https://api.example.test',
    'curl -ualice:attached https://api.example.test',
    'docker login registry.example.test --password registry-secret',
    'redis-cli -aredis-secret ping',
    'redis-cli --pass redis-long-secret ping',
    'REDISCLI_AUTH=redis-env-secret',
    'mysql --password mysql-secret',
    'MYSQL_PWD=mysql-env-secret',
    'curl --proxy-user alice:proxy-secret https://api.example.test',
    'kubectl --token=cluster-token get pods'
  ].join('\n'))

  assert.deepEqual(lines, [
    'DATABASE_URL=[REDACTED]',
    'remote=https://[REDACTED]@api.example.test/v1',
    'Set-Cookie: [REDACTED]',
    'SESSION_ID=[REDACTED]',
    'curl -u [REDACTED] https://api.example.test',
    'curl -u[REDACTED] https://api.example.test',
    'docker login registry.example.test --password [REDACTED]',
    'redis-cli -a[REDACTED] ping',
    'redis-cli --pass [REDACTED] ping',
    'REDISCLI_AUTH=[REDACTED]',
    'mysql --password [REDACTED]',
    'MYSQL_PWD=[REDACTED]',
    'curl --proxy-user [REDACTED] https://api.example.test',
    'kubectl --token=[REDACTED] get pods'
  ])
})

test('终端上下文隐藏常见平台令牌，即使令牌没有键名', () => {
  const lines = buildTerminalContextLines([
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'github_pat_abcdefghijklmnopqrstuvwxyz_1234567890',
    'lsv2_pt_abcdefghijklmnopqrstuvwxyz1234567890',
    'xoxb-' + '1234567890-abcdefghijklmnopqrstuvwxyz',
    'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
  ].join('\n'))

  assert.deepEqual(lines, Array.from({ length: 5 }, () => '[REDACTED]'))
})
