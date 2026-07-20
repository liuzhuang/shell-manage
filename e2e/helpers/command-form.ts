import { expect, type Page } from '@playwright/test'

export async function openManualCommandForm(page: Page) {
  await page.getByTestId('command-create-menu-trigger').click()
  await page.getByTestId('command-create-menu-manual').waitFor({ state: 'visible' })
  await page.getByTestId('command-create-menu-manual').click()
  await page.getByTestId('command-form-name').waitFor({ state: 'visible' })
}

export async function openAiCommandForm(page: Page) {
  await page.getByTestId('command-create-menu-trigger').click()
  await page.getByTestId('command-create-menu-ai').waitFor({ state: 'visible' })
  await page.getByTestId('command-create-menu-ai').click()
  await page.getByTestId('command-form-modal').waitFor({ state: 'visible' })
}

export async function openCommandFormPickStep(page: Page) {
  await page.getByTestId('command-create-trigger').click()
  await page.getByTestId('command-form-modal').waitFor({ state: 'visible' })
  await page.getByTestId('command-create-pick-manual').waitFor({ state: 'visible' })
}

export async function submitCreateCommandForm(page: Page, commandRowTestId: string) {
  await page.getByTestId('command-form-save').click()
  await expect(page.getByTestId('global-toast')).toContainText('命令已添加并保存到配置文件')
  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId(commandRowTestId)).toBeVisible()
}

export async function openImportDirectoryForm(page: Page) {
  await page.getByTestId('command-create-menu-trigger').click()
  await page.getByTestId('command-create-menu-import').waitFor({ state: 'visible' })
  await page.getByTestId('command-create-menu-import').click()
  await page.getByTestId('import-projects-modal').waitFor({ state: 'visible' })
}

export async function openDemoCommandForm(page: Page) {
  await page.getByTestId('command-create-menu-trigger').click()
  await page.getByTestId('command-create-menu-demo').waitFor({ state: 'visible' })
  await page.getByTestId('command-create-menu-demo').click()
  await page.getByTestId('demo-commands-modal').waitFor({ state: 'visible' })
}

export async function confirmDemoCommandImport(page: Page) {
  await page.getByTestId('demo-commands-confirm').click()
  await expect(page.getByTestId('global-toast')).toContainText('演示命令已导入', { timeout: 8000 })
}

export async function cleanupDemoCommandsFromForm(page: Page) {
  await openDemoCommandForm(page)
  await page.getByTestId('demo-commands-cleanup').click()
  await expect(page.getByTestId('global-toast')).toContainText('演示命令已清理', { timeout: 8000 })
}
