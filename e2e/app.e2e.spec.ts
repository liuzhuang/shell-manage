import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { openManualCommandForm, submitCreateCommandForm, openImportDirectoryForm } from './helpers/command-form'
import { setHiddenHomeSearch, skipFirstRunAiGuide } from './helpers/home'

const appEntry = join(process.cwd(), 'dist/main/index.js')
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

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
  - name: rcsvc
    command: echo service-rc-loaded:$E2E_SHELL_RC_MARKER && sleep 120
    tags: [ops]
    color: purple
    autoRestart: false
  - name: termy
    command: echo log-analysis-e2e-marker && echo rc-loaded:$E2E_SHELL_RC_MARKER && sleep 120
    tags: [ops]
    color: green
    mode: terminal
  - name: termy2
    command: echo log-analysis-e2e-marker-2 && sleep 120
    tags: [qa]
    color: cyan
    mode: terminal
  - name: termy-auto
    command: exec /bin/sh -i
    tags: [qa]
    color: blue
    mode: terminal
  - name: termy-ssh-pending
    command: ssh -o "ProxyCommand=/bin/sleep 30" test-host
    tags: [qa]
    color: blue
    mode: terminal
  - name: termy-fake-prompt
    command: /bin/bash -lc 'printf "$ "; IFS= read -r line; printf "%s" "$line" > "$HOME/auto-execute-fake-prompt"'
    tags: [qa]
    color: gray
    mode: terminal
  - name: termy-retry
    command: node -e "console.log('termy-retry-boom'); process.exit(2)"
    tags: [qa]
    color: orange
    mode: terminal
    autoRestart: true
    maxRestarts: 3
  - name: termy-ok
    command: node -e "console.log('termy-ok-once'); process.exit(0)"
    tags: [qa]
    color: yellow
    mode: terminal
    autoRestart: true
    maxRestarts: 3
  - name: termy-manual
    command: node -e "console.log('termy-manual-start'); setInterval(() => {}, 1000)"
    tags: [qa]
    color: teal
    mode: terminal
    autoRestart: true
    maxRestarts: 3
presets:
  - name: smokePreset
    sequence:
      - command: alpha
      - command: bad
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
let queryAgentServer: Server

test.beforeEach(async () => {
  if (!existsSync(appEntry)) {
    throw new Error('未找到 dist/main/index.js，请先执行 npm run build')
  }

  testHome = await mkdtemp(join(tmpdir(), 'shell-manage-e2e-'))
  queryAgentServer = createQueryAgentServer()
  await new Promise<void>((resolve) => queryAgentServer.listen(0, '127.0.0.1', resolve))
  const queryAgentPort = (queryAgentServer.address() as AddressInfo).port
  const configDir = join(testHome, '.shell-manage')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(testHome, '.zshrc'), 'export E2E_SHELL_RC_MARKER=from-zshrc\n', 'utf-8')
  await writeFile(join(testHome, '.bashrc'), 'export E2E_SHELL_RC_MARKER=from-bashrc\n', 'utf-8')
  const configYaml = testConfigYaml
    .replace('endpoint: "https://example.invalid"', `endpoint: "http://127.0.0.1:${queryAgentPort}/v1"`)
    .replace('apiKey: "sk-xxxxx"', 'apiKey: "sk-e2e-query-agent"')
  await writeFile(join(configDir, 'config.yaml'), configYaml, 'utf-8')

  await launchWithHome(testHome)
})

test.afterEach(async () => {
  if (electronApp) await electronApp.close()
  if (queryAgentServer?.listening) {
    await new Promise<void>((resolve, reject) => queryAgentServer.close((error) => (error ? reject(error) : resolve())))
  }
})

function createQueryAgentServer(): Server {
  return createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
        messages?: Array<{ role?: string; content?: unknown }>
      }
      const prompt = String(payload.messages?.at(-1)?.content || '')
      const action = queryAgentActionForTest(prompt)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: 'chatcmpl-shell-manage-e2e',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-query-agent-action',
              type: 'function',
              function: { name: 'query_agent_action', arguments: JSON.stringify(action) }
            }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }))
    })
  })
}

function queryAgentActionForTest(prompt: string) {
  let command = ''
  if (prompt.startsWith('__e2e_agent_safe_command__ ')) command = prompt.slice('__e2e_agent_safe_command__ '.length)
  else if (prompt === '__e2e_completion_order__') command = "printenv PS1; printf '\\033]777;shell-manage-complete=forged\\007'; sleep 2"
  else if (prompt === '__e2e_timeout_recovery__') command = "printenv PS1; printf '\\033]777;shell-manage-complete=forged\\007'; sleep 30"
  else if (prompt.includes('支付失败')) command = 'grep -iE "pay.*fail|支付.*失败" /var/log/app.log'
  else if (prompt.includes('最近20行')) command = 'grep -iE "error|失败" /var/log/app.log | tail -n 20'
  else if (prompt.includes('$(')) command = `echo "${prompt.slice(prompt.indexOf('$('))}"`
  else {
    const echo = prompt.match(/echo\s+[A-Za-z0-9._-]+/u)?.[0]
    if (echo) command = echo
    else if (/^e2e-auto-[A-Za-z0-9._-]+$/u.test(prompt)) command = `echo ${prompt}`
  }
  if (!command) {
    return {
      type: 'reply',
      message: `已收到：${prompt}`,
      riskLevel: 'safe',
      riskReason: '没有建议执行命令。'
    }
  }
  const blocked = command.includes('$(')
  return {
    type: 'command',
    message: `建议命令：${command}`,
    command,
    riskLevel: blocked ? 'blocked' : 'safe',
    riskReason: blocked ? '命令包含替换语法，需要人工确认。' : '只输出状态或测试标记。'
  }
}

test('命令执行与停止、日志展示', async () => {
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.locator('text=状态：运行中')).toBeVisible()
  await expect(page.getByTestId('log-lines')).toContainText('alpha-start')

  await page.getByTestId('log-stop').click()
  await expect(page.locator('text=状态：空闲')).toBeVisible()
})

test('日志页支持清空当前命令日志内容', async () => {
  await page.getByTestId('command-run-bad').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('global-toast')).toContainText('退出码 2', { timeout: 8000 })
  await page.getByTestId('command-more-bad').click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '查看运行日志' }).click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-lines')).toContainText('bad-boom')

  await page.getByTestId('log-clear').click()
  await expect(page.getByTestId('log-lines')).toContainText('当前没有任何日志输出')
})

test('二级页面按 Esc 返回首页', async () => {
  await page.evaluate(() => {
    const navigate = (window as unknown as { __shellE2ENavigate?: (target: 'log' | 'terminal') => void }).__shellE2ENavigate
    navigate?.('log')
  })
  await expect(page.getByTestId('log-page')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.evaluate(() => {
    const navigate = (window as unknown as { __shellE2ENavigate?: (target: 'log' | 'terminal') => void }).__shellE2ENavigate
    navigate?.('terminal')
  })
  await expect(page.getByTestId('terminal-page')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('后台服务命令会加载 shell rc 环境且日志不重复输出', async () => {
  await page.getByTestId('command-run-rcsvc').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-rcsvc')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-rcsvc').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-lines')).toContainText('service-rc-loaded:from-', { timeout: 15000 })

  // 命令的 echo 只触发一次，渲染端任何重复订阅都会让 marker 出现 ≥ 2 次。
  const markerCount = await page.getByTestId('log-lines').evaluate((el) => {
    const text = (el as HTMLElement).innerText
    return (text.match(/service-rc-loaded:from-/g) || []).length
  })
  expect(markerCount).toBe(1)

  await page.getByTestId('log-stop').click()
  await expect(page.locator('text=状态：空闲')).toBeVisible()
})

test('侧栏执行记录支持打开弹窗并按筛选与搜索查看事件', async () => {
  const ticker = page.getByTestId('sidebar-system-ticker')
  await expect(ticker).toBeVisible()
  await expect(ticker).toContainText('暂无执行记录')

  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(ticker).toContainText('执行命令：node -e', { timeout: 8000 })
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()

  await page.getByTestId('log-stop').click()
  await expect(page.locator('text=状态：空闲')).toBeVisible()
  await expect(ticker).toContainText('已手动停止', { timeout: 8000 })

  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('command-run-bad').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('global-toast')).toContainText('退出码 2', { timeout: 8000 })
  await page.getByTestId('command-more-bad').click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '查看运行日志' }).click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.locator('text=状态：异常')).toBeVisible()
  await expect(ticker).toContainText('退出码 2', { timeout: 8000 })

  await page.getByTestId('tab-monitoring').click()
  await expect(page.getByTestId('monitoring-page')).toBeVisible()
  await expect(ticker).toContainText('__MON_METRIC__', { timeout: 8000 })

  await ticker.click()
  await expect(page.getByTestId('sidebar-history-modal')).toBeVisible()
  await expect(page.getByTestId('sidebar-history-list')).toContainText('退出码 2')
  await expect(page.getByTestId('sidebar-history-list')).toContainText('__MON_METRIC__')

  await page.getByTestId('sidebar-history-tab-error').click()
  await expect(page.getByTestId('sidebar-history-list')).toContainText('退出码 2')
  await expect(page.getByTestId('sidebar-history-list')).not.toContainText('__MON_METRIC__')

  await page.getByTestId('sidebar-history-tab-all').click()
  await page.getByTestId('sidebar-history-search').fill('__MON_METRIC__')
  await expect(page.getByTestId('sidebar-history-list')).toContainText('__MON_METRIC__')
  await expect(page.getByTestId('sidebar-history-list')).not.toContainText('退出码 2')

  await page.getByTestId('sidebar-history-close').click()
  await expect(page.getByTestId('sidebar-history-modal')).toHaveCount(0)
})

test('首页卡片默认隐藏次要元信息', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.locator('text=重启策略')).toHaveCount(0)
  await expect(page.locator('text=标签数')).toHaveCount(0)
  await expect(page.getByTestId('command-run-alpha')).toBeVisible()
})

test('导入目录识别结果支持预览并导入命令', async () => {
  const projectRoot = join(testHome, 'import-root')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(join(projectRoot, 'web-app'), { recursive: true })
  await writeFile(
    join(projectRoot, 'web-app', 'package.json'),
    JSON.stringify(
      {
        dependencies: { react: '^19.0.0' },
        scripts: { dev: 'vite' }
      },
      null,
      2
    ),
    'utf-8'
  )
  await writeFile(join(projectRoot, 'web-app', 'pnpm-lock.yaml'), 'lockfileVersion: 9', 'utf-8')
  await page.evaluate((rootPath) => {
    window.localStorage.setItem('__e2e_import_root_path', rootPath)
  }, projectRoot)

  await openImportDirectoryForm(page)
  await expect(page.getByTestId('import-projects-modal')).toContainText('web-app')
  await page.getByTestId('import-projects-confirm').click()
  await expect(page.getByTestId('global-toast')).toContainText('已导入 1 条命令')
  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId('command-row-web-app')).toBeVisible()
})

test('预设执行、日志分析命令执行与异常命令反馈', async () => {
  await page.evaluate(async () => {
    await window.api.presetExecute('smokePreset')
  })
  await expect(page.getByTestId('preset-progress-overlay')).toBeVisible()
  await expect(page.getByTestId('preset-progress-overlay')).toContainText('smokePreset')

  await page.getByTestId('command-run-bad').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('global-toast')).toContainText('bad：退出码 2', { timeout: 8000 })
  await page.getByTestId('command-more-bad').click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '查看运行日志' }).click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.locator('text=状态：异常')).toBeVisible()

  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await expect(page.getByTestId('tab-log-analysis')).toContainText('日志')
  await expect(page.getByRole('button', { name: '日志' })).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy')

  const bufferBeforeManualExecute = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })
  await page.getByTestId('log-analysis-mode-command').click()
  await page.getByTestId('log-analysis-command-input').fill(`echo query-ok`)
  await page.getByTestId('log-analysis-execute').click()
  await page.waitForFunction(
    async (before) => {
      const result = await window.api.terminalGetBuffer('termy')
      return result.text.length > before && result.text.includes('query-ok')
    },
    bufferBeforeManualExecute,
    { timeout: 10000 }
  )

  await page.getByTestId('log-analysis-mode-ask').click()
  await page.getByTestId('log-analysis-input').fill('帮我看支付失败日志')
  await page.getByTestId('log-analysis-translate').click()
  await page.getByTestId('log-analysis-mode-command').click()
  await expect(page.getByTestId('log-analysis-command-input')).toContainText('grep -iE')

  await page.getByTestId('log-analysis-mode-ask').click()
  await page.getByTestId('log-analysis-input').fill('再加上只看最近20行')
  await page.getByTestId('log-analysis-translate').click()
  await page.getByTestId('log-analysis-open-history').click()
  await expect(page.getByTestId('log-analysis-chat-history')).toContainText('帮我看支付失败日志')
  await expect(page.getByTestId('log-analysis-chat-history')).toContainText('grep -iE')
})

test('日志分析页仅列出会话模式命令并支持下拉选择', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await expect(page.getByTestId('log-analysis-command-select')).toBeVisible()
  await expect(page.locator('[data-testid="log-analysis-command-select"] option[value="alpha"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="log-analysis-command-select"] option[value="bad"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="log-analysis-command-select"] option[value="termy"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="log-analysis-command-select"] option[value="termy2"]')).toHaveCount(1)

  await page.getByTestId('log-analysis-command-select').selectOption('termy')
  await expect(page.getByTestId('log-analysis-command-select')).toHaveValue('termy')
})

test('命令交互窗口从首页切换会话命令时不串台', async () => {
  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-全部').click()
  await setHiddenHomeSearch(page, 'termy')

  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible()
  await expect(page.getByTestId('terminal-page')).toContainText('命令交互窗口 · termy', { timeout: 5000 })
  await expect(page.getByTestId('terminal-page')).toContainText('log-analysis-e2e-marker', { timeout: 15000 })
  await expect(page.getByTestId('terminal-page')).toContainText('rc-loaded:from-', { timeout: 15000 })
  await expect(page.getByTestId('terminal-page')).not.toContainText('log-analysis-e2e-marker-2')

  await page.getByTestId('terminal-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-termy')).toContainText('继续会话', { timeout: 15000 })
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible()
  await expect(page.getByTestId('terminal-page')).toContainText('log-analysis-e2e-marker', { timeout: 15000 })
  await page.getByTestId('terminal-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('tag-全部').click()
  await setHiddenHomeSearch(page, 'termy2')

  await page.getByTestId('command-run-termy2').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible()
  await expect(page.getByTestId('terminal-page')).toContainText('命令交互窗口 · termy2', { timeout: 5000 })
  await expect(page.getByTestId('terminal-page')).toContainText('log-analysis-e2e-marker-2', { timeout: 15000 })
})

test('命令交互窗口不展示 Tab、布局与实验控件', async () => {
  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-全部').click()
  await setHiddenHomeSearch(page, 'termy')
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible({ timeout: 15000 })

  const terminalPage = page.getByTestId('terminal-page')
  await expect(page.getByRole('button', { name: '+ 新建 Tab' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '单窗口' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '左右双栏' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 洞察（实验）' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '回到首页' })).toHaveCount(0)
  await expect(page.getByTestId('terminal-auto-return-home')).toHaveCount(0)
  await expect(terminalPage.getByText('Pane', { exact: true })).toHaveCount(0)
  await expect(terminalPage.getByRole('button', { name: '全屏' })).toHaveCount(0)
  await expect(terminalPage.getByRole('button', { name: '删除' })).toHaveCount(0)
  await expect(terminalPage).not.toContainText('运行中')
  await expect(page.getByTestId('terminal-shell')).toBeVisible()
  await expect(page.getByTestId('terminal-back-icon')).toBeVisible()
  await expect(page.getByTestId('terminal-stop-session')).toBeVisible()
})

test('命令交互详情终止会话后列表卡片为可打开窗口', async () => {
  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-termy')).toContainText('继续会话', { timeout: 15000 })
  await expect(page.getByTestId('command-stop-termy')).toBeVisible()

  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible()

  await page.getByTestId('terminal-stop-session').click()
  await page.getByTestId('terminal-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await expect(page.getByTestId('command-run-termy')).toContainText('打开窗口', { timeout: 10000 })
  await expect(page.getByTestId('command-run-termy')).not.toContainText('继续会话')
  await expect(page.getByTestId('command-stop-termy')).toHaveCount(0)
})

test('bash 终端会话会加载 ~/.bashrc', async () => {
  test.skip(!existsSync('/bin/bash'), '当前环境无 /bin/bash，跳过该校验')

  await electronApp.close()
  await launchWithHome(testHome, {
    SHELL: '/bin/bash'
  })

  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-termy')).toContainText('继续会话', { timeout: 15000 })
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toBeVisible()
  await expect(page.getByTestId('terminal-page')).toContainText('rc-loaded:from-bashrc', { timeout: 15000 })
})

test('terminal 异常退出时自动重连且最多重试 3 次', async () => {
  await page.evaluate(async () => {
    await window.api.terminalStart('termy-retry')
  })

  await page.waitForTimeout(7000)
  const terminalRetryState = await page.evaluate(async () => {
    const { text } = await window.api.terminalGetBuffer('termy-retry')
    const boomCount = (text.match(/termy-retry-boom/g) || []).length
    const reconnectCount = (text.match(/自动重连/g) || []).length
    const { instances } = await window.api.terminalListInstances()
    const runningCount = instances.filter((item) => item.commandName === 'termy-retry').length
    return { boomCount, reconnectCount, runningCount }
  })

  expect(terminalRetryState.boomCount).toBeGreaterThanOrEqual(1)
  expect(terminalRetryState.reconnectCount).toBeGreaterThanOrEqual(1)
  expect(terminalRetryState.reconnectCount).toBeLessThanOrEqual(3)
  expect(terminalRetryState.runningCount).toBe(0)
})

test('terminal 正常退出不触发自动重连', async () => {
  await page.evaluate(async () => {
    await window.api.terminalStart('termy-ok')
  })
  await page.waitForFunction(
    async () => {
      const { text } = await window.api.terminalGetBuffer('termy-ok')
      return text.includes('termy-ok-once')
    },
    undefined,
    { timeout: 10000 }
  )

  await page.waitForTimeout(1800)
  const okState = await page.evaluate(async () => {
    const { text } = await window.api.terminalGetBuffer('termy-ok')
    return {
      okCount: (text.match(/termy-ok-once/g) || []).length,
      reconnectCount: (text.match(/自动重连/g) || []).length
    }
  })
  expect(okState.okCount).toBe(1)
  expect(okState.reconnectCount).toBe(0)
})

test('terminal 手动停止不触发自动重连', async () => {
  await page.evaluate(async () => {
    await window.api.terminalStart('termy-manual')
  })
  await page.waitForFunction(
    async () => {
      const { instances } = await window.api.terminalListInstances()
      return instances.some((item) => item.commandName === 'termy-manual')
    },
    undefined,
    { timeout: 10000 }
  )
  await page.evaluate(async () => {
    await window.api.terminalStopAllForCommand('termy-manual')
  })
  await page.waitForFunction(
    async () => {
      const { instances } = await window.api.terminalListInstances()
      return !instances.some((item) => item.commandName === 'termy-manual')
    },
    undefined,
    { timeout: 10000 }
  )
  await page.waitForTimeout(2200)
  const manualState = await page.evaluate(async () => {
    const { text } = await window.api.terminalGetBuffer('termy-manual')
    const { instances } = await window.api.terminalListInstances()
    return {
      reconnectCount: (text.match(/自动重连/g) || []).length,
      runningCount: instances.filter((item) => item.commandName === 'termy-manual').length
    }
  })
  expect(manualState.reconnectCount).toBe(0)
  expect(manualState.runningCount).toBe(0)
})

test('@layout-stability 日志分析页切换命令时布局不跳变', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()

  const getRect = async () => {
    return page.getByTestId('log-analysis-page').evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })
  }
  const assertStable = (baseline: Awaited<ReturnType<typeof getRect>>, current: Awaited<ReturnType<typeof getRect>>) => {
    expect(Math.abs(current.top - baseline.top)).toBeLessThanOrEqual(2)
    expect(Math.abs(current.left - baseline.left)).toBeLessThanOrEqual(2)
    expect(Math.abs(current.width - baseline.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(current.height - baseline.height)).toBeLessThanOrEqual(2)
  }

  const baseline = await getRect()
  await page.getByTestId('log-analysis-command-select').selectOption('termy')
  await page.waitForTimeout(400)
  const afterFirst = await getRect()
  assertStable(baseline, afterFirst)

  await page.getByTestId('log-analysis-command-select').selectOption('termy2')
  await page.waitForTimeout(400)
  const afterSecond = await getRect()
  assertStable(afterFirst, afterSecond)
})

test('@layout-stability 切换 Tab 后返回日志分析页布局不跳变', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy')

  const getRect = async () => {
    return page.getByTestId('log-analysis-page').evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })
  }
  const baseline = await getRect()

  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.waitForTimeout(300)

  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.waitForTimeout(300)

  const current = await getRect()
  expect(Math.abs(current.top - baseline.top)).toBeLessThanOrEqual(2)
  expect(Math.abs(current.left - baseline.left)).toBeLessThanOrEqual(2)
  expect(Math.abs(current.width - baseline.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(current.height - baseline.height)).toBeLessThanOrEqual(2)
})

test('@layout-stability 全屏终端关闭后布局不跳变', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy')

  const baseline = await page.getByTestId('log-analysis-page').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  })

  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="log-analysis-page"]') as HTMLElement | null
    ;(window as unknown as { __layoutSamples?: Array<{ t: number; l: number; w: number; h: number }> }).__layoutSamples = []
    if (!target) return
    const samples = (window as unknown as { __layoutSamples: Array<{ t: number; l: number; w: number; h: number }> }).__layoutSamples
    const startedAt = performance.now()
    const take = () => {
      const rect = target.getBoundingClientRect()
      samples.push({ t: rect.top, l: rect.left, w: rect.width, h: rect.height })
      if (performance.now() - startedAt < 900) requestAnimationFrame(take)
    }
    requestAnimationFrame(take)
  })

  const fullscreenToggle = page.getByRole('button', { name: '放大终端' })
  await fullscreenToggle.click()
  await expect(fullscreenToggle).toContainText('退出全屏')
  await page.waitForTimeout(250)
  await fullscreenToggle.click()
  await expect(fullscreenToggle).toContainText('全屏终端')
  await page.waitForTimeout(1000)

  const deltas = await page.evaluate((base) => {
    const samples = ((window as unknown as { __layoutSamples?: Array<{ t: number; l: number; w: number; h: number }> }).__layoutSamples || [])
    let maxTop = 0
    let maxLeft = 0
    let maxWidth = 0
    let maxHeight = 0
    for (const sample of samples) {
      maxTop = Math.max(maxTop, Math.abs(sample.t - base.top))
      maxLeft = Math.max(maxLeft, Math.abs(sample.l - base.left))
      maxWidth = Math.max(maxWidth, Math.abs(sample.w - base.width))
      maxHeight = Math.max(maxHeight, Math.abs(sample.h - base.height))
    }
    return { maxTop, maxLeft, maxWidth, maxHeight, sampleCount: samples.length }
  }, baseline)
  expect(deltas.sampleCount).toBeGreaterThan(10)
  expect(deltas.maxTop).toBeLessThanOrEqual(2)
  expect(deltas.maxLeft).toBeLessThanOrEqual(2)
  expect(deltas.maxWidth).toBeLessThanOrEqual(2)
  expect(deltas.maxHeight).toBeLessThanOrEqual(2)
})

test('聊天输入回车清空、用户消息自适应、AI消息执行支持二次确认开关', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy')

  const userPrompt = '请只返回一个命令：echo e2e-ai-confirm-run'
  await page.getByTestId('log-analysis-input').fill(userPrompt)
  await page.getByTestId('log-analysis-input').press('Enter')
  await expect(page.getByTestId('log-analysis-input')).toHaveValue('')
  await page.getByTestId('log-analysis-open-history').click()

  await expect(page.getByTestId('log-analysis-chat-bubble-user').last()).toBeVisible()
  await expect(page.getByTestId('log-analysis-chat-bubble-ai').last()).toBeVisible()

  const bubbleStyles = await page.evaluate(() => {
    const timeline = document.querySelector('[data-testid="log-analysis-chat-history"]') as HTMLElement | null
    const user = document.querySelector('[data-testid="log-analysis-chat-bubble-user"]') as HTMLElement | null
    const ai = document.querySelector('[data-testid="log-analysis-chat-bubble-ai"]') as HTMLElement | null
    const userRect = user?.getBoundingClientRect()
    const timelineRect = timeline?.getBoundingClientRect()
    return {
      userTextAlign: user ? getComputedStyle(user).textAlign : '',
      userWidth: userRect ? Math.round(userRect.width) : 0,
      timelineWidth: timelineRect ? Math.round(timelineRect.width) : 0,
      userMaxWidth: user ? getComputedStyle(user).maxWidth : '',
      aiMaxWidth: ai ? getComputedStyle(ai).maxWidth : ''
    }
  })
  expect(bubbleStyles.userTextAlign).toBe('right')
  expect(bubbleStyles.userWidth).toBeGreaterThan(0)
  expect(bubbleStyles.userWidth).toBeLessThan(bubbleStyles.timelineWidth)
  expect(bubbleStyles.userMaxWidth).toBe(bubbleStyles.aiMaxWidth)

  await expect(page.getByTestId('log-analysis-confirm-execute-toggle')).toContainText('二次确认执行')

  const bufferBefore = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })

  const aiBubble = page.getByTestId('log-analysis-chat-bubble-ai').last()
  await aiBubble.click()
  await expect(page.getByTestId('log-analysis-ai-execute-dialog')).toBeVisible()
  await expect(page.getByTestId('log-analysis-ai-confirm-execute')).toBeVisible()

  await page.getByTestId('log-analysis-ai-confirm-execute').click()
  await page.getByTestId('log-analysis-mode-command').click()
  await expect(page.getByTestId('log-analysis-command-input')).toHaveValue('echo e2e-ai-confirm-run')

  await page.waitForFunction(
    async (before) => {
      const result = await window.api.terminalGetBuffer('termy')
      return result.text.length > before
    },
    bufferBefore,
    { timeout: 10000 }
  )

  await page.getByTestId('log-analysis-confirm-execute-toggle').click()
  const aiBubbleSecond = page.getByTestId('log-analysis-chat-bubble-ai').last()
  const bufferBeforeDirect = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })
  await aiBubbleSecond.click()
  await expect(page.getByTestId('log-analysis-ai-execute-dialog')).toHaveCount(0)
  await expect(page.getByTestId('log-analysis-ai-confirm-execute')).toHaveCount(0)
  await page.waitForFunction(
    async (before) => {
      const result = await window.api.terminalGetBuffer('termy')
      return result.text.length > before
    },
    bufferBeforeDirect,
    { timeout: 10000 }
  )
})

test('自动执行开关仅在 AI 回复完成后执行低风险命令', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await expect(page.getByTestId('log-analysis-auto-execute-low-risk')).toBeChecked()

  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await expect(page.getByTestId('log-analysis-auto-execute-toggle')).toContainText('仅限低风险命令')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  })
  await expect(page.getByTestId('log-analysis-auto-execute-toggle')).toContainText('仅限低风险命令')

  const safeMarker = 'e2e-auto-safe-command'
  await page.getByTestId('log-analysis-input').fill(safeMarker)
  await page.getByTestId('log-analysis-translate').click()
  await expect(page.getByTestId('log-analysis-translate')).toHaveText('询问 AI')
  await page.waitForFunction(
    async (marker) => {
      const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
      return (result.text.match(new RegExp(marker, 'g')) || []).length >= 2
    },
    safeMarker,
    { timeout: 10000 }
  )
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  })

  const blockedMarker = 'e2e-auto-command-substitution-blocked'
  await page.getByTestId('log-analysis-input').fill(`请输出 $(printf ${blockedMarker})`)
  await page.getByTestId('log-analysis-translate').click()
  await expect(page.getByTestId('log-analysis-translate')).toHaveText('询问 AI')
  await page.getByTestId('log-analysis-mode-command').click()
  await expect(page.getByTestId('log-analysis-command-input')).toHaveValue(new RegExp(blockedMarker))
  const assessment = await page.evaluate(async (command) => window.api.queryAssessAutoExecution(command), `echo "$(printf ${blockedMarker})"`)
  expect(assessment.canAutoExecute).toBe(false)
  await page.waitForTimeout(400)
  const terminalBuffer = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect((terminalBuffer.text.match(new RegExp(safeMarker, 'g')) || []).length).toBeGreaterThanOrEqual(2)
  expect(terminalBuffer.text).not.toContain(blockedMarker)

  const activeInstance = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.instanceId
  })
  expect(activeInstance).toBeTruthy()
  const promptLeakProbe = await page.evaluate(async (instanceId) => {
    return window.api.terminalInput('termy-auto', 'printenv PS1 | cat /dev/stdin /dev/tty\n', {
      source: 'query-auto',
      sessionId: 'query:termy-auto',
      expectedInstanceId: instanceId
    })
  }, activeInstance)
  expect(promptLeakProbe.ok).toBe(false)
  const bufferAfterPromptLeakAttempt = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(bufferAfterPromptLeakAttempt.text).not.toContain('shell-manage-prompt=')

  const tamperedGrantMarker = 'e2e-auto-tampered-grant-blocked'
  const tamperedGrantAttempt = await page.evaluate(async ({ instanceId, marker }) => {
    const sessionId = 'query:termy-auto'
    const response = await window.api.queryAiChat({
      requestId: `e2e-tampered-${Date.now()}`,
      input: 'e2e-auto-original-grant-command',
      history: [],
      selectedCommand: 'termy-auto',
      terminalSessionId: sessionId,
      terminalInstanceId: instanceId,
      sessionLogs: [],
      queryOutputLines: []
    })
    return window.api.terminalInput('termy-auto', `echo ${marker}\n`, {
      source: 'query-auto',
      sessionId,
      expectedInstanceId: instanceId,
      autoExecutionToken: response.autoExecutionToken
    })
  }, { instanceId: activeInstance, marker: tamperedGrantMarker })
  expect(tamperedGrantAttempt.ok).toBe(false)
  const bufferAfterTamperedGrant = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(bufferAfterTamperedGrant.text).not.toContain(tamperedGrantMarker)

  const pendingInputMarkerPath = join(testHome, 'auto-execute-pending-input-should-not-run')
  await page.evaluate(
    async (markerPath) => {
      await window.api.terminalInput('termy-auto', `touch "${markerPath}"; `, {
        source: 'query',
        sessionId: 'query:termy-auto'
      })
    },
    pendingInputMarkerPath
  )
  await page.evaluate(async () => {
    await window.api.terminalInput('termy-auto', '\u000c', {
      source: 'query',
      sessionId: 'query:termy-auto'
    })
  })
  await page.waitForTimeout(200)
  const afterPromptRedraw = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(afterPromptRedraw.autoExecutionCapable).toBe(false)
  const pendingSafeMarker = 'e2e-auto-pending-input-blocked'
  await page.getByTestId('log-analysis-mode-ask').click()
  await page.getByTestId('log-analysis-input').fill(pendingSafeMarker)
  await page.getByTestId('log-analysis-translate').click()
  await expect(page.getByTestId('log-analysis-translate')).toHaveText('询问 AI')
  await page.waitForTimeout(300)
  expect(existsSync(pendingInputMarkerPath)).toBe(false)
  const bufferAfterPendingInput = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(bufferAfterPendingInput.text).not.toContain(pendingSafeMarker)
  await page.evaluate(async () => {
    await window.api.terminalInput('termy-auto', '\u0003', { source: 'query', sessionId: 'query:termy-auto' })
  })

  await page.evaluate(async () => {
    await window.api.terminalStop('termy-auto', { sessionId: 'query:termy-auto' })
  })
  const stoppingAttempt = await page.evaluate(async (instanceId) => {
    return window.api.terminalInput('termy-auto', 'echo must-not-run-while-stopping\n', {
      source: 'query-auto',
      sessionId: 'query:termy-auto',
      expectedInstanceId: instanceId
    })
  }, activeInstance)
  expect(stoppingAttempt.ok).toBe(false)
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return !result.instanceId
  })
  await page.waitForTimeout(1000)
  const restarted = await page.evaluate(async () => {
    return window.api.terminalStart('termy-auto', { source: 'query', sessionId: 'query:termy-auto' })
  })
  expect(restarted.instanceId).toBeTruthy()
  expect(restarted.instanceId).not.toBe(activeInstance)
  const staleGenerationMarker = 'e2e-auto-stale-terminal-generation-blocked'
  const staleGenerationAttempt = await page.evaluate(async ({ instanceId, marker }) => {
    return window.api.terminalInput('termy-auto', `echo ${marker}\n`, {
      source: 'query-auto',
      sessionId: 'query:termy-auto',
      expectedInstanceId: instanceId
    })
  }, { instanceId: activeInstance, marker: staleGenerationMarker })
  expect(staleGenerationAttempt.ok).toBe(false)
  const bufferAfterRestart = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(bufferAfterRestart.text).not.toContain(staleGenerationMarker)

  await page.getByTestId('log-analysis-auto-execute-toggle').click()
  await expect(page.getByTestId('log-analysis-auto-execute-low-risk')).not.toBeChecked()
})

test('自动执行必须先观察完成凭证再接受可信提示符', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  })

  await page.getByTestId('log-analysis-input').fill('__e2e_completion_order__')
  await page.getByTestId('log-analysis-translate').click()
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === false
  })
  await page.waitForTimeout(400)
  const midway = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(midway.autoExecutionCapable).toBe(false)
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  }, undefined, { timeout: 5000 })
})

test('主进程会提高 Agent 误判命令的风险等级', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  })

  const blockedDirectory = join(testHome, 'agent-safe-rm-must-stay')
  const reviewFile = join(testHome, 'agent-safe-redirect-must-not-exist')
  await mkdir(blockedDirectory)

  const results = await page.evaluate(async ({ blockedCommand, reviewCommand }) => {
    const sessionId = 'query:termy-auto'
    const execute = async (command: string) => {
      const snapshot = await window.api.terminalGetBuffer('termy-auto', { sessionId })
      const response = await window.api.queryAiChat({
        requestId: `e2e-main-risk-${Date.now()}-${Math.random()}`,
        input: `__e2e_agent_safe_command__ ${command}`,
        history: [],
        selectedCommand: 'termy-auto',
        terminalSessionId: sessionId,
        terminalInstanceId: snapshot.instanceId,
        sessionLogs: [],
        queryOutputLines: []
      })
      return window.api.terminalInput('termy-auto', `${response.action.command || ''}\n`, {
        source: 'query-auto',
        sessionId,
        expectedInstanceId: snapshot.instanceId,
        autoExecutionToken: response.autoExecutionToken
      })
    }
    return {
      blocked: await execute(blockedCommand),
      review: await execute(reviewCommand)
    }
  }, {
    blockedCommand: `rm -rf ${JSON.stringify(blockedDirectory)}`,
    reviewCommand: `echo changed > ${JSON.stringify(reviewFile)}`
  })

  expect(results.blocked.ok).toBe(false)
  expect(results.blocked.riskLevel).toBe('blocked')
  expect(results.review.ok).toBe(false)
  expect(results.review.riskLevel).toBe('review')
  expect(existsSync(blockedDirectory)).toBe(true)
  expect(existsSync(reviewFile)).toBe(false)
})

test('自动执行使用完成凭证并在超时后 Ctrl-C 恢复同一会话', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.autoExecutionCapable === true
  })

  const timeoutResult = await page.evaluate(async () => {
    const sessionId = 'query:termy-auto'
    const before = await window.api.terminalGetBuffer('termy-auto', { sessionId })
    const response = await window.api.queryAiChat({
      requestId: `e2e-timeout-${Date.now()}`,
      input: '__e2e_timeout_recovery__',
      history: [],
      selectedCommand: 'termy-auto',
      terminalSessionId: sessionId,
      terminalInstanceId: before.instanceId,
      sessionLogs: [],
      queryOutputLines: []
    })
    const startedAt = Date.now()
    const execution = await window.api.terminalInput(
      'termy-auto',
      `${response.action.command || ''}\n`,
      {
        source: 'query-auto',
        sessionId,
        expectedInstanceId: before.instanceId,
        autoExecutionToken: response.autoExecutionToken
      }
    )
    const after = await window.api.terminalGetBuffer('termy-auto', { sessionId })
    return { before, execution, after, elapsedMs: Date.now() - startedAt }
  })

  expect(timeoutResult.execution.ok).toBe(false)
  expect(timeoutResult.execution.message).toContain('Ctrl-C')
  expect(timeoutResult.elapsedMs).toBeGreaterThanOrEqual(14_000)
  expect(timeoutResult.after.instanceId).toBe(timeoutResult.before.instanceId)
  expect(timeoutResult.after.autoExecutionCapable).toBe(true)
  expect(timeoutResult.after.text).not.toContain('shell-manage-prompt=')

  const recoveryResult = await page.evaluate(async () => {
    const sessionId = 'query:termy-auto'
    const snapshot = await window.api.terminalGetBuffer('termy-auto', { sessionId })
    const response = await window.api.queryAiChat({
      requestId: `e2e-recovery-${Date.now()}`,
      input: 'e2e-auto-recovered-after-timeout',
      history: [],
      selectedCommand: 'termy-auto',
      terminalSessionId: sessionId,
      terminalInstanceId: snapshot.instanceId,
      sessionLogs: [],
      queryOutputLines: []
    })
    return window.api.terminalInput('termy-auto', `${response.action.command || ''}\n`, {
      source: 'query-auto',
      sessionId,
      expectedInstanceId: snapshot.instanceId,
      autoExecutionToken: response.autoExecutionToken
    })
  })
  expect(recoveryResult.ok).toBe(true)
})

test('支持的会话被手动操作后仍可开启自动执行并重建安全会话', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await page.getByTestId('log-analysis-auto-execute-toggle').click()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return Boolean(result.instanceId)
  })

  await page.getByTestId('log-analysis-terminal').locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('echo manual-before-auto')
  await page.keyboard.press('Enter')

  const autoExecute = page.getByTestId('log-analysis-auto-execute-low-risk')
  await expect(autoExecute).toBeEnabled()
  await page.getByTestId('log-analysis-auto-execute-toggle').click()
  await expect(autoExecute).toBeChecked()
  await page.waitForFunction(async () => {
    const first = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    if (!first.instanceId || !first.autoExecutionCapable) return false
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    const second = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return second.instanceId === first.instanceId && second.autoExecutionCapable === true
  })
  const readyInstance = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })

  const manualResult = await page.evaluate(async () => {
    return window.api.terminalInput('termy-auto', 'echo manual-after-auto\r', {
      source: 'query',
      sessionId: 'query:termy-auto'
    })
  })
  expect(manualResult.ok).toBe(true)
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.text.includes('manual-after-auto')
  })
  await page.waitForFunction(async (instanceId) => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return result.instanceId === instanceId && result.autoExecutionCapable === true
  }, readyInstance.instanceId)
})

test('SSH 会话开启自动执行时保持当前连接', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await page.getByTestId('log-analysis-auto-execute-toggle').click()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-ssh-pending')
  const initialInstance = await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-ssh-pending', { sessionId: 'query:termy-ssh-pending' })
    return result.instanceId || false
  })

  await page.getByTestId('log-analysis-auto-execute-toggle').click()
  await expect(page.getByTestId('log-analysis-auto-execute-low-risk')).toBeChecked()
  await page.waitForTimeout(1000)

  const currentInstance = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-ssh-pending', { sessionId: 'query:termy-ssh-pending' })
  })
  expect(currentInstance.instanceId).toBe(await initialInstance.jsonValue())
})

test('自动执行不信任普通文本伪造的 Shell 提示符', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-fake-prompt')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-fake-prompt', { sessionId: 'query:termy-fake-prompt' })
    return result.text.includes('$ ')
  })

  await expect(page.getByTestId('log-analysis-auto-execute-low-risk')).toBeDisabled()
  await expect(page.getByTestId('log-analysis-auto-execute-toggle')).toContainText('当前会话不支持')
  const marker = 'e2e-auto-fake-prompt-blocked'
  await page.getByTestId('log-analysis-input').fill(marker)
  await page.getByTestId('log-analysis-translate').click()
  await expect(page.getByTestId('log-analysis-translate')).toHaveText('询问 AI')
  await page.waitForTimeout(300)

  expect(existsSync(join(testHome, 'auto-execute-fake-prompt'))).toBe(false)
  const buffer = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-fake-prompt', { sessionId: 'query:termy-fake-prompt' })
  })
  expect(buffer.text).not.toContain(marker)
})

test('自动执行不会向正在停止的终端会话写入', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-command-select').selectOption('termy-auto')
  await page.waitForFunction(async () => {
    const result = await window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
    return Boolean(result.instanceId) && /[$#%]\s*$/.test(result.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, ''))
  })

  const marker = 'e2e-auto-stopping-session-blocked'
  const attempt = await page.evaluate(async (commandMarker) => {
    const sessionId = 'query:termy-auto'
    const snapshot = await window.api.terminalGetBuffer('termy-auto', { sessionId })
    const response = await window.api.queryAiChat({
      requestId: `e2e-stopping-${Date.now()}`,
      input: commandMarker,
      history: [],
      selectedCommand: 'termy-auto',
      terminalSessionId: sessionId,
      terminalInstanceId: snapshot.instanceId,
      sessionLogs: [],
      queryOutputLines: []
    })
    await window.api.terminalStop('termy-auto', { sessionId })
    return window.api.terminalInput('termy-auto', `${response.action.command || ''}\n`, {
      source: 'query-auto',
      sessionId,
      expectedInstanceId: snapshot.instanceId,
      autoExecutionToken: response.autoExecutionToken
    })
  }, marker)
  expect(attempt.ok).toBe(false)
  const buffer = await page.evaluate(async () => {
    return window.api.terminalGetBuffer('termy-auto', { sessionId: 'query:termy-auto' })
  })
  expect(buffer.text).not.toContain(marker)
})

test('满幅终端内展示底部悬浮 AI 工作台且模式切换可用', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await expect(page.getByTestId('log-analysis-command-select')).toBeVisible()
  const pageBox = await page.getByTestId('log-analysis-page').boundingBox()
  const terminal = await page.getByTestId('log-analysis-terminal').boundingBox()
  const workbench = await page.getByTestId('log-analysis-workbench').boundingBox()
  const autoExecute = await page.getByTestId('log-analysis-auto-execute-toggle').boundingBox()
  const select = await page.getByTestId('log-analysis-command-select').boundingBox()
  const historyButton = page.getByTestId('log-analysis-open-history')
  const historyBox = await historyButton.boundingBox()
  expect(pageBox).not.toBeNull()
  expect(terminal).not.toBeNull()
  expect(workbench).not.toBeNull()
  expect(autoExecute).not.toBeNull()
  expect(select).not.toBeNull()
  expect(historyBox).not.toBeNull()
  expect(terminal!.width).toBeGreaterThan(pageBox!.width - 40)
  expect(terminal!.height).toBeGreaterThan(pageBox!.height - 40)
  expect(workbench!.x).toBeGreaterThan(terminal!.x)
  expect(workbench!.x + workbench!.width).toBeLessThan(terminal!.x + terminal!.width)
  expect(workbench!.width / terminal!.width).toBeGreaterThan(0.68)
  expect(workbench!.width / terminal!.width).toBeLessThan(0.72)
  expect(workbench!.height).toBeGreaterThanOrEqual(190)
  expect(workbench!.height).toBeLessThanOrEqual(220)
  expect(Math.abs(terminal!.x + terminal!.width / 2 - (workbench!.x + workbench!.width / 2))).toBeLessThanOrEqual(3)
  const bottomGap = terminal!.y + terminal!.height - workbench!.y - workbench!.height
  expect(bottomGap).toBeGreaterThanOrEqual(24)
  expect(bottomGap).toBeLessThanOrEqual(48)
  expect(select!.x).toBeGreaterThanOrEqual(workbench!.x)
  expect(select!.x + select!.width).toBeLessThanOrEqual(workbench!.x + workbench!.width)
  await expect(historyButton).toHaveText('历史对话')
  expect(historyBox!.x).toBeGreaterThanOrEqual(workbench!.x)
  expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(workbench!.x + workbench!.width)
  expect(autoExecute!.x).toBeGreaterThan(workbench!.x + workbench!.width / 2)
  expect(autoExecute!.y).toBeLessThan(workbench!.y + 64)
  const workbenchVisual = await page.getByTestId('log-analysis-workbench').evaluate((element) => {
    const style = window.getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, backdropFilter: style.backdropFilter }
  })
  expect(workbenchVisual.backgroundColor).toMatch(/^rgb\(/)
  expect(workbenchVisual.backdropFilter).toBe('none')
  await expect(page.getByTestId('log-analysis-auto-execute-low-risk')).toBeChecked()
  await expect(page.getByTestId('log-analysis-mode-ask')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('log-analysis-input')).toBeVisible()
  await expect(page.getByTestId('log-analysis-command-input')).toHaveCount(0)
  await page.getByTestId('log-analysis-mode-command').click()
  await expect(page.getByTestId('log-analysis-mode-command')).toHaveText('手动执行命令')
  await expect(page.getByTestId('log-analysis-mode-command')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('log-analysis-command-input')).toBeVisible()
  await expect(page.getByTestId('log-analysis-input')).toHaveCount(0)
  await page.getByTestId('log-analysis-command-select').selectOption('termy')
  const bufferBeforeExecute = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })
  await page.getByTestId('log-analysis-command-input').fill('echo workbench-command-ok')
  await page.getByTestId('log-analysis-execute').click()
  await page.waitForFunction(
    async (before) => {
      const result = await window.api.terminalGetBuffer('termy')
      return result.text.length > before && result.text.includes('workbench-command-ok')
    },
    bufferBeforeExecute,
    { timeout: 10000 }
  )
  await expect(page.getByTestId('log-analysis-favorites')).toHaveCount(0)
  await expect(page.getByTestId('log-analysis-favorite-add')).toHaveCount(0)
})

test('AI 工作台可拖动且不会移出终端区域', async () => {
  await page.getByTestId('tab-log-analysis').click()
  const terminal = await page.getByTestId('log-analysis-terminal').boundingBox()
  const workbench = page.getByTestId('log-analysis-workbench')
  const before = await workbench.boundingBox()
  const handle = await page.getByTestId('log-analysis-workbench-drag-area').boundingBox()
  expect(terminal).not.toBeNull()
  expect(before).not.toBeNull()
  expect(handle).not.toBeNull()

  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + handle!.width / 2 - 120, handle!.y + handle!.height / 2 - 80)
  await page.mouse.up()

  const after = await workbench.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.x).toBeLessThan(before!.x - 80)
  expect(after!.y).toBeLessThan(before!.y - 50)
  expect(after!.x).toBeGreaterThanOrEqual(terminal!.x)
  expect(after!.y).toBeGreaterThanOrEqual(terminal!.y)
  expect(after!.x + after!.width).toBeLessThanOrEqual(terminal!.x + terminal!.width)
  expect(after!.y + after!.height).toBeLessThanOrEqual(terminal!.y + terminal!.height)
})

test('会话历史默认隐藏并悬浮在底部工作台上方', async () => {
  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-history-popover')).toHaveCount(0)
  await page.getByTestId('log-analysis-command-select').selectOption('termy')
  await page.getByTestId('log-analysis-input').fill('查询昨天的备份任务')
  await page.getByTestId('log-analysis-translate').click()
  await expect(page.getByTestId('log-analysis-translate')).toHaveText('询问 AI')
  await page.getByTestId('log-analysis-open-history').click()
  await expect(page.getByTestId('log-analysis-history-popover')).toBeVisible()
  await expect(page.getByTestId('log-analysis-chat-history')).toBeVisible()
  const popover = await page.getByTestId('log-analysis-history-popover').boundingBox()
  const terminal = await page.getByTestId('log-analysis-terminal').boundingBox()
  const workbench = await page.getByTestId('log-analysis-workbench').boundingBox()
  const historyButton = await page.getByTestId('log-analysis-open-history').boundingBox()
  expect(popover).not.toBeNull()
  expect(terminal).not.toBeNull()
  expect(workbench).not.toBeNull()
  expect(historyButton).not.toBeNull()
  expect(popover!.y + popover!.height).toBeLessThan(workbench!.y)
  const popoverGap = workbench!.y - popover!.y - popover!.height
  expect(popoverGap).toBeGreaterThanOrEqual(8)
  expect(popoverGap).toBeLessThanOrEqual(30)
  expect(Math.abs(terminal!.x + terminal!.width - popover!.x - popover!.width - 32)).toBeLessThanOrEqual(6)
  expect(popover!.width).toBeGreaterThanOrEqual(360)
  expect(popover!.width).toBeLessThanOrEqual(430)
  const triggerCenter = historyButton!.x + historyButton!.width / 2
  expect(triggerCenter).toBeGreaterThan(popover!.x)
  expect(triggerCenter).toBeLessThan(popover!.x + popover!.width)
  await page.getByTestId('log-analysis-close-history').click()
  await expect(page.getByTestId('log-analysis-history-popover')).toHaveCount(0)
})

test('会话持久化与日志分析会话恢复', async () => {
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-alpha')).toContainText('查看日志', { timeout: 15000 })
  await page.getByTestId('command-run-alpha').click()
  await expect(page.getByTestId('log-page')).toBeVisible()
  await expect(page.getByTestId('log-lines')).toContainText('alpha-start')
  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('command-run-termy')).toContainText('继续会话', { timeout: 15000 })
  await page.getByTestId('command-run-termy').click()
  await expect(page.getByTestId('terminal-page')).toContainText('log-analysis-e2e-marker', { timeout: 15000 })
  await page.getByTestId('terminal-back-icon').click()
  await expect(page.getByTestId('home-page')).toBeVisible()

  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()

  await page.getByTestId('log-analysis-command-select').selectOption('termy')
  await page.getByTestId('log-analysis-input').fill('看看当前会话里异常')
  await page.getByTestId('log-analysis-translate').click()
  await page.getByTestId('log-analysis-open-history').click()
  await expect(page.getByTestId('log-analysis-chat-history')).toContainText('看看当前会话里异常')

  await electronApp.close()
  await launchWithHome(testHome)

  await page.getByTestId('tab-log-analysis').click()
  await expect(page.getByTestId('log-analysis-page')).toBeVisible()
  await page.getByTestId('log-analysis-open-history').click()
  await expect(page.getByTestId('log-analysis-chat-history')).toContainText('看看当前会话里异常')
})

test('命令侧栏文案与首页可进入', async () => {
  await expect(page.getByTestId('tab-home')).toContainText('命令')
  await expect(page.getByTestId('tab-home')).toBeVisible()
  await expect(page.getByTestId('home-page')).toBeVisible()
})

test('AI监控侧栏文案与页面可进入', async () => {
  await expect(page.getByTestId('tab-monitoring')).toContainText('监控')
  await page.getByTestId('tab-monitoring').click()
  await expect(page.getByTestId('monitoring-page')).toBeVisible()
  await expect(page.getByTestId('monitoring-workspace')).toBeVisible()
  await expect(page.getByTestId('monitoring-overview-grid')).toBeVisible()
  await expect(page.getByTestId('monitoring-metric-card-cpu')).toBeVisible()
  await expect(page.getByTestId('monitoring-metric-card-memory')).toBeVisible()
  await expect(page.getByTestId('monitoring-device-table')).toBeVisible()
  await expect(page.getByTestId('monitoring-device-rail')).toBeVisible()
  await expect(page.getByTestId('monitoring-selected-device')).toBeVisible()
  await expect(page.getByTestId('monitoring-selected-device')).toContainText('本机')
  await expect(page.getByTestId('monitoring-process-snapshot-panel')).toBeVisible()
  await expect(page.getByTestId('monitoring-ai-sidebar')).toBeVisible()
  await expect(page.getByTestId('monitoring-device-selector')).toContainText('本机')
  await expect(page.getByTestId('monitoring-chat-timeline')).toBeVisible()
  await expect(page.getByTestId('monitoring-chat-input')).toBeVisible()
})

test('AI监控切换命令时不串会话', async () => {
  await page.getByTestId('tab-monitoring').click()
  await expect(page.getByTestId('monitoring-page')).toBeVisible()

  await page.getByTestId('monitoring-device-selector').click()
  await page.getByTestId('monitoring-add-command-option-termy').click()
  await expect(page.getByTestId('monitoring-device-item-termy')).toBeVisible()
  await expect(page.getByTestId('monitoring-device-row-termy')).toBeVisible()
  await expect(page.getByTestId('monitoring-selected-device')).toContainText('termy')

  await page.waitForFunction(
    async () => {
      const result = await window.api.terminalGetBuffer('termy')
      return result.text.includes('__MON_METRIC__')
    },
    undefined,
    { timeout: 10000 }
  )
  const oldCommandBufferBeforeSwitch = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })

  await page.getByTestId('monitoring-device-selector').click()
  await page.getByTestId('monitoring-add-command-option-termy2').click()
  await expect(page.getByTestId('monitoring-device-item-termy2')).toBeVisible()
  await page.getByTestId('monitoring-device-row-termy2').click()
  await expect(page.getByTestId('monitoring-selected-device')).toContainText('termy2')
  await expect(page.getByTestId('monitoring-switch-notice')).toContainText('termy')

  await page.waitForFunction(
    async () => {
      const result = await window.api.terminalGetBuffer('termy2')
      return result.text.includes('__MON_METRIC__')
    },
    undefined,
    { timeout: 10000 }
  )
  await page.waitForTimeout(5200)
  const oldCommandBufferAfterSwitch = await page.evaluate(async () => {
    const result = await window.api.terminalGetBuffer('termy')
    return result.text.length
  })
  const instancesAfterSwitch = await page.evaluate(async () => window.api.terminalListInstances())
  expect(instancesAfterSwitch.instances.some((instance) => instance.commandName === 'termy')).toBe(true)
  // 旧命令保持驻留，但监控采样只发给当前设备。
  expect(oldCommandBufferAfterSwitch - oldCommandBufferBeforeSwitch).toBeLessThanOrEqual(80)
})

test('编辑配置保存与 YAML 语法错误反馈', async () => {
  await page.getByTestId('tab-editor').click()
  await expect(page.getByTestId('editor-page')).toBeVisible()
  await page.getByTestId('editor-mode-toggle').click()
  await expect(page.locator('[data-testid="yaml-editor"] .cm-content')).toBeVisible()

  await setEditorContent(page, `${testConfigYaml}\n# e2e-save\n`)
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('editor-status')).toContainText('配置状态：有效')
  await expect(page.getByTestId('global-toast')).toContainText('配置已保存并重新加载')

  await setEditorContent(page, 'commands: [')
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('editor-status')).toContainText('保存失败')
})

test('首页支持命令列表与标签拖拽排序并持久化', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()

  const firstCommandCard = page.getByTestId('command-row-alpha')
  const secondCommandCard = page.getByTestId('command-row-bad')
  await firstCommandCard.dragTo(secondCommandCard)
  await expect(page.getByTestId('global-toast')).toContainText('命令列表排序已保存')

  const apiTag = page.getByTestId('tag-api')
  const webTag = page.getByTestId('tag-web')
  await apiTag.dragTo(webTag)
  await expect(page.getByTestId('global-toast')).toContainText('标签排序已保存')

  const persisted = await page.evaluate(async () => {
    const raw = await window.api.configRead()
    const commandNames = Array.from(raw.matchAll(/^\s*-\s+name:\s*(.+)$/gm)).map((m) => m[1].trim())
    const tagOrderMatch = raw.match(/^\s*tagOrder:\s*\n((?:\s*-\s*.+\n?)*)/m)
    const tagOrder = tagOrderMatch
      ? Array.from(tagOrderMatch[1].matchAll(/^\s*-\s*(.+)\s*$/gm)).map((m) => m[1].trim().replace(/^["']|["']$/g, ''))
      : []
    return { commandNames: commandNames.slice(0, 4), tagOrder }
  })
  expect(persisted.commandNames.slice(0, 2)).toEqual(['bad', 'alpha'])
  expect(persisted.tagOrder.slice(0, 2)).toEqual(['api', 'web'])

  await electronApp.close()
  await launchWithHome(testHome)

  const commandIdsAfterReload = await page
    .locator('[data-testid^="command-row-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
  expect(commandIdsAfterReload.slice(0, 2)).toEqual(['command-row-bad', 'command-row-alpha'])

  const tagsAfterReload = await page
    .locator('[data-testid^="tag-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
  expect(tagsAfterReload.slice(0, 3)).toEqual(['tag-全部', 'tag-api', 'tag-web'])
})

test('命令列表支持添加与编辑命令并持久化到配置文件', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await openManualCommandForm(page)
  await page.getByTestId('command-form-name').fill('new-web')
  await page.getByTestId('command-form-command').fill('echo new-web')
  await page.getByTestId('command-form-tags').fill('new, web')
  await page.getByTestId('command-form-mode').selectOption('service')
  await page.getByTestId('command-form-auto-restart').check()
  await page.getByTestId('command-form-web-url').fill('http://localhost:3300')
  await submitCreateCommandForm(page, 'command-row-new-web')

  const rawAfterCreate = await page.evaluate(async () => window.api.configRead())
  expect(rawAfterCreate).toContain('name: new-web')
  expect(rawAfterCreate).toContain('command: echo new-web')
  expect(rawAfterCreate).toContain('webUrl: http://localhost:3300')
  expect(rawAfterCreate).toContain('autoRestart: true')

  await page.getByTestId('command-more-new-web').click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '编辑命令' }).click()
  await expect(page.getByTestId('command-form-modal')).toBeVisible()
  await expect(page.getByTestId('command-create-back-to-pick')).toHaveCount(0)

  await page.getByTestId('command-form-name').fill('new-web-edited')
  await page.getByTestId('command-form-command').fill('echo new-web-edited')
  await page.getByTestId('command-form-tags').fill('edited, web')
  await page.getByTestId('command-form-auto-restart').uncheck()
  await page.getByTestId('command-form-web-url').fill('http://localhost:3311')
  await page.getByTestId('command-form-save').click()
  await expect(page.getByTestId('global-toast')).toContainText('命令已更新并保存到配置文件')
  await page.getByTestId('tag-全部').click()
  await expect(page.getByTestId('command-row-new-web-edited')).toBeVisible()
  await expect(page.getByTestId('command-row-new-web')).toHaveCount(0)

  const rawAfterEdit = await page.evaluate(async () => window.api.configRead())
  expect(rawAfterEdit).toContain('name: new-web-edited')
  expect(rawAfterEdit).toContain('command: echo new-web-edited')
  expect(rawAfterEdit).toContain('webUrl: http://localhost:3311')
  expect(rawAfterEdit).toContain('autoRestart: false')
  expect(rawAfterEdit).not.toContain('name: new-web\n')

  await electronApp.close()
  await launchWithHome(testHome)
  await expect(page.getByTestId('command-row-new-web-edited')).toBeVisible()
})

test('命令列表支持从更多操作删除命令并持久化', async () => {
  await expect(page.getByTestId('home-page')).toBeVisible()
  await openManualCommandForm(page)
  await page.getByTestId('command-form-name').fill('to-delete')
  await page.getByTestId('command-form-command').fill('echo to-delete')
  await page.getByTestId('command-form-tags').fill('tmp')
  await submitCreateCommandForm(page, 'command-row-to-delete')

  await page.getByTestId('command-more-to-delete').click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('menuitem', { name: '删除命令' }).click()
  await expect(page.getByTestId('global-toast')).toContainText('命令已删除：to-delete')
  await expect(page.getByTestId('command-row-to-delete')).toHaveCount(0)

  const rawAfterDelete = await page.evaluate(async () => window.api.configRead())
  expect(rawAfterDelete).not.toContain('name: to-delete')
  expect(rawAfterDelete).not.toContain('command: echo to-delete')
})

test('可视化编辑器删除第二条交互命令时应移除输入框', async () => {
  await page.getByTestId('tab-editor').click()
  await expect(page.getByTestId('editor-page')).toBeVisible()

  await page.getByTestId('visual-command-plus-3').click()
  await expect(page.getByTestId('visual-command-segment-input-3-1')).toBeVisible()
  await page.getByTestId('visual-command-segment-input-3-1').fill('tail -f /tmp/e2e.log')
  await expect(page.getByTestId('visual-command-segment-input-3-1')).toHaveValue('tail -f /tmp/e2e.log')

  await page.getByTestId('visual-command-segment-remove-3-1').click()
  await expect(page.getByTestId('visual-command-segment-input-3-1')).toHaveCount(0)
  await expect(page.getByTestId('visual-command-segment-input-3-0')).toBeVisible()
})

test('添加命令弹窗删除第二条交互命令时应移除整行控件', async () => {
  await openManualCommandForm(page)

  await page.getByTestId('command-form-mode').selectOption('terminal')
  await page.getByTestId('command-form-command').fill('ssh root@127.0.0.1')
  await page.getByTestId('command-form-add-segment').click()
  await expect(page.getByTestId('command-form-command-1')).toBeVisible()
  await page.getByTestId('command-form-command-1').fill('tail -f /tmp/e2e.log')
  await expect(page.getByTestId('command-form-command-1')).toHaveValue('tail -f /tmp/e2e.log')
  await expect(page.getByTestId('command-form-remove-segment-1')).toBeVisible()

  await page.getByTestId('command-form-remove-segment-1').click()
  const commandInputsAfterRemove = await page
    .locator('[data-testid^="command-form-command"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
  expect(commandInputsAfterRemove).toEqual(['ssh root@127.0.0.1'])
  await expect(page.getByTestId('command-form-command')).toHaveValue('ssh root@127.0.0.1')
})

test('命令表单支持读取网站图标并持久化到配置', async () => {
  const faviconPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBApJ0xWQAAAAASUVORK5CYII='
  const faviconBuffer = Buffer.from(faviconPngBase64, 'base64')
  const server = createServer((req, res) => {
    if (req.url === '/favicon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(faviconBuffer)
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html><head><link rel="icon" href="/favicon.png" /></head><body>ok</body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const webUrl = `http://127.0.0.1:${port}`

  try {
    await expect(page.getByTestId('home-page')).toBeVisible()
    await openManualCommandForm(page)
    await page.getByTestId('command-form-name').fill('web-icon-test')
    await page.getByTestId('command-form-command').fill('echo web-icon-test')
    await page.getByTestId('command-form-tags').fill('web')
    await page.getByTestId('command-form-web-url').fill(webUrl)
    await page.getByTestId('command-form-fetch-web-icon').click()
    await expect(page.getByTestId('global-toast')).toContainText('网站图标读取成功')
    await submitCreateCommandForm(page, 'command-row-web-icon-test')

    const raw = await page.evaluate(async () => window.api.configRead())
    expect(raw).toContain('name: web-icon-test')
    expect(raw).toContain(`webUrl: ${webUrl}`)
    expect(raw).toContain('iconDataUrl: data:image/png;base64,')
    expect(raw).toContain('iconFilePath: ')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('命令表单直接保存时会自动读取网站图标并持久化', async () => {
  const faviconPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBApJ0xWQAAAAASUVORK5CYII='
  const faviconBuffer = Buffer.from(faviconPngBase64, 'base64')
  const server = createServer((req, res) => {
    if (req.url === '/favicon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(faviconBuffer)
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html><head><link rel="icon" href="/favicon.png" /></head><body>ok</body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const webUrl = `http://127.0.0.1:${port}`

  try {
    await expect(page.getByTestId('home-page')).toBeVisible()
    await openManualCommandForm(page)
    await page.getByTestId('command-form-name').fill('web-auto-icon-test')
    await page.getByTestId('command-form-command').fill('echo web-auto-icon-test')
    await page.getByTestId('command-form-tags').fill('web')
    await page.getByTestId('command-form-web-url').fill(webUrl)
    await submitCreateCommandForm(page, 'command-row-web-auto-icon-test')

    const raw = await page.evaluate(async () => window.api.configRead())
    expect(raw).toContain('name: web-auto-icon-test')
    expect(raw).toContain(`webUrl: ${webUrl}`)
    expect(raw).toContain('iconDataUrl: data:image/png;base64,')
    expect(raw).toContain('iconFilePath: ')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('命令表单支持从 macOS Applications 选择 App 并回填命令', async () => {
  test.skip(process.platform !== 'darwin', '仅在 macOS 校验该能力')
  const appPath = pickExistingMacosAppPath()
  test.skip(!appPath, '未找到可用于测试的系统 App')
  const appName = basename(appPath!).replace(/\.app$/i, '')
  const escapedAppName = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const launchCommand = `open -gj -a "${escapedAppName}"`

  await page.evaluate((path) => {
    window.localStorage.setItem('__e2e_macos_app_path', path)
  }, appPath!)
  await openManualCommandForm(page)
  await page.getByTestId('command-form-pick-macos-app').click()
  await expect(page.getByTestId('command-form-name')).toHaveValue(appName)
  await expect(page.getByTestId('command-form-command')).toHaveValue(launchCommand)
  await page.getByTestId('command-form-tags').fill('macos, app')
  await submitCreateCommandForm(page, `command-row-${appName}`)

  await page.getByTestId(`command-more-${appName}`).click()
  await expect(page.getByTestId('command-context-menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '编辑命令' }).click()
  await expect(page.getByTestId('command-form-modal')).toBeVisible()
  await page.getByTestId('command-form-pick-macos-app').click()
  await expect(page.getByTestId('command-form-command')).toHaveValue(launchCommand)
  await page.getByTestId('command-form-name').fill(`${appName}-edited`)
  await page.getByTestId('command-form-save').click()
  await expect(page.getByTestId(`command-row-${appName}-edited`)).toBeVisible()

  const rawAfterEdit = await page.evaluate(async () => window.api.configRead())
  expect(rawAfterEdit).toContain(`name: ${appName}-edited`)
  expect(rawAfterEdit).toContain(`command: ${launchCommand}`)
  const iconPathMatch = rawAfterEdit.match(/^(\s*)iconFilePath:\s*(.+)$/m)
  expect(iconPathMatch).toBeTruthy()
  const iconPath = (iconPathMatch?.[2] || '').trim().replace(/^['"]|['"]$/g, '')
  expect(iconPath).toContain('/.shell-manage/app-icons/')
  expect(existsSync(iconPath)).toBeTruthy()
  const iconBuffer = await readFile(iconPath)
  const expectedDataUrl = `data:image/png;base64,${iconBuffer.toString('base64')}`
  expect(rawAfterEdit).toContain(`iconDataUrl: ${expectedDataUrl}`)
  await page.evaluate(() => window.localStorage.removeItem('__e2e_macos_app_path'))
})

async function setEditorContent(targetPage: Page, content: string): Promise<void> {
  const editorContent = targetPage.locator('[data-testid="yaml-editor"] .cm-content')
  await editorContent.click()
  await targetPage.keyboard.press(`${modKey}+A`)
  await targetPage.keyboard.insertText(content)
}

async function launchWithHome(homeDir: string, extraEnv: Record<string, string> = {}): Promise<void> {
  electronApp = await electron.launch({
    args: [appEntry],
    env: {
      ...process.env,
      HOME: homeDir,
      SHELL_MANAGE_HOME: homeDir,
      E2E_SHELL_RC_MARKER: '',
      ...extraEnv
    }
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await skipFirstRunAiGuide(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
  await page.getByTestId('tag-全部').click()
}

function pickExistingMacosAppPath(): string | undefined {
  const candidates = [
    '/Applications/Calculator.app',
    '/System/Applications/Calculator.app',
    '/Applications/Safari.app',
    '/System/Applications/Safari.app'
  ]
  return candidates.find((path) => existsSync(path))
}
