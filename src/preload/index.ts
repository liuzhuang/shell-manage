import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyticsEvent,
  AnalyticsSummary3d,
  AnalyticsViewerSnapshot,
  AppConfig,
  AppUpdateBroadcastPayload,
  AppUpdateDisabledReason,
  DashboardApproveReviewRequest,
  DashboardApproveReviewResponse,
  DashboardExecuteProbeRequest,
  DashboardExecuteProbeResponse,
  DashboardIntentRequest,
  DashboardIntentProgressPayload,
  DashboardIntentResponse,
  LocalMetricSnapshot,
  ListProjectSubdirectoriesResult,
  DetectProjectsResult,
  PresetProgressPayload,
  ProcessKeywordInspectionResult,
  ProjectDirectoryValidation,
  QueryAiRequest,
  QueryAiResponse,
  QueryAiProgressPayload,
  QueryAgentToolTraceRequest,
  QueryAgentTraceFinishRequest,
  QueryCommandRiskAssessment,
  LocalTopSnapshot,
  PortInspectionResult,
  ProcessOutputPayload,
  ProcessStatusPayload,
  QueryOutputPayload,
  SshKeyConfig,
  SshKeyImportRequest,
  SshKeyImportResponse,
  TerminalDataPayload,
  TerminalInstanceSummary,
  TerminalObserverPayload,
  TerminalStatusPayload,
  TemplatePreviewRequest,
  TemplatePreviewResult,
  ScriptToTemplateRequest,
  ScriptToTemplateResult,
  DeployScriptExecuteRequest,
  DeployScriptExecuteResult,
  DeployScriptValidateRequest,
  DeployScriptValidateResult,
} from '../shared/types'
import type {
  BrowserActionResult,
  BrowserContentBounds,
  BrowserCreateTabRequest,
  BrowserPageInfoPayload,
  BrowserProfileImportResult,
  BrowserProfileListResult,
  BrowserTabMeta,
  BrowserTabUpdatedPayload,
  BrowserTheme
} from '../shared/browser-types'
import type { RunQueryAgentOptions } from '../shared/query-agent'
import { runQueryAgent } from './query-agent-runner'

const api = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  getWindowFullscreen: () => ipcRenderer.invoke('window:get-fullscreen') as Promise<{ fullscreen: boolean }>,
  toggleWindowMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<{ maximized: boolean }>,
  onWindowFullscreenChanged: (handler: (payload: { fullscreen: boolean }) => void) => {
    const wrapped = (_e: unknown, payload: { fullscreen: boolean }) => handler(payload)
    ipcRenderer.on('window:fullscreen-changed', wrapped)
    return () => ipcRenderer.removeListener('window:fullscreen-changed', wrapped)
  },
  getWindowFocused: () => ipcRenderer.invoke('window:get-focused') as Promise<{ focused: boolean }>,
  onWindowFocusChanged: (handler: (payload: { focused: boolean }) => void) => {
    const wrapped = (_e: unknown, payload: { focused: boolean }) => handler(payload)
    ipcRenderer.on('window:focus-changed', wrapped)
    return () => ipcRenderer.removeListener('window:focus-changed', wrapped)
  },
  getPlatform: () => process.platform,
  showCommandContextMenu: (items: Array<{ key: string; label: string; enabled?: boolean; group?: string }>) =>
    ipcRenderer.invoke('menu:show-command-context', items) as Promise<{ key: string | null }>,

  configRead: () => ipcRenderer.invoke('config:read') as Promise<string>,
  analyticsTrack: (payload: Omit<AnalyticsEvent, 'schemaVersion' | 'eventId' | 'timestamp'> & { timestamp?: number }) =>
    ipcRenderer.invoke('analytics:track', payload) as Promise<{ ok: boolean }>,
  analyticsFlush: () => ipcRenderer.invoke('analytics:flush') as Promise<{ ok: boolean }>,
  analyticsAggregate3d: () =>
    ipcRenderer.invoke('analytics:aggregate-3d') as Promise<{ ok: boolean; summary: AnalyticsSummary3d; outputPath: string }>,
  analyticsGetViewerSnapshot: (limit?: number) =>
    ipcRenderer.invoke('analytics:get-viewer-snapshot', limit) as Promise<{ ok: boolean; snapshot: AnalyticsViewerSnapshot }>,
  configGetPath: () => ipcRenderer.invoke('config:getPath') as Promise<string>,
  configValidate: (raw: string) => ipcRenderer.invoke('config:validate', raw) as Promise<{ valid: boolean; error?: string }>,
  configSave: (raw: string) => ipcRenderer.invoke('config:save', raw) as Promise<{ ok: boolean }>,
  sshKeyImport: (request: SshKeyImportRequest) =>
    ipcRenderer.invoke('ssh-key:import', request) as Promise<SshKeyImportResponse>,
  sshKeyDelete: (id: string) => ipcRenderer.invoke('ssh-key:delete', id) as Promise<{ ok: boolean }>,
  sshKeyList: () => ipcRenderer.invoke('ssh-key:list') as Promise<SshKeyConfig[]>,
  onConfigLoaded: (handler: (cfg: AppConfig) => void) => {
    const wrapped = (_e: unknown, payload: AppConfig) => handler(payload)
    ipcRenderer.on('config:loaded', wrapped)
    return () => ipcRenderer.removeListener('config:loaded', wrapped)
  },
  onConfigError: (handler: (payload: { error: string }) => void) => {
    const wrapped = (_e: unknown, payload: { error: string }) => handler(payload)
    ipcRenderer.on('config:error', wrapped)
    return () => ipcRenderer.removeListener('config:error', wrapped)
  },

  processStart: (name: string) => ipcRenderer.invoke('process:start', name),
  processStop: (name: string) => ipcRenderer.invoke('process:stop', name),
  processRestart: (name: string) => ipcRenderer.invoke('process:restart', name),
  onProcessStatus: (handler: (payload: ProcessStatusPayload) => void) => {
    const wrapped = (_e: unknown, payload: ProcessStatusPayload) => handler(payload)
    ipcRenderer.on('process:status', wrapped)
    return () => ipcRenderer.removeListener('process:status', wrapped)
  },
  onProcessOutput: (handler: (payload: ProcessOutputPayload) => void) => {
    const wrapped = (_e: unknown, payload: ProcessOutputPayload) => handler(payload)
    ipcRenderer.on('process:output', wrapped)
    return () => ipcRenderer.removeListener('process:output', wrapped)
  },

  queryExecute: (command: string) => ipcRenderer.invoke('query:execute', command),
  queryCancel: (requestId?: string) =>
    ipcRenderer.invoke('query:cancel', requestId) as Promise<{ ok: boolean; cancelledAiRequest: boolean }>,
  queryAiChat: (payload: QueryAiRequest) => ipcRenderer.invoke('query:ai-chat', payload) as Promise<QueryAiResponse>,
  queryAgentRun: (options: RunQueryAgentOptions) => runQueryAgent(options),
  queryAgentTraceTool: (payload: QueryAgentToolTraceRequest) =>
    ipcRenderer.invoke('query:agent-trace-tool', payload) as Promise<{ ok: boolean; recorded: boolean }>,
  queryAgentTraceFinish: (payload: QueryAgentTraceFinishRequest) =>
    ipcRenderer.invoke('query:agent-trace-finish', payload) as Promise<{ ok: boolean; recorded: boolean }>,
  queryAssessAutoExecution: (command: string, autoExecutionToken?: string) =>
    ipcRenderer.invoke('query:assess-auto-execution', command, autoExecutionToken) as Promise<QueryCommandRiskAssessment>,
  onQueryOutput: (handler: (payload: QueryOutputPayload) => void) => {
    const wrapped = (_e: unknown, payload: QueryOutputPayload) => handler(payload)
    ipcRenderer.on('query:output', wrapped)
    return () => ipcRenderer.removeListener('query:output', wrapped)
  },
  onQueryAiProgress: (handler: (payload: QueryAiProgressPayload) => void) => {
    const wrapped = (_e: unknown, payload: QueryAiProgressPayload) => handler(payload)
    ipcRenderer.on('query:ai-progress', wrapped)
    return () => ipcRenderer.removeListener('query:ai-progress', wrapped)
  },

  presetExecute: (presetName: string) => ipcRenderer.invoke('preset:execute', presetName),
  presetStop: (presetName: string) => ipcRenderer.invoke('preset:stop', presetName),
  onPresetProgress: (handler: (payload: PresetProgressPayload) => void) => {
    const wrapped = (_e: unknown, payload: PresetProgressPayload) => handler(payload)
    ipcRenderer.on('preset:progress', wrapped)
    return () => ipcRenderer.removeListener('preset:progress', wrapped)
  },

  pickDirectoryAndDetectProjects: (request?: { rootPath?: string; maxDepth?: number; maxDirs?: number }) =>
    ipcRenderer.invoke('project:detect-from-directory', request || {}) as Promise<DetectProjectsResult>,
  pickProjectDirectory: () => ipcRenderer.invoke('project:pick-directory') as Promise<{ canceled: boolean; path?: string }>,
  pickAndListProjectSubdirectories: () =>
    ipcRenderer.invoke('project:list-subdirectories') as Promise<ListProjectSubdirectoriesResult>,
  validateProjectDirectories: () =>
    ipcRenderer.invoke('project:validate-directories') as Promise<ProjectDirectoryValidation[]>,
  deployGetDefaultTemplate: () =>
    ipcRenderer.invoke('deploy:get-default-template') as Promise<{
      template: string
      script: { id: string; name: string; content: string; deployTarget?: string; remoteDir?: string }
    }>,
  deployPreviewTemplate: (request: TemplatePreviewRequest) =>
    ipcRenderer.invoke('deploy:preview-template', request) as Promise<TemplatePreviewResult>,
  deployConvertToTemplate: (request: ScriptToTemplateRequest) =>
    ipcRenderer.invoke('deploy:convert-to-template', request) as Promise<ScriptToTemplateResult>,
  deployValidateScript: (request: DeployScriptValidateRequest) =>
    ipcRenderer.invoke('deploy:validate-script', request) as Promise<DeployScriptValidateResult>,
  deployExecuteScript: (request: DeployScriptExecuteRequest) =>
    ipcRenderer.invoke('deploy:execute-script', request) as Promise<DeployScriptExecuteResult>,
  pickMacosApplication: (request?: { appPath?: string }) =>
    ipcRenderer.invoke('app:pick-macos-application', request || {}) as Promise<{
      canceled: boolean
      appPath?: string
      appName?: string
      launchCommand?: string
      iconDataUrl?: string
      iconFilePath?: string
    }>,
  fetchWebsiteIcon: (request?: { url?: string }) =>
    ipcRenderer.invoke('app:fetch-website-icon', request || {}) as Promise<{
      ok: boolean
      pageUrl: string
      iconSourceUrl?: string
      iconDataUrl?: string
      iconFilePath?: string
    }>,

  terminalStart: (
    commandName: string,
    options?: { source?: string; traceId?: string; sessionId?: string; autoExecutionEnabled?: boolean }
  ) =>
    ipcRenderer.invoke('terminal:start', commandName, options) as Promise<{
      ok: boolean
      state?: 'running' | 'idle'
      buffer?: string
      instanceId?: string
      autoExecutionSupported?: boolean
      autoExecutionPrepared?: boolean
      autoExecutionCapable?: boolean
    }>,
  terminalInput: (
    commandName: string,
    data: string,
    options?: {
      source?: string
      traceId?: string
      sessionId?: string
      expectedInstanceId?: string
      autoExecutionToken?: string
      awaitCompletion?: boolean
    }
  ) =>
    ipcRenderer.invoke('terminal:input', commandName, data, options) as Promise<{
      ok: boolean
      completed?: boolean
      executionFailed?: boolean
      riskLevel?: QueryCommandRiskAssessment['riskLevel']
      message?: string
    }>,
  terminalResize: (commandName: string, cols: number, rows: number, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:resize', commandName, cols, rows, options) as Promise<{ ok: boolean }>,
  terminalStop: (commandName: string, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:stop', commandName, options) as Promise<{ ok: boolean }>,
  terminalStopAllForCommand: (commandName: string) =>
    ipcRenderer.invoke('terminal:stop-all-for-command', commandName) as Promise<{ ok: boolean; stopped: number }>,
  terminalGetBuffer: (commandName: string, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:get-buffer', commandName, options) as Promise<{
      text: string
      instanceId?: string
      autoExecutionSupported?: boolean
      autoExecutionPrepared?: boolean
      autoExecutionCapable?: boolean
    }>,
  terminalGetInstanceCount: () => ipcRenderer.invoke('terminal:get-instance-count') as Promise<{ count: number }>,
  terminalListInstances: () =>
    ipcRenderer.invoke('terminal:list-instances') as Promise<{ instances: TerminalInstanceSummary[] }>,
  monitoringGetLocalSnapshot: () =>
    ipcRenderer.invoke('monitoring:get-local-snapshot') as Promise<LocalMetricSnapshot>,
  monitoringGetLocalTopSnapshot: (mode: 'process' | 'threads') =>
    ipcRenderer.invoke('monitoring:get-local-top-snapshot', mode) as Promise<LocalTopSnapshot>,
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalDataPayload) => handler(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.removeListener('terminal:data', wrapped)
  },
  onTerminalObserver: (handler: (payload: TerminalObserverPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalObserverPayload) => handler(payload)
    ipcRenderer.on('terminal:observer', wrapped)
    return () => ipcRenderer.removeListener('terminal:observer', wrapped)
  },
  onTerminalStatus: (handler: (payload: TerminalStatusPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalStatusPayload) => handler(payload)
    ipcRenderer.on('terminal:status', wrapped)
    return () => ipcRenderer.removeListener('terminal:status', wrapped)
  },

  dashboardIntent: (payload: DashboardIntentRequest) =>
    ipcRenderer.invoke('dashboard:intent', payload) as Promise<DashboardIntentResponse>,
  onDashboardIntentProgress: (handler: (payload: DashboardIntentProgressPayload) => void) => {
    const wrapped = (_e: unknown, payload: DashboardIntentProgressPayload) => handler(payload)
    ipcRenderer.on('dashboard:intent-progress', wrapped)
    return () => ipcRenderer.removeListener('dashboard:intent-progress', wrapped)
  },
  dashboardExecuteProbe: (payload: DashboardExecuteProbeRequest) =>
    ipcRenderer.invoke('dashboard:execute-probe', payload) as Promise<DashboardExecuteProbeResponse>,
  dashboardApproveReview: (payload: DashboardApproveReviewRequest) =>
    ipcRenderer.invoke('dashboard:approve-review', payload) as Promise<DashboardApproveReviewResponse>,

  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<{ ok: boolean }>,
  hideToBackground: () => ipcRenderer.invoke('window:hide-to-background') as Promise<{ ok: boolean }>,

  browserListTabs: () => ipcRenderer.invoke('browser:list-tabs') as Promise<{ tabs: BrowserTabMeta[] }>,
  browserGetState: () =>
    ipcRenderer.invoke('browser:get-state') as Promise<{
      tabs: BrowserTabMeta[]
      activeTabId: string | null
      moduleActive: boolean
      privacyBlurred: boolean
    }>,
  browserListProfiles: () => ipcRenderer.invoke('browser:list-profiles') as Promise<BrowserProfileListResult>,
  browserImportProfile: (profileId: string) =>
    ipcRenderer.invoke('browser:import-profile', { profileId }) as Promise<BrowserProfileImportResult>,
  reloadMainWindow: (opts?: { force?: boolean }) =>
    ipcRenderer.invoke('app:reload-main-window', opts) as Promise<{ ok: boolean }>,
  browserCreateTab: (request?: BrowserCreateTabRequest) =>
    ipcRenderer.invoke('browser:create-tab', request) as Promise<{ tabId: string }>,
  browserCloseTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', { tabId }) as Promise<BrowserActionResult>,
  browserSetActiveTab: (tabId: string) =>
    ipcRenderer.invoke('browser:set-active-tab', { tabId }) as Promise<{ ok: boolean }>,
  browserNavigate: (tabId: string, url: string) =>
    ipcRenderer.invoke('browser:navigate', { tabId, url }) as Promise<BrowserActionResult>,
  browserGoBack: (tabId: string) => ipcRenderer.invoke('browser:go-back', { tabId }) as Promise<{ ok: boolean }>,
  browserGoForward: (tabId: string) => ipcRenderer.invoke('browser:go-forward', { tabId }) as Promise<{ ok: boolean }>,
  browserReload: (tabId: string) => ipcRenderer.invoke('browser:reload', { tabId }) as Promise<{ ok: boolean }>,
  browserSetContentBounds: (bounds: BrowserContentBounds) =>
    ipcRenderer.invoke('browser:set-content-bounds', bounds) as Promise<{ ok: boolean }>,
  browserSetModuleActive: (active: boolean) =>
    ipcRenderer.invoke('browser:set-module-active', { active }) as Promise<{ ok: boolean }>,
  browserSetPrivacyBlur: (blurred: boolean) =>
    ipcRenderer.invoke('browser:set-privacy-blur', { blurred }) as Promise<{ ok: boolean }>,
  browserSetTheme: (theme: BrowserTheme) => ipcRenderer.invoke('browser:set-theme', { theme }) as Promise<{ ok: boolean }>,
  browserBossHide: (mode: 'switch-page' | 'tray') =>
    ipcRenderer.invoke('browser:boss-hide', { mode }) as Promise<{ ok: boolean }>,
  onBrowserTabCreated: (handler: (payload: BrowserTabMeta) => void) => {
    const wrapped = (_e: unknown, payload: BrowserTabMeta) => handler(payload)
    ipcRenderer.on('browser:tab-created', wrapped)
    return () => ipcRenderer.removeListener('browser:tab-created', wrapped)
  },
  onBrowserTabUpdated: (handler: (payload: BrowserTabUpdatedPayload) => void) => {
    const wrapped = (_e: unknown, payload: BrowserTabUpdatedPayload) => handler(payload)
    ipcRenderer.on('browser:tab-updated', wrapped)
    return () => ipcRenderer.removeListener('browser:tab-updated', wrapped)
  },
  onBrowserTabClosed: (handler: (payload: { tabId: string }) => void) => {
    const wrapped = (_e: unknown, payload: { tabId: string }) => handler(payload)
    ipcRenderer.on('browser:tab-closed', wrapped)
    return () => ipcRenderer.removeListener('browser:tab-closed', wrapped)
  },
  onBrowserPageInfo: (handler: (payload: BrowserPageInfoPayload) => void) => {
    const wrapped = (_e: unknown, payload: BrowserPageInfoPayload) => handler(payload)
    ipcRenderer.on('browser:page-info', wrapped)
    return () => ipcRenderer.removeListener('browser:page-info', wrapped)
  },
  killPortProcess: (port: number) =>
    ipcRenderer.invoke('system:kill-port-process', port) as Promise<{ ok: boolean; port: number; pids: number[] }>,
  killPortProcessByKeyword: (keyword: string) =>
    ipcRenderer.invoke('system:kill-port-process-by-keyword', keyword) as Promise<{
      ok: boolean
      keyword: string
      processPids: number[]
      ports: number[]
      killedPids: number[]
    }>,
  killProcessByPid: (pid: number) =>
    ipcRenderer.invoke('system:kill-process-by-pid', pid) as Promise<{
      ok: boolean
      requestedPid: number
      rootPid: number
      killedPids: number[]
    }>,
  inspectPortProcess: (port: number) => ipcRenderer.invoke('system:inspect-port-process', port) as Promise<PortInspectionResult>,
  inspectProcessByKeyword: (keyword: string) =>
    ipcRenderer.invoke('system:inspect-process-by-keyword', keyword) as Promise<ProcessKeywordInspectionResult>,

  updateCheck: (opts?: { manual?: boolean }) =>
    ipcRenderer.invoke('app-update:check', opts) as Promise<
      | { ok: true }
      | { ok: false; reason: AppUpdateDisabledReason }
      | { ok: false; error: string }
    >,
  updateQuitAndInstall: () =>
    ipcRenderer.invoke('app-update:quit-and-install') as Promise<
      { ok: true } | { ok: false; reason: AppUpdateDisabledReason }
    >,
  updateDownload: () =>
    ipcRenderer.invoke('app-update:download') as Promise<
      | { ok: true }
      | { ok: false; reason: AppUpdateDisabledReason }
      | { ok: false; error: string }
    >,
  onAppUpdate: (handler: (payload: AppUpdateBroadcastPayload) => void) => {
    const wrapped = (_e: unknown, payload: AppUpdateBroadcastPayload) => handler(payload)
    ipcRenderer.on('app-update:status', wrapped)
    return () => {
      ipcRenderer.removeListener('app-update:status', wrapped)
    }
  },
  onAppNavigate: (handler: (payload: { target: 'home' | 'query' | 'monitoring' | 'editor' | 'browser' }) => void) => {
    const wrapped = (_e: unknown, payload: { target: 'home' | 'query' | 'monitoring' | 'editor' | 'browser' }) => handler(payload)
    ipcRenderer.on('app:navigate', wrapped)
    return () => ipcRenderer.removeListener('app:navigate', wrapped)
  },
  onAppFocusHomeSearch: (handler: () => void) => {
    const wrapped = () => handler()
    ipcRenderer.on('app:focus-home-search', wrapped)
    return () => ipcRenderer.removeListener('app:focus-home-search', wrapped)
  },
  onAppCheckUpdate: (handler: () => void) => {
    const wrapped = () => handler()
    ipcRenderer.on('app:check-update', wrapped)
    return () => ipcRenderer.removeListener('app:check-update', wrapped)
  },
  onAppReloadRequest: (handler: (payload: { force: boolean }) => void) => {
    const wrapped = (_e: unknown, payload: { force: boolean }) => handler(payload)
    ipcRenderer.on('app:reload-request', wrapped)
    return () => ipcRenderer.removeListener('app:reload-request', wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
