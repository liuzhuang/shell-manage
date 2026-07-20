import { expect, test } from '@playwright/test'

const downloadUrl = 'https://github.com/liuzhuang/shell-manage/releases'

test.describe('ShellManage 官网', () => {
  test('首页说明核心用途并提供下载入口', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('site-header')).toContainText('ShellManage')
    await expect(page.getByTestId('home-page')).toBeVisible()

    const hero = page.getByTestId('hero')
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText('不用记命令，也不用重复输入。')
    await expect(hero).toContainText('项目启动命令、SSH 隧道和其他重复操作')

    const downloadButtons = page.getByTestId('download-button')
    await expect(downloadButtons).toHaveCount(4)
    for (const button of await downloadButtons.all()) {
      await expect(button).toHaveText('下载')
      await expect(button).toHaveAttribute('href', downloadUrl)
    }
  })

  test('首页按三组展示九张产品截图', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('core-workflow')).toContainText('核心工作流')
    await expect(page.getByTestId('development-workspace')).toContainText('开发现场')
    await expect(page.getByTestId('remote-and-team')).toContainText('远程与团队')

    const images = page.locator('.product-shot img')
    await expect(images).toHaveCount(9)
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded()
      await expect(image).toHaveAttribute('alt', /\S+/)
      expect(await image.evaluate((element) => {
        const target = element as HTMLImageElement
        return target.complete && target.naturalWidth > 0 && target.naturalHeight > 0
      })).toBe(true)
    }

    await expect(page.getByTestId('hero-screenshot').locator('img')).toHaveAttribute('loading', 'eager')
    const deferredImages = page.locator('.product-shot:not([data-testid="hero-screenshot"]) img')
    for (const image of await deferredImages.all()) await expect(image).toHaveAttribute('loading', 'lazy')
  })

  test('三步上手区域复制 Agent 导入指令并公开对应文档', async ({ page, request }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => window.localStorage.setItem('copied-text', text)
        }
      })
    })
    await page.goto('/#getting-started')

    const guideUrl = new URL('/doc/shell-manage-assistant.md', page.url()).href
    const importInstruction =
      `请阅读 ${guideUrl}，按照文档分析当前项目，并将验证通过的启动命令导入 ShellManage。`
    const section = page.getByTestId('getting-started')
    await expect(section.locator('.onboarding-step')).toHaveCount(3)
    await expect(section.getByTestId('import-instruction')).toHaveText(importInstruction)
    await expect(section.getByTestId('install-guide-link')).toHaveAttribute('href', '/doc/install/')
    await expect(section.getByTestId('assistant-guide-link')).toHaveAttribute(
      'href',
      '/doc/shell-manage-assistant/'
    )

    await section.getByTestId('import-instruction-copy').click()
    await expect(section.getByTestId('import-instruction-copy')).toHaveText('已复制，请发送给 Agent')
    expect(await page.evaluate(() => window.localStorage.getItem('copied-text'))).toBe(importInstruction)

    const guide = await request.get('/doc/shell-manage-assistant.md')
    expect(guide.ok()).toBe(true)
    expect(guide.headers()['content-type']).toContain('charset=utf-8')
    expect(await guide.text()).toContain('把启动命令导入 ShellManage')

    const installGuide = await request.get('/doc/install.md')
    expect(installGuide.ok()).toBe(true)
    expect(installGuide.headers()['content-type']).toContain('charset=utf-8')
    expect(await installGuide.text()).toContain('下载并安装 ShellManage')

    await page.goto('/doc/install/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('下载并安装 ShellManage')
    await page.goto('/doc/shell-manage-assistant/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('用 Agent 导入项目命令')
  })

  test('产品截图支持局部放大和全屏查看', async ({ page }) => {
    await page.goto('/')

    const screenshot = page.getByTestId('hero-screenshot')
    if (await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)) {
      const box = await screenshot.boundingBox()
      if (!box) throw new Error('首页截图不可见')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const lens = screenshot.locator('.screenshot-lens')
      await expect(lens).toBeVisible()
      const placement = await lens.evaluate((element) => {
        const lensBox = element.getBoundingClientRect()
        const screenshotBox = element.parentElement!.getBoundingClientRect()
        return {
          left: lensBox.left - screenshotBox.left,
          top: lensBox.top - screenshotBox.top
        }
      })
      expect(placement.left).toBeCloseTo(box.width / 2, 0)
      expect(placement.top).toBeCloseTo(box.height / 2, 0)
    }

    await screenshot.click()
    const dialog = page.getByRole('dialog', { name: /查看大图/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).not.toBeVisible()
  })

  test('术语速查同时保留技术名称和解释', async ({ page }) => {
    await page.goto('/#terms')

    const terms = page.getByTestId('term-guide')
    await expect(terms.locator('dt')).toHaveCount(6)
    await expect(terms).toContainText('启动命令')
    await expect(terms).toContainText('运行日志')
    await expect(terms).toContainText('交互终端')
    await expect(terms).toContainText('SSH 隧道')
    await expect(terms).toContainText('SSH 密钥')
    await expect(terms).toContainText('项目目录')
  })

  test('首页保持单页语义和键盘入口', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.locator('footer')).toHaveCount(1)
    await expect(page.locator('a[href^="/guide"]')).toHaveCount(0)

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: '跳到主要内容' })
    await expect(skipLink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('页面没有横向溢出', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      const body = document.body
      return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth)
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('减少动态效果时关闭平滑滚动', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).not.toBe('smooth')
  })
})
