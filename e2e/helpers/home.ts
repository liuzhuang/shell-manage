import type { Page } from '@playwright/test'

export async function skipFirstRunAiGuide(page: Page) {
  await page.evaluate(() => window.localStorage.setItem('home.aiPromptGuideAfterFirstRun.seen', '1'))
  await page.reload()
}

export async function setHiddenHomeSearch(page: Page, value: string) {
  await page.getByTestId('home-search').evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
