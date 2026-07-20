import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { readWindowExpanded } from './window-expanded'
import { exec, execFileSync, spawn as cpSpawn } from 'node:child_process'
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { cpus, freemem, homedir, loadavg, platform, tmpdir, totalmem } from 'node:os'
import { basename, join, extname } from 'node:path'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import type {
  AnalyticsEvent,
  AppConfig,
  CommandConfig,
  DashboardApproveReviewRequest,
  DashboardExecuteProbeRequest,
  LocalMetricSnapshot,
  LocalTopSnapshot,
  ListProjectSubdirectoriesResult,
  DetectProjectsResult,
  DashboardIntentRequest,
  ProcessInspectorItem,
  PresetAction,
  ProjectDirectoryValidation,
  QueryAiRequest,
  TemplatePreviewRequest,
  TemplatePreviewResult,
  ScriptToTemplateRequest,
  ScriptToTemplateResult,
  DeployScriptExecuteRequest,
  DeployScriptExecuteResult,
  DeployScriptValidateRequest,
  DeployScriptValidateResult,
  QueryAiStreamPayload,
  QueryOutputPayload,
  SshKeyImportRequest,
  TerminalDataPayload,
  TerminalStartupStep,
  TerminalObserverPayload,
  TerminalStatusPayload
} from '../shared/types'
import { ConfigLoader } from './config-loader'
import { ProcessManager } from './process-manager'
import { LlmService } from './llm-service'
import { syncLaunchAtLogin } from './login-item'
import { terminateProcessTreeWithEscalation } from './process-tree'
import { resolveServiceArgs, resolveShellExecutable, resolveTerminalArgs } from './shell-runtime'
import { buildDashboardIntent } from './dashboard/intent-service'
import { parseProbeOutput } from './dashboard/parser-core'
import { runProbeCommand } from './dashboard/probe-runner'
import { ReviewTokenStore } from './dashboard/review-token-store'
import {
  assessCommandForAutoExecution,
  combineRiskLevels,
  hardenCommandForAutoExecution,
  inferRiskLevel,
  isCommandBlocked
} from './dashboard/security-gate'
import { detectProjectsFromRoot } from './project-detector'
import { listImmediateSubdirectories, validateProjectDirectories } from './project-registry'
import { createDefaultDeployScript, DEFAULT_DEPLOY_TEMPLATE, previewDeployTemplate } from './template-engine'
import { convertScriptToTemplate } from './script-to-template'
import {
  clearDeployScriptSession,
  getDeployScriptSession,
  isDeployTerminalCommand,
  prepareDeployScriptExecution,
  renderDeployScriptContent,
  resolveDeployScriptInput
} from './deploy-script-runner'
import { prepareManagedSshCommand, resolveCommandWithSshKey } from './ssh-command'
import {
  deleteSshKeyFile,
  getSshKeyFilePath,
  removeSshKeyMetadata,
  sanitizeKeyId,
  slugifyKeyLabel,
  upsertSshKeyMetadata,
  writeSshKeyFile
} from './ssh-key-store'
import yaml from 'js-yaml'
import { AnalyticsStore } from './analytics-store'
import { BrowserManager } from './browser-manager'
import type { BrowserContentBounds, BrowserCreateTabRequest, BrowserTheme } from '../shared/browser-types'

export interface IpcRuntimeControl {
  shutdown: () => Promise<void>
  attachMainWindow: (window: BrowserWindow) => void
}

interface NativeMenuItemInput {
  key: string
  label: string
  enabled?: boolean
  tone?: 'normal' | 'warn' | 'danger'
  group?: string
}

let localNetworkBytes: { rxBytes: number; txBytes: number; at: number } | null = null

export function registerIpcHandlers(
  configLoader: ConfigLoader,
  processManager: ProcessManager,
  llmService: LlmService,
  getConfig: () => AppConfig,
  setConfig: (config: AppConfig) => void
): IpcRuntimeControl {
  const analyticsStore = new AnalyticsStore()
  interface TerminalRuntimeState {
    restarts: number
    manualStop: boolean
    pendingRestartTimer?: ReturnType<typeof setTimeout>
    lastStartOptions?: { source?: string; traceId?: string; sessionId?: string; autoExecutionEnabled?: boolean }
  }
  interface TerminalSessionEntry {
    pty: IPty
    instanceId: string
    commandName: string
    sessionId?: string
    commandLine: string
    sessionKind: string
    autoExecutionPromptMarker?: string
    autoExecutionRcDirectory?: string
    autoExecutionRcFilePath?: string
    autoExecutionPromptTail: string
    autoExecutionPromptReady: boolean
    autoExecutionCompletionMarker?: string
    autoExecutionCompletionSeen: boolean
    autoExecutionSupported: boolean
    autoExecutionMode?: 'local' | 'ssh'
  }
  interface QueryAutoExecutionGrant {
    command: string
    commandName: string
    sessionId?: string
    instanceId: string
    riskLevel: 'safe'
    riskReason: string
    expiresAt: number
  }
  const terminalMap = new Map<string, TerminalSessionEntry>()
  const terminalRuntimeMap = new Map<string, TerminalRuntimeState>()
  const terminalBufferMap = new Map<string, string>()
  const terminalLastExitAtMap = new Map<string, number>()
  const terminalObserverPendingMap = new Map<string, string>()
  const terminalObserverTimerMap = new Map<string, ReturnType<typeof setTimeout>>()
  const terminalPendingInputMap = new Map<string, boolean>()
  const terminalOutputSinceInputMap = new Map<string, boolean>()
  const terminalAutomationBusyMap = new Map<string, IPty>()
  const terminalManuallyControlledSet = new Set<string>()
  const queryAutoExecutionGrantMap = new Map<string, QueryAutoExecutionGrant>()
  const monitoringTraceBySessionKey = new Map<string, string>()
  const MAX_TERMINAL_BUFFER = 200_000
  const TERMINAL_BUFFER_RETAIN_MS = 30 * 60 * 1000
  const MAX_RETAINED_TERMINAL_BUFFERS = 60
  const MAX_TERMINAL_OBSERVER_CHUNK = 8_000
  const TERMINAL_OBSERVER_DEBOUNCE_MS = 900
  const STARTUP_STEP_DEFAULT_TIMEOUT_MS = 15_000
  const reviewTokenStore = new ReviewTokenStore()
  const browserManager = new BrowserManager(broadcast)
  const probeGroupTails = new Map<string, Promise<void>>()
  const QUERY_AUTO_EXECUTION_GRANT_TTL_MS = 60_000

  const readQueryAutoExecutionGrant = (
    token: unknown,
    command: string,
    consume = false
  ): QueryAutoExecutionGrant | undefined => {
    const normalizedToken = typeof token === 'string' ? token.trim() : ''
    if (!normalizedToken) return undefined
    const grant = queryAutoExecutionGrantMap.get(normalizedToken)
    if (!grant) return undefined
    if (consume) queryAutoExecutionGrantMap.delete(normalizedToken)
    if (grant.expiresAt <= Date.now()) {
      queryAutoExecutionGrantMap.delete(normalizedToken)
      return undefined
    }
    return grant.command === command.trim() ? grant : undefined
  }

  const issueQueryAutoExecutionGrant = (
    request: QueryAiRequest,
    action: { type: string; command?: string; riskLevel: string; riskReason: string }
  ): string | undefined => {
    const commandName = request.selectedCommand?.trim() || ''
    const sessionId = request.terminalSessionId?.trim() || undefined
    const instanceId = request.terminalInstanceId?.trim() || ''
    const command = action.command?.trim() || ''
    if (
      action.type !== 'command' ||
      action.riskLevel !== 'safe' ||
      !action.riskReason.trim() ||
      !command ||
      !commandName ||
      !sessionId ||
      !instanceId
    ) {
      return undefined
    }
    const terminal = terminalMap.get(resolveTerminalSessionKey(commandName, sessionId))
    if (
      !terminal ||
      terminal.commandName !== commandName ||
      terminal.sessionId !== sessionId ||
      terminal.instanceId !== instanceId
    ) {
      return undefined
    }
    for (const [existingToken, existingGrant] of queryAutoExecutionGrantMap) {
      if (existingGrant.expiresAt <= Date.now() || existingGrant.instanceId === instanceId) {
        queryAutoExecutionGrantMap.delete(existingToken)
      }
    }
    const token = randomBytes(24).toString('hex')
    queryAutoExecutionGrantMap.set(token, {
      command,
      commandName,
      sessionId,
      instanceId,
      riskLevel: 'safe',
      riskReason: action.riskReason,
      expiresAt: Date.now() + QUERY_AUTO_EXECUTION_GRANT_TTL_MS
    })
    return token
  }

  const resolveCommandForExecution = (command: CommandConfig): CommandConfig => {
    const appConfig = getConfig()
    const resolvedCommand = resolveCommandWithSshKey(
      command.command,
      command.sshKeyId,
      appConfig.settings.sshKeys
    )
    if (resolvedCommand === command.command) return command
    return { ...command, command: resolvedCommand }
  }

  const persistConfig = (config: AppConfig) => {
    const raw = yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true })
    configLoader.save(raw)
    setConfig(config)
    processManager.syncConfig(config.commands)
    broadcast('config:loaded', config)
  }

  const pruneTerminalBuffers = () => {
    const now = Date.now()
    for (const [sessionKey, exitedAt] of terminalLastExitAtMap.entries()) {
      if (terminalMap.has(sessionKey)) continue
      if (now - exitedAt <= TERMINAL_BUFFER_RETAIN_MS) continue
      terminalLastExitAtMap.delete(sessionKey)
      terminalBufferMap.delete(sessionKey)
    }
    if (terminalBufferMap.size <= MAX_RETAINED_TERMINAL_BUFFERS) return
    const stale = [...terminalLastExitAtMap.entries()]
      .filter(([sessionKey]) => !terminalMap.has(sessionKey))
      .sort((a, b) => a[1] - b[1])
    while (terminalBufferMap.size > MAX_RETAINED_TERMINAL_BUFFERS && stale.length > 0) {
      const [sessionKey] = stale.shift()!
      terminalLastExitAtMap.delete(sessionKey)
      terminalBufferMap.delete(sessionKey)
    }
  }

  const clearTerminalObserver = (sessionKey: string) => {
    const timer = terminalObserverTimerMap.get(sessionKey)
    if (timer) {
      clearTimeout(timer)
      terminalObserverTimerMap.delete(sessionKey)
    }
    terminalObserverPendingMap.delete(sessionKey)
  }

  const getOrCreateTerminalRuntime = (sessionKey: string): TerminalRuntimeState => {
    const existing = terminalRuntimeMap.get(sessionKey)
    if (existing) return existing
    const created: TerminalRuntimeState = { restarts: 0, manualStop: false }
    terminalRuntimeMap.set(sessionKey, created)
    return created
  }

  const clearTerminalRestartTimer = (sessionKey: string) => {
    const runtime = terminalRuntimeMap.get(sessionKey)
    if (!runtime?.pendingRestartTimer) return
    clearTimeout(runtime.pendingRestartTimer)
    runtime.pendingRestartTimer = undefined
  }

  const markTerminalManualStop = (sessionKey: string) => {
    const runtime = getOrCreateTerminalRuntime(sessionKey)
    runtime.manualStop = true
    clearTerminalRestartTimer(sessionKey)
  }

  const flushTerminalObserver = (sessionKey: string, commandName: string, sessionId?: string) => {
    terminalObserverTimerMap.delete(sessionKey)
    const pending = terminalObserverPendingMap.get(sessionKey) || ''
    terminalObserverPendingMap.delete(sessionKey)
    const normalized = normalizeTerminalObserverChunk(pending)
    if (!normalized) return
    broadcast('terminal:observer', asTerminalObserver(commandName, normalized, sessionId))
  }

  const queueTerminalObserver = (sessionKey: string, commandName: string, sessionId: string | undefined, data: string) => {
    const prev = terminalObserverPendingMap.get(sessionKey) || ''
    terminalObserverPendingMap.set(sessionKey, `${prev}${data}`.slice(-MAX_TERMINAL_OBSERVER_CHUNK))
    if (terminalObserverTimerMap.has(sessionKey)) return
    const timer = setTimeout(() => flushTerminalObserver(sessionKey, commandName, sessionId), TERMINAL_OBSERVER_DEBOUNCE_MS)
    terminalObserverTimerMap.set(sessionKey, timer)
  }

  async function enqueueProbeByGroup<T>(groupKey: string, task: () => Promise<T>): Promise<T> {
    const prev = probeGroupTails.get(groupKey) || Promise.resolve()
    const run = prev.then(task, task)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    probeGroupTails.set(groupKey, tail)
    try {
      return await run
    } finally {
      if (probeGroupTails.get(groupKey) === tail) {
        probeGroupTails.delete(groupKey)
      }
    }
  }

  const appendTerminalAutomationNote = (
    sessionKey: string,
    commandName: string,
    sessionId: string | undefined,
    message: string,
    expectedPty?: IPty
  ) => {
    if (expectedPty && terminalMap.get(sessionKey)?.pty !== expectedPty) return
    const line = `\r\n[shell-manage] ${message}\r\n`
    const prev = terminalBufferMap.get(sessionKey) || ''
    terminalBufferMap.set(sessionKey, `${prev}${line}`.slice(-MAX_TERMINAL_BUFFER))
    broadcast('terminal:data', asTerminalData(commandName, line, sessionId))
    queueTerminalObserver(sessionKey, commandName, sessionId, line)
  }

  const writeTerminalInput = (sessionKey: string, data: string, expectedPty?: IPty): boolean => {
    const session = terminalMap.get(sessionKey)
    if (!session || (expectedPty && session.pty !== expectedPty)) return false
    terminalOutputSinceInputMap.set(sessionKey, false)
    session.autoExecutionPromptReady = false
    session.autoExecutionPromptTail = ''
    session.pty.write(data)
    terminalPendingInputMap.set(
      sessionKey,
      updateTerminalPendingInput(terminalPendingInputMap.get(sessionKey) || false, data)
    )
    return true
  }

  const waitForAutoExecutionPrompt = async (sessionKey: string, expectedPty: IPty, timeoutMs = 15_000): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const session = terminalMap.get(sessionKey)
      if (session?.pty !== expectedPty) throw new Error('终端会话已结束。')
      if (terminalRuntimeMap.get(sessionKey)?.manualStop) throw new Error('终端会话正在停止。')
      if (session.autoExecutionPromptReady) return
      await sleep(50)
    }
    throw new Error('命令已发送，但未能确认执行完成。')
  }

  const waitForAutoExecutionCompletion = async (
    sessionKey: string,
    expectedPty: IPty,
    completionMarker: string,
    timeoutMs = 15_000
  ): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const session = terminalMap.get(sessionKey)
      if (session?.pty !== expectedPty) throw new Error('终端会话已结束。')
      if (terminalRuntimeMap.get(sessionKey)?.manualStop) throw new Error('终端会话正在停止。')
      if (session.autoExecutionCompletionMarker !== completionMarker) {
        throw new Error('自动执行完成凭证已失效。')
      }
      if (session.autoExecutionCompletionSeen && session.autoExecutionPromptReady) {
        if (terminalManuallyControlledSet.has(sessionKey)) throw new Error('自动执行已被手动中断。')
        return
      }
      await sleep(50)
    }
    throw new Error('命令执行超时，已发送 Ctrl-C 中断。')
  }

  const isTerminalAutoExecutionReady = (sessionKey: string, session?: TerminalSessionEntry): boolean => {
    if (!session?.autoExecutionPromptMarker || !session.autoExecutionPromptReady) return false
    if (!terminalOutputSinceInputMap.get(sessionKey)) return false
    if (terminalRuntimeMap.get(sessionKey)?.manualStop) return false
    if (terminalAutomationBusyMap.get(sessionKey) === session.pty) return false
    if (terminalManuallyControlledSet.has(sessionKey) || terminalPendingInputMap.get(sessionKey)) return false
    return true
  }

  const consumeAutoExecutionPromptMarker = (sessionKey: string, session: TerminalSessionEntry, data: string): string => {
    const marker = session.autoExecutionPromptMarker
    if (!marker) return data

    let output = `${session.autoExecutionPromptTail}${data}`
    let visibleOutput = ''
    while (output) {
      const completionMarker = session.autoExecutionCompletionMarker
      const promptIndex = output.indexOf(marker)
      const completionIndex = completionMarker ? output.indexOf(completionMarker) : -1
      const nextIsCompletion = completionIndex >= 0 && (promptIndex < 0 || completionIndex < promptIndex)
      const markerIndex = nextIsCompletion ? completionIndex : promptIndex
      if (markerIndex < 0) break

      visibleOutput += output.slice(0, markerIndex)
      if (nextIsCompletion && completionMarker) {
        output = output.slice(markerIndex + completionMarker.length)
        session.autoExecutionCompletionSeen = true
        continue
      }

      output = output.slice(markerIndex + marker.length)
      const completionSatisfied = !session.autoExecutionCompletionMarker || session.autoExecutionCompletionSeen
      const interruptedWhileBusy =
        Boolean(session.autoExecutionCompletionMarker) &&
        terminalAutomationBusyMap.get(sessionKey) === session.pty &&
        terminalManuallyControlledSet.has(sessionKey)
      if (!terminalPendingInputMap.get(sessionKey) && completionSatisfied) {
        session.autoExecutionPromptReady = true
        if (!interruptedWhileBusy) terminalManuallyControlledSet.delete(sessionKey)
        cleanupManagedAutoExecutionShell(session)
        session.autoExecutionRcDirectory = undefined
        session.autoExecutionRcFilePath = undefined
      }
    }

    const candidates = [marker, session.autoExecutionCompletionMarker].filter((item): item is string => Boolean(item))
    let pendingLength = 0
    for (let length = output.length; length > 0; length -= 1) {
      const suffix = output.slice(-length)
      if (!candidates.some((candidate) => candidate.startsWith(suffix))) continue
      pendingLength = length
      break
    }
    session.autoExecutionPromptTail = pendingLength > 0 ? output.slice(-pendingLength) : ''
    visibleOutput += pendingLength > 0 ? output.slice(0, -pendingLength) : output
    return visibleOutput
  }

  const waitForTerminalOutputPattern = async (
    sessionKey: string,
    expectedPty: IPty,
    pattern: RegExp,
    timeoutMs: number
  ): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (terminalMap.get(sessionKey)?.pty !== expectedPty) throw new Error('会话已结束')
      const text = terminalBufferMap.get(sessionKey) || ''
      if (pattern.test(text)) return
      await sleep(120)
    }
    throw new Error(`等待输出超时（${timeoutMs}ms）`)
  }

  const runTerminalStartupSteps = async (
    sessionKey: string,
    expectedPty: IPty,
    commandName: string,
    sessionId: string | undefined,
    startupSteps: TerminalStartupStep[],
    traceId: string
  ): Promise<void> => {
    if (startupSteps.length === 0) return
    appendTerminalAutomationNote(sessionKey, commandName, sessionId, `启动步骤已开始，共 ${startupSteps.length} 步`, expectedPty)
    for (let index = 0; index < startupSteps.length; index += 1) {
      const step = startupSteps[index]
      const stepLabel = step.label?.trim() || `步骤 ${index + 1}`
      if (step.delayMs && step.delayMs > 0) {
        appendTerminalAutomationNote(sessionKey, commandName, sessionId, `${stepLabel} 等待 ${step.delayMs}ms`, expectedPty)
        await sleep(step.delayMs)
      }
      if (step.waitForOutputPattern) {
        const timeoutMs = step.timeoutMs || STARTUP_STEP_DEFAULT_TIMEOUT_MS
        appendTerminalAutomationNote(
          sessionKey,
          commandName,
          sessionId,
          `${stepLabel} 等待输出匹配 /${step.waitForOutputPattern}/（超时 ${timeoutMs}ms）`,
          expectedPty
        )
        await waitForTerminalOutputPattern(sessionKey, expectedPty, new RegExp(step.waitForOutputPattern, 'm'), timeoutMs)
      }
      const session = terminalMap.get(sessionKey)
      if (session?.pty !== expectedPty) throw new Error('会话已结束，无法继续执行启动步骤')
      const payload = step.sendNewline === false ? step.send : `${step.send}\n`
      if (!writeTerminalInput(sessionKey, payload, expectedPty)) throw new Error('会话已结束，无法继续执行启动步骤')
      appendTerminalAutomationNote(sessionKey, commandName, sessionId, `${stepLabel} 已发送`, expectedPty)
      console.info('[terminal][startup-step] sent', {
        traceId,
        sessionKey,
        commandName,
        sessionId,
        stepIndex: index,
        stepLabel,
        sendPreview: step.send.slice(0, 180),
        at: Date.now()
      })
    }
    appendTerminalAutomationNote(sessionKey, commandName, sessionId, '启动步骤执行完成，已进入手动交互模式', expectedPty)
  }

  const POST_COMMAND_IDLE_MS = 2000
  const POST_COMMAND_TIMEOUT_MS = 30_000

  const waitForOutputIdle = async (
    sessionKey: string,
    expectedPty: IPty,
    idleMs: number,
    timeoutMs: number
  ): Promise<void> => {
    const startedAt = Date.now()
    let lastBufferLen = (terminalBufferMap.get(sessionKey) || '').length
    let lastChangeAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (terminalMap.get(sessionKey)?.pty !== expectedPty) throw new Error('会话已结束')
      const currentLen = (terminalBufferMap.get(sessionKey) || '').length
      if (currentLen !== lastBufferLen) {
        lastBufferLen = currentLen
        lastChangeAt = Date.now()
      }
      if (Date.now() - lastChangeAt >= idleMs && currentLen > 0) return
      await sleep(100)
    }
    throw new Error(`等待输出稳定超时（${timeoutMs}ms）`)
  }

  const runPostCommands = async (
    sessionKey: string,
    expectedPty: IPty,
    commandName: string,
    sessionId: string | undefined,
    postCommands: string[],
    traceId: string
  ): Promise<void> => {
    appendTerminalAutomationNote(
      sessionKey,
      commandName,
      sessionId,
      `等待会话就绪后注入 ${postCommands.length} 条后续命令`,
      expectedPty
    )
    await waitForOutputIdle(sessionKey, expectedPty, POST_COMMAND_IDLE_MS, POST_COMMAND_TIMEOUT_MS)
    for (let index = 0; index < postCommands.length; index += 1) {
      const cmd = postCommands[index]
      const session = terminalMap.get(sessionKey)
      if (session?.pty !== expectedPty) throw new Error('会话已结束，无法继续注入')
      if (!writeTerminalInput(sessionKey, `${cmd}\n`, expectedPty)) throw new Error('会话已结束，无法继续注入')
      appendTerminalAutomationNote(sessionKey, commandName, sessionId, `已注入: ${cmd.slice(0, 120)}`, expectedPty)
      console.info('[terminal][post-command] sent', { traceId, commandName, sessionId, index, cmd: cmd.slice(0, 180), at: Date.now() })
      if (index < postCommands.length - 1) {
        await waitForOutputIdle(sessionKey, expectedPty, POST_COMMAND_IDLE_MS, POST_COMMAND_TIMEOUT_MS)
      }
    }
    appendTerminalAutomationNote(sessionKey, commandName, sessionId, '后续命令注入完成，已进入手动交互模式', expectedPty)
  }

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('window:get-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return { fullscreen: win ? readWindowExpanded(win) : false }
  })
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { maximized: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { maximized: win.isMaximized() }
  })
  ipcMain.handle('window:get-focused', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return { focused: win?.isFocused() === true }
  })
  ipcMain.handle('monitoring:get-local-snapshot', (): LocalMetricSnapshot => buildLocalMetricSnapshot())
  ipcMain.handle('monitoring:get-local-top-snapshot', (_event, mode: 'process' | 'threads'): LocalTopSnapshot => buildLocalTopSnapshot(mode))
  ipcMain.handle('menu:show-command-context', async (event, items: NativeMenuItemInput[]) => {
    if (!Array.isArray(items) || items.length === 0) return { key: null as string | null }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { key: null as string | null }
    let selectedKey: string | null = null
    const grouped = items.reduce<Record<string, NativeMenuItemInput[]>>((acc, item) => {
      const group = item.group || '更多设置'
      if (!acc[group]) acc[group] = []
      acc[group].push(item)
      return acc
    }, {})
    const orderedGroups = ['快捷运行', '配置管理', '更多设置'].filter((group) => grouped[group]?.length > 0)
    const template: Electron.MenuItemConstructorOptions[] = []
    for (const group of orderedGroups) {
      const chunk = grouped[group] || []
      if (template.length > 0) template.push({ type: 'separator' })
      for (const item of chunk) {
        template.push({
          label: item.label,
          enabled: item.enabled !== false,
          click: () => {
            selectedKey = item.key
          }
        })
      }
    }
    const menu = Menu.buildFromTemplate(template)
    await new Promise<void>((resolve) => {
      menu.popup({
        window: win,
        callback: () => resolve()
      })
    })
    return { key: selectedKey }
  })

  ipcMain.handle('config:read', () => configLoader.readRaw())
  ipcMain.handle(
    'analytics:track',
    async (_e, payload: Omit<AnalyticsEvent, 'schemaVersion' | 'eventId' | 'timestamp'> & { timestamp?: number }) => {
      await analyticsStore.track(payload)
      return { ok: true as const }
    }
  )
  ipcMain.handle('analytics:flush', async () => {
    await analyticsStore.flush()
    return { ok: true as const }
  })
  ipcMain.handle('analytics:aggregate-3d', async () => {
    const { summary, outputPath } = await analyticsStore.aggregate3d()
    return { ok: true as const, summary, outputPath }
  })
  ipcMain.handle('analytics:get-viewer-snapshot', async (_e, limit?: number) => {
    const snapshot = await analyticsStore.getViewerSnapshot(typeof limit === 'number' ? limit : 200)
    return { ok: true as const, snapshot }
  })
  ipcMain.handle('config:getPath', () => configLoader.getConfigPath())
  ipcMain.handle('config:validate', (_e, raw: string) => configLoader.validate(raw))
  ipcMain.handle('config:save', (_e, raw: string) => {
    configLoader.save(raw)
    const config = configLoader.readParsed()
    setConfig(config)
    syncLaunchAtLogin(config.settings.launchAtLogin === true)
    processManager.syncConfig(config.commands)
    broadcast('config:loaded', config)
    return { ok: true }
  })

  ipcMain.handle('ssh-key:import', (_e, request: SshKeyImportRequest) => {
    const label = request.label?.trim()
    if (!label) throw new Error('密钥名称不能为空')
    const id = sanitizeKeyId(request.id?.trim() || slugifyKeyLabel(label))
    writeSshKeyFile(id, request.content)
    const config = getConfig()
    const nextConfig: AppConfig = {
      ...config,
      settings: {
        ...config.settings,
        sshKeys: upsertSshKeyMetadata(config.settings.sshKeys, {
          id,
          label,
          createdAt: new Date().toISOString()
        })
      }
    }
    persistConfig(nextConfig)
    return { ok: true as const, id, label }
  })

  ipcMain.handle('ssh-key:delete', (_e, id: string) => {
    const keyId = sanitizeKeyId(id)
    deleteSshKeyFile(keyId)
    const config = getConfig()
    const nextConfig: AppConfig = {
      ...config,
      commands: config.commands.map((command) =>
        command.sshKeyId === keyId ? { ...command, sshKeyId: undefined } : command
      ),
      settings: {
        ...config.settings,
        sshKeys: removeSshKeyMetadata(config.settings.sshKeys, keyId)
      }
    }
    persistConfig(nextConfig)
    return { ok: true as const }
  })

  ipcMain.handle('ssh-key:list', () => {
    return getConfig().settings.sshKeys || []
  })

  ipcMain.handle('process:start', (_e, commandName: string) => {
    const command = getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(`命令不存在: ${commandName}`)
    if ((command.mode || 'service') === 'terminal') {
      throw new Error(`命令 ${commandName} 为交互终端模式，请使用“进入终端”`)
    }
    processManager.start(resolveCommandForExecution(command))
    return { ok: true }
  })
  ipcMain.handle('process:stop', (_e, commandName: string) => {
    processManager.stop(commandName)
    return { ok: true }
  })
  ipcMain.handle('process:restart', (_e, commandName: string) => {
    const command = getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(`命令不存在: ${commandName}`)
    if ((command.mode || 'service') === 'terminal') {
      throw new Error(`命令 ${commandName} 为交互终端模式，不支持后台重启`)
    }
    processManager.restart(resolveCommandForExecution(command))
    return { ok: true }
  })

  ipcMain.handle('preset:execute', async (_e, presetName: string) => {
    await runPresetSequence('start', presetName, getConfig, processManager)
    return { ok: true }
  })
  ipcMain.handle('preset:stop', async (_e, presetName: string) => {
    await runPresetSequence('stop', presetName, getConfig, processManager)
    return { ok: true }
  })

  ipcMain.handle(
    'project:detect-from-directory',
    async (
      _e,
      request?: { rootPath?: string; maxDepth?: number; maxDirs?: number }
    ): Promise<DetectProjectsResult> => {
      let rootPath = request?.rootPath?.trim() || ''
      if (!rootPath) {
        const selected = await dialog.showOpenDialog({
          title: '选择需要导入的目录',
          properties: ['openDirectory']
        })
        if (selected.canceled || selected.filePaths.length === 0) {
          return { canceled: true, projects: [] }
        }
        rootPath = selected.filePaths[0]
      }
      const projects = await detectProjectsFromRoot(rootPath, {
        maxDepth: request?.maxDepth,
        maxDirs: request?.maxDirs
      })
      return {
        canceled: false,
        rootPath,
        projects
      }
    }
  )

  ipcMain.handle('project:pick-directory', async (): Promise<{ canceled: boolean; path?: string }> => {
    const selected = await dialog.showOpenDialog({
      title: '选择项目目录',
      properties: ['openDirectory']
    })
    if (selected.canceled || selected.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, path: selected.filePaths[0] }
  })

  ipcMain.handle('project:list-subdirectories', async (): Promise<ListProjectSubdirectoriesResult> => {
    const selected = await dialog.showOpenDialog({
      title: '选择要导入子目录的父目录',
      properties: ['openDirectory']
    })
    if (selected.canceled || selected.filePaths.length === 0) {
      return { canceled: true, subdirectories: [] }
    }
    const rootPath = selected.filePaths[0]
    const subdirectories = await listImmediateSubdirectories(rootPath)
    return { canceled: false, rootPath, subdirectories }
  })

  ipcMain.handle('project:validate-directories', (): ProjectDirectoryValidation[] => {
    const config = getConfig()
    return validateProjectDirectories(config.projectDirectories || [])
  })

  ipcMain.handle('deploy:get-default-template', (): { template: string; script: ReturnType<typeof createDefaultDeployScript> } => {
    return {
      template: DEFAULT_DEPLOY_TEMPLATE,
      script: createDefaultDeployScript()
    }
  })

  ipcMain.handle('deploy:preview-template', (_e, request: TemplatePreviewRequest): TemplatePreviewResult => {
    const config = getConfig()
    return previewDeployTemplate({
      template: request.content,
      projectDirectories: request.projectDirectories ?? config.projectDirectories ?? [],
      sshKeys: config.settings.sshKeys || []
    })
  })

  ipcMain.handle('deploy:convert-to-template', (_e, request: ScriptToTemplateRequest): ScriptToTemplateResult => {
    const config = getConfig()
    const sshKeys = config.settings.sshKeys || []
    return convertScriptToTemplate({
      script: request.script,
      projectDirectories: request.projectDirectories ?? config.projectDirectories ?? [],
      sshKeys: sshKeys.map((item) => ({
        id: item.id,
        label: item.label,
        path: getSshKeyFilePath(item.id)
      }))
    })
  })

  ipcMain.handle('deploy:validate-script', (_e, request: DeployScriptValidateRequest): DeployScriptValidateResult => {
    const config = getConfig()
    const script = resolveDeployScriptInput(config, request)
    const rendered = renderDeployScriptContent(config, script)
    return {
      ok: rendered.missingSlots.length === 0 && rendered.unknownSlots.length === 0,
      missingSlots: rendered.missingSlots,
      unknownSlots: rendered.unknownSlots,
      usedSlots: rendered.usedSlots
    }
  })

  ipcMain.handle('deploy:execute-script', async (_e, request: DeployScriptExecuteRequest): Promise<DeployScriptExecuteResult> => {
    const config = getConfig()
    const script = resolveDeployScriptInput(config, request)
    const prepared = await prepareDeployScriptExecution(app.getPath('userData'), config, script)
    return {
      ok: true,
      terminalCommandName: prepared.terminalCommandName,
      scriptId: prepared.scriptId,
      scriptName: prepared.scriptName
    }
  })

  ipcMain.handle('app:pick-macos-application', async (_e, request?: { appPath?: string }) => {
    if (process.platform !== 'darwin') {
      throw new Error('当前平台不支持选择 macOS App')
    }
    let appPath = request?.appPath?.trim() || ''
    if (!appPath) {
      const fallbackPath = join(homedir(), 'Applications')
      const selected = await dialog.showOpenDialog({
        title: '选择应用（.app）',
        defaultPath: '/Applications',
        properties: ['openFile'],
        filters: [{ name: 'Application', extensions: ['app'] }]
      })
      if (selected.canceled || selected.filePaths.length === 0) {
        const selectedFallback = await dialog.showOpenDialog({
          title: '选择应用（.app）',
          defaultPath: fallbackPath,
          properties: ['openFile'],
          filters: [{ name: 'Application', extensions: ['app'] }]
        })
        if (selectedFallback.canceled || selectedFallback.filePaths.length === 0) {
          return { canceled: true as const }
        }
        appPath = selectedFallback.filePaths[0] || ''
      } else {
        appPath = selected.filePaths[0] || ''
      }
    }

    if (!appPath) return { canceled: true as const }
    if (!/\.app$/i.test(appPath)) {
      throw new Error('请选择 .app 应用')
    }

    const appName = basename(appPath).replace(/\.app$/i, '').trim()
    if (!appName) {
      throw new Error('无法识别应用名称')
    }
    const launchCommand = `open -a "${escapeDoubleQuoted(appName)}"`
    const iconResult = await resolveMacosAppIconData(appPath, appName)
    return {
      canceled: false as const,
      appPath,
      appName,
      launchCommand,
      iconDataUrl: iconResult.iconDataUrl,
      iconFilePath: iconResult.iconFilePath
    }
  })

  ipcMain.handle('app:fetch-website-icon', async (_e, request?: { url?: string }) => {
    const rawUrl = request?.url?.trim() || ''
    if (!rawUrl) throw new Error('网站地址不能为空')
    const pageUrl = normalizeWebsiteUrl(rawUrl)
    const result = await resolveWebsiteIconData(pageUrl)
    if (!result.iconDataUrl || !result.iconFilePath) {
      throw new Error('未读取到网站图标，请确认地址可访问')
    }
    return {
      ok: true as const,
      pageUrl,
      iconSourceUrl: result.iconSourceUrl,
      iconDataUrl: result.iconDataUrl,
      iconFilePath: result.iconFilePath
    }
  })

  const startTerminalSession = (
    commandName: string,
    options?: { source?: string; traceId?: string; sessionId?: string; autoExecutionEnabled?: boolean },
    behavior?: { preserveRestarts?: boolean }
  ) => {
    pruneTerminalBuffers()
    const deploySession = isDeployTerminalCommand(commandName) ? getDeployScriptSession(commandName) : undefined
    const command =
      deploySession
        ? ({
            name: commandName,
            command: deploySession.commandLine,
            tags: [],
            mode: 'terminal' as const,
            autoRestart: false
          } satisfies CommandConfig)
        : getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(deploySession ? `部署脚本会话已过期: ${commandName}` : `命令不存在: ${commandName}`)
    const resolved = resolveCommandForExecution(command)
    const source = options?.source || 'unknown'
    const traceId = options?.traceId || 'trace-missing'
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const runtime = getOrCreateTerminalRuntime(sessionKey)
    const isMonitoringSource = source === 'monitoring'
    const commandSegments = resolved.command.split('|||').map((s) => s.trim()).filter((s) => s.length > 0)
    const primaryCommand = commandSegments[0] || command.command
    const postCommands = commandSegments.slice(1)
    const isSshCommand = /^\s*ssh(\s|$)/i.test(primaryCommand)
    const autoExecutionSupported = supportsManagedAutoExecutionShell(primaryCommand)
    if (isMonitoringSource && isSshCommand) {
      console.info('[monitoring][ssh] before_connect', {
        traceId,
        commandName,
        sessionId,
        commandPreview: primaryCommand.slice(0, 240),
        at: Date.now()
      })
    }
    const existing = terminalMap.get(sessionKey)
    if (existing) {
      const existingBuffer = terminalBufferMap.get(sessionKey) || ''
      if (isMonitoringSource) {
        monitoringTraceBySessionKey.set(sessionKey, traceId)
      }
      if (isMonitoringSource && isSshCommand) {
        console.info('[monitoring][ssh] connecting(reuse_existing_session)', {
          traceId,
          commandName,
          sessionId,
          pid: existing.pty.pid,
          at: Date.now()
        })
      }
      return {
        ok: true,
        state: 'running' as const,
        buffer: existingBuffer,
        instanceId: existing.instanceId,
        autoExecutionSupported: existing.autoExecutionSupported,
        autoExecutionPrepared: Boolean(existing.autoExecutionPromptMarker),
        autoExecutionCapable: isTerminalAutoExecutionReady(sessionKey, existing)
      }
    }
    runtime.lastStartOptions = {
      source: options?.source,
      traceId: options?.traceId,
      sessionId: options?.sessionId,
      autoExecutionEnabled: options?.autoExecutionEnabled
    }
    runtime.manualStop = false
    clearTerminalRestartTimer(sessionKey)
    if (!behavior?.preserveRestarts) runtime.restarts = 0
    if (!terminalBufferMap.has(sessionKey)) {
      terminalBufferMap.set(sessionKey, '')
    }
    terminalLastExitAtMap.delete(sessionKey)
    const managedAutoExecutionShell = options?.autoExecutionEnabled || (isSshCommand && autoExecutionSupported)
      ? prepareManagedAutoExecutionShell(primaryCommand)
      : undefined
    const terminalLaunchCommand = managedAutoExecutionShell?.command || primaryCommand
    const shellExec = resolveShellExecutable()
    const shellArgs = resolveTerminalArgs(shellExec, terminalLaunchCommand)
    let pty: IPty
    try {
      pty = ptySpawn(shellExec, shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd: process.cwd(),
        env: process.env
      })
    } catch (error) {
      cleanupManagedAutoExecutionShell(managedAutoExecutionShell)
      const message = error instanceof Error ? error.message : String(error)
      const hint =
        /posix_spawnp failed/i.test(message)
          ? ' 常见原因：node-pty 未针对当前 Electron 编译，请在项目根目录执行 npm run rebuild:native（或重新 npm install 以触发 postinstall）。'
          : ''
      throw new Error(`无法启动交互终端（shell: ${shellExec}）：${message}${hint}`)
    }
    const instanceId = randomBytes(12).toString('hex')
    terminalMap.set(sessionKey, {
      pty,
      instanceId,
      commandName,
      sessionId,
      commandLine: resolved.command,
      sessionKind: resolveTerminalSessionKind(sessionId, options?.source),
      autoExecutionPromptMarker: managedAutoExecutionShell?.promptMarker,
      autoExecutionRcDirectory: managedAutoExecutionShell?.rcDirectory,
      autoExecutionRcFilePath: managedAutoExecutionShell?.rcFilePath,
      autoExecutionPromptTail: '',
      autoExecutionPromptReady: false,
      autoExecutionCompletionSeen: false,
      autoExecutionSupported,
      autoExecutionMode: managedAutoExecutionShell?.mode
    })
    terminalPendingInputMap.set(sessionKey, false)
    terminalOutputSinceInputMap.set(sessionKey, false)
    terminalManuallyControlledSet.delete(sessionKey)
    if (isMonitoringSource) {
      monitoringTraceBySessionKey.set(sessionKey, traceId)
    }
    if (isMonitoringSource && isSshCommand) {
      console.info('[monitoring][ssh] connecting(spawned_session)', {
        traceId,
        commandName,
        sessionId,
        pid: pty.pid,
        shellExec,
        at: Date.now()
      })
    }
    broadcast('terminal:status', asTerminalStatus(commandName, 'running', undefined, sessionId))
    pty.onData((data) => {
      const activeTerminal = terminalMap.get(sessionKey)
      if (activeTerminal?.pty !== pty) return
      terminalOutputSinceInputMap.set(sessionKey, true)
      const visibleData = consumeAutoExecutionPromptMarker(sessionKey, activeTerminal, data)
      if (visibleData) {
        const prev = terminalBufferMap.get(sessionKey) || ''
        const merged = `${prev}${visibleData}`
        terminalBufferMap.set(sessionKey, merged.slice(-MAX_TERMINAL_BUFFER))
        broadcast('terminal:data', asTerminalData(commandName, visibleData, sessionId))
        queueTerminalObserver(sessionKey, commandName, sessionId, visibleData)
      }
      const monitoringTraceId = monitoringTraceBySessionKey.get(sessionKey)
      if (monitoringTraceId) {
        const preview = sanitizeTerminalLogPreview(data)
        if (preview) {
          console.info('[monitoring][ssh] command_result', {
            traceId: monitoringTraceId,
            commandName,
            sessionId,
            outputPreview: preview,
            at: Date.now()
          })
        }
      }
    })
    pty.onExit(({ exitCode }) => {
      const exitedTerminal = terminalMap.get(sessionKey)
      if (exitedTerminal?.pty !== pty) return
      cleanupManagedAutoExecutionShell(terminalMap.get(sessionKey))
      const monitoringTraceId = monitoringTraceBySessionKey.get(sessionKey)
      if (monitoringTraceId) {
        console.info('[monitoring][ssh] session_exit', {
          traceId: monitoringTraceId,
          commandName,
          sessionId,
          exitCode,
          at: Date.now()
        })
      }
      terminalMap.delete(sessionKey)
      for (const [token, grant] of queryAutoExecutionGrantMap) {
        if (grant.instanceId === exitedTerminal.instanceId) queryAutoExecutionGrantMap.delete(token)
      }
      terminalPendingInputMap.delete(sessionKey)
      terminalOutputSinceInputMap.delete(sessionKey)
      terminalManuallyControlledSet.delete(sessionKey)
      if (terminalAutomationBusyMap.get(sessionKey) === pty) {
        terminalAutomationBusyMap.delete(sessionKey)
      }
      terminalLastExitAtMap.set(sessionKey, Date.now())
      monitoringTraceBySessionKey.delete(sessionKey)
      clearTerminalObserver(sessionKey)
      if (isDeployTerminalCommand(commandName)) {
        clearDeployScriptSession(commandName)
      }
      pruneTerminalBuffers()
      const maxRestarts = command.maxRestarts ?? 3
      const shouldRestart =
        !runtime.manualStop && exitCode !== 0 && Boolean(command.autoRestart) && runtime.restarts < maxRestarts
      if (shouldRestart) {
        runtime.restarts += 1
        const restartMessage = `会话异常退出，正在自动重连（${runtime.restarts}/${maxRestarts}）`
        appendTerminalAutomationNote(sessionKey, commandName, sessionId, restartMessage)
        broadcast('terminal:status', asTerminalStatus(commandName, 'idle', exitCode, sessionId, restartMessage, runtime.restarts))
        runtime.pendingRestartTimer = setTimeout(() => {
          runtime.pendingRestartTimer = undefined
          if (runtime.manualStop) return
          const latest = getConfig().commands.find((item) => item.name === commandName)
          if (!latest || (latest.mode || 'service') !== 'terminal') return
          try {
            startTerminalSession(commandName, runtime.lastStartOptions, { preserveRestarts: true })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            appendTerminalAutomationNote(sessionKey, commandName, sessionId, `自动重连失败：${message}`)
          }
        }, 1500)
        return
      }
      runtime.pendingRestartTimer = undefined
      const finalMessage = runtime.manualStop
        ? '会话已手动停止'
        : exitCode === 0
          ? '会话已正常退出'
          : `会话退出码 ${exitCode ?? -1}`
      appendTerminalAutomationNote(sessionKey, commandName, sessionId, finalMessage)
      broadcast('terminal:status', asTerminalStatus(commandName, 'idle', exitCode, sessionId, finalMessage, runtime.restarts))
    })
    const startupSteps = (command.terminalStartupSteps || []).filter((step) => step.send.trim().length > 0)
    if (startupSteps.length > 0) {
      terminalAutomationBusyMap.set(sessionKey, pty)
      void runTerminalStartupSteps(sessionKey, pty, commandName, sessionId, startupSteps, traceId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          appendTerminalAutomationNote(sessionKey, commandName, sessionId, `启动步骤失败：${message}`, pty)
          console.warn('[terminal][startup-step] failed', {
            traceId,
            sessionKey,
            commandName,
            sessionId,
            error: message,
            at: Date.now()
          })
        })
        .finally(() => {
          if (terminalAutomationBusyMap.get(sessionKey) === pty) terminalAutomationBusyMap.delete(sessionKey)
        })
    }
    if (postCommands.length > 0 && startupSteps.length === 0) {
      terminalAutomationBusyMap.set(sessionKey, pty)
      void runPostCommands(sessionKey, pty, commandName, sessionId, postCommands, traceId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          appendTerminalAutomationNote(sessionKey, commandName, sessionId, `后续命令注入失败：${message}`, pty)
        })
        .finally(() => {
          if (terminalAutomationBusyMap.get(sessionKey) === pty) terminalAutomationBusyMap.delete(sessionKey)
        })
    }
    return {
      ok: true,
      state: 'running' as const,
      buffer: '',
      instanceId,
      autoExecutionSupported,
      autoExecutionPrepared: Boolean(managedAutoExecutionShell),
      autoExecutionCapable: false
    }
  }

  ipcMain.handle('terminal:start', async (_e, commandName: string, options?: { source?: string; traceId?: string; sessionId?: string; autoExecutionEnabled?: boolean }) => {
    const result = startTerminalSession(commandName, options)
    if (!options?.autoExecutionEnabled) return result
    const sessionId = options.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const terminal = terminalMap.get(sessionKey)
    if (!terminal?.autoExecutionPromptMarker) {
      return { ...result, autoExecutionCapable: false }
    }
    if (terminal.autoExecutionMode === 'ssh') {
      return {
        ...result,
        autoExecutionCapable: isTerminalAutoExecutionReady(sessionKey, terminal)
      }
    }
    await waitForAutoExecutionPrompt(sessionKey, terminal.pty)
    return {
      ...result,
      autoExecutionCapable: isTerminalAutoExecutionReady(sessionKey, terminalMap.get(sessionKey))
    }
  })
  ipcMain.handle(
    'terminal:input',
    async (
      _e,
      commandName: string,
      data: string,
      options?: {
        source?: string
        traceId?: string
        sessionId?: string
        expectedInstanceId?: string
        autoExecutionToken?: string
      }
    ) => {
      const source = options?.source || 'unknown'
      const traceId = options?.traceId || 'trace-missing'
      const sessionId = options?.sessionId?.trim() || undefined
      const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
      const terminal = terminalMap.get(sessionKey)
      if (!terminal) return { ok: false, message: '终端会话已结束，命令未执行。' }
      if (source === 'query-auto') {
        if (!options?.expectedInstanceId || options.expectedInstanceId !== terminal.instanceId) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: 'AI 生成期间终端会话已重建，已跳过自动执行。'
          }
        }
        const grant = readQueryAutoExecutionGrant(options?.autoExecutionToken, data, true)
        if (
          !grant ||
          terminal.commandName !== commandName ||
          terminal.sessionId !== sessionId ||
          grant.commandName !== commandName ||
          grant.sessionId !== sessionId ||
          grant.instanceId !== terminal.instanceId
        ) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: 'Agent 的低风险判定缺失、已失效或与当前会话不匹配，已保留并等待手动执行。'
          }
        }
        if (terminalRuntimeMap.get(sessionKey)?.manualStop) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: '终端会话正在停止，已跳过自动执行。'
          }
        }
        if (terminalAutomationBusyMap.get(sessionKey) === terminal.pty) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: '终端仍在执行连接或启动步骤，已跳过自动执行。'
          }
        }
        if (terminalManuallyControlledSet.has(sessionKey)) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: '当前会话已进行过手动交互，无法确认 Shell 状态，已跳过自动执行。'
          }
        }
        if (terminalPendingInputMap.get(sessionKey)) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: '终端存在未提交的手动输入，已跳过自动执行。'
          }
        }
        const assessment = assessCommandForAutoExecution(data, grant.riskLevel)
        if (!assessment.canAutoExecute) return { ok: false, ...assessment }
        const hardenedCommand = hardenCommandForAutoExecution(data)
        if (!hardenedCommand) return { ok: false, ...assessment, canAutoExecute: false }
        if (
          !terminal.autoExecutionPromptMarker ||
          !terminal.autoExecutionPromptReady ||
          !terminalOutputSinceInputMap.get(sessionKey)
        ) {
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: '仅支持应用已验证且未被手动接管的交互 Shell，已跳过自动执行。'
          }
        }
        const lineEnding = data.endsWith('\r') ? '\r' : '\n'
        const completionId = randomBytes(16).toString('hex')
        const completionMarker = `\x1b]777;shell-manage-complete=${completionId}\x07`
        const completionCommand = `if ${hardenedCommand}; then :; else :; fi; command printf '\\033]777;shell-manage-complete=${completionId}\\007'`
        terminal.autoExecutionCompletionMarker = completionMarker
        terminal.autoExecutionCompletionSeen = false
        terminalAutomationBusyMap.set(sessionKey, terminal.pty)
        try {
          if (!writeTerminalInput(sessionKey, `${completionCommand}${lineEnding}`, terminal.pty)) {
            return { ok: false, message: '终端会话已结束，命令未执行。' }
          }
          await waitForAutoExecutionCompletion(sessionKey, terminal.pty, completionMarker)
          return { ok: true, completed: true }
        } catch (error) {
          const activeTerminal = terminalMap.get(sessionKey)
          if (
            activeTerminal?.pty === terminal.pty &&
            !terminalRuntimeMap.get(sessionKey)?.manualStop &&
            !terminalManuallyControlledSet.has(sessionKey)
          ) {
            activeTerminal.autoExecutionPromptReady = false
            if (writeTerminalInput(sessionKey, '\x03', terminal.pty)) {
              try {
                await waitForAutoExecutionCompletion(sessionKey, terminal.pty, completionMarker, 3_000)
              } catch {
                terminalManuallyControlledSet.add(sessionKey)
              }
            }
          }
          return {
            ok: false,
            canAutoExecute: false,
            riskLevel: 'review' as const,
            message: error instanceof Error ? error.message : String(error)
          }
        } finally {
          const activeTerminal = terminalMap.get(sessionKey)
          if (activeTerminal?.pty === terminal.pty) {
            activeTerminal.autoExecutionCompletionMarker = undefined
            activeTerminal.autoExecutionCompletionSeen = false
          }
          if (terminalAutomationBusyMap.get(sessionKey) === terminal.pty) {
            terminalAutomationBusyMap.delete(sessionKey)
          }
        }
      }
      if (
        terminal.autoExecutionCompletionMarker &&
        terminalAutomationBusyMap.get(sessionKey) === terminal.pty
      ) {
        if (data !== '\x03') {
          return { ok: false, message: '自动命令仍在执行，仅可使用 Ctrl-C 中断。' }
        }
        terminalManuallyControlledSet.add(sessionKey)
        if (!writeTerminalInput(sessionKey, data, terminal.pty)) {
          return { ok: false, message: '终端会话已结束，命令未执行。' }
        }
        return { ok: true }
      }
      if (source === 'monitoring') {
        const compact = data.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 240)
        console.info('[monitoring][ssh] execute_command', {
          traceId,
          commandName,
          sessionId,
          inputPreview: compact,
          at: Date.now()
        })
      }
      terminalManuallyControlledSet.add(sessionKey)
      if (!writeTerminalInput(sessionKey, data, terminal.pty)) {
        return { ok: false, message: '终端会话已结束，命令未执行。' }
      }
      return { ok: true }
    }
  )
  ipcMain.handle('terminal:resize', (_e, commandName: string, cols: number, rows: number, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const session = terminalMap.get(sessionKey)
    if (!session) return { ok: true }
    session.pty.resize(Math.max(20, Math.floor(cols)), Math.max(8, Math.floor(rows)))
    return { ok: true }
  })
  ipcMain.handle('terminal:get-buffer', (_e, commandName: string, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const terminal = terminalMap.get(sessionKey)
    return {
      text: terminalBufferMap.get(sessionKey) || '',
      instanceId: terminal?.instanceId,
      autoExecutionSupported: terminal?.autoExecutionSupported || false,
      autoExecutionPrepared: Boolean(terminal?.autoExecutionPromptMarker),
      autoExecutionCapable: isTerminalAutoExecutionReady(sessionKey, terminal)
    }
  })
  ipcMain.handle('terminal:get-instance-count', () => {
    return { count: terminalMap.size }
  })
  ipcMain.handle('terminal:list-instances', () => {
    const instances = [...terminalMap.values()].map((s) => ({
      commandName: s.commandName,
      command: s.commandLine,
      sessionId: s.sessionId,
      pid: typeof s.pty.pid === 'number' ? s.pty.pid : undefined,
      sessionKind:
        s.sessionKind ??
        (s.sessionId && s.sessionId.trim().length > 0 ? 'terminal-pane' : 'default')
    }))
    return { instances }
  })

  const killTerminalSessionBySessionKey = (sessionKey: string): void => {
    markTerminalManualStop(sessionKey)
    const session = terminalMap.get(sessionKey)
    if (!session) return
    const pty = session.pty
    const pid = pty.pid
    let exited = false
    const disposable = pty.onExit(() => {
      exited = true
    })
    try {
      pty.kill('SIGTERM')
    } catch {
      // handled by tree termination fallback
    }
    void terminateProcessTreeWithEscalation(pid, () => exited || terminalMap.get(sessionKey)?.pty !== pty, 900).finally(() =>
      disposable.dispose()
    )
  }

  ipcMain.handle('terminal:stop', (_e, commandName: string, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    killTerminalSessionBySessionKey(sessionKey)
    return { ok: true }
  })

  /** 停止该配置命令名下所有 PTY（默认槽 + 各 Pane session），供首页「停止运行」等使用 */
  ipcMain.handle('terminal:stop-all-for-command', (_e, commandName: string) => {
    const target = commandName.trim()
    if (!target) return { ok: true, stopped: 0 }
    const keys = [...terminalMap.entries()].filter(([, s]) => s.commandName === target).map(([k]) => k)
    for (const sessionKey of keys) {
      killTerminalSessionBySessionKey(sessionKey)
    }
    return { ok: true, stopped: keys.length }
  })

  ipcMain.handle('system:open-external', async (_e, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })
  ipcMain.handle('system:kill-port-process', async (_e, port: number) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`端口号不合法: ${String(port)}`)
    }
    const listenerPids = await findListeningPidsByPort(port)
    const pids = await normalizeTerminationRoots(listenerPids)
    for (const pid of pids) {
      await terminateProcessTreeWithEscalation(pid, () => !isPidAlive(pid), 900)
    }
    return { ok: true, port, pids, listenerPids }
  })
  ipcMain.handle('system:kill-port-process-by-keyword', async (_e, keyword: string) => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) throw new Error('关键字不能为空')
    const processPids = await findProcessPidsByKeyword(normalizedKeyword)
    if (processPids.length === 0) {
      throw new Error(`未通过关键字 "${normalizedKeyword}" 识别到进程`)
    }
    const candidateRoots = await normalizeTerminationRoots(processPids)
    const rootSet = new Set<number>(candidateRoots)
    const allListeningPids = await findAllListeningPids()
    const listenerPidSet = new Set<number>()
    for (const pid of allListeningPids) {
      const rootPid = await resolveTerminationRootPid(pid)
      if (rootSet.has(rootPid)) listenerPidSet.add(pid)
    }
    if (listenerPidSet.size === 0) {
      throw new Error(`关键字 "${normalizedKeyword}" 命中的进程未发现 LISTEN 端口，已阻止清理以避免误杀`)
    }
    const ports = await findListeningPortsByPids([...listenerPidSet])
    const targetPids = await normalizeTerminationRoots([...listenerPidSet])
    for (const pid of targetPids) {
      await terminateProcessTreeWithEscalation(pid, () => !isPidAlive(pid), 900)
    }
    return { ok: true, keyword: normalizedKeyword, processPids, ports, killedPids: targetPids, listenerPids: [...listenerPidSet] }
  })
  ipcMain.handle('system:kill-process-by-pid', async (_e, pid: number) => {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`PID 不合法: ${String(pid)}`)
    }
    const rootPid = await resolveTerminationRootPid(pid)
    await terminateProcessTreeWithEscalation(rootPid, () => !isPidAlive(rootPid), 900)
    return {
      ok: true,
      requestedPid: pid,
      rootPid,
      killedPids: [rootPid]
    }
  })
  ipcMain.handle('system:inspect-port-process', async (_e, port: number) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`端口号不合法: ${String(port)}`)
    }
    const pids = await findListeningPidsByPort(port)
    const processes = await loadProcessInspectorItems(pids)
    return {
      port,
      processCount: processes.length,
      processes
    }
  })
  ipcMain.handle('system:inspect-process-by-keyword', async (_e, keyword: string) => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) throw new Error('关键字不能为空')
    const pids = await findProcessPidsByKeyword(normalizedKeyword)
    const processes = await loadProcessInspectorItems(pids)
    return {
      keyword: normalizedKeyword,
      processCount: processes.length,
      processes
    }
  })

  ipcMain.handle('dashboard:intent', async (_e, request: DashboardIntentRequest) => {
    return buildDashboardIntent(request, getConfig(), (payload) => {
      broadcast('dashboard:intent-progress', payload)
    })
  })

  ipcMain.handle('dashboard:approve-review', (_e, payload: DashboardApproveReviewRequest) => {
    const issued = reviewTokenStore.issue(payload.widgetId, payload.stepId, payload.command)
    return {
      ok: true,
      tokenAuth: issued.tokenAuth,
      expiresAt: issued.expiresAt
    }
  })

  ipcMain.handle('dashboard:execute-probe', async (_e, request: DashboardExecuteProbeRequest) => {
    const riskLevel = combineRiskLevels(inferRiskLevel(request.command), request.riskLevel)
    if (riskLevel === 'blocked' || isCommandBlocked(request.command)) {
      return {
        success: false,
        isBlockedBySecurity: true,
        riskLevel,
        message: '命中高危策略，命令已被拦截。'
      }
    }
    if (riskLevel === 'review') {
      const token = request.tokenAuth || ''
      const approved = reviewTokenStore.validate(token, request.widgetId, request.stepId, request.command)
      if (!approved) {
        return {
          success: false,
          isBlockedBySecurity: false,
          riskLevel,
          message: '该命令需要先授权后执行。'
        }
      }
    }
    const executeTask = () =>
      runProbeCommand(request.command, request.timeoutMs ?? 5000, {
        sessionGroupKey: request.datasourceId || request.widgetId
      })
    const isSshCommand = /^\s*ssh(\s|$)/i.test(request.command)
    const result = isSshCommand ? await enqueueProbeByGroup(request.datasourceId || request.widgetId, executeTask) : await executeTask()
    if (result.exitCode !== 0) {
      console.warn('[dashboard][probe] non-zero exit', {
        widgetId: request.widgetId,
        datasourceId: request.datasourceId,
        stepId: request.stepId,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stderrPreview: result.stderr.slice(0, 240)
      })
    }
    return {
      success: true,
      isBlockedBySecurity: false,
      riskLevel,
      execResult: result,
      parsedData: parseProbeOutput(request.parserRule, result.stdout)
    }
  })

  let runningQuery: ReturnType<typeof cpSpawn> | undefined
  ipcMain.handle('query:execute', (_e, command: string) => {
    runningQuery?.kill('SIGTERM')
    const shellExec = resolveShellExecutable()
    const shellArgs = resolveServiceArgs(shellExec, command)
    const child = cpSpawn(shellExec, shellArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    runningQuery = child
    child.stdout?.on('data', (buf) => {
      const text = String(buf)
      broadcast('query:output', asQueryOutput(text, 'stdout'))
    })
    child.stderr?.on('data', (buf) => {
      const text = String(buf)
      broadcast('query:output', asQueryOutput(text, 'stderr'))
    })
    child.on('exit', (code) => {
      const tail = `命令结束，退出码 ${code ?? -1}`
      broadcast('query:output', asQueryOutput(tail, 'stdout'))
      runningQuery = undefined
    })
    return { ok: true }
  })
  ipcMain.handle('query:cancel', () => {
    runningQuery?.kill('SIGTERM')
    runningQuery = undefined
    return { ok: true }
  })
  ipcMain.handle('query:assess-auto-execution', (_e, command: unknown, autoExecutionToken?: unknown) => {
    const normalizedCommand = typeof command === 'string' ? command : ''
    const grant = readQueryAutoExecutionGrant(autoExecutionToken, normalizedCommand)
    return assessCommandForAutoExecution(normalizedCommand, grant?.riskLevel)
  })
  ipcMain.handle('query:ai-chat', async (_e, request: QueryAiRequest) => {
    broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'start'))
    try {
      const result = await llmService.chatToShell(request, getConfig(), async (token) => {
        broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'chunk', token))
      })
      broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'end', result.answer, undefined, result.stats))
      const autoExecutionToken = issueQueryAutoExecutionGrant(request, result.action)
      return autoExecutionToken ? { ...result, autoExecutionToken } : result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'error', undefined, message))
      throw error
    }
  })

  ipcMain.handle('browser:list-tabs', () => ({ tabs: browserManager.listTabs() }))
  ipcMain.handle('browser:get-state', () => browserManager.getState())
  ipcMain.handle('browser:list-profiles', () => browserManager.listImportableProfiles())
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object')
  const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  const validBounds = (value: unknown): value is BrowserContentBounds => {
    if (!isRecord(value)) return false
    return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))
  }

  ipcMain.handle('browser:import-profile', (_e, payload: { profileId: string }) => {
    const profileId = isRecord(payload) ? asString(payload.profileId)?.trim() : null
    if (!profileId || profileId.length > 128) {
      return { ok: false, profileId: profileId || '', imported: 0, skipped: 0, failed: 0, error: 'Profile ID 无效。' }
    }
    return browserManager.importProfile(profileId)
  })

  ipcMain.handle('browser:create-tab', async (_e, request?: BrowserCreateTabRequest) => {
    const tabId = await browserManager.createTab(isRecord(request) ? request : {})
    return { tabId }
  })
  ipcMain.handle('browser:close-tab', (_e, payload: { tabId: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    if (!tabId) return { ok: false, error: '缺少标签页 ID', activeTabId: browserManager.getActiveTabId() }
    return browserManager.closeTab(tabId)
  })
  ipcMain.handle('browser:set-active-tab', (_e, payload: { tabId: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    if (!tabId) return { ok: false, error: '缺少标签页 ID' }
    browserManager.setActiveTab(tabId)
    return { ok: true }
  })
  ipcMain.handle('browser:navigate', (_e, payload: { tabId: string; url: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    const url = isRecord(payload) ? asString(payload.url) : null
    if (!tabId || url === null) return { ok: false, error: '导航参数不完整', activeTabId: browserManager.getActiveTabId() }
    return browserManager.navigate(tabId, url)
  })
  ipcMain.handle('browser:go-back', (_e, payload: { tabId: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    if (!tabId) return { ok: false, error: '缺少标签页 ID' }
    browserManager.goBack(tabId)
    return { ok: true }
  })
  ipcMain.handle('browser:go-forward', (_e, payload: { tabId: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    if (!tabId) return { ok: false, error: '缺少标签页 ID' }
    browserManager.goForward(tabId)
    return { ok: true }
  })
  ipcMain.handle('browser:reload', (_e, payload: { tabId: string }) => {
    const tabId = isRecord(payload) ? asString(payload.tabId) : null
    if (!tabId) return { ok: false, error: '缺少标签页 ID' }
    browserManager.reload(tabId)
    return { ok: true }
  })
  ipcMain.handle('browser:set-content-bounds', (_e, bounds: BrowserContentBounds) => {
    if (!validBounds(bounds)) return { ok: false, error: '浏览器内容区尺寸无效' }
    browserManager.setContentBounds(bounds)
    return { ok: true }
  })
  ipcMain.handle('browser:set-module-active', (_e, payload: { active: boolean }) => {
    const active = isRecord(payload) && typeof payload.active === 'boolean' ? payload.active : false
    browserManager.setModuleActive(active)
    return { ok: true }
  })
  ipcMain.handle('browser:set-privacy-blur', async (_e, payload: { blurred: boolean }) => {
    const blurred = isRecord(payload) && payload.blurred === true
    await browserManager.setPrivacyBlur(blurred)
    return { ok: true }
  })
  ipcMain.handle('browser:set-theme', (_e, payload: { theme: BrowserTheme }) => {
    const theme: BrowserTheme = isRecord(payload) && payload.theme === 'light' ? 'light' : 'dark'
    browserManager.setTheme(theme)
    return { ok: true }
  })
  ipcMain.handle('browser:boss-hide', (_e, payload: { mode: 'switch-page' | 'tray' }) => {
    const mode = isRecord(payload) && payload.mode === 'tray' ? 'tray' : 'switch-page'
    browserManager.bossHide(mode)
    return { ok: true }
  })
  ipcMain.handle('window:hide-to-background', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win || win.isDestroyed()) return { ok: false }
    browserManager.setModuleActive(false)
    win.hide()
    if (process.platform === 'darwin') app.dock.hide()
    return { ok: true }
  })
  ipcMain.handle('app:reload-main-window', (event, payload?: { force?: boolean }) => {
    browserManager.setModuleActive(false)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { ok: false as const }
    if (payload?.force) win.webContents.reloadIgnoringCache()
    else win.webContents.reload()
    return { ok: true as const }
  })

  const attachMainWindow = (window: BrowserWindow): void => {
    window.webContents.on('did-start-loading', () => {
      browserManager.setModuleActive(false)
    })

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const emitExpandedChanged = () => {
      if (window.isDestroyed()) return
      window.webContents.send('window:fullscreen-changed', { fullscreen: readWindowExpanded(window) })
    }
    const emitFocusChanged = (focused: boolean) => {
      if (!window.isDestroyed()) window.webContents.send('window:focus-changed', { focused })
    }

    window.on('focus', () => emitFocusChanged(true))
    window.on('blur', () => emitFocusChanged(false))
    window.on('enter-full-screen', emitExpandedChanged)
    window.on('leave-full-screen', emitExpandedChanged)
    window.on('maximize', emitExpandedChanged)
    window.on('unmaximize', emitExpandedChanged)
    window.on('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(emitExpandedChanged, 120)
    })
  }

  const shutdown = async () => {
    await browserManager.destroyAll()
    await analyticsStore.shutdown()
    runningQuery?.kill('SIGTERM')
    runningQuery = undefined
    const terminalEntries = [...terminalMap.entries()]
    if (terminalEntries.length === 0) return
    await Promise.allSettled(
      terminalEntries.map(async ([sessionKey, session]) => {
        markTerminalManualStop(sessionKey)
        cleanupManagedAutoExecutionShell(session)
        const pty = session.pty
        const pid = pty.pid
        try {
          pty.kill('SIGTERM')
        } catch {
          // fallback to tree termination below
        }
        await terminateProcessTreeWithEscalation(pid, () => terminalMap.get(sessionKey)?.pty !== pty, 900)
      })
    )
  }

  return { shutdown, attachMainWindow }
}

export function broadcast(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asQueryOutput(line: string, stream: 'stdout' | 'stderr'): QueryOutputPayload {
  return {
    line: line.replace(/\n$/, ''),
    stream,
    at: Date.now()
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function buildLocalMetricSnapshot(): LocalMetricSnapshot {
  const currentPlatform = platform()
  const unavailable: string[] = []
  const macMetrics = currentPlatform === 'darwin' ? readMacMetrics(unavailable) : {}
  const totalMemory = totalmem()
  const fallbackMemory = totalMemory > 0 ? clampPercent(((totalMemory - freemem()) / totalMemory) * 100) : undefined
  return {
    platform: currentPlatform,
    cpuUsage: macMetrics.cpuUsage ?? clampPercent((loadavg()[0] / Math.max(cpus().length, 1)) * 100),
    load1m: macMetrics.load1m ?? loadavg()[0],
    memoryUsage: macMetrics.memoryUsage ?? fallbackMemory,
    diskUsage: macMetrics.diskUsage,
    diskUsedBytes: macMetrics.diskUsedBytes,
    diskTotalBytes: macMetrics.diskTotalBytes,
    netRxKbps: macMetrics.netRxKbps,
    netTxKbps: macMetrics.netTxKbps,
    capturedAt: Date.now(),
    unavailable: unavailable.length > 0 ? unavailable : undefined
  }
}

function buildLocalTopSnapshot(mode: 'process' | 'threads'): LocalTopSnapshot {
  const currentPlatform = platform()
  const lines =
    currentPlatform === 'win32'
      ? readWindowsProcessLines()
      : readUnixProcessLines(mode)
  return {
    lines: lines.slice(0, 40),
    capturedAt: Date.now()
  }
}

function readMacMetrics(unavailable: string[]): Partial<LocalMetricSnapshot> {
  const topOutput = runLocalCommand('top', ['-l', '1', '-n', '0'])
  const netBytes = readMacNetworkBytes()
  const netRate = calculateNetworkRate(netBytes)
  const metrics: Partial<LocalMetricSnapshot> = {
    cpuUsage: parseMacTopCpu(topOutput),
    load1m: parseMacTopLoad(topOutput),
    memoryUsage: parseMacMemoryUsage(),
    ...parseMacDisk(),
    ...netRate
  }
  if (typeof metrics.cpuUsage !== 'number') unavailable.push('cpu')
  if (typeof metrics.memoryUsage !== 'number') unavailable.push('memory')
  if (typeof metrics.diskUsage !== 'number') unavailable.push('disk')
  if (typeof metrics.netRxKbps !== 'number' || typeof metrics.netTxKbps !== 'number') unavailable.push('network_rate')
  return metrics
}

function readUnixProcessLines(mode: 'process' | 'threads'): string[] {
  const isMac = platform() === 'darwin'
  const output = isMac
    ? runLocalShellCommand(`${mode === 'threads' ? 'ps -M' : 'ps'} -arcwwwxo pid,pcpu,pmem,comm | head -n 40`)
    : runLocalShellCommand(`${mode === 'threads' ? 'ps -eLo pid,tid,pcpu,pmem,comm' : 'ps -eo pid,pcpu,pmem,comm'} --sort=-pcpu | head -n 40`)
  return output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
}

function readWindowsProcessLines(): string[] {
  const script = 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Id,CPU,WorkingSet,ProcessName | Format-Table -AutoSize'
  const output = runLocalCommand('powershell.exe', ['-NoProfile', '-Command', script])
  return output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
}

function runLocalCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 })
  } catch {
    return ''
  }
}

function runLocalShellCommand(command: string): string {
  try {
    return execFileSync('sh', ['-lc', command], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 256 })
  } catch {
    return ''
  }
}

function parseMacTopCpu(output: string): number | undefined {
  const line = output.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/i)
  if (!line) return undefined
  return clampPercent(Number(line[1]) + Number(line[2]))
}

function parseMacTopLoad(output: string): number | undefined {
  const line = output.match(/Load Avg:\s*([\d.]+)/i)
  return line ? Number(line[1]) : undefined
}

function parseMacMemoryUsage(): number | undefined {
  const output = runLocalCommand('vm_stat', [])
  const pageSize = Number(output.match(/page size of (\d+) bytes/i)?.[1])
  if (!pageSize) return undefined
  const pages = (label: string) => Number(output.match(new RegExp(`${label}:\\s+(\\d+)\\.`, 'i'))?.[1] || 0)
  const usedPages =
    pages('Pages active') +
    pages('Pages wired down') +
    pages('Pages occupied by compressor') +
    pages('Pages speculative') +
    pages('Pages purgeable')
  return totalmem() > 0 ? clampPercent((usedPages * pageSize * 100) / totalmem()) : undefined
}

function parseMacDisk(): Pick<LocalMetricSnapshot, 'diskUsage' | 'diskUsedBytes' | 'diskTotalBytes'> {
  const output = runLocalCommand('df', ['-k', '/System/Volumes/Data']) || runLocalCommand('df', ['-k', '/'])
  const line = output.trim().split(/\r?\n/)[1]
  const parts = line?.trim().split(/\s+/)
  const totalKb = Number(parts?.[1])
  const usedKb = Number(parts?.[2])
  const value = parts?.[4]?.replace('%', '')
  return {
    diskUsage: value ? clampPercent(Number(value)) : undefined,
    diskUsedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : undefined,
    diskTotalBytes: Number.isFinite(totalKb) ? totalKb * 1024 : undefined
  }
}

function readMacNetworkBytes(): { rxBytes: number; txBytes: number; at: number } | null {
  const output = runLocalCommand('netstat', ['-ibn'])
  let rxBytes = 0
  let txBytes = 0
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 10 || parts[0] === 'Name' || parts[0].startsWith('lo')) continue
    if (!parts.includes('<Link#') && !/<Link#\d+>/.test(line)) continue
    const ibytes = Number(parts.at(-5))
    const obytes = Number(parts.at(-2))
    if (Number.isFinite(ibytes)) rxBytes += ibytes
    if (Number.isFinite(obytes)) txBytes += obytes
  }
  return rxBytes > 0 || txBytes > 0 ? { rxBytes, txBytes, at: Date.now() } : null
}

function calculateNetworkRate(current: { rxBytes: number; txBytes: number; at: number } | null): Pick<LocalMetricSnapshot, 'netRxKbps' | 'netTxKbps'> {
  if (!current) return {}
  const previous = localNetworkBytes
  localNetworkBytes = current
  if (!previous) return { netRxKbps: 0, netTxKbps: 0 }
  const elapsedSec = Math.max((current.at - previous.at) / 1000, 1)
  return {
    netRxKbps: Math.max(0, (current.rxBytes - previous.rxBytes) / 1024 / elapsedSec),
    netTxKbps: Math.max(0, (current.txBytes - previous.txBytes) / 1024 / elapsedSec)
  }
}

function asTerminalData(commandName: string, data: string, sessionId?: string): TerminalDataPayload {
  return { commandName, sessionId, data, at: Date.now() }
}

function asTerminalObserver(commandName: string, chunk: string, sessionId?: string): TerminalObserverPayload {
  return { commandName, sessionId, chunk, at: Date.now() }
}

function asTerminalStatus(
  commandName: string,
  state: 'running' | 'idle',
  exitCode?: number,
  sessionId?: string,
  message?: string,
  restarts?: number
): TerminalStatusPayload {
  return { commandName, sessionId, state, exitCode, message, restarts }
}

function resolveTerminalSessionKey(commandName: string, sessionId?: string): string {
  if (sessionId && sessionId.trim().length > 0) return `session:${sessionId.trim()}`
  return `command:${commandName}`
}

function updateTerminalPendingInput(pending: boolean, data: string): boolean {
  let next = pending
  for (const character of data) {
    if (character === '\r' || character === '\n' || character === '\u0003' || character === '\u0015') {
      next = false
      continue
    }
    if (character === '\b' || character === '\u007f') continue
    next = true
  }
  return next
}

function supportsManagedAutoExecutionShell(commandLine: string): boolean {
  if (process.platform === 'win32') return false
  return /^\s*(?:exec\s+)?(?:\/bin|\/usr\/bin)\/(?:bash|zsh|sh)\s+-i\s*$/iu.test(commandLine) ||
    Boolean(prepareManagedSshCommand(commandLine, 'shell-manage-capability-check'))
}

function prepareManagedAutoExecutionShell(
  commandLine: string
): {
  command: string
  promptMarker: string
  rcDirectory?: string
  rcFilePath?: string
  mode: 'local' | 'ssh'
} | undefined {
  if (!supportsManagedAutoExecutionShell(commandLine)) return undefined
  const promptMarker = `\x1b]777;shell-manage-prompt=${randomBytes(16).toString('hex')}\x07`
  const managedSshCommand = prepareManagedSshCommand(commandLine, promptMarker)
  if (managedSshCommand) {
    return {
      command: managedSshCommand,
      promptMarker,
      mode: 'ssh'
    }
  }
  const match = commandLine.match(/^\s*(?:exec\s+)?((?:\/bin|\/usr\/bin)\/(bash|zsh|sh))\s+-i\s*$/iu)
  if (!match) return undefined

  const shellPath = match[1]
  const shellName = match[2].toLowerCase()
  const prompt = `${promptMarker}${shellName === 'zsh' ? '%' : '$'} `
  let rcDirectory: string | undefined
  let rcFilePath: string | undefined
  try {
    rcDirectory = mkdtempSync(join(tmpdir(), 'shell-manage-auto-shell-'))
    rcFilePath = join(rcDirectory, shellName === 'zsh' ? '.zshrc' : `${shellName}rc`)
    writeFileSync(
      rcFilePath,
      [
        `PS1=${quotePosixShellArgument(prompt)}`,
        'unset PROMPT_COMMAND ENV BASH_ENV ZDOTDIR HISTFILE',
        shellName === 'bash' ? 'set +H' : ''
      ].filter(Boolean).join('\n') + '\n',
      { encoding: 'utf-8', mode: 0o600 }
    )
    const cleanEnvironment = '/usr/bin/env -u PS1 -u PROMPT_COMMAND -u ENV -u BASH_ENV -u ZDOTDIR -u HISTFILE'
    const shellCommand = shellName === 'bash'
      ? `${cleanEnvironment} ${shellPath} --noprofile --rcfile ${quotePosixShellArgument(rcFilePath)} -i`
      : shellName === 'zsh'
        ? `${cleanEnvironment} ZDOTDIR=${quotePosixShellArgument(rcDirectory)} ${shellPath} -i`
        : `${cleanEnvironment} ENV=${quotePosixShellArgument(rcFilePath)} ${shellPath} -i`
    return {
      command: `exec ${shellCommand}`,
      promptMarker,
      rcDirectory,
      rcFilePath,
      mode: 'local'
    }
  } catch {
    cleanupManagedAutoExecutionShell({ rcDirectory, rcFilePath })
    return undefined
  }
}

function cleanupManagedAutoExecutionShell(
  managed?: { autoExecutionRcDirectory?: string; autoExecutionRcFilePath?: string; rcDirectory?: string; rcFilePath?: string }
): void {
  const rcDirectory = managed?.autoExecutionRcDirectory || managed?.rcDirectory
  const rcFilePath = managed?.autoExecutionRcFilePath || managed?.rcFilePath
  const allowedPrefix = join(tmpdir(), 'shell-manage-auto-shell-')
  if (!rcDirectory?.startsWith(allowedPrefix)) return
  if (rcFilePath?.startsWith(`${rcDirectory}/`)) {
    try {
      unlinkSync(rcFilePath)
    } catch {
      // The managed shell may already have consumed and removed the file.
    }
  }
  try {
    rmdirSync(rcDirectory)
  } catch {
    // Leave an unexpected non-empty directory untouched.
  }
}

function quotePosixShellArgument(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`
}

/** 区分「终端页独立 PTY」与「每命令仅一条的默认 PTY 槽」（监控/AI 日志等共用） */
function resolveTerminalSessionKind(sessionId: string | undefined, optSource: string | undefined): string {
  if (sessionId && sessionId.trim().length > 0) return 'terminal-pane'
  const src = optSource?.trim()
  if (src === 'monitoring') return 'monitoring'
  if (src && src !== 'unknown') return src
  return 'default'
}

function asQueryAiStream(
  requestId: string,
  phase: QueryAiStreamPayload['phase'],
  text?: string,
  error?: string,
  stats?: QueryAiStreamPayload['stats']
): QueryAiStreamPayload {
  return { requestId, phase, text, error, stats }
}

function normalizeTerminalObserverChunk(text: string): string {
  const normalized = text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-120)
    .join('\n')
  return normalized.slice(-4_000)
}

function sanitizeTerminalLogPreview(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' | ')
    .slice(0, 260)
}

export function executeShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

export function pickCommand(config: AppConfig, name: string): CommandConfig | undefined {
  return config.commands.find((item) => item.name === name)
}

interface ProcessBasicInfo {
  pid: number
  ppid: number
  name: string
  command: string
}

async function findListeningPidsByPort(port: number): Promise<number[]> {
  const output = await executeShell(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`)
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const value = Number.parseInt(line.trim(), 10)
    if (Number.isFinite(value) && value > 0) pidSet.add(value)
  }
  return [...pidSet]
}

async function findAllListeningPids(): Promise<number[]> {
  const output = await executeShell('lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null || true')
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const value = Number.parseInt(line.trim(), 10)
    if (Number.isFinite(value) && value > 0) pidSet.add(value)
  }
  return [...pidSet]
}

async function findListeningPortsByPids(pids: number[]): Promise<number[]> {
  const portSet = new Set<number>()
  for (const pid of pids) {
    const ports = await findListeningPortsByPid(pid)
    for (const port of ports) portSet.add(port)
  }
  return [...portSet]
}

async function findProcessPidsByKeyword(keyword: string): Promise<number[]> {
  const escapedKeyword = shellSingleQuote(keyword)
  const output = await executeShell(`ps -aef | rg -i -F -- '${escapedKeyword}' | rg -v 'rg -i -F --' || true`)
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const columns = trimmed.split(/\s+/)
    if (columns.length < 2) continue
    const pid = Number.parseInt(columns[1], 10)
    if (Number.isFinite(pid) && pid > 0) pidSet.add(pid)
  }
  return [...pidSet]
}

async function findListeningPortsByPid(pid: number): Promise<number[]> {
  const output = await executeShell(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null || true`)
  const portSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const matched = line.match(/:(\d{1,5})\s+\(LISTEN\)\s*$/)
    if (!matched) continue
    const port = Number.parseInt(matched[1], 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) portSet.add(port)
  }
  return [...portSet]
}

async function loadProcessInspectorItems(pids: number[]): Promise<ProcessInspectorItem[]> {
  const items = await Promise.all(pids.map((pid) => loadProcessInspectorItem(pid)))
  return items.filter((item): item is ProcessInspectorItem => Boolean(item)).sort((a, b) => a.pid - b.pid)
}

async function loadProcessInspectorItem(pid: number): Promise<ProcessInspectorItem | undefined> {
  if (!Number.isFinite(pid) || pid <= 0) return undefined
  const infoCache = new Map<number, ProcessBasicInfo | undefined>()
  const [selfInfo, cwdOutput, ports] = await Promise.all([
    getProcessBasicInfo(pid, infoCache),
    executeShell(`lsof -a -d cwd -p ${pid} 2>/dev/null || true`),
    findListeningPortsByPid(pid)
  ])
  if (!selfInfo?.command) return undefined
  const [parentInfo, rootInfo] = await Promise.all([
    selfInfo.ppid > 0 ? getProcessBasicInfo(selfInfo.ppid, infoCache) : Promise.resolve(undefined),
    resolveTerminationRootInfo(pid, infoCache)
  ])
  const cwd = extractCwdFromLsof(cwdOutput)
  return {
    pid: selfInfo.pid,
    name: selfInfo.name,
    command: selfInfo.command,
    cwd,
    parentPid: parentInfo?.pid,
    parentName: parentInfo?.name,
    rootPid: rootInfo?.pid,
    rootName: rootInfo?.name,
    rootCommand: rootInfo?.command,
    listeningPorts: ports
  }
}

async function normalizeTerminationRoots(pids: number[]): Promise<number[]> {
  const infoCache = new Map<number, ProcessBasicInfo | undefined>()
  const rootSet = new Set<number>()
  for (const pid of pids) {
    const root = await resolveTerminationRootInfo(pid, infoCache)
    if (root?.pid) rootSet.add(root.pid)
  }
  return [...rootSet]
}

async function resolveTerminationRootPid(pid: number): Promise<number> {
  const root = await resolveTerminationRootInfo(pid)
  return root?.pid ?? pid
}

async function resolveTerminationRootInfo(
  pid: number,
  infoCache: Map<number, ProcessBasicInfo | undefined> = new Map()
): Promise<ProcessBasicInfo | undefined> {
  let current = await getProcessBasicInfo(pid, infoCache)
  if (!current) return undefined
  for (let hop = 0; hop < 24; hop += 1) {
    if (!current.ppid || current.ppid <= 1) break
    const parent = await getProcessBasicInfo(current.ppid, infoCache)
    if (!parent) break
    if (!isSameExecutableProcess(current, parent)) break
    current = parent
  }
  return current
}

async function getProcessBasicInfo(
  pid: number,
  infoCache: Map<number, ProcessBasicInfo | undefined> = new Map()
): Promise<ProcessBasicInfo | undefined> {
  if (!Number.isFinite(pid) || pid <= 0) return undefined
  if (infoCache.has(pid)) return infoCache.get(pid)
  const output = await executeShell(`ps -p ${pid} -o ppid=,comm=,command= 2>/dev/null || true`)
  const line = output.trim()
  if (!line) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const matched = line.match(/^\s*(\d+)\s+(\S+)\s+([\s\S]+)$/)
  if (!matched) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const ppid = Number.parseInt(matched[1], 10)
  const name = matched[2]?.trim() || 'unknown'
  const command = matched[3]?.trim() || ''
  if (!command) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const info: ProcessBasicInfo = {
    pid,
    ppid: Number.isFinite(ppid) && ppid > 0 ? ppid : 0,
    name,
    command
  }
  infoCache.set(pid, info)
  return info
}

function extractCwdFromLsof(output: string): string | undefined {
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('COMMAND')) continue
    const columns = trimmed.split(/\s+/)
    if (columns.length < 9) continue
    const path = columns.slice(8).join(' ')
    if (path) return path
  }
  return undefined
}

function isSameExecutableProcess(current: ProcessBasicInfo, parent: ProcessBasicInfo): boolean {
  const currentExecutable = extractExecutableName(current.command, current.name)
  const parentExecutable = extractExecutableName(parent.command, parent.name)
  return Boolean(currentExecutable && parentExecutable && currentExecutable === parentExecutable)
}

function extractExecutableName(command: string, fallbackName: string): string {
  const firstToken = command.trim().split(/\s+/)[0] || ''
  const byToken = firstToken.split('/').pop() || ''
  const normalized = (byToken || fallbackName || '').trim().toLowerCase()
  return normalized
}

function shellSingleQuote(input: string): string {
  return input.replace(/'/g, `'\"'\"'`)
}

function escapeDoubleQuoted(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function resolveMacosAppIconData(
  appPath: string,
  appName: string
): Promise<{ iconDataUrl?: string; iconFilePath?: string }> {
  try {
    const iconDir = join(homedir(), '.shell-manage', 'app-icons')
    await mkdir(iconDir, { recursive: true })
    const hash = createHash('sha1').update(appPath).digest('hex').slice(0, 12)
    const iconFileName = `${sanitizeFileName(appName) || 'app'}-${hash}.png`
    const iconFilePath = join(iconDir, iconFileName)
    const icnsPath = await resolveIcnsPathFromBundle(appPath, appName)
    if (icnsPath) {
      await executeShell(
        `sips -s format png "${escapeDoubleQuoted(icnsPath)}" --out "${escapeDoubleQuoted(iconFilePath)}" >/dev/null`
      )
      const pngBuffer = await readFile(iconFilePath)
      return {
        iconFilePath,
        iconDataUrl: toPngDataUrl(pngBuffer)
      }
    }

    const icon = await app.getFileIcon(appPath, { size: 'large' })
    if (icon.isEmpty()) return {}
    const pngBuffer = icon.toPNG()
    if (!pngBuffer || pngBuffer.length === 0) return {}
    await writeFile(iconFilePath, pngBuffer)
    return {
      iconFilePath,
      iconDataUrl: toPngDataUrl(pngBuffer)
    }
  } catch {
    return {}
  }
}

async function resolveIcnsPathFromBundle(appPath: string, appName: string): Promise<string | undefined> {
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  const infoPlist = join(appPath, 'Contents', 'Info.plist')
  const fromPlist = await readIconCandidatesFromPlist(infoPlist)
  for (const candidate of fromPlist) {
    const name = extname(candidate).toLowerCase() === '.icns' ? candidate : `${candidate}.icns`
    const fullPath = join(resourcesDir, name)
    try {
      await readFile(fullPath)
      return fullPath
    } catch {
    }
  }
  try {
    const files = await readdir(resourcesDir)
    const icnsFiles = files.filter((file) => file.toLowerCase().endsWith('.icns'))
    if (icnsFiles.length === 0) return undefined
    const byName = icnsFiles.find((file) => file.toLowerCase().includes(appName.toLowerCase()))
    return join(resourcesDir, byName || icnsFiles[0])
  } catch {
    return undefined
  }
}

async function readIconCandidatesFromPlist(infoPlistPath: string): Promise<string[]> {
  try {
    const jsonText = await executeShell(`plutil -convert json -o - "${escapeDoubleQuoted(infoPlistPath)}"`)
    const parsed = JSON.parse(jsonText) as {
      CFBundleIconFile?: unknown
      CFBundleIconFiles?: unknown
      CFBundleIcons?: { CFBundlePrimaryIcon?: { CFBundleIconFiles?: unknown } }
    }
    const candidates = new Set<string>()
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const normalized = value.trim()
      if (!normalized) return
      candidates.add(normalized)
    }
    push(parsed.CFBundleIconFile)
    if (Array.isArray(parsed.CFBundleIconFiles)) {
      parsed.CFBundleIconFiles.forEach((item) => push(item))
    }
    const primary = parsed.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles
    if (Array.isArray(primary)) {
      primary.forEach((item) => push(item))
    }
    return [...candidates]
  } catch {
    return []
  }
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
}

function toPngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function resolveWebsiteIconData(
  pageUrl: string
): Promise<{ iconDataUrl?: string; iconFilePath?: string; iconSourceUrl?: string }> {
  const iconDir = join(homedir(), '.shell-manage', 'app-icons')
  await mkdir(iconDir, { recursive: true })
  const candidates = await collectWebsiteIconCandidates(pageUrl)
  for (const iconUrl of candidates) {
    try {
      const response = await fetch(iconUrl, { headers: { 'user-agent': 'shell-manage/1.0' } })
      if (!response.ok) continue
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      if (!buffer || buffer.length === 0) continue
      const mime = normalizeImageMimeType(response.headers.get('content-type'), iconUrl, buffer)
      const ext = extensionByMimeType(mime)
      const hash = createHash('sha1').update(iconUrl).digest('hex').slice(0, 12)
      const iconFilePath = join(iconDir, `web-${hash}${ext}`)
      await writeFile(iconFilePath, buffer)
      return {
        iconSourceUrl: iconUrl,
        iconFilePath,
        iconDataUrl: `data:${mime};base64,${buffer.toString('base64')}`
      }
    } catch {
      // try next candidate
    }
  }
  return {}
}

async function collectWebsiteIconCandidates(pageUrl: string): Promise<string[]> {
  const set = new Set<string>()
  const baseUrl = new URL(pageUrl)
  try {
    const response = await fetch(pageUrl, { headers: { accept: 'text/html', 'user-agent': 'shell-manage/1.0' } })
    if (response.ok) {
      const html = await response.text()
      const fromHtml = extractIconUrlsFromHtml(html, pageUrl)
      for (const url of fromHtml) set.add(url)
    }
  } catch {
    // ignore and fallback below
  }
  set.add(new URL('/favicon.ico', baseUrl).toString())
  set.add(new URL('/apple-touch-icon.png', baseUrl).toString())
  return [...set]
}

function extractIconUrlsFromHtml(html: string, pageUrl: string): string[] {
  const results: string[] = []
  const linkRegex = /<link\b[^>]*>/gi
  const hrefRegex = /\bhref\s*=\s*["']([^"']+)["']/i
  const relRegex = /\brel\s*=\s*["']([^"']+)["']/i
  const typeRegex = /\btype\s*=\s*["']([^"']+)["']/i
  const matches = html.match(linkRegex) || []
  for (const linkTag of matches) {
    const href = hrefRegex.exec(linkTag)?.[1]?.trim()
    if (!href) continue
    const rel = relRegex.exec(linkTag)?.[1]?.toLowerCase() || ''
    const type = typeRegex.exec(linkTag)?.[1]?.toLowerCase() || ''
    const isIcon = rel.includes('icon') || type.startsWith('image/')
    if (!isIcon) continue
    try {
      results.push(new URL(href, pageUrl).toString())
    } catch {
      // ignore invalid href
    }
  }
  return results
}

function normalizeWebsiteUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error(`网站地址不合法：${input}`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('仅支持 http/https 网站地址')
  }
  return url.toString()
}

function normalizeImageMimeType(contentType: string | null, sourceUrl: string, buffer: Buffer): string {
  const cleanType = (contentType || '').split(';')[0].trim().toLowerCase()
  if (cleanType.startsWith('image/')) return cleanType
  const lowered = sourceUrl.toLowerCase()
  if (lowered.endsWith('.png')) return 'image/png'
  if (lowered.endsWith('.ico')) return 'image/x-icon'
  if (lowered.endsWith('.svg')) return 'image/svg+xml'
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg'
  if (lowered.endsWith('.webp')) return 'image/webp'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00)
    return 'image/x-icon'
  return 'image/png'
}

function extensionByMimeType(mime: string): string {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/svg+xml') return '.svg'
  if (mime === 'image/x-icon') return '.ico'
  return '.png'
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function runPresetSequence(
  action: PresetAction,
  presetName: string,
  getConfig: () => AppConfig,
  processManager: ProcessManager
): Promise<void> {
  const preset = getConfig().presets.find((item) => item.name === presetName)
  if (!preset) throw new Error(`预设不存在: ${presetName}`)
  const sequence = action === 'stop' ? [...preset.sequence].reverse() : preset.sequence
  const sequenceNames = sequence.map((item) => item.command)
  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index]
    if (action === 'start') {
      const command = getConfig().commands.find((item) => item.name === step.command)
      if (command) {
        if ((command.mode || 'service') === 'terminal') {
          broadcast('process:status', {
            commandName: command.name,
            state: 'idle',
            message: '该命令为交互终端模式，已跳过预设自动启动'
          })
        } else {
          processManager.start(command)
        }
      }
    } else {
      const command = getConfig().commands.find((item) => item.name === step.command)
      if (!command || (command.mode || 'service') === 'terminal') continue
      processManager.stop(step.command)
    }
    broadcast('preset:progress', {
      presetName,
      action,
      index,
      total: sequence.length,
      commandName: step.command,
      sequence: sequenceNames
    })
    if (step.delay) await sleep(step.delay * 1000)
  }
}
