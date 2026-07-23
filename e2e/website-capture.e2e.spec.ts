import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopViewportSize, setElectronViewportSize } from './helpers/electron-viewport'

const appEntry = join(process.cwd(), 'dist/main/index.js')
const outputDir = join(process.cwd(), 'docs', 'website', 'assets')

const captureConfig = `commands: []
presets: []
settings:
  llm:
    provider: openai
    endpoint: http://127.0.0.1:9/v1
    apiKey: synthetic-placeholder
    model: synthetic-model
  themePreset: coder
  launchAtLogin: false
  logBufferLines: 5000
`

let electronApp: ElectronApplication
let page: Page
let captureHome = ''

test.skip(process.env.SHELL_MANAGE_CAPTURE_WEBSITE !== '1', 'Set SHELL_MANAGE_CAPTURE_WEBSITE=1 to regenerate website assets')

test.beforeAll(async () => {
  if (!existsSync(appEntry)) throw new Error('Missing dist/main/index.js; run npm run build first')

  captureHome = await mkdtemp(join(tmpdir(), 'shell-manage-website-capture-'))
  const configDir = join(captureHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(configDir, 'config.yaml'), captureConfig, 'utf8')

  electronApp = await electron.launch({
    args: [appEntry, '-ApplePersistenceIgnoreState', 'YES'],
    env: {
      HOME: captureHome,
      SHELL_MANAGE_HOME: captureHome,
      PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
      SHELL: '/bin/zsh',
      TMPDIR: captureHome,
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      USER: 'demo',
      LOGNAME: 'demo'
    }
  })

  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await setElectronViewportSize(page, desktopViewportSize)

  await page.evaluate(() => {
    window.localStorage.setItem('home.aiPromptGuideAfterFirstRun.seen', '1')
    window.localStorage.setItem('home.demoHintSeen', '1')
    window.localStorage.setItem('shell-manage-theme', 'dark')
    window.localStorage.setItem('shell-manage-theme-preset', 'coder')
  })
  await page.reload()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-全部').click()
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'
  })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
})

test.afterAll(async () => {
  if (electronApp) await electronApp.close().catch(() => undefined)
  if (captureHome) await rm(captureHome, { recursive: true, force: true })
})

test('capture privacy-safe real runtime website images', async () => {
  test.setTimeout(120_000)

  await page.getByTestId('command-create-trigger').click()
  await expect(page.getByTestId('command-create-pick-manual')).toBeVisible()
  await capture('02-add-command-choices.png')
  await page.getByTestId('command-create-pick-demo').click()
  await expect(page.getByTestId('demo-commands-modal')).toBeVisible()
  await page.getByTestId('demo-commands-confirm').click()
  await expect(page.getByTestId('global-toast')).toContainText('演示命令已导入', { timeout: 8_000 })

  await page.getByTestId('tag-演示').click()
  await page.getByTestId('command-run-demo-service').click()
  await expect(page.getByTestId('command-row-demo-service')).toContainText('正在运行', { timeout: 15_000 })
  await page.getByTestId('command-run-demo-bad-exit').click()
  await expect(page.getByTestId('command-row-demo-bad-exit')).toContainText('运行异常', { timeout: 15_000 })
  await expect(page.getByTestId('command-row-demo-terminal')).toContainText('未启动')
  await expect(page.getByTestId('global-toast')).toHaveCount(0, { timeout: 8_000 })
  await capture('01-command-workspace.png', { x: 0, y: 0, width: 1440, height: 520 })

  await page.getByTestId('command-run-demo-service').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-lines')).toContainText('demo-service tick 4', { timeout: 10_000 })
  await capture('03-live-service-logs.png')
  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-演示').click()

  await page.getByTestId('command-run-demo-terminal').click()
  await expect(page.getByTestId('terminal-page')).toContainText('demo-terminal heartbeat 2', { timeout: 10_000 })
  await capture('04-interactive-terminal.png')
})

async function capture(
  fileName: string,
  clip?: { x: number; y: number; width: number; height: number }
): Promise<void> {
  await page.screenshot({
    path: join(outputDir, fileName),
    animations: 'disabled',
    scale: 'css',
    clip: clip ?? { x: 0, y: 0, width: 1440, height: 824 }
  })
}
