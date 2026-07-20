import type { Page } from '@playwright/test'

export const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

export const BROWSER_NEWTAB_URL = 'shell-manage://browser/newtab'
export const BROWSER_TUTORIAL_URL = 'shell-manage://browser/tutorial'
export const BROWSER_PROMO_URL = 'shell-manage://browser/promo'

export async function openBrowserPage(page: Page): Promise<void> {
  await page.getByTestId('tab-browser').click()
  await page.getByTestId('browser-page').waitFor({ state: 'visible' })
}

export async function navigateBrowserUrl(page: Page, url: string): Promise<void> {
  const urlBar = page.getByTestId('browser-url-bar')
  await urlBar.click()
  await urlBar.fill(url)
  await urlBar.press('Enter')
}

export async function readBrowserState(page: Page): Promise<{
  tabs: Array<{ id: string; url: string; title: string }>
  activeTabId: string | null
  moduleActive: boolean
  privacyBlurred: boolean
}> {
  return page.evaluate(async () => window.api.browserGetState())
}

export async function waitForActiveTabUrl(page: Page, urlPart: string, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    async (part) => {
      const state = await window.api.browserGetState()
      const active = state.tabs.find((t) => t.id === state.activeTabId)
      return Boolean(active?.url.includes(part))
    },
    urlPart,
    { timeout: timeoutMs }
  )
}

export async function selectBrowserTabByIndex(page: Page, index: number): Promise<void> {
  await page.getByTestId(`browser-tab-item-${index}`).click()
}

export async function waitForActiveTabInternal(page: Page, pageId: string, timeoutMs = 15_000): Promise<void> {
  const expected = `shell-manage://browser/${pageId}`
  await page.waitForFunction(
    async (url) => {
      const state = await window.api.browserGetState()
      const active = state.tabs.find((t) => t.id === state.activeTabId)
      return active?.url === url
    },
    expected,
    { timeout: timeoutMs }
  )
}
