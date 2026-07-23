import { expect, type Page } from '@playwright/test'

export const compactViewportSize = { width: 1024, height: 700 }
export const desktopViewportSize = { width: 1440, height: 900 }

export async function setElectronViewportSize(
  page: Page,
  viewport = compactViewportSize
): Promise<void> {
  await page.setViewportSize(viewport)
  await expect.poll(async () => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual(viewport)
}
