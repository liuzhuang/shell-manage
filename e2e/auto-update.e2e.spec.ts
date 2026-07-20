import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const appEntry = join(process.cwd(), 'dist/main/index.js')

const testConfigYaml = `commands: []
presets: []
settings:
  llm:
    provider: "openai"
    endpoint: "https://example.invalid"
    apiKey: "sk-xxxxx"
    model: "test-model"
  logBufferLines: 5000
`

let electronApp: ElectronApplication
let page: Page
let testHome = ''

test.beforeEach(async () => {
  if (!existsSync(appEntry)) {
    throw new Error('未找到 dist/main/index.js，请先执行 npm run build')
  }

  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-e2e-update-'))
  const configDir = join(testHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'config.yaml'), testConfigYaml, 'utf-8')
})

test.afterEach(async () => {
  await electronApp.close()
})

test('未打包时侧栏检查更新提示未启用', async () => {
  await launchWithHome(testHome, {})
  await expect(page.getByTestId('sidebar-app-version')).toBeVisible()
  await expect(page.getByTestId('sidebar-app-version')).toContainText(/v[\d.]+ Stable/)

  await page.getByTestId('sidebar-check-update').click()
  await expect(page.getByTestId('global-toast')).toContainText('自动更新未启用', { timeout: 5000 })
})

test('E2E 模拟：手动检查更新可走通「已是最新版本」', async () => {
  await launchWithHome(testHome, { SHELL_MANAGE_E2E_UPDATE_SIM: '1' })

  await page.getByTestId('sidebar-check-update').click()
  await expect(page.getByTestId('update-banner')).toContainText('正在检查更新', { timeout: 3000 })
  await expect(page.getByTestId('global-toast')).toContainText('当前已是最新版本', { timeout: 8000 })
})

async function launchWithHome(homeDir: string, extraEnv: Record<string, string>): Promise<void> {
  electronApp = await electron.launch({
    args: [appEntry],
    env: {
      ...process.env,
      SHELL_MANAGE_HOME: homeDir,
      ...extraEnv
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('home-page')).toBeVisible()
}
