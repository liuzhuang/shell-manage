import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { desktopViewportSize, setElectronViewportSize } from './helpers/electron-viewport'
import { skipFirstRunAiGuide } from './helpers/home'

const appEntry = join(process.cwd(), 'dist/main/index.js')

let electronApp: ElectronApplication
let page: Page
let testHome = ''

test.beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-public-access-e2e-'))
  const binDir = join(testHome, 'bin')
  const projectRoot = join(testHome, 'demo-project')
  const configDir = join(testHome, '.shell-manage')
  const port = await getFreePort()
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(join(projectRoot, '.vercel'), { recursive: true }),
    mkdir(configDir, { recursive: true })
  ])
  await writeExecutable(join(binDir, 'vercel'), `#!/bin/sh
printf '%s\n' "$1" >> "${join(testHome, 'vercel-invocations')}"
if [ "$1" = "inspect" ]; then
  printf '%s\n' "$@" > "${join(testHome, 'vercel-inspect.args')}"
  printf '%s\n' '{"aliases":["public-demo.vercel.app"]}'
else
  printf '%s\n' "$@" > "${join(testHome, 'vercel.args')}"
  printf '%s\n' '{"status":"ready","deployment":{"url":"https://protected-demo.vercel.app"}}'
fi
`)
  await writeExecutable(join(binDir, 'cpolar'), `#!/bin/sh
printf '%s\n' "$@" > "${join(testHome, 'cpolar.args')}"
printf '%s\n' 't=2026-08-11T12:00:00 lvl=info url=https://public-demo.cpolar.test'
trap 'exit 0' INT TERM
while :; do sleep 1; done
`)
  await writeExecutable(join(binDir, 'cloudflared'), `#!/bin/sh
printf '%s\n' "$@" > "${join(testHome, 'cloudflared.args')}"
printf '%s\n' '{"message":"https://public-demo.trycloudflare.com"}' >&2
trap 'exit 0' INT TERM
while :; do sleep 1; done
`)
  await writeFile(join(projectRoot, '.vercel', 'project.json'), '{"projectId":"prj_demo","orgId":"team_demo"}', 'utf8')
  await writeFile(join(projectRoot, 'index.html'), '<h1>ShellManage public access demo</h1>', 'utf8')
  await writeFile(join(testHome, '.zshrc'), `export PATH="${binDir}:$PATH"\n`, 'utf8')
  await writeFile(
    join(configDir, 'config.yaml'),
    yaml.dump({
      commands: [
        {
          name: 'public-demo',
          command: `cd "${projectRoot}" && node -e "setTimeout(()=>require('http').createServer((req,res)=>res.end('ok')).listen(${port},'127.0.0.1'),800)"`,
          tags: ['demo'],
          mode: 'service',
          webUrl: `http://localhost:${port}`
        }
      ],
      projectDirectories: [],
      deployScripts: [],
      presets: [],
      settings: {
        llm: {
          provider: 'openai',
          endpoint: 'https://example.invalid',
          apiKey: 'sk-xxxxx',
          model: 'test-model'
        },
        logBufferLines: 5000
      }
    }, { lineWidth: -1 }),
    'utf8'
  )

  await launchTestApp()
})

test.afterEach(async () => {
  await electronApp.close()
  await rm(testHome, { recursive: true, force: true })
})

test('区分云端发布与临时链接，并可依次发布、开启和停止', async () => {
  await setElectronViewportSize(page, desktopViewportSize)
  const moreTrigger = page.getByTestId('command-more-public-demo')
  const menu = page.getByTestId('command-publish-menu-public-demo')
  const openPublishMenu = async () => {
    await moreTrigger.click()
    const publishItem = page.getByRole('menuitem', { name: '发布', exact: true })
    const anchorBox = await publishItem.boundingBox()
    expect(anchorBox).not.toBeNull()
    await publishItem.click()
    await expect(page.getByTestId('command-context-menu')).toBeVisible()
    await expect(publishItem).toHaveAttribute('aria-expanded', 'true')
    await expect(menu).toBeVisible()
    return anchorBox!
  }
  await expect(page.getByTestId('command-publish-public-demo')).toHaveCount(0)
  const publishItemBox = await openPublishMenu()
  await expect(menu).toBeVisible()
  const firstPublishAction = menu.getByRole('button', { name: '复制 Vercel 配置提示词' })
  await expect(firstPublishAction).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(firstPublishAction).toBeFocused()
  const menuBox = await menu.boundingBox()
  const viewport = page.viewportSize()
  expect(menuBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(menuBox!.width).toBeLessThanOrEqual(420)
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width)
  expect(menuBox!.x).toBeGreaterThanOrEqual(publishItemBox.x + publishItemBox.width)
  await expect(menu).toContainText('Vercel（云端长期发布）')
  await expect(menu).toContainText('Cloudflare（海外临时链接）')
  await expect(menu).toContainText('cpolar（国内临时链接）')
  await expect(menu.getByTestId('public-access-start-cloudflare')).toHaveCount(0)
  await expect(menu.getByTestId('public-access-start-cpolar')).toHaveCount(0)

  await menu.getByTestId('public-access-copy-prompt-vercel').click()
  const vercelPrompt = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(vercelPrompt).toContain('禁止执行 vercel deploy --prod')
  expect(vercelPrompt).toContain('请返回 ShellManage')
  expect(vercelPrompt).not.toContain('cpolar')
  expect(vercelPrompt).not.toContain('cloudflared')

  await menu.getByTestId('public-access-copy-prompt-cloudflare').click()
  const cloudflarePrompt = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(cloudflarePrompt).toContain('禁止执行 cloudflared tunnel')
  expect(cloudflarePrompt).not.toContain('cpolar')
  expect(cloudflarePrompt).not.toContain('vercel deploy')

  await menu.getByTestId('public-access-copy-prompt-cpolar').click()
  const cpolarPrompt = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(cpolarPrompt).toContain('禁止执行 cpolar http')
  expect(cpolarPrompt).not.toContain('cloudflared')
  expect(cpolarPrompt).not.toContain('vercel deploy')

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '发布', exact: true })).toBeFocused()
  await expect(page.getByRole('menuitem', { name: '发布', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-context-menu')).toBeHidden()
  await expect(moreTrigger).toBeFocused()

  await setElectronViewportSize(page)
  const compactPublishItemBox = await openPublishMenu()
  const compactMenuBox = await menu.boundingBox()
  expect(compactMenuBox).not.toBeNull()
  expect(compactMenuBox!.x + compactMenuBox!.width).toBeLessThanOrEqual(compactPublishItemBox.x)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-context-menu')).toBeHidden()
  await expect(moreTrigger).toBeFocused()

  await page.getByTestId('command-run-public-demo').click()
  await expect(page.getByTestId('command-run-public-demo')).toContainText('查看日志')
  await openPublishMenu()
  await expect(menu.getByTestId('public-access-start-cloudflare')).toBeVisible()
  await expect(menu.getByTestId('public-access-start-cpolar')).toBeVisible()
  await expect(menu.getByRole('button', { name: '启动 Cloudflare 临时链接' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '启动 cpolar 临时链接' })).toBeVisible()

  page.once('dialog', (dialog) => void dialog.accept())
  await menu.getByTestId('public-access-start-vercel').click()
  await expect(menu.getByTestId('public-access-row-vercel')).toContainText('电脑关闭后仍可访问')
  await expect(menu.getByTestId('public-access-row-vercel')).toContainText('https://public-demo.vercel.app')
  await expect(menu.getByTestId('public-access-start-vercel')).toContainText('重新发布')
  await electronApp.evaluate(({ clipboard }) => clipboard.writeText('before-copy'))
  await menu.getByTestId('public-access-copy-url-vercel').click()
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://public-demo.vercel.app')
  expect((await readFile(join(testHome, 'vercel.args'), 'utf8')).split('\n')).toEqual(expect.arrayContaining(['deploy', '--prod', '--format=json']))
  expect((await readFile(join(testHome, 'vercel-inspect.args'), 'utf8')).split('\n')).toEqual(expect.arrayContaining(['inspect', 'https://protected-demo.vercel.app', '--format=json']))

  await menu.getByTestId('public-access-start-cpolar').click()
  await expect(menu.getByTestId('public-access-row-cpolar')).toContainText('临时链接运行中')
  await expect(menu.getByTestId('public-access-row-cpolar')).toContainText('https://public-demo.cpolar.test')
  await expect(menu.getByTestId('public-access-start-cpolar')).toHaveCount(0)
  await expect(menu.getByTestId('public-access-stop-cpolar')).toBeVisible()
  const cpolarArgs = await readFile(join(testHome, 'cpolar.args'), 'utf8')
  expect(cpolarArgs).toMatch(/-host-header=localhost:\d+/u)
  expect(cpolarArgs).not.toContain('-host-header=rewrite')
  expect(cpolarArgs.split('\n')).toEqual(expect.arrayContaining(['http', '-region=cn', '-log=stdout']))
  await menu.getByTestId('public-access-stop-cpolar').click()
  await expect(menu.getByTestId('public-access-row-cpolar')).toContainText('临时公网链接已停止')
  await expect(menu.getByTestId('public-access-start-cpolar')).toBeVisible()

  await menu.getByTestId('public-access-start-cloudflare').click()
  await expect(menu.getByTestId('public-access-row-cloudflare')).toContainText('临时链接运行中')
  await expect(menu.getByTestId('public-access-row-cloudflare')).toContainText('https://public-demo.trycloudflare.com')
  await expect(menu.getByTestId('public-access-stop-cloudflare')).toBeVisible()
  const cloudflareArgs = await readFile(join(testHome, 'cloudflared.args'), 'utf8')
  expect(cloudflareArgs).toContain('--http-host-header\nlocalhost:')
  expect(cloudflareArgs.split('\n')).toEqual(expect.arrayContaining(['tunnel', '--config', '--output', 'json', '--url']))
  await page.evaluate(async () => {
    const raw = await window.api.configRead()
    await window.api.configSave(raw.replace(/webUrl: http:\/\/localhost:\d+/u, 'webUrl: http://localhost:1'))
  })
  await expect(menu.getByTestId('public-access-row-cloudflare')).toContainText('临时公网链接已停止')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '发布', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-context-menu')).toBeHidden()
  await page.getByTestId('command-stop-public-demo').click()
  await expect(page.getByTestId('command-run-public-demo')).toContainText('启动')

  await moreTrigger.click()
  await expect(page.getByRole('menuitem', { name: '发布', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '发布与公网访问…' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '发布', exact: true }).click()
  await expect(menu).toBeVisible()
  await expect(menu.getByTestId('public-access-row-cloudflare')).toContainText('请先启动本地服务')
  await expect(menu.getByTestId('public-access-start-cloudflare')).toHaveCount(0)
})

test('应用重启后仍显示最近一次 Vercel 生产链接', async () => {
  const openPublishMenu = async () => {
    await page.getByTestId('command-more-public-demo').click()
    await page.getByRole('menuitem', { name: '发布', exact: true }).click()
    await expect(page.getByTestId('command-publish-menu-public-demo')).toBeVisible()
  }

  await openPublishMenu()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByTestId('public-access-start-vercel').click()
  await expect(page.getByTestId('public-access-row-vercel')).toContainText('https://public-demo.vercel.app')
  const invocationsBeforeRestart = await readFile(join(testHome, 'vercel-invocations'), 'utf8')

  await electronApp.close()
  await launchTestApp()
  await openPublishMenu()
  await expect(page.getByTestId('public-access-row-vercel')).toContainText('https://public-demo.vercel.app')
  await expect(page.getByTestId('public-access-start-vercel')).toContainText('重新发布')
  expect(await readFile(join(testHome, 'vercel-invocations'), 'utf8')).toBe(invocationsBeforeRestart)
})

async function launchTestApp(): Promise<void> {
  electronApp = await electron.launch({
    args: [appEntry, '-ApplePersistenceIgnoreState', 'YES'],
    env: {
      ...process.env,
      HOME: testHome,
      SHELL_MANAGE_HOME: testHome,
      PATH: `${join(testHome, 'bin')}:${process.env.PATH || ''}`
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await setElectronViewportSize(page)
  await skipFirstRunAiGuide(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
  await chmod(path, 0o755)
}

async function getFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!port) throw new Error('无法分配测试端口')
  return port
}
