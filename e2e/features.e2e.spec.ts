import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAiCommandForm, openCommandFormPickStep, openDemoCommandForm, confirmDemoCommandImport, cleanupDemoCommandsFromForm } from './helpers/command-form'
import { setElectronViewportSize } from './helpers/electron-viewport'
import { setHiddenHomeSearch, skipFirstRunAiGuide } from './helpers/home'

const appEntry = join(process.cwd(), 'dist/main/index.js')
const skillInstallCommand =
  'npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy'

const testConfigYaml = `commands:
  - name: alpha
    command: node -e "console.log('alpha-start'); setInterval(() => console.log('alpha-tick'), 300)"
    tags: [api]
    color: blue
    autoRestart: false
  - name: bad
    command: node -e "console.error('bad-boom'); process.exit(2)"
    tags: [web]
    color: red
    autoRestart: false
  - name: beta
    command: node -e "console.log('beta-start'); setInterval(() => console.log('beta-tick'), 300)"
    tags: [api, ops]
    color: green
    autoRestart: false
projectDirectories:
  - id: project-alpha
    name: alpha-project
    path: /tmp/shell-manage-alpha
deployScripts:
  - id: deploy-alpha
    name: deploy-alpha
    content: echo {{alpha-project}}
presets: []
settings:
  llm:
    provider: "openai"
    endpoint: "https://example.invalid"
    apiKey: "sk-xxxxx"
    model: "test-model"
  logBufferLines: 5000
`

const sidebarPerformanceConfigYaml = `commands:
${Array.from({ length: 32 }, (_, index) => `  - name: command-${index + 1}
    command: node -e "console.log('command-${index + 1}')"
    tags: [api, local]
    mode: ${index < 12 ? 'terminal' : 'service'}
    autoRestart: false`).join('\n')}
projectDirectories: []
deployScripts: []
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

async function measureSidebarSwitch(targetTestId: string, pageTestId: string): Promise<number> {
  return page.evaluate(
    ({ targetTestId, pageTestId }) =>
      new Promise<number>((resolve, reject) => {
        const target = document.querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`)
        if (!target) {
          reject(new Error(`未找到侧栏入口：${targetTestId}`))
          return
        }
        const startedAt = performance.now()
        target.click()
        const waitForPage = () => {
          if (!document.querySelector(`[data-testid="${pageTestId}"]`)) {
            if (performance.now() - startedAt >= 2000) {
              reject(new Error(`页面未完成切换：${pageTestId}`))
              return
            }
            requestAnimationFrame(waitForPage)
            return
          }
          requestAnimationFrame(() => {
            resolve(performance.now() - startedAt)
          })
        }
        requestAnimationFrame(waitForPage)
      }),
    { targetTestId, pageTestId }
  )
}

test.beforeEach(async ({}, testInfo) => {
  if (!existsSync(appEntry)) {
    throw new Error('未找到 dist/main/index.js，请先执行 npm run build')
  }
  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-feat-e2e-'))
  const configDir = join(testHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, 'config.yaml'),
    testInfo.title === '侧边栏 Tab 首次加载与重复切换保持响应' ? sidebarPerformanceConfigYaml : testConfigYaml,
    'utf-8'
  )
  await launchWithHome(testHome)
})

test.afterEach(async () => {
  await electronApp.close()
})

// ─── 首页搜索 ────────────────────────────────────────────────────────────────

test('首页搜索框隐藏但仍可按命令名称过滤卡片', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('home-search')).toBeHidden()
  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()

  await setHiddenHomeSearch(page, 'alpha')
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)
  await expect(page.getByTestId('command-row-beta')).toHaveCount(0)
})

test('隐藏搜索仍可按标签名称过滤卡片', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await setHiddenHomeSearch(page, 'ops')
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
  await expect(page.getByTestId('command-row-alpha')).toHaveCount(0)
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)
})

test('隐藏搜索清空后还原全部命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-全部').click()

  await setHiddenHomeSearch(page, 'alpha')
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)

  await setHiddenHomeSearch(page, '')
  await expect(page.getByTestId('home-search')).toHaveValue('')
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
})

test('首页搜索无结果时命令列表为空', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await setHiddenHomeSearch(page, 'xyzzy-no-match-e2e')
  await expect(page.getByTestId('command-row-alpha')).toHaveCount(0)
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)
  await expect(page.getByTestId('command-row-beta')).toHaveCount(0)
})

// ─── 标签过滤 ────────────────────────────────────────────────────────────────

test('首页默认选中第一个真实标签并过滤命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)
})

test('点击标签只显示该标签下的命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('tag-api').click()
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toHaveCount(0)
})

test('点击 web 标签仅显示 bad 命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('tag-web').click()
  await expect(page.getByTestId('command-row-bad')).toBeVisible()
  await expect(page.getByTestId('command-row-alpha')).toHaveCount(0)
  await expect(page.getByTestId('command-row-beta')).toHaveCount(0)
})

test('点击"全部"标签取消过滤还原所有命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('tag-web').click()
  await expect(page.getByTestId('command-row-alpha')).toHaveCount(0)

  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
})

// ─── 侧边栏折叠/展开 ─────────────────────────────────────────────────────────

const sidebarPerformanceTest = process.env.SHELL_MANAGE_E2E_SKIP_PERFORMANCE ? test.skip : test

sidebarPerformanceTest('侧边栏 Tab 首次加载与重复切换保持响应', async () => {
  const measureRound = async () => [
    await measureSidebarSwitch('tab-editor', 'editor-page'),
    await measureSidebarSwitch('tab-home', 'home-page'),
    await measureSidebarSwitch('tab-browser', 'browser-page'),
    await measureSidebarSwitch('tab-home', 'home-page'),
    await measureSidebarSwitch('tab-monitoring', 'monitoring-page'),
    await measureSidebarSwitch('tab-home', 'home-page'),
    await measureSidebarSwitch('tab-ssh-keys', 'ssh-keys-page'),
    await measureSidebarSwitch('tab-collaboration', 'collaboration-page')
  ]
  const firstRound = await measureRound()
  const secondRound = await measureRound()

  expect(firstRound[4], `监控页首次加载：${firstRound[4].toFixed(1)}ms`).toBeLessThan(120)
  // 首次挂载以 60Hz 下最多四帧为预算；重复切换仍必须稳定在 50ms 内。
  expect(
    Math.max(...firstRound.filter((_, index) => index !== 4)),
    `其他页面首次切换：${firstRound.map((value) => `${value.toFixed(1)}ms`).join(', ')}`
  ).toBeLessThan(75)
  expect(
    Math.max(...secondRound),
    `重复切换：${secondRound.map((value) => `${value.toFixed(1)}ms`).join(', ')}`
  ).toBeLessThan(50)
})

test('侧边栏可折叠为图标模式', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  const sidebar = page.locator('[data-sidebar-collapsed]')
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false')
  await expect(sidebar).toHaveCSS('width', '160px')
  await expect(page.getByTestId('sidebar-footer').getByTestId('theme-toggle')).toBeVisible()
  await expect(page.getByTestId('sidebar-theme-label')).toBeVisible()
  await expect(page.getByTestId('titlebar-page-illustration')).toHaveCount(0)
  await expect(page.getByTestId('tab-home')).toContainText('命令')

  await page.getByRole('button', { name: '仅显示图标' }).click()
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true')
  expect((await sidebar.boundingBox())?.width).toBe(process.platform === 'darwin' ? 78 : 56)
  await expect(page.getByTestId('sidebar-theme-label')).toHaveCount(0)
  await expect(page.getByTestId('tab-home')).not.toContainText('命令')
})

test('顶部与侧栏保留窗口拖拽面且控件仍可点击', async () => {
  const topDragRegion = page.getByTestId('window-top-drag-region')
  await expect(topDragRegion).toHaveCSS('-webkit-app-region', 'drag')
  await expect(topDragRegion).toHaveCSS('height', '16px')
  await expect(page.locator('[data-sidebar-collapsed]')).toHaveCSS('-webkit-app-region', 'drag')
  await expect(page.getByTestId('theme-toggle')).toHaveCSS('-webkit-app-region', 'no-drag')

  await page.getByTestId('tab-browser').click()
  await expect(page.getByTestId('browser-tab-row')).toHaveCSS('-webkit-app-region', 'drag')
  await expect(page.getByTestId('browser-new-tab')).toHaveCSS('-webkit-app-region', 'no-drag')
})

test('双击顶部拖拽区切换窗口最大化与还原', async () => {
  await expect.poll(async () => electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return null
    if (win.isFullScreen()) win.setFullScreen(false)
    if (win.isMaximized()) win.unmaximize()
    win.setBounds({ width: 900, height: 600 }, false)
    const bounds = win.getBounds()
    return {
      expanded: win.isFullScreen() || win.isMaximized(),
      width: bounds.width,
      height: bounds.height
    }
  })).toEqual({ expanded: false, width: 900, height: 600 })

  const topDragRegion = page.getByTestId('window-top-drag-region')
  await expect.poll(async () => (await page.evaluate(() => window.api.getWindowFullscreen())).fullscreen).toBe(false)

  await topDragRegion.dblclick()
  await expect.poll(async () => (await page.evaluate(() => window.api.getWindowFullscreen())).fullscreen).toBe(true)

  await topDragRegion.dblclick()
  await expect.poll(async () => (await page.evaluate(() => window.api.getWindowFullscreen())).fullscreen).toBe(false)
})

test('侧边栏图标模式可展开恢复文字', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  const sidebar = page.locator('[data-sidebar-collapsed]')

  await page.getByRole('button', { name: '仅显示图标' }).click()
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true')

  await page.getByRole('button', { name: '展开侧栏' }).click()
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false')
  expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(160)
  await expect(page.getByTestId('tab-home')).toContainText('命令')
  await expect(page.getByTestId('tab-editor')).toContainText('设置')
})

test('侧边栏折叠状态持久化到 localStorage', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByRole('button', { name: '仅显示图标' }).click()
  await expect(page.locator('[data-sidebar-collapsed]')).toHaveAttribute('data-sidebar-collapsed', 'true')
  const stored = await page.evaluate(() => window.localStorage.getItem('sidebar.iconOnly'))
  expect(stored).toBe('1')

  await page.getByRole('button', { name: '展开侧栏' }).click()
  const storedExpanded = await page.evaluate(() => window.localStorage.getItem('sidebar.iconOnly'))
  expect(storedExpanded).toBe('0')
})

test('侧边栏折叠时导航 tab 仍可点击切换页面', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByRole('button', { name: '仅显示图标' }).click()
  await expect(page.locator('[data-sidebar-collapsed]')).toHaveAttribute('data-sidebar-collapsed', 'true')

  await page.getByTestId('tab-editor').click()
  await expect(page.getByTestId('editor-page')).toBeVisible()

  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('设置页将 AI 独立为 Tab 并隐藏预设编辑入口', async () => {
  await page.getByTestId('tab-editor').click()

  const tabs = page.getByRole('tablist', { name: '配置分区' })
  await expect(tabs.getByRole('tab')).toHaveText(['命令', 'AI', '全局设置'])
  await expect(page.getByTestId('visual-tab-presets')).toHaveCount(0)

  await page.getByTestId('visual-tab-ai').click()
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'AI 配置' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toContainText('AI 模型')
  await expect(page.getByRole('tabpanel')).toContainText('LANGSMITH_TRACING')
  await expect(page.getByRole('tabpanel')).toContainText('LANGSMITH_ENDPOINT')
  await expect(page.getByRole('tabpanel')).toContainText('LANGSMITH_API_KEY')
  await expect(page.getByRole('tabpanel')).toContainText('LANGSMITH_PROJECT')
  await page.getByTestId('visual-langsmith-tracing').uncheck()
  await page.getByTestId('visual-langsmith-endpoint').fill('https://smith.example')
  await page.getByTestId('visual-langsmith-api-key').fill('langsmith-test-key')
  await page.getByTestId('visual-langsmith-project').fill('shell-manage-e2e')
  await page.getByTestId('editor-save').click()
  await expect.poll(async () => {
    const saved = await page.evaluate(() => window.api.configRead())
    return ['tracing: false', 'endpoint: https://smith.example', 'apiKey: langsmith-test-key', 'project: shell-manage-e2e']
      .every((entry) => saved.includes(entry))
  }).toBe(true)
  await expect(page.getByRole('tabpanel')).not.toContainText('基础设置')

  await page.getByTestId('visual-tab-settings').click()
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: '基础设置' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).not.toContainText('AI 配置')
})

test('协作页使用顶部 Tab 并将协作包操作放在页头', async () => {
  await page.getByTestId('tab-collaboration').click()

  const header = page.getByTestId('collaboration-header')
  await expect(header.getByRole('heading', { name: '协作' })).toBeVisible()
  await expect(header.getByTestId('collaboration-import-bundle')).toHaveText('导入')
  await expect(header.getByTestId('collaboration-copy-bundle')).toHaveText('分享')

  const tabs = page.getByRole('tablist', { name: '协作子页面' })
  const directoriesTab = tabs.getByRole('tab', { name: '项目目录 1' })
  const scriptsTab = tabs.getByRole('tab', { name: '脚本 1' })
  await expect(tabs.getByRole('tab')).toHaveText(['脚本1', '项目目录1'])
  await expect(directoriesTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('project-directories-page')).toBeVisible()

  await scriptsTab.click()
  await expect(scriptsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('deploy-script-editor-page')).toBeVisible()
})

test('侧边栏展示最近打开命令入口并支持回到日志页', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-recent-section')).toBeVisible()
  await expect(page.getByTestId('sidebar-recent-item-alpha')).toBeVisible()

  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('sidebar-recent-item-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-page')).toContainText('alpha')
})

test('侧边栏最近命令可删除且不会删除配置命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await expect(page.getByTestId('sidebar-recent-item-alpha')).toBeVisible()
  await page.getByTestId('sidebar-recent-item-alpha').hover()
  await page.getByTestId('sidebar-recent-remove-alpha').click()
  await expect(page.getByTestId('sidebar-recent-item-alpha')).toHaveCount(0)
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
})

test('同一命令重复打开时侧边栏最近入口保持去重', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('sidebar-recent-item-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await expect(page.getByTestId('sidebar-recent-item-alpha')).toHaveCount(1)
})

test('命令二级页返回首页时命中最近入口会触发最小化动画', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-recent-item-alpha')).toBeVisible()

  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('dock-minimize-overlay')).toBeVisible()
  await expect(page.getByTestId('dock-minimize-overlay')).toHaveCount(0, { timeout: 3000 })
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('命令二级页返回首页时未命中最近入口不触发最小化动画', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-recent-item-alpha')).toBeVisible()

  await page.getByTestId('sidebar-recent-remove-alpha').evaluate((button) => {
    ;(button as HTMLButtonElement).click()
  })
  await expect(page.getByTestId('sidebar-recent-item-alpha')).toHaveCount(0)

  await page.getByTestId('log-back-icon').click()
  await expect(page.getByTestId('dock-minimize-overlay')).toHaveCount(0)
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('菜单快捷键可切换页面', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.keyboard.press(`${modKey}+2`)
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()

  await page.keyboard.press(`${modKey}+3`)
  await expect(page.getByTestId('monitoring-page')).toBeVisible()

  await page.keyboard.press(`${modKey}+4`)
  await expect(page.getByTestId('editor-page')).toBeVisible()

  await page.keyboard.press(`${modKey}+1`)
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('快捷键可返回首页且搜索框保持隐藏', async () => {
  await page.getByTestId('tab-editor').click()
  await expect(page.getByTestId('editor-page')).toBeVisible()

  await page.keyboard.press(`${modKey}+K`)
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('home-search')).toBeHidden()
})

// ─── 演示命令导入/清理 ────────────────────────────────────────────────────────

test('导入演示命令后首页出现三条演示命令', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await openDemoCommandForm(page)

  await confirmDemoCommandImport(page)
  await page.getByTestId('tag-演示').click()
  await expect(page.getByTestId('command-row-demo-service')).toBeVisible()
  await expect(page.getByTestId('command-row-demo-bad-exit')).toBeVisible()
  await expect(page.getByTestId('command-row-demo-terminal')).toBeVisible()

  await openDemoCommandForm(page)
  await expect(page.getByTestId('demo-commands-cleanup')).toBeVisible()
})

test('导入演示命令后演示预设写入配置', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await openDemoCommandForm(page)
  await confirmDemoCommandImport(page)
  const raw = await page.evaluate(async () => window.api.configRead())
  expect(raw).toContain('name: 演示-后台与异常')
  expect(raw).toContain('name: 演示-全流程')
})

test('清理演示命令后首页移除演示命令和演示预设', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await openDemoCommandForm(page)
  await confirmDemoCommandImport(page)
  await page.getByTestId('tag-演示').click()
  await expect(page.getByTestId('command-row-demo-service')).toBeVisible({ timeout: 8000 })

  await cleanupDemoCommandsFromForm(page)
  await expect(page.getByTestId('command-row-demo-service')).toHaveCount(0)
  await expect(page.getByTestId('command-row-demo-bad-exit')).toHaveCount(0)
  await expect(page.getByTestId('command-row-demo-terminal')).toHaveCount(0)
  const raw = await page.evaluate(async () => window.api.configRead())
  expect(raw).not.toContain('name: 演示-后台与异常')
  expect(raw).not.toContain('name: 演示-全流程')

  await openDemoCommandForm(page)
  await expect(page.getByTestId('demo-commands-confirm')).toBeVisible()
})

test('导入演示命令后原有命令仍完整保留', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  await openDemoCommandForm(page)
  await confirmDemoCommandImport(page)
  await page.getByTestId('tag-演示').click()
  await expect(page.getByTestId('command-row-demo-service')).toBeVisible({ timeout: 8000 })

  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId('command-row-alpha')).toBeVisible()
  await expect(page.getByTestId('command-row-bad')).toBeVisible()
  await expect(page.getByTestId('command-row-beta')).toBeVisible()
})

// ─── 新手引导提示 ─────────────────────────────────────────────────────────────

test('新用户首次启动显示新手引导提示', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('demo-hint')).toBeVisible()
})

test('点击知道了关闭新手引导提示', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('demo-hint')).toBeVisible()

  await page.getByTestId('demo-hint-dismiss').click()
  await expect(page.getByTestId('demo-hint')).toHaveCount(0)

  const stored = await page.evaluate(() => window.localStorage.getItem('home.demoHintSeen'))
  expect(stored).toBe('1')
})

test('导入演示命令后新手引导提示自动消失', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('demo-hint')).toBeVisible()

  await openDemoCommandForm(page)
  await confirmDemoCommandImport(page)
  await page.getByTestId('tag-演示').click()
  await expect(page.getByTestId('command-row-demo-service')).toBeVisible({ timeout: 8000 })
  await expect(page.getByTestId('demo-hint')).toHaveCount(0)
})

// ─── AI 添加命令提示词 ────────────────────────────────────────────────────────

test('点击添加命令主按钮打开方式选择页', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await openCommandFormPickStep(page)
  await expect(page.getByTestId('command-create-pick-manual')).toBeVisible()
  await expect(page.getByTestId('command-create-pick-ai')).toBeVisible()
  await expect(page.getByTestId('command-create-pick-import')).toBeVisible()
  await expect(page.getByTestId('command-create-pick-demo')).toBeVisible()
})

test('方式选择页选手动填写可进入表单并返回选择', async () => {
  await openCommandFormPickStep(page)
  await page.getByTestId('command-create-pick-manual').click()
  await expect(page.getByTestId('command-form-name')).toBeVisible()
  await page.getByTestId('command-create-back-to-pick').click()
  await expect(page.getByTestId('command-create-pick-manual')).toBeVisible()
})

test('快捷菜单打开 AI 添加命令提示词', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await openAiCommandForm(page)
  await expect(page.getByTestId('ai-prompt-config-path')).toContainText('.shell-manage/config.yaml')
  await expect(page.getByTestId('assistant-skill-install-command')).toHaveText(skillInstallCommand)
  await expect(page.getByTestId('ai-prompt-preview')).toContainText('$shell-manage-assistant')
  await expect(page.getByTestId('ai-prompt-preview')).toContainText('如果该 Skill 不可用')
  await expect(page.getByTestId('ai-prompt-preview')).toContainText('未收到用户明确确认时不得写入')
})

test('AI 添加命令可复制 Assistant Skill 安装命令', async () => {
  await openAiCommandForm(page)
  await page.getByTestId('assistant-skill-copy').click()
  await expect(page.getByTestId('assistant-skill-copy')).toContainText('已复制，请在终端运行')
})

test('快捷菜单可见导入目录入口', async () => {
  await page.getByTestId('command-create-menu-trigger').click()
  await expect(page.getByTestId('command-create-menu-import')).toBeVisible()
})

test('快捷菜单可见导入演示命令入口', async () => {
  await page.getByTestId('command-create-menu-trigger').click()
  await expect(page.getByTestId('command-create-menu-demo')).toBeVisible()
})

test('AI 提示词弹窗可复制提示词', async () => {
  await openAiCommandForm(page)
  await expect(page.getByTestId('ai-prompt-copy')).toBeEnabled({ timeout: 5000 })

  await page.getByTestId('ai-prompt-copy').click()
  await expect(page.getByTestId('ai-prompt-copy')).toContainText('已复制')

  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByTestId('command-form-modal')).toHaveCount(0)
})

// ─── 日志页重启 ──────────────────────────────────────────────────────────────

test('日志页点击重新启动可重启正在运行的命令', async () => {
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.locator('text=状态：运行中')).toBeVisible()

  await expect(page.getByTestId('log-lines')).toContainText('alpha-start')
  await page.getByTestId('log-restart').click()
  await expect(page.getByTestId('log-lines')).toContainText('alpha-start', { timeout: 10000 })
  await expect(page.locator('text=状态：运行中')).toBeVisible({ timeout: 10000 })
})

// ─── 日志页 Inspector Modal ──────────────────────────────────────────────────

test('日志页端口排查工具可打开和关闭', async () => {
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()

  await expect(page.getByTestId('log-inspector-modal')).toHaveCount(0)
  await page.getByTestId('log-inspector').click()
  await expect(page.getByTestId('log-inspector-modal')).toBeVisible()
  await expect(page.getByTestId('log-inspector-modal')).toContainText('端口冲突排查工具')

  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByTestId('log-inspector-modal')).toHaveCount(0)
})

test('日志页端口排查工具包含端口和关键字输入框', async () => {
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()

  await page.getByTestId('log-inspector').click()
  await expect(page.getByTestId('log-inspector-modal')).toBeVisible()

  await expect(page.getByTestId('log-inspector-port-input')).toBeVisible()
  await expect(page.getByTestId('log-inspector-keyword-input')).toBeVisible()

  await page.getByTestId('log-inspector-port-input').fill('3000')
  await expect(page.getByTestId('log-inspector-port-input')).toHaveValue('3000')

  await page.getByTestId('log-inspector-keyword-input').fill('node')
  await expect(page.getByTestId('log-inspector-keyword-input')).toHaveValue('node')
})

// ─── 编辑器重新加载 ──────────────────────────────────────────────────────────

test('编辑器重新加载可从磁盘恢复原始内容', async () => {
  await page.getByTestId('tab-editor').click()
  await expect(page.getByTestId('editor-page')).toBeVisible()
  await page.getByTestId('editor-mode-toggle').click()
  await expect(page.locator('[data-testid="yaml-editor"] .cm-content')).toBeVisible()

  await setEditorContent(page, 'commands: [invalid incomplete')
  await page.getByTestId('editor-reload').click()
  const content = await page.locator('[data-testid="yaml-editor"] .cm-content').innerText()
  expect(content).toContain('alpha')
  expect(content).toContain('bad')
})

// ─── 侧边栏底部信息 ───────────────────────────────────────────────────────────

test('侧边栏显示版本号信息', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-app-version')).toBeVisible()
  const versionText = await page.getByTestId('sidebar-app-version').innerText()
  expect(versionText.trim().length).toBeGreaterThan(0)
})

test('侧边栏检查更新按钮可点击', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-check-update')).toBeVisible()
  await page.getByTestId('sidebar-check-update').click()
})

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

async function setEditorContent(targetPage: Page, content: string): Promise<void> {
  const editorContent = targetPage.locator('[data-testid="yaml-editor"] .cm-content')
  await editorContent.click()
  await targetPage.keyboard.press(`${modKey}+A`)
  await targetPage.keyboard.insertText(content)
}

async function launchWithHome(homeDir: string, extraEnv: Record<string, string> = {}): Promise<void> {
  electronApp = await electron.launch({
    args: [appEntry, '-ApplePersistenceIgnoreState', 'YES'],
    env: {
      ...process.env,
      HOME: homeDir,
      SHELL_MANAGE_HOME: homeDir,
      ...extraEnv
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await setElectronViewportSize(page)
  await skipFirstRunAiGuide(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
}
