import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectProjectsFromRoot } from './project-detector'

test('project-detector: Next.js 优先于 React 且识别 pnpm 命令', async () => {
  const root = await mkdtemp(join(tmpdir(), 'detector-next-'))
  await mkdir(join(root, 'web'), { recursive: true })
  await writeFile(
    join(root, 'web', 'package.json'),
    JSON.stringify(
      {
        dependencies: { react: '^19.0.0', next: '^15.0.0' },
        scripts: { dev: 'next dev' }
      },
      null,
      2
    ),
    'utf-8'
  )
  await writeFile(join(root, 'web', 'pnpm-lock.yaml'), 'lockfileVersion: 9', 'utf-8')

  const projects = await detectProjectsFromRoot(root, { maxDepth: 3, maxDirs: 200 })
  const web = projects.find((item) => item.name === 'web')
  assert.ok(web)
  assert.equal(web.type, 'nextjs')
  assert.match(web.command, /pnpm dev/)
})

test('project-detector: 忽略 node_modules 目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'detector-ignore-'))
  await mkdir(join(root, 'node_modules', 'fake-react'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', 'fake-react', 'package.json'),
    JSON.stringify(
      {
        dependencies: { react: '^19.0.0' },
        scripts: { dev: 'vite' }
      },
      null,
      2
    ),
    'utf-8'
  )

  const projects = await detectProjectsFromRoot(root, { maxDepth: 3, maxDirs: 200 })
  assert.equal(projects.length, 0)
})

test('project-detector: Python manage.py 生成 runserver 命令', async () => {
  const root = await mkdtemp(join(tmpdir(), 'detector-py-'))
  await mkdir(join(root, 'api'), { recursive: true })
  await writeFile(join(root, 'api', 'manage.py'), 'print("manage")', 'utf-8')

  const projects = await detectProjectsFromRoot(root, { maxDepth: 3, maxDirs: 200 })
  const api = projects.find((item) => item.name === 'api')
  assert.ok(api)
  assert.equal(api.type, 'python')
  assert.match(api.command, /python manage\.py runserver/)
})
