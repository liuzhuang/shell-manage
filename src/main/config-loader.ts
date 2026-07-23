import { app } from 'electron'
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FSWatcher } from 'chokidar'
import yaml from 'js-yaml'
import type { AppConfig, CommandMode, DashboardConfig, DashboardRiskLevel, DashboardTab, DashboardWidgetKind, DeployScriptConfig, ProjectDirectory, SshKeyConfig, ThemePreset } from '../shared/types'

const HOME_DIR = process.env.SHELL_MANAGE_HOME || app.getPath('home')
const CONFIG_DIR = join(HOME_DIR, '.shell-manage')
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')
const DEFAULT_CONFIG_PATH = join(process.cwd(), 'default-config.yaml')

export class ConfigLoader {
  private watcher?: FSWatcher

  ensureConfigFile(): void {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
    if (!existsSync(CONFIG_PATH)) {
      if (existsSync(DEFAULT_CONFIG_PATH)) {
        writeFileSync(CONFIG_PATH, readFileSync(DEFAULT_CONFIG_PATH), { mode: 0o600 })
      }
      else
        writeFileSync(
          CONFIG_PATH,
          'commands: []\npresets: []\ndashboard:\n  version: 1\n  activeTabId: ops-main\n  tabs: []\nsettings:\n  llm:\n    provider: "openai"\n    endpoint: ""\n    apiKey: ""\n    model: ""\n  themePreset: coder\n  launchAtLogin: false\n  logBufferLines: 5000\n',
          { mode: 0o600 }
        )
    }
    chmodSync(CONFIG_PATH, 0o600)
  }

  readRaw(): string {
    this.ensureConfigFile()
    return readFileSync(CONFIG_PATH, 'utf-8')
  }

  validate(raw: string): { valid: boolean; error?: string } {
    try {
      const parsed = yaml.load(raw) as AppConfig
      if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
        return { valid: false, error: '配置结构不完整，缺少 commands/presets/settings' }
      }
      for (const command of parsed.commands) {
        if (command.mode && !isCommandMode(command.mode)) {
          return { valid: false, error: `命令 ${command.name} 的 mode 非法：${command.mode}` }
        }
        const startupStepsError = validateTerminalStartupSteps(command.name, command.terminalStartupSteps)
        if (startupStepsError) return { valid: false, error: startupStepsError }
        if (command.healthCheck) {
          const error = validateHealthCheck(command.name, command.healthCheck)
          if (error) return { valid: false, error }
        }
        if (command.sshKeyId !== undefined && typeof command.sshKeyId !== 'string') {
          return { valid: false, error: `命令 ${command.name} 的 sshKeyId 必须是字符串` }
        }
      }
      const sshKeysError = validateSshKeys(parsed.settings.sshKeys)
      if (sshKeysError) return { valid: false, error: sshKeysError }
      const sshKeyRefError = validateCommandSshKeyRefs(parsed.commands, parsed.settings.sshKeys)
      if (sshKeyRefError) return { valid: false, error: sshKeyRefError }
      const projectDirectoriesError = validateProjectDirectories(parsed.projectDirectories)
      if (projectDirectoriesError) return { valid: false, error: projectDirectoriesError }
      const deployScriptsError = validateDeployScripts(parsed.deployScripts, parsed.settings.sshKeys)
      if (deployScriptsError) return { valid: false, error: deployScriptsError }
      const activeDeployScriptError = validateActiveDeployScriptId(parsed.deployScripts, parsed.activeDeployScriptId)
      if (activeDeployScriptError) return { valid: false, error: activeDeployScriptError }
      const dashboardError = validateDashboardConfig(parsed.dashboard)
      if (dashboardError) return { valid: false, error: dashboardError }
      if (parsed.settings.themePreset && !isThemePreset(parsed.settings.themePreset)) {
        return { valid: false, error: `themePreset 非法：${String(parsed.settings.themePreset)}，仅支持 system/coder/girl` }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  readParsed(): AppConfig {
    const raw = this.readRaw()
    const result = this.validate(raw)
    if (!result.valid) throw new Error(result.error)
    const parsed = yaml.load(raw) as AppConfig
    parsed.commands = parsed.commands.map((command) => ({
      ...command,
      mode: command.mode && isCommandMode(command.mode) ? command.mode : 'service',
      terminalStartupSteps: Array.isArray(command.terminalStartupSteps)
        ? command.terminalStartupSteps
            .filter((step) => step && typeof step === 'object' && typeof step.send === 'string')
            .map((step) => ({
              ...step,
              delayMs: Number.isFinite(step.delayMs) ? Math.max(0, Math.floor(step.delayMs as number)) : undefined,
              timeoutMs: Number.isFinite(step.timeoutMs) ? Math.max(1, Math.floor(step.timeoutMs as number)) : undefined,
              sendNewline: step.sendNewline !== false,
              label: typeof step.label === 'string' ? step.label : undefined
            }))
        : undefined
    }))
    parsed.dashboard = normalizeDashboardConfig(parsed.dashboard)
    parsed.settings.llm.provider = parsed.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
    parsed.settings.langsmith = normalizeLangsmithConfig(parsed.settings.langsmith)
    parsed.settings.themePreset = normalizeThemePreset(parsed.settings.themePreset)
    parsed.settings.launchAtLogin = parsed.settings.launchAtLogin === true
    parsed.settings.sshKeys = normalizeSshKeys(parsed.settings.sshKeys)
    parsed.projectDirectories = normalizeProjectDirectories(parsed.projectDirectories)
    parsed.deployScripts = normalizeDeployScripts(parsed.deployScripts)
    parsed.activeDeployScriptId = normalizeActiveDeployScriptId(parsed.activeDeployScriptId, parsed.deployScripts)
    return parsed
  }

  save(raw: string): void {
    const result = this.validate(raw)
    if (!result.valid) throw new Error(result.error)
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, raw, { encoding: 'utf-8', mode: 0o600 })
    chmodSync(CONFIG_PATH, 0o600)
  }

  getConfigPath(): string {
    return CONFIG_PATH
  }

  watch(onChange: () => void): void {
    this.watcher?.close()
    void import('chokidar').then((mod) => {
      this.watcher = mod.default.watch(CONFIG_PATH, { ignoreInitial: true })
      this.watcher.on('change', () => onChange())
    })
  }
}

function isCommandMode(value: unknown): value is CommandMode {
  return value === 'service' || value === 'terminal'
}

function validateTerminalStartupSteps(commandName: string, steps: unknown): string | undefined {
  if (steps === undefined) return undefined
  if (!Array.isArray(steps)) return `命令 ${commandName} 的 terminalStartupSteps 必须是数组`
  for (let index = 0; index < steps.length; index += 1) {
    const item = steps[index] as Record<string, unknown>
    if (!item || typeof item !== 'object') {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}] 必须是对象`
    }
    if (typeof item.send !== 'string' || item.send.trim().length === 0) {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}].send 不能为空`
    }
    if (
      item.delayMs !== undefined &&
      (typeof item.delayMs !== 'number' || !Number.isFinite(item.delayMs) || item.delayMs < 0)
    ) {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}].delayMs 必须是 >= 0 的数字`
    }
    if (
      item.timeoutMs !== undefined &&
      (typeof item.timeoutMs !== 'number' || !Number.isFinite(item.timeoutMs) || item.timeoutMs <= 0)
    ) {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}].timeoutMs 必须是 > 0 的数字`
    }
    if (item.sendNewline !== undefined && typeof item.sendNewline !== 'boolean') {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}].sendNewline 必须是布尔值`
    }
    if (item.label !== undefined && typeof item.label !== 'string') {
      return `命令 ${commandName} 的 terminalStartupSteps[${index}].label 必须是字符串`
    }
    if (item.waitForOutputPattern !== undefined) {
      if (typeof item.waitForOutputPattern !== 'string' || item.waitForOutputPattern.trim().length === 0) {
        return `命令 ${commandName} 的 terminalStartupSteps[${index}].waitForOutputPattern 不能为空`
      }
      try {
        // 预编译，避免运行时因无效正则导致启动失败。
        void new RegExp(item.waitForOutputPattern)
      } catch {
        return `命令 ${commandName} 的 terminalStartupSteps[${index}].waitForOutputPattern 不是合法正则`
      }
    }
  }
  return undefined
}

function validateHealthCheck(commandName: string, healthCheck: unknown): string | undefined {
  if (!healthCheck || typeof healthCheck !== 'object') {
    return `命令 ${commandName} 的 healthCheck 必须是对象`
  }
  const config = healthCheck as Record<string, unknown>
  if (config.type !== 'port' && config.type !== 'log') {
    return `命令 ${commandName} 的 healthCheck.type 仅支持 "port" 或 "log"`
  }
  if (config.type === 'port') {
    if (typeof config.port !== 'number' || !Number.isFinite(config.port) || config.port <= 0 || config.port > 65535) {
      return `命令 ${commandName} 的 healthCheck.port 必须是 1-65535 的数字`
    }
  }
  if (config.type === 'log') {
    if (typeof config.pattern !== 'string' || config.pattern.trim().length === 0) {
      return `命令 ${commandName} 的 healthCheck.pattern 不能为空`
    }
  }
  return undefined
}

function normalizeDashboardConfig(config: AppConfig['dashboard']): DashboardConfig {
  if (!config || !Array.isArray(config.tabs)) {
    return {
      version: 1,
      activeTabId: 'ops-main',
      tabs: [createDefaultDashboardTab()]
    }
  }
  if (config.tabs.length === 0) {
    return {
      version: Number.isFinite(config.version) ? Math.max(1, Math.floor(config.version)) : 1,
      activeTabId: 'ops-main',
      tabs: [createDefaultDashboardTab()]
    }
  }
  const tabs = config.tabs.map((tab) => ({
    ...tab,
    contextLabel: tab.contextLabel || 'prod-master-01',
    createdAt: Number.isFinite(tab.createdAt) ? tab.createdAt : Date.now(),
    updatedAt: Number.isFinite(tab.updatedAt) ? tab.updatedAt : Date.now(),
    widgets: Array.isArray(tab.widgets) ? tab.widgets : [],
    gridLayout: Array.isArray(tab.gridLayout) ? tab.gridLayout : []
  }))
  return {
    version: Number.isFinite(config.version) ? Math.max(1, Math.floor(config.version)) : 1,
    activeTabId: config.activeTabId || tabs[0].id,
    tabs
  }
}

function validateDashboardConfig(config: AppConfig['dashboard']): string | undefined {
  if (!config) return undefined
  if (typeof config !== 'object') return 'dashboard 配置必须是对象'
  if (!Array.isArray(config.tabs)) return 'dashboard.tabs 必须是数组'
  for (const tab of config.tabs) {
    if (!tab || typeof tab !== 'object') return 'dashboard.tabs 存在非法项'
    if (!tab.id || typeof tab.id !== 'string') return 'dashboard.tabs[].id 必须是非空字符串'
    if (!tab.name || typeof tab.name !== 'string') return `dashboard tab ${tab.id} 缺少 name`
    if (!Array.isArray(tab.widgets)) return `dashboard tab ${tab.id} 的 widgets 必须是数组`
    if (!Array.isArray(tab.gridLayout)) return `dashboard tab ${tab.id} 的 gridLayout 必须是数组`
    const widgetIds = new Set<string>()
    for (const widget of tab.widgets) {
      if (!widget.id || typeof widget.id !== 'string') return `dashboard tab ${tab.id} 存在无效 widget.id`
      if (widgetIds.has(widget.id)) return `dashboard tab ${tab.id} 中 widget.id 重复：${widget.id}`
      widgetIds.add(widget.id)
      if (!isWidgetKind(widget.kind)) return `dashboard widget ${widget.id} 的 kind 非法：${String(widget.kind)}`
      if (!widget.datasourceId || typeof widget.datasourceId !== 'string') return `dashboard widget ${widget.id} 缺少 datasourceId`
      if (!widget.probe || !Array.isArray(widget.probe.steps)) return `dashboard widget ${widget.id} 缺少 probe.steps`
      for (const step of widget.probe.steps) {
        if (!step.stepId || !step.command) return `dashboard widget ${widget.id} 存在无效 probe step`
        if (!isRiskLevel(step.riskLevel)) return `dashboard widget ${widget.id} 的 riskLevel 非法：${String(step.riskLevel)}`
      }
    }
    for (const grid of tab.gridLayout) {
      if (!widgetIds.has(grid.i)) return `dashboard tab ${tab.id} 的 gridLayout.i 未对应 widget: ${grid.i}`
      if (![grid.x, grid.y, grid.w, grid.h].every((n) => Number.isFinite(n))) return `dashboard tab ${tab.id} 的 gridLayout 坐标非法`
      if (grid.w <= 0 || grid.h <= 0) return `dashboard tab ${tab.id} 的 gridLayout 宽高必须大于 0`
    }
  }
  return undefined
}

function createDefaultDashboardTab(): DashboardTab {
  const now = Date.now()
  return {
    id: 'ops-main',
    name: '可视化看板',
    contextLabel: 'prod-master-01',
    createdAt: now,
    updatedAt: now,
    widgets: [],
    gridLayout: []
  }
}

function isRiskLevel(value: unknown): value is DashboardRiskLevel {
  return value === 'safe' || value === 'review' || value === 'blocked'
}

function isWidgetKind(value: unknown): value is DashboardWidgetKind {
  return value === 'metric' || value === 'table' || value === 'timeseries' || value === 'event'
}

function isThemePreset(value: unknown): value is ThemePreset {
  return value === 'system' || value === 'coder' || value === 'girl'
}

function normalizeThemePreset(value: unknown): ThemePreset {
  return isThemePreset(value) ? value : 'coder'
}

function normalizeLangsmithConfig(config: AppConfig['settings']['langsmith']): AppConfig['settings']['langsmith'] {
  if (!config || typeof config !== 'object') {
    return {
      tracing: true,
      endpoint: '',
      apiKey: '',
      project: ''
    }
  }
  return {
    tracing: config.tracing !== false,
    endpoint: typeof config.endpoint === 'string' ? config.endpoint : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    project: typeof config.project === 'string' ? config.project : ''
  }
}

function normalizeSshKeys(keys: AppConfig['settings']['sshKeys']): SshKeyConfig[] {
  if (!Array.isArray(keys)) return []
  return keys
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.label === 'string')
    .map((item) => ({
      id: item.id.trim(),
      label: item.label.trim(),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined
    }))
    .filter((item) => item.id.length > 0 && item.label.length > 0)
}

function validateSshKeys(keys: unknown): string | undefined {
  if (keys === undefined) return undefined
  if (!Array.isArray(keys)) return 'settings.sshKeys 必须是数组'
  const ids = new Set<string>()
  for (const item of keys) {
    if (!item || typeof item !== 'object') return 'settings.sshKeys 存在非法项'
    const key = item as Record<string, unknown>
    if (typeof key.id !== 'string' || key.id.trim().length === 0) return 'settings.sshKeys[].id 必须是非空字符串'
    if (typeof key.label !== 'string' || key.label.trim().length === 0) return 'settings.sshKeys[].label 必须是非空字符串'
    if (ids.has(key.id.trim())) return `settings.sshKeys 中 id 重复：${key.id.trim()}`
    ids.add(key.id.trim())
    if (key.createdAt !== undefined && typeof key.createdAt !== 'string') {
      return `settings.sshKeys[].createdAt 必须是字符串：${key.id}`
    }
  }
  return undefined
}

function validateCommandSshKeyRefs(
  commands: AppConfig['commands'],
  sshKeys: AppConfig['settings']['sshKeys']
): string | undefined {
  const knownIds = new Set((sshKeys || []).map((item) => item.id))
  for (const command of commands) {
    const keyId = command.sshKeyId?.trim()
    if (!keyId) continue
    if (!knownIds.has(keyId)) {
      return `命令 ${command.name} 引用了不存在的 sshKeyId：${keyId}`
    }
  }
  return undefined
}

function validateProjectDirectories(directories: unknown): string | undefined {
  if (directories === undefined) return undefined
  if (!Array.isArray(directories)) return 'projectDirectories 必须是数组'
  const ids = new Set<string>()
  for (const item of directories) {
    if (!item || typeof item !== 'object') return 'projectDirectories 存在非法项'
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      return 'projectDirectories[].id 必须是非空字符串'
    }
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      return 'projectDirectories[].name 必须是非空字符串'
    }
    if (typeof entry.path !== 'string' || entry.path.trim().length === 0) {
      return 'projectDirectories[].path 必须是非空字符串'
    }
    if (entry.createdAt !== undefined && typeof entry.createdAt !== 'string') {
      return 'projectDirectories[].createdAt 必须是字符串'
    }
    const id = entry.id.trim()
    if (ids.has(id)) return `projectDirectories 中 id 重复：${id}`
    ids.add(id)
  }
  return undefined
}

function validateDeployScripts(scripts: unknown, sshKeys: AppConfig['settings']['sshKeys']): string | undefined {
  if (scripts === undefined) return undefined
  if (!Array.isArray(scripts)) return 'deployScripts 必须是数组'
  const ids = new Set<string>()
  const knownKeyIds = new Set((sshKeys || []).map((item) => item.id))
  for (const item of scripts) {
    if (!item || typeof item !== 'object') return 'deployScripts 存在非法项'
    const script = item as Record<string, unknown>
    if (typeof script.id !== 'string' || script.id.trim().length === 0) {
      return 'deployScripts[].id 必须是非空字符串'
    }
    if (typeof script.name !== 'string' || script.name.trim().length === 0) {
      return 'deployScripts[].name 必须是非空字符串'
    }
    if (typeof script.content !== 'string' && typeof (script as { template?: unknown }).template !== 'string') {
      return 'deployScripts[].content 必须是字符串'
    }
    if (script.createdAt !== undefined && typeof script.createdAt !== 'string') {
      return `deployScripts[${String(script.id)}].createdAt 必须是字符串`
    }
    const id = script.id.trim()
    if (ids.has(id)) return `deployScripts 中 id 重复：${id}`
    ids.add(id)
    if (script.sshKeyRef !== undefined) {
      if (typeof script.sshKeyRef !== 'string' || script.sshKeyRef.trim().length === 0) {
        return `deployScripts[${id}].sshKeyRef 必须是非空字符串`
      }
      if (!knownKeyIds.has(script.sshKeyRef.trim())) {
        return `deployScripts[${id}] 引用了不存在的 sshKeyRef：${script.sshKeyRef.trim()}`
      }
    }
    if (script.deployTarget !== undefined && typeof script.deployTarget !== 'string') {
      return `deployScripts[${id}].deployTarget 必须是字符串`
    }
    if (script.remoteDir !== undefined && typeof script.remoteDir !== 'string') {
      return `deployScripts[${id}].remoteDir 必须是字符串`
    }
  }
  return undefined
}

function validateActiveDeployScriptId(scripts: unknown, activeDeployScriptId: unknown): string | undefined {
  if (activeDeployScriptId === undefined || activeDeployScriptId === null || activeDeployScriptId === '') return undefined
  if (typeof activeDeployScriptId !== 'string') return 'activeDeployScriptId 必须是字符串'
  const list = Array.isArray(scripts) ? scripts : []
  if (!list.some((item) => item && typeof item === 'object' && (item as DeployScriptConfig).id === activeDeployScriptId.trim())) {
    return `activeDeployScriptId 不存在：${activeDeployScriptId.trim()}`
  }
  return undefined
}

function normalizeProjectDirectories(directories: AppConfig['projectDirectories']): ProjectDirectory[] {
  if (!Array.isArray(directories)) return []
  return directories
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.path === 'string'
    )
    .map((item) => ({
      id: item.id.trim(),
      name: item.name.trim(),
      path: item.path.trim(),
      createdAt: typeof item.createdAt === 'string' && item.createdAt.trim().length > 0 ? item.createdAt.trim() : undefined
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0 && item.path.length > 0)
}

function normalizeDeployScripts(scripts: AppConfig['deployScripts']): DeployScriptConfig[] {
  if (!Array.isArray(scripts)) return []
  return scripts
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (typeof item.content === 'string' || typeof (item as { template?: unknown }).template === 'string')
    )
    .map((item) => ({
      id: item.id.trim(),
      name: item.name.trim(),
      content:
        typeof item.content === 'string'
          ? item.content
          : typeof (item as { template?: unknown }).template === 'string'
            ? String((item as { template?: unknown }).template)
            : '',
      sshKeyRef: typeof item.sshKeyRef === 'string' && item.sshKeyRef.trim().length > 0 ? item.sshKeyRef.trim() : undefined,
      deployTarget:
        typeof item.deployTarget === 'string' && item.deployTarget.trim().length > 0 ? item.deployTarget.trim() : undefined,
      remoteDir: typeof item.remoteDir === 'string' && item.remoteDir.trim().length > 0 ? item.remoteDir.trim() : undefined,
      createdAt: typeof item.createdAt === 'string' && item.createdAt.trim().length > 0 ? item.createdAt.trim() : undefined
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0)
}

function normalizeActiveDeployScriptId(
  activeDeployScriptId: AppConfig['activeDeployScriptId'],
  scripts: DeployScriptConfig[]
): string | undefined {
  const normalized = typeof activeDeployScriptId === 'string' ? activeDeployScriptId.trim() : ''
  if (!normalized) return undefined
  return scripts.some((item) => item.id === normalized) ? normalized : undefined
}
