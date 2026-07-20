import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import {
  modKey,
  openBrowserPage,
  navigateBrowserUrl,
  readBrowserState,
  waitForActiveTabUrl,
  waitForActiveTabInternal,
  selectBrowserTabByIndex,
  BROWSER_NEWTAB_URL,
  BROWSER_TUTORIAL_URL
} from './helpers/browser'

const appEntry = join(process.cwd(), 'dist/main/index.js')
const execFileAsync = promisify(execFile)

const testConfigYaml = `commands:
  - name: alpha
    command: node -e "console.log('alpha')"
    tags: [api]
    color: blue
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
  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-browser-e2e-'))
  const configDir = join(testHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'config.yaml'), testConfigYaml, 'utf-8')
  await launchWithHome(testHome)
})

test.afterEach(async () => {
  await electronApp.close()
})

test('侧栏可进入内置浏览器页', async () => {
  await openBrowserPage(page)
  await expect(page.getByTestId('browser-url-bar')).toBeVisible()
  await expect(page.getByTestId('browser-address-display')).toBeVisible()
  await expect(page.getByTestId('browser-viewport')).toBeVisible()
  await expect(page.getByTestId('browser-tab-row')).toBeVisible()
  await expect(page.getByTestId('titlebar-page-illustration')).toHaveCount(0)
})

test('快捷键 Cmd+6 可进入浏览器页', async () => {
  await page.keyboard.press(`${modKey}+6`)
  await expect(page.getByTestId('browser-page')).toBeVisible()
})

test('首次进入浏览器默认加载起始页', async () => {
  await openBrowserPage(page)
  await waitForActiveTabInternal(page, 'newtab')
  const state = await readBrowserState(page)
  expect(state.tabs[0]?.url).toBe(BROWSER_NEWTAB_URL)
  expect(state.tabs[0]?.title).toBe('起始页')
  await expect(page.getByTestId('browser-url-bar')).toHaveValue(BROWSER_NEWTAB_URL)
  await expect(page.getByTestId('browser-address-display')).toHaveText('起始页')
})

test('彻底退出后恢复全部网页标签、顺序和活动标签', async () => {
  const serverA = await startMarkerServer('E2E_BROWSER_RESTORE_A')
  const serverB = await startMarkerServer('E2E_BROWSER_RESTORE_B')
  const urlA = `http://127.0.0.1:${serverA.port}/a`
  const urlB = `http://127.0.0.1:${serverB.port}/b`
  const closedUrl = `http://127.0.0.1:${serverA.port}/closed`

  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, urlA)
    await waitForActiveTabUrl(page, urlA)

    await openNewBrowserTab(page)
    await navigateBrowserUrl(page, urlB)
    await waitForActiveTabUrl(page, urlB)

    await openNewBrowserTab(page)
    await navigateBrowserUrl(page, urlA)
    await waitForActiveTabUrl(page, urlA)

    await openNewBrowserTab(page)
    await navigateBrowserUrl(page, closedUrl)
    await waitForActiveTabUrl(page, closedUrl)
    await page.getByTestId('browser-tab-close-3').click()

    await openNewBrowserTab(page)
    await selectBrowserTabByIndex(page, 1)
    await expect(page.getByTestId('browser-tab-item-1')).toHaveAttribute('aria-selected', 'true')

    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem('browser.session.v1')
      return raw ? JSON.parse(raw) : null
    })).toEqual({ urls: [urlA, urlB, urlA], activeIndex: 1 })

    await electronApp.close()
    await launchWithHome(testHome, 'browser')

    await expect.poll(async () => {
      const state = await readBrowserState(page)
      return {
        urls: state.tabs.map((tab) => tab.url),
        activeIndex: state.tabs.findIndex((tab) => tab.id === state.activeTabId),
        moduleActive: state.moduleActive
      }
    }).toEqual({ urls: [urlA, urlB, urlA], activeIndex: 1, moduleActive: true })
    await expect(page.getByTestId('browser-url-bar')).toHaveValue(urlB)

    await electronApp.close()
    await launchWithHome(testHome, 'browser')
    await expect.poll(async () => {
      const state = await readBrowserState(page)
      return {
        urls: state.tabs.map((tab) => tab.url),
        activeIndex: state.tabs.findIndex((tab) => tab.id === state.activeTabId)
      }
    }).toEqual({ urls: [urlA, urlB, urlA], activeIndex: 1 })

    await page.getByTestId('tab-home').click()
    await expect(page.getByTestId('home-page')).toBeVisible()
    await electronApp.close()
    await launchWithHome(testHome)
  } finally {
    await closeServer(serverA.server)
    await closeServer(serverB.server)
  }
})

test('内置起始页跟随应用亮色暗色主题', async () => {
  await ensureAppTheme('dark')
  await openBrowserPage(page)
  await waitForActiveTabInternal(page, 'newtab')

  await expect
    .poll(async () => readInternalBrowserPageTheme('newtab'), { timeout: 5000 })
    .toMatchObject({ theme: 'dark' })
  const darkInfo = await readInternalBrowserPageTheme('newtab')

  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await expect
    .poll(async () => readInternalBrowserPageTheme('newtab'), { timeout: 5000 })
    .toMatchObject({ theme: 'light' })
  const lightInfo = await readInternalBrowserPageTheme('newtab')
  expect(lightInfo.background).not.toBe(darkInfo.background)
})

test('可从 Chrome Profile 导入 Cookie 并复用登录状态', async () => {
  await createChromeProfileWithCookie(testHome)
  const server = await startCookieServer()
  const url = `http://127.0.0.1:${server.port}/`

  try {
    await openBrowserPage(page)
    await page.getByTestId('browser-profile-import-open').click()
    await expect(page.getByTestId('browser-profile-import-panel')).toBeVisible()
    await expect(page.getByTestId('browser-profile-import-select')).toContainText('Chrome · E2E Profile')
    await page.getByTestId('browser-profile-import-submit').click()
    await expect(page.getByTestId('browser-profile-import-result')).toContainText('已导入 1 个 Cookie')

    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))
    await expect.poll(server.lastCookie).toContain('profile_auth=signed-in')
  } finally {
    await closeServer(server.server)
  }
})

test('可从 Firefox Profile 导入 Cookie 并复用登录状态', async () => {
  await createFirefoxProfileWithCookie(testHome)
  const server = await startCookieServer()
  const url = `http://127.0.0.1:${server.port}/`

  try {
    await openBrowserPage(page)
    await page.getByTestId('browser-profile-import-open').click()
    await expect(page.getByTestId('browser-profile-import-select')).toContainText('Firefox · e2e.default-release')
    await page.getByTestId('browser-profile-import-submit').click()
    await expect(page.getByTestId('browser-profile-import-result')).toContainText('已导入 1 个 Cookie')

    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))
    await expect.poll(server.lastCookie).toContain('firefox_auth=signed-in')
  } finally {
    await closeServer(server.server)
  }
})

test('新建 Tab 默认打开起始页', async () => {
  await openBrowserPage(page)
  await page.getByTestId('browser-new-tab').click()
  await waitForActiveTabInternal(page, 'newtab')
  await expect(page.getByTestId('browser-url-bar')).toHaveValue(BROWSER_NEWTAB_URL)
})

test('地址栏输入 about:blank 会跳转到起始页', async () => {
  const server = await startMarkerServer('E2E_BROWSER_ABOUT_BLANK')
  const url = `http://127.0.0.1:${server.port}/`
  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))
    await navigateBrowserUrl(page, 'about:blank')
    await waitForActiveTabInternal(page, 'newtab')
    await expect(page.getByTestId('browser-url-bar')).toHaveValue(BROWSER_NEWTAB_URL)
  } finally {
    await closeServer(server.server)
  }
})

test('可导航到快速教程内部页', async () => {
  await openBrowserPage(page)
  await navigateBrowserUrl(page, BROWSER_TUTORIAL_URL)
  await waitForActiveTabInternal(page, 'tutorial')
  const state = await readBrowserState(page)
  expect(state.tabs.find((t) => t.id === state.activeTabId)?.title).toBe('快速教程')
})

test('顶部 Tab 栏可见且可点击切换', async () => {
  await openBrowserPage(page)
  await page.getByTestId('browser-new-tab').click()
  await expect(page.getByTestId('browser-tab-item-0')).toBeVisible()
  await expect(page.getByTestId('browser-tab-item-1')).toBeVisible()
  const state = await readBrowserState(page)
  expect(state.tabs.length).toBe(2)
})

test('新建 Tab 会增加标签数量', async () => {
  await openBrowserPage(page)
  await page.getByTestId('browser-new-tab').click()
  await expect(page.getByTestId('browser-tab-item-0')).toBeVisible()
  await expect(page.getByTestId('browser-tab-item-1')).toBeVisible()
  const state = await readBrowserState(page)
  expect(state.tabs.length).toBe(2)
})

test('新建 Tab 后导航到不同 URL 不会落在旧 Tab 上', async () => {
  const serverA = await startMarkerServer('E2E_BROWSER_PAGE_A')
  const serverB = await startMarkerServer('E2E_BROWSER_PAGE_B')
  const urlA = `http://127.0.0.1:${serverA.port}/`
  const urlB = `http://127.0.0.1:${serverB.port}/`

  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, urlA)
    await waitForActiveTabUrl(page, String(serverA.port))

    await page.getByTestId('browser-new-tab').click()
    await expect(page.getByTestId('browser-url-bar')).toHaveValue(BROWSER_NEWTAB_URL)
    await navigateBrowserUrl(page, urlB)
    await waitForActiveTabUrl(page, String(serverB.port))

    const stateAfterB = await readBrowserState(page)
    const activeB = stateAfterB.tabs.find((t) => t.id === stateAfterB.activeTabId)
    expect(activeB?.url).toContain(String(serverB.port))
    expect(activeB?.url).not.toContain(String(serverA.port))
    await expect(page.getByTestId('browser-address-display')).toHaveText(`127.0.0.1:${serverB.port}`)

    await selectBrowserTabByIndex(page, 0)
    await waitForActiveTabUrl(page, String(serverA.port))
    const stateAfterSwitch = await readBrowserState(page)
    const activeA = stateAfterSwitch.tabs.find((t) => t.id === stateAfterSwitch.activeTabId)
    expect(activeA?.url).toContain(String(serverA.port))
    await expect(page.getByTestId('browser-url-bar')).toHaveValue(new RegExp(String(serverA.port)))
  } finally {
    await closeServer(serverA.server)
    await closeServer(serverB.server)
  }
})

test('应用强制刷新后恢复浏览器且切回命令页无原生视图残留', async () => {
  const server = await startMarkerServer('E2E_BROWSER_RELOAD_GHOST')
  const url = `http://127.0.0.1:${server.port}/`

  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))

    const stateBefore = await readBrowserState(page)
    expect(stateBefore.moduleActive).toBe(true)

    await page.evaluate(async () => {
      await window.api.reloadMainWindow({ force: true })
    })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('browser-page')).toBeVisible()
    await waitForActiveTabUrl(page, String(server.port))

    const restoredState = await readBrowserState(page)
    expect(restoredState.moduleActive).toBe(true)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('home-page')).toBeVisible()
    const stateAfter = await readBrowserState(page)
    expect(stateAfter.moduleActive).toBe(false)
    await expect(page.getByTestId('home-search')).toBeHidden()
  } finally {
    await closeServer(server.server)
  }
})

test('浏览器页仅在应用窗口真正失焦时模糊', async () => {
  await openBrowserPage(page)
  await page.getByTestId('browser-privacy-blur-toggle').check()

  await electronApp.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((item) => item.getURL().includes('/browser-pages/newtab.html'))?.focus()
  })
  await expect.poll(async () => (await readBrowserState(page)).privacyBlurred).toBe(false)
  await expect(page.getByTestId('browser-chrome')).toHaveCSS('filter', 'none')

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit('blur'))
  await expect.poll(async () => (await readBrowserState(page)).privacyBlurred).toBe(true)
  await expect(page.getByTestId('browser-page')).toHaveAttribute('data-privacy-blurred', 'true')
  await expect(page.getByTestId('browser-chrome')).toHaveCSS('filter', 'blur(18px)')

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit('focus'))
  await expect.poll(async () => (await readBrowserState(page)).privacyBlurred).toBe(false)
  await expect(page.getByTestId('browser-chrome')).toHaveCSS('filter', 'none')
})

test('浏览器页 Cmd+R 刷新当前标签而非重载应用', async () => {
  const server = await startMarkerServer('E2E_BROWSER_TAB_RELOAD')
  const url = `http://127.0.0.1:${server.port}/`

  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))

    await page.keyboard.press(`${modKey}+R`)
    await expect(page.getByTestId('browser-page')).toBeVisible()
    await waitForActiveTabUrl(page, String(server.port))
    const state = await readBrowserState(page)
    expect(state.moduleActive).toBe(true)
    expect(state.tabs[0]?.url).toContain(String(server.port))
  } finally {
    await closeServer(server.server)
  }
})

test('Esc 老板键切回命令页并隐藏浏览器层', async () => {
  await openBrowserPage(page)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('home-page')).toBeVisible()
  const state = await readBrowserState(page)
  expect(state.moduleActive).toBe(false)
})

test('顶部 Tab 栏可关闭标签', async () => {
  const server = await startMarkerServer('E2E_BROWSER_CLOSE')
  const url = `http://127.0.0.1:${server.port}/`

  try {
    await openBrowserPage(page)
    await navigateBrowserUrl(page, url)
    await waitForActiveTabUrl(page, String(server.port))

    await page.getByTestId('browser-new-tab').click()
    await waitForActiveTabInternal(page, 'newtab')

    await page.getByTestId('browser-tab-close-1').click()

    const state = await readBrowserState(page)
    expect(state.tabs.length).toBe(1)
    expect(state.tabs[0]?.url).toContain(String(server.port))
    await expect(page.getByTestId('browser-url-bar')).toHaveValue(new RegExp(String(server.port)))
  } finally {
    await closeServer(server.server)
  }
})

test('地址栏拒绝 mailto 等非网页协议并保留当前页', async () => {
  await openBrowserPage(page)
  await waitForActiveTabInternal(page, 'newtab')

  await navigateBrowserUrl(page, 'mailto:test@example.com')

  await expect(page.getByTestId('browser-url-error')).toContainText('仅支持 http/https')
  await expect(page.getByTestId('browser-url-bar')).toHaveValue('mailto:test@example.com')
  const state = await readBrowserState(page)
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  expect(active?.url).toBe(BROWSER_NEWTAB_URL)
})

// ─── helpers ─────────────────────────────────────────────────────────────────

async function openNewBrowserTab(targetPage: Page): Promise<void> {
  const count = (await readBrowserState(targetPage)).tabs.length
  await targetPage.getByTestId('browser-new-tab').click()
  await expect.poll(async () => (await readBrowserState(targetPage)).tabs.length).toBe(count + 1)
  await waitForActiveTabInternal(targetPage, 'newtab')
  await expect(targetPage.getByTestId('browser-url-bar')).toHaveValue(BROWSER_NEWTAB_URL)
}

async function launchWithHome(homeDir: string, expectedPage: 'home' | 'browser' = 'home'): Promise<void> {
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
  await expect(page.getByTestId(expectedPage === 'browser' ? 'browser-page' : 'home-page')).toBeVisible()
}

async function startMarkerServer(marker: string): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html><body><h1>${marker}</h1></body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return { server, port }
}

async function startCookieServer(): Promise<{ server: Server; port: number; lastCookie: () => string }> {
  let cookie = ''
  const server = createServer((req, res) => {
    cookie = req.headers.cookie || ''
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('<!doctype html><html><body><h1>E2E_BROWSER_PROFILE_COOKIE</h1></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return { server, port, lastCookie: () => cookie }
}

async function createChromeProfileWithCookie(homeDir: string): Promise<void> {
  const root = join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')
  const profileDir = join(root, 'Default')
  const cookieDb = join(profileDir, 'Network', 'Cookies')
  await mkdir(join(profileDir, 'Network'), { recursive: true })
  await writeFile(
    join(root, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: 'E2E Profile' } } } }),
    'utf-8'
  )
  await execFileAsync('/usr/bin/sqlite3', [
    cookieDb,
    `CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL,
      host_key TEXT NOT NULL,
      top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL,
      has_expires INTEGER NOT NULL,
      is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      samesite INTEGER NOT NULL,
      source_scheme INTEGER NOT NULL,
      source_port INTEGER NOT NULL,
      last_update_utc INTEGER NOT NULL,
      source_type INTEGER NOT NULL,
      has_cross_site_ancestor INTEGER NOT NULL
    );
    INSERT INTO cookies VALUES (
      0, '127.0.0.1', '', 'profile_auth', 'signed-in', X'', '/',
      13727232000000000, 0, 1, 0, 1, 1, 1, -1, 1, 80, 0, 0, 0
    );`
  ])
}

async function createFirefoxProfileWithCookie(homeDir: string): Promise<void> {
  const profileDir = join(
    homeDir,
    'Library',
    'Application Support',
    'Firefox',
    'Profiles',
    'e2e.default-release'
  )
  const cookieDb = join(profileDir, 'cookies.sqlite')
  await mkdir(profileDir, { recursive: true })
  await execFileAsync('/usr/bin/sqlite3', [
    cookieDb,
    `CREATE TABLE moz_cookies (
      id INTEGER PRIMARY KEY,
      originAttributes TEXT NOT NULL DEFAULT '',
      name TEXT,
      value TEXT,
      host TEXT,
      path TEXT,
      expiry INTEGER,
      lastAccessed INTEGER,
      creationTime INTEGER,
      isSecure INTEGER,
      isHttpOnly INTEGER,
      sameSite INTEGER
    );
    INSERT INTO moz_cookies VALUES (
      1, '', 'firefox_auth', 'signed-in', '127.0.0.1', '/', 4102444800, 0, 0, 0, 1, 1
    );`
  ])
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function readInternalBrowserPageTheme(pageId: string): Promise<{ theme: string; background: string }> {
  return electronApp.evaluate(
    async ({ webContents }, id) => {
      const target = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes(`/browser-pages/${id}.html`))
      if (!target) return { theme: '', background: '' }
      return target.executeJavaScript(
        `({ theme: document.documentElement.dataset.theme || '', background: getComputedStyle(document.body).backgroundColor })`,
        true
      )
    },
    pageId
  )
}

async function ensureAppTheme(theme: 'dark' | 'light'): Promise<void> {
  const current = await page.locator('html').getAttribute('data-theme')
  if (current !== theme) {
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  }
}
