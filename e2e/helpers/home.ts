import type { Page } from '@playwright/test'

export async function skipFirstRunAiGuide(page: Page) {
  await page.evaluate(() => window.localStorage.setItem('home.aiPromptGuideAfterFirstRun.seen', '1'))
  const rendererUrl = page.url()
  try {
    await page.reload()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('net::ERR_FILE_NOT_FOUND')) throw error
    console.warn('[e2e] renderer reload transiently returned ERR_FILE_NOT_FOUND; retrying once')
    await page.waitForTimeout(100)
    await page.goto(rendererUrl)
  }
}

export async function setHiddenHomeSearch(page: Page, value: string) {
  await page.getByTestId('home-search').evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
