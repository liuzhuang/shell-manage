import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'
import { skipFirstRunAiGuide } from './helpers/home'

const appEntry = join(process.cwd(), 'dist/main/index.js')

const testConfigYaml = `commands:
  - name: svc-alpha
    command: node -e "console.log('alpha-start'); setInterval(() => console.log('alpha-tick'), 300)"
    tags: [backend]
    autoRestart: false
  - name: svc-beta
    command: node -e "console.log('beta-start'); setInterval(() => console.log('beta-tick'), 300)"
    tags: [backend]
    autoRestart: false
  - name: svc-gamma
    command: node -e "console.log('gamma-start'); setInterval(() => console.log('gamma-tick'), 300)"
    tags: [frontend]
    autoRestart: false
  - name: term-only
    command: node -e "console.log('term-only'); setInterval(() => {}, 1000)"
    tags: [backend]
    mode: terminal
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

async function resetHomeTag(targetPage: Page = page) {
  await targetPage.getByTestId('tag-全部').click()
}

async function openAddLogDashboardSheet(targetPage: Page = page) {
  await resetHomeTag(targetPage)
  await targetPage.getByTestId('log-dashboard-add-trigger').click()
  await expect(targetPage.getByTestId('batch-log-modal')).toBeVisible()
}

async function savePreset(
  targetPage: Page = page,
  opts?: { name?: string; selectAll?: boolean; commands?: string[] }
) {
  if (opts?.selectAll) {
    await targetPage.getByTestId('batch-log-select-all').check()
  } else if (opts?.commands) {
    for (const cmd of opts.commands) {
      await targetPage.getByTestId(`batch-log-item-${cmd}`).locator('input').check()
    }
  }
  if (opts?.name) {
    await targetPage.getByTestId('batch-log-preset-name').fill(opts.name)
  }
  await targetPage.getByTestId('batch-log-save-preset').click()
  await expect(targetPage.getByTestId('batch-log-modal')).toHaveCount(0)
}

async function openMultiLogViaPreset(presetName: string, targetPage: Page = page) {
  await targetPage.getByTestId(`log-dashboard-preset-item-${presetName}`).click()
  await expect(targetPage.getByTestId('multi-log-page')).toBeVisible()
}

test.beforeEach(async () => {
  if (!existsSync(appEntry)) {
    throw new Error('未找到 dist/main/index.js，请先执行 npm run build')
  }
  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-batch-log-e2e-'))
  const configDir = join(testHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'config.yaml'), testConfigYaml, 'utf-8')
  electronApp = await electron.launch({
    args: [appEntry],
    env: {
      ...process.env,
      HOME: testHome,
      SHELL_MANAGE_HOME: testHome
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await skipFirstRunAiGuide(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
  await resetHomeTag(page)
})

test.afterEach(async () => {
  await electronApp.close().catch(() => {})
})

// ─── 底部 Dock 添加入口 ───────────────────────────────────────────────────────

test('无预设时 Dock 仍可见且包含添加看板卡片', async () => {
  await expect(page.getByTestId('log-dashboard-presets-panel')).toBeVisible()
  await expect(page.getByTestId('log-dashboard-add-trigger')).toBeVisible()
  await expect(page.getByTestId('log-dashboard-add-trigger')).toContainText('添加看板')
  await expect(page.getByTestId('log-dashboard-empty-hint')).toBeVisible()
  await expect(page.locator('[data-testid^="log-dashboard-preset-item-"]')).toHaveCount(0)
})

test('点击 Dock 添加卡打开添加 Sheet', async () => {
  await openAddLogDashboardSheet()
  await expect(page.getByTestId('batch-log-modal')).toContainText('添加日志看板')
})

// ─── 添加日志看板 Sheet ──────────────────────────────────────────────────────

test('Sheet 仅显示 service 模式命令', async () => {
  await openAddLogDashboardSheet()

  await expect(page.getByTestId('batch-log-item-svc-alpha')).toBeVisible()
  await expect(page.getByTestId('batch-log-item-svc-beta')).toBeVisible()
  await expect(page.getByTestId('batch-log-item-svc-gamma')).toBeVisible()
  await expect(page.locator('[data-testid="batch-log-item-term-only"]')).toHaveCount(0)
})

test('Sheet 按当前 tag 过滤命令', async () => {
  await page.getByTestId('tag-frontend').click()
  await page.getByTestId('log-dashboard-add-trigger').click()
  await expect(page.getByTestId('batch-log-modal')).toBeVisible()

  await expect(page.getByTestId('batch-log-item-svc-gamma')).toBeVisible()
  await expect(page.locator('[data-testid="batch-log-item-svc-alpha"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="batch-log-item-svc-beta"]')).toHaveCount(0)
})

test('Sheet 取消按钮可关闭', async () => {
  await openAddLogDashboardSheet()
  await page.getByRole('button', { name: '取消' }).first().click()
  await expect(page.getByTestId('batch-log-modal')).toHaveCount(0)
})

test('Sheet 点击遮罩可关闭', async () => {
  await openAddLogDashboardSheet()
  await page.locator('[role="presentation"]').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('batch-log-modal')).toHaveCount(0)
})

test('Sheet 全选功能影响保存看板按钮状态', async () => {
  await openAddLogDashboardSheet()

  await page.getByTestId('batch-log-select-all').check()
  await expect(page.getByTestId('batch-log-save-preset')).toBeEnabled()
  await expect(page.getByTestId('batch-log-save-preset')).toContainText('保存看板')

  await page.getByTestId('batch-log-select-all').uncheck()
  await expect(page.getByTestId('batch-log-save-preset')).toBeDisabled()
})

// ─── 日志预设 ────────────────────────────────────────────────────────────────

test('可将勾选命令保存为日志预设并显示在首页预设面板', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '后端核心组', commands: ['svc-alpha', 'svc-beta'] })

  await expect(page.getByTestId('log-dashboard-presets-panel')).toBeVisible()
  await expect(page.getByTestId('log-dashboard-preset-item-后端核心组')).toBeVisible()
})

test('预设名称留空时自动生成动漫风格名称', async () => {
  await openAddLogDashboardSheet()
  await page.getByTestId('batch-log-item-svc-alpha').locator('input').check()
  await expect(page.getByTestId('batch-log-save-preset')).toBeEnabled()
  await page.getByTestId('batch-log-save-preset').click()
  await expect(page.getByTestId('batch-log-modal')).toHaveCount(0)

  await expect(page.getByTestId('log-dashboard-presets-panel')).toBeVisible()
  await expect(page.locator('[data-testid^="log-dashboard-preset-item-"]')).toHaveCount(1)
})

test('点击预设面板中的预设可一键打开日志看板', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '后端核心组', commands: ['svc-alpha', 'svc-beta'] })

  await openMultiLogViaPreset('后端核心组')
  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toBeVisible()
  await expect(page.getByTestId('multi-log-pane-svc-beta')).toBeVisible()
})

test('预设重名时需确认覆盖，确认后替换为新组合', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '后端核心组', commands: ['svc-alpha', 'svc-beta'] })

  await openAddLogDashboardSheet()
  await page.getByTestId('batch-log-item-svc-alpha').locator('input').uncheck()
  await page.getByTestId('batch-log-item-svc-beta').locator('input').uncheck()
  await page.getByTestId('batch-log-item-svc-gamma').locator('input').check()
  await page.getByTestId('batch-log-preset-name').fill('后端核心组')
  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByTestId('batch-log-save-preset').click()
  await expect(page.getByTestId('batch-log-modal')).toHaveCount(0)

  await openMultiLogViaPreset('后端核心组')
  await expect(page.getByTestId('multi-log-pane-svc-gamma')).toBeVisible()
  await expect(page.locator('[data-testid="multi-log-pane-svc-alpha"]')).toHaveCount(0)
})

test('删除预设后首页预设面板中该项应消失', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '临时组', commands: ['svc-alpha'] })

  await expect(page.getByTestId('log-dashboard-preset-item-临时组')).toBeVisible()

  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByTestId('log-dashboard-preset-delete-临时组').click()
  await expect(page.locator('[data-testid="log-dashboard-preset-item-临时组"]')).toHaveCount(0)
})

test('预设包含失效命令时会自动忽略并打开剩余面板', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '后端核心组', commands: ['svc-alpha', 'svc-beta'] })

  await electronApp.close()
  const configPath = join(testHome, '.shell-manage', 'config.yaml')
  const raw = await readFile(configPath, 'utf-8')
  const parsed = yaml.load(raw) as {
    commands: Array<{ name: string }>
    settings: { logViewPresets?: Array<{ name: string; commandNames: string[] }> }
  }
  parsed.commands = parsed.commands.filter((item) => item.name !== 'svc-beta')
  await writeFile(configPath, yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true }), 'utf-8')
  await launchWithHome(testHome)

  await openMultiLogViaPreset('后端核心组')
  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toBeVisible()
  await expect(page.locator('[data-testid="multi-log-pane-svc-beta"]')).toHaveCount(0)
})

// ─── 日志看板页面 ─────────────────────────────────────────────────────────────

test('保存预设后点击 Dock 卡片进入日志看板', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '全选组', selectAll: true })

  await openMultiLogViaPreset('全选组')
  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toBeVisible()
  await expect(page.getByTestId('multi-log-pane-svc-beta')).toBeVisible()
  await expect(page.getByTestId('multi-log-pane-svc-gamma')).toBeVisible()
})

test('多日志视图返回按钮可回到首页', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '全选组', selectAll: true })
  await openMultiLogViaPreset('全选组')

  await page.getByTestId('multi-log-back').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('多日志视图可移除单个日志面板', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '全选组', selectAll: true })
  await openMultiLogViaPreset('全选组')

  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toBeVisible()
  await page.getByTestId('multi-log-remove-svc-alpha').click()
  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toHaveCount(0)
  await expect(page.getByTestId('multi-log-pane-svc-beta')).toBeVisible()
})

test('移除所有日志面板后自动返回首页', async () => {
  await page.getByTestId('tag-frontend').click()
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '前端组', commands: ['svc-gamma'] })
  await openMultiLogViaPreset('前端组')

  await page.getByTestId('multi-log-remove-svc-gamma').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
})

// ─── 跳转命令详情 ─────────────────────────────────────────────────────────────

test('日志看板面板跳转按钮可打开单命令日志详情', async () => {
  await openAddLogDashboardSheet()
  await savePreset(page, { name: '全选组', selectAll: true })
  await openMultiLogViaPreset('全选组')

  await page.getByTestId('multi-log-open-detail-svc-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-page')).toContainText('svc-alpha')
})

// ─── 日志数据展示 ─────────────────────────────────────────────────────────────

test('多日志视图实时展示运行中命令的日志输出', async () => {
  async function startServiceAndReturnHome(commandName: string) {
    await page.getByTestId(`command-run-${commandName}`).click()
    await expect(page.getByTestId(`command-run-${commandName}`)).toContainText('查看日志', { timeout: 15000 })
    await page.getByTestId(`command-run-${commandName}`).click()
    await page.getByTestId('log-back-icon').click()
    await expect(page.getByTestId('home-page')).toBeVisible()
  }

  await startServiceAndReturnHome('svc-alpha')
  await startServiceAndReturnHome('svc-beta')

  await openAddLogDashboardSheet()
  await savePreset(page, { name: '运行组', commands: ['svc-alpha', 'svc-beta'] })
  await openMultiLogViaPreset('运行组')

  await expect(page.getByTestId('multi-log-pane-svc-alpha')).toContainText('alpha-start', { timeout: 10000 })
  await expect(page.getByTestId('multi-log-pane-svc-beta')).toContainText('beta-start', { timeout: 10000 })
})

// ─── 日志看板画廊预设 + 跳转详情（新增 feature 专项） ─────────────────────────

test.describe('日志看板画廊预设交互', () => {
  test('预设条悬浮在底部，未滚到底部也应可见', async () => {
    await electronApp.close()
    const configPath = join(testHome, '.shell-manage', 'config.yaml')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = yaml.load(raw) as {
      commands: Array<{ name: string; command: string; tags?: string[]; autoRestart?: boolean; mode?: string }>
      settings: { logViewPresets?: Array<{ name: string; commandNames: string[] }>; [key: string]: unknown }
      [key: string]: unknown
    }

    const generatedCommands = Array.from({ length: 42 }).map((_, idx) => ({
      name: `svc-load-${idx + 1}`,
      command: `node -e \"setInterval(() => {}, 1000)\"`,
      tags: ['load'],
      autoRestart: false
    }))

    parsed.commands = generatedCommands
    parsed.settings = parsed.settings || {}
    parsed.settings.logViewPresets = [{ name: '底部悬浮验证', commandNames: ['svc-load-1', 'svc-load-2'] }]
    await writeFile(configPath, yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true }), 'utf-8')

    await launchWithHome(testHome)

    const panel = page.getByTestId('log-dashboard-presets-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByTestId('log-dashboard-preset-item-底部悬浮验证')).toBeVisible()
    await expect(page.getByTestId('log-dashboard-add-trigger')).toBeVisible()

    const initialBox = await panel.boundingBox()
    expect(initialBox).not.toBeNull()

    await page.mouse.wheel(0, 2200)
    await page.waitForTimeout(180)

    const afterScrollBox = await panel.boundingBox()
    expect(afterScrollBox).not.toBeNull()
    expect(afterScrollBox!.y).toBeGreaterThan(0)
    expect(Math.abs(afterScrollBox!.y - initialBox!.y)).toBeLessThan(20)
  })

  test('预设画廊以平行四边形卡片水平展示', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '画廊测试组', commands: ['svc-alpha', 'svc-beta'] })

    const panel = page.getByTestId('log-dashboard-presets-panel')
    await expect(panel).toBeVisible()
    const item = page.getByTestId('log-dashboard-preset-item-画廊测试组')
    await expect(item).toBeVisible()

    const box = await item.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(80)
    expect(box!.height).toBeGreaterThan(40)
  })

  test('多个预设水平排列且可点击打开', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '组A', commands: ['svc-alpha'] })

    await openAddLogDashboardSheet()
    await page.getByTestId('batch-log-item-svc-beta').locator('input').check()
    await page.getByTestId('batch-log-item-svc-alpha').locator('input').uncheck()
    await page.getByTestId('batch-log-preset-name').fill('组B')
    await page.getByTestId('batch-log-save-preset').click()
    await expect(page.getByTestId('batch-log-modal')).toHaveCount(0)

    await expect(page.getByTestId('log-dashboard-preset-item-组A')).toBeVisible()
    await expect(page.getByTestId('log-dashboard-preset-item-组B')).toBeVisible()

    const panel = page.getByTestId('log-dashboard-presets-panel')
    const panelBox = await panel.boundingBox()
    expect(panelBox).not.toBeNull()
    const items = await page.locator('[data-testid^="log-dashboard-preset-item-"]').count()
    expect(items).toBe(2)

    await openMultiLogViaPreset('组B')
    await expect(page.getByTestId('multi-log-pane-svc-beta')).toBeVisible()
  })

  test('画廊预设项可通过删除按钮移除', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '待删除', commands: ['svc-gamma'] })

    await expect(page.getByTestId('log-dashboard-preset-item-待删除')).toBeVisible()
    page.once('dialog', async (dialog) => dialog.accept())
    await page.getByTestId('log-dashboard-preset-delete-待删除').click()
    await expect(page.locator('[data-testid="log-dashboard-preset-item-待删除"]')).toHaveCount(0)
  })

  test('画廊预设项显示重命名按钮', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '旧名', commands: ['svc-alpha'] })

    await expect(page.getByTestId('log-dashboard-preset-item-旧名')).toBeVisible()
    await expect(page.getByTestId('log-dashboard-preset-rename-旧名')).toBeVisible()
  })

  test('无预设时 Dock 仍显示添加卡', async () => {
    await expect(page.getByTestId('log-dashboard-presets-panel')).toBeVisible()
    await expect(page.getByTestId('log-dashboard-add-trigger')).toBeVisible()
    await expect(page.locator('[data-testid^="log-dashboard-preset-item-"]')).toHaveCount(0)
  })
})

test.describe('日志看板跳转详情', () => {
  test('每个面板显示跳转按钮', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '全选组', selectAll: true })
    await openMultiLogViaPreset('全选组')

    await expect(page.getByTestId('multi-log-open-detail-svc-alpha')).toBeVisible()
    await expect(page.getByTestId('multi-log-open-detail-svc-beta')).toBeVisible()
    await expect(page.getByTestId('multi-log-open-detail-svc-gamma')).toBeVisible()
  })

  test('跳转后详情页显示对应命令名称', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '全选组', selectAll: true })
    await openMultiLogViaPreset('全选组')

    await page.getByTestId('multi-log-open-detail-svc-beta').click()
    await expect(page.getByTestId('log-page')).toBeVisible()
    await expect(page.getByTestId('log-page')).toContainText('svc-beta')
  })

  test('跳转详情后可返回首页', async () => {
    await openAddLogDashboardSheet()
    await savePreset(page, { name: '全选组', selectAll: true })
    await openMultiLogViaPreset('全选组')

    await page.getByTestId('multi-log-open-detail-svc-gamma').click()
    await expect(page.getByTestId('log-page')).toBeVisible()
    await page.getByTestId('log-back-icon').click()
    await expect(page.getByTestId('home-page')).toBeVisible()
  })
})

async function launchWithHome(homeDir: string): Promise<void> {
  electronApp = await electron.launch({
    args: [appEntry],
    env: {
      ...process.env,
      HOME: homeDir,
      SHELL_MANAGE_HOME: homeDir
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await skipFirstRunAiGuide(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
  await resetHomeTag(page)
}
