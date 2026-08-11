import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CommandPublicAccessManager,
  extractTunnelUrl,
  extractVercelAlias,
  extractVercelUrl,
  resolveLoopbackTarget,
  resolveVercelProjectRoot
} from './command-public-access'
import type { ProcessManager } from './process-manager'

test('公网访问只接受命令中的绝对项目根和显式 loopback HTTP 端口', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'shell-manage-public-access-'))
  try {
    assert.equal(resolveVercelProjectRoot(`cd "${projectRoot}" && npm run dev`), realpathSync(projectRoot))
    assert.throws(() => resolveVercelProjectRoot('npm run dev'), /项目根目录/)
    assert.deepEqual(
      resolveLoopbackTarget({
        name: 'demo',
        command: `cd "${projectRoot}" && npm run dev`,
        tags: [],
        webUrl: 'http://localhost:4173/path'
      }),
      { origin: 'http://localhost:4173', host: 'localhost', authority: 'localhost:4173', port: 4173 }
    )
    assert.throws(
      () => resolveLoopbackTarget({ name: 'remote', command: 'run', tags: [], webUrl: 'https://example.com:443' }),
      /本地 HTTP/
    )
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('端口探测期间配置被删除时不会继续启动公网隧道', async () => {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const command = {
      name: 'race-demo',
      command: 'cd "/tmp/race-demo" && npm run dev',
      tags: [],
      mode: 'service' as const,
      webUrl: `http://127.0.0.1:${address.port}`
    }
    const processManager = {
      getState: () => ({ commandName: command.name, state: 'running' as const })
    } as unknown as ProcessManager
    const manager = new CommandPublicAccessManager(processManager, () => {})
    manager.syncCommands([command])
    const start = manager.start(command, 'cpolar')
    manager.syncCommands([])
    await assert.rejects(start, /配置或运行状态已变更/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('只为当前关联的 Vercel 项目恢复持久化链接', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'shell-manage-vercel-cache-'))
  const storagePath = join(projectRoot, 'vercel-deployments.json')
  const projectFile = join(projectRoot, '.vercel', 'project.json')
  const command = {
    name: 'persisted-demo',
    command: `cd "${projectRoot}/" && npm run dev`,
    tags: []
  }
  try {
    mkdirSync(join(projectRoot, '.vercel'))
    writeFileSync(projectFile, '{"projectId":"prj_one","orgId":"team_one"}')
    writeFileSync(storagePath, JSON.stringify([{
      projectRoot: `${projectRoot}/`,
      projectId: 'prj_one',
      orgId: 'team_one',
      url: 'https://persisted-demo.vercel.app'
    }]))

    const restored = new CommandPublicAccessManager({} as ProcessManager, () => {}, storagePath)
    restored.syncCommands([command])
    assert.equal(restored.list(command.name)[0]?.url, 'https://persisted-demo.vercel.app')

    writeFileSync(projectFile, '{"projectId":"prj_two","orgId":"team_one"}')
    const relinked = new CommandPublicAccessManager({} as ProcessManager, () => {}, storagePath)
    relinked.syncCommands([command])
    assert.equal(relinked.list(command.name).length, 0)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('从三种 CLI 输出中提取公网链接', () => {
  assert.equal(
    extractVercelUrl('{"status":"ready","deployment":{"url":"https://demo.vercel.app"}}'),
    'https://demo.vercel.app'
  )
  assert.equal(
    extractVercelUrl(
      '{"deployment":{"url":"https://protected.vercel.app"}}',
      'Production https://protected.vercel.app\nAliased https://public-demo.vercel.app\n'
    ),
    'https://public-demo.vercel.app'
  )
  assert.equal(extractVercelUrl('https://legacy.vercel.app\n'), 'https://legacy.vercel.app')
  assert.equal(
    extractVercelAlias('{"aliases":["public-demo.vercel.app","www.example.com"]}'),
    'https://public-demo.vercel.app'
  )
  assert.equal(
    extractTunnelUrl('cloudflare', '{"message":"https://gentle-river.trycloudflare.com"}\n'),
    'https://gentle-river.trycloudflare.com'
  )
  assert.equal(
    extractTunnelUrl('cpolar', '\u001b[32mForwarding https://demo.cpolar.cn -> http://127.0.0.1:4173\u001b[0m'),
    'https://demo.cpolar.cn'
  )
  assert.equal(
    extractTunnelUrl('cpolar', '{"lvl":"info","msg":"started tunnel","url":"https://logged.cpolar.cn"}'),
    'https://logged.cpolar.cn'
  )
  assert.equal(
    extractTunnelUrl('cpolar', 't=2026-08-11T12:00:00 lvl=info url=https://fallback.cpolar.top'),
    'https://fallback.cpolar.top'
  )
})
