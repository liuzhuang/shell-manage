export type CommandMode = 'service' | 'terminal'
export type ThemePreset = 'system' | 'coder' | 'girl'
export type AnalyticsEventType = 'ui_action' | 'command_lifecycle' | 'feature_usage'
export type AnalyticsResult = 'success' | 'fail' | 'unknown'

export interface AnalyticsEvent {
  schemaVersion: number
  eventId: string
  eventType: AnalyticsEventType
  featureKey: string
  action: string
  timestamp: number
  sessionId: string
  page?: string
  result?: AnalyticsResult
  durationMs?: number
  context?: Record<string, string | number | boolean | null>
}

export interface AnalyticsSummaryWindow {
  startAt: number
  endAt: number
  timezone: string
  days: number
}

export interface AnalyticsFeatureUsageItem {
  featureKey: string
  count: number
  sessionCoverage: number
  successRate: number
  /** command_lifecycle 等 idle/unknown 事件占比 */
  idleRate?: number
}

export interface AnalyticsLowUsageCandidate {
  featureKey: string
  count: number
  sessionCoverage: number
  lastSeenAt?: number
  protected: boolean
  reason: string
}

export interface AnalyticsFailureTopItem {
  featureKey: string
  errorCode: string
  count: number
  failRate: number
}

export interface AnalyticsFlowTopItem {
  from: string
  to: string
  count: number
}

export interface AnalyticsSummary3d {
  schemaVersion: number
  generatedAt: number
  window: AnalyticsSummaryWindow
  overview: {
    totalEvents: number
    totalSessions: number
    activeFeatures: number
    overallSuccessRate: number
  }
  featureUsageTop: AnalyticsFeatureUsageItem[]
  featureLowUsageCandidates: AnalyticsLowUsageCandidate[]
  failureTop: AnalyticsFailureTopItem[]
  flowTop: AnalyticsFlowTopItem[]
  protectedFeatures: string[]
}

export interface AnalyticsViewerSnapshot {
  latestSummary: AnalyticsSummary3d | null
  recentEvents: AnalyticsEvent[]
  eventFileCount: number
  summaryFileCount: number
}

export interface CommandHealthCheckConfig {
  type: 'port' | 'log'
  host?: string
  port?: number
  pattern?: string
  intervalSec?: number
  startupGraceSec?: number
  failureThreshold?: number
}

export interface TerminalStartupStep {
  /**
   * 等待后再执行当前步骤（毫秒）。可与 waitForOutputPattern 组合使用。
   */
  delayMs?: number
  /**
   * 当终端输出命中该正则后再执行当前步骤（字符串形式的 RegExp）。
   */
  waitForOutputPattern?: string
  /**
   * waitForOutputPattern 的超时时间（毫秒），默认 15000。
   */
  timeoutMs?: number
  /**
   * 实际写入 PTY 的命令内容。
   */
  send: string
  /**
   * 是否自动追加换行，默认 true。
   */
  sendNewline?: boolean
  /**
   * 步骤展示名，仅用于日志提示。
   */
  label?: string
}

export interface SshKeyConfig {
  id: string
  label: string
  createdAt?: string
}

export interface CommandConfig {
  name: string
  command: string
  tags: string[]
  mode?: CommandMode
  /** 引用 settings.sshKeys 中的密钥 ID，执行 SSH 时自动注入 -i */
  sshKeyId?: string
  webUrl?: string
  iconDataUrl?: string
  iconFilePath?: string
  autoRestart?: boolean
  maxRestarts?: number
  healthCheck?: CommandHealthCheckConfig
  terminalStartupSteps?: TerminalStartupStep[]
}

export interface PresetSequenceItem {
  command: string
  delay?: number
}

export interface PresetConfig {
  name: string
  sequence: PresetSequenceItem[]
}

export interface LogViewPreset {
  name: string
  commandNames: string[]
  updatedAt?: string
}

export interface ProjectDirectory {
  id: string
  name: string
  path: string
  createdAt?: string
}

export type ProjectDirectoryStatus = 'ok' | 'missing' | 'permission_denied'

export interface ProjectDirectoryValidation {
  id: string
  name: string
  path: string
  status: ProjectDirectoryStatus
}

export interface DeployScriptConfig {
  id: string
  name: string
  content: string
  /** 引用 settings.sshKeys[].id */
  sshKeyRef?: string
  deployTarget?: string
  remoteDir?: string
  createdAt?: string
}

export interface TemplatePreviewResult {
  rendered: string
  slotValues: Record<string, string | undefined>
  missingSlots: string[]
  unknownSlots: string[]
  knownSlots: string[]
  usedSlots: string[]
}

export interface TemplatePreviewRequest {
  content: string
  projectDirectories?: ProjectDirectory[]
}

export interface ScriptToTemplateRequest {
  script: string
  projectDirectories?: ProjectDirectory[]
}

export interface ScriptToTemplateResult {
  content: string
  sshKeyRef?: string
  matchedProjectId?: string
  replacements: Array<{ from: string; slot: string }>
}

export interface DeployScriptExecuteRequest {
  scriptId: string
  content?: string
}

export interface DeployScriptExecuteResult {
  ok: boolean
  terminalCommandName: string
  scriptId: string
  scriptName: string
}

export interface DeployScriptValidateRequest {
  scriptId?: string
  content?: string
}

export interface DeployScriptValidateResult {
  ok: boolean
  missingSlots: string[]
  unknownSlots: string[]
  usedSlots: string[]
}

/** 与 config.yaml 中 projectDirectories / deployScripts 段落一致；分享时不含 path、id、sshKeyRef */
export interface CollaborationShareProjectEntry {
  name: string
}

export interface CollaborationShareScriptEntry {
  name: string
  content: string
}

export interface CollaborationSharePayload {
  projectDirectories?: CollaborationShareProjectEntry[]
  deployScripts?: CollaborationShareScriptEntry[]
}

export type CollaborationScriptConflictAction = 'skip' | 'overwrite'

export interface CollaborationImportProjectRow {
  name: string
  selected: boolean
  path: string | undefined
  existingPath: string | undefined
}

export interface CollaborationImportScriptRow {
  name: string
  content: string
  selected: boolean
  hasConflict: boolean
  conflictAction: CollaborationScriptConflictAction
}

export interface CollaborationImportDraft {
  share: CollaborationSharePayload
  projects: CollaborationImportProjectRow[]
  scripts: CollaborationImportScriptRow[]
}

export interface CollaborationExportProjectRow {
  id: string
  name: string
  selected: boolean
}

export interface CollaborationExportScriptRow {
  id: string
  name: string
  content: string
  selected: boolean
}

export interface CollaborationExportDraft {
  projects: CollaborationExportProjectRow[]
  scripts: CollaborationExportScriptRow[]
}

export interface CollaborationMergeResult {
  projectsAdded: number
  projectsSkipped: number
  scriptsAdded: number
  scriptsOverwritten: number
  scriptsSkipped: number
}

export interface AppConfig {
  commands: CommandConfig[]
  presets: PresetConfig[]
  projectDirectories?: ProjectDirectory[]
  deployScripts?: DeployScriptConfig[]
  activeDeployScriptId?: string
  dashboard?: DashboardConfig
  settings: {
    llm: {
      provider?: 'openai' | 'deepseek'
      endpoint: string
      apiKey: string
      model: string
    }
    langsmith?: {
      tracingV2?: boolean
      endpoint?: string
      apiKey?: string
      project?: string
    }
    tagOrder?: string[]
    logViewPresets?: LogViewPreset[]
    themePreset?: ThemePreset
    /** 登录 macOS 时自动启动应用，默认 false */
    launchAtLogin?: boolean
    logBufferLines: number
    /** SSH 密钥元数据；私钥文件保存在 ~/.shell-manage/keys/ */
    sshKeys?: SshKeyConfig[]
  }
}

export interface SshKeyImportRequest {
  label: string
  content: string
  id?: string
}

export interface SshKeyImportResponse {
  ok: boolean
  id: string
  label: string
}

export type DashboardRiskLevel = 'safe' | 'review' | 'blocked'
export type DashboardWidgetKind = 'metric' | 'table' | 'timeseries' | 'event'
export type DashboardProbeMode = 'single' | 'multi-step'
export type DashboardActionType = 'CREATE' | 'UPDATE'
export type DashboardCreationMode = 'auto' | 'chat'

export interface ProbePlanStep {
  stepId: string
  command: string
  shellType: 'bash' | 'zsh' | 'mysql' | 'redis'
  timeoutMs: number
  riskLevel: DashboardRiskLevel
  dependsOn?: string[]
}

export interface ProbePlan {
  mode: DashboardProbeMode
  steps: ProbePlanStep[]
}

export interface WidgetSpec {
  id: string
  title: string
  description?: string
  kind: DashboardWidgetKind
  priority: 'high' | 'medium' | 'low'
  datasourceId: string
  probe: ProbePlan
  parserRule: {
    type: 'regex' | 'json' | 'awk-table'
    pattern?: string
    keysMapping?: string[]
  }
}

export interface DashboardGridLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export interface DashboardTab {
  id: string
  name: string
  contextLabel: string
  createdAt: number
  updatedAt: number
  widgets: WidgetSpec[]
  gridLayout: DashboardGridLayoutItem[]
}

export interface DashboardConfig {
  version: number
  activeTabId?: string
  tabs: DashboardTab[]
}

export interface DashboardIntentRequest {
  actionType: DashboardActionType
  creationMode: DashboardCreationMode
  userQuery: string
  threadId?: string
  history?: QueryAiHistoryItem[]
  context: {
    targetDatasourceId: string
    envInfo: string
    currentDashboardState?: DashboardTab | null
    selectedShellCommandName?: string
    availableShellCommands?: Array<{
      name: string
      tags?: string[]
    }>
    lastGenerationFeedback?: DashboardLastGenerationFeedback
  }
}

export interface DashboardLastGenerationFeedback {
  parse?: {
    parsedBy?: string
    repairAttempted?: boolean
    semanticErrorCount?: number
    semanticErrors?: string[]
  }
  render?: {
    widgetsCount: number
    renderedWidgetCount: number
    layoutMatch: boolean
    isBlankCanvas: boolean
  }
}

export interface CommandReviewItem {
  widgetTitle: string
  widgetId: string
  stepId: string
  commandToExecute: string
  riskLevel: DashboardRiskLevel
  riskReason: string
}

export interface DashboardIntentResponse {
  success: boolean
  draftDashboard: DashboardTab
  commandsToReview: CommandReviewItem[]
  threadId?: string
  assistantReply?: string
  stats?: QueryAiStats
  intentDiagnostics?: {
    engine: 'deepagents'
    parsedBy?: string
    repairAttempted: boolean
    semanticErrorCount: number
    semanticErrors?: string[]
    localFixCount?: number
    localFixes?: string[]
  }
}

export interface DashboardIntentProgressPayload {
  threadId: string
  phase:
    | 'start'
    | 'agent_init'
    | 'invoke_start'
    | 'invoke_heartbeat'
    | 'raw_output'
    | 'local_repair'
    | 'llm_repair_start'
    | 'llm_repair_done'
    | 'done'
    | 'error'
  message: string
  at: number
  inputPreview?: string
  outputPreview?: string
  localFixes?: string[]
}

export interface DashboardApproveReviewRequest {
  widgetId: string
  stepId: string
  command: string
}

export interface DashboardApproveReviewResponse {
  ok: boolean
  tokenAuth: string
  expiresAt: number
}

export interface DashboardExecuteProbeRequest {
  widgetId: string
  datasourceId: string
  stepId: string
  command: string
  riskLevel?: DashboardRiskLevel
  timeoutMs?: number
  parserRule?: WidgetSpec['parserRule']
  tokenAuth?: string
}

export interface DashboardExecuteProbeResponse {
  success: boolean
  isBlockedBySecurity: boolean
  execResult?: {
    exitCode: number
    stdout: string
    stderr: string
    durationMs: number
  }
  parsedData?: unknown
  riskLevel?: DashboardRiskLevel
  message?: string
}

export interface QueryAiAction {
  type: 'command' | 'reply' | 'clarify'
  message: string
  command?: string
  riskLevel: DashboardRiskLevel
  riskReason: string
}

export interface QueryAiHistoryItem {
  role: 'user' | 'assistant'
  content: string
  action?: QueryAiAction
}

export interface QueryCommandRiskAssessment {
  canAutoExecute: boolean
  riskLevel: DashboardRiskLevel
  message: string
}

export interface QueryAiRequest {
  requestId: string
  input: string
  history: QueryAiHistoryItem[]
  selectedCommand?: string
  terminalSessionId?: string
  terminalInstanceId?: string
  targetLogPath?: string
  sessionLogs: string[]
  queryOutputLines: string[]
}

export interface QueryAiResponse {
  answer: string
  action: QueryAiAction
  autoExecutionToken?: string
  stats: QueryAiStats
}

export interface QueryAiStreamPayload {
  requestId: string
  phase: 'start' | 'chunk' | 'end' | 'error'
  text?: string
  error?: string
  stats?: QueryAiStats
}

export interface QueryAiStats {
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedTokens?: number
  provider: 'openai' | 'deepseek'
  model: string
}

export type ProcessState = 'idle' | 'running' | 'error' | 'restarting'

export interface ProcessStatusPayload {
  commandName: string
  state: ProcessState
  pid?: number
  restarts?: number
  message?: string
  configChanged?: boolean
  exitCode?: number
}

export interface ProcessOutputPayload {
  commandName: string
  line: string
  stream: 'stdout' | 'stderr'
  at: number
}

export interface QueryOutputPayload {
  line: string
  stream: 'stdout' | 'stderr'
  at: number
}

export type PresetAction = 'start' | 'stop'

export interface PresetProgressPayload {
  presetName: string
  action: PresetAction
  index: number
  total: number
  commandName: string
  sequence: string[]
}

export interface TerminalDataPayload {
  commandName: string
  sessionId?: string
  data: string
  at: number
}

export interface TerminalObserverPayload {
  commandName: string
  sessionId?: string
  chunk: string
  at: number
}

export interface TerminalStatusPayload {
  commandName: string
  sessionId?: string
  state: 'running' | 'idle'
  exitCode?: number
  message?: string
  restarts?: number
}

export interface LocalMetricSnapshot {
  platform: string
  cpuUsage?: number
  load1m?: number
  memoryUsage?: number
  diskUsage?: number
  diskUsedBytes?: number
  diskTotalBytes?: number
  netRxKbps?: number
  netTxKbps?: number
  capturedAt: number
  unavailable?: string[]
}

export interface LocalTopSnapshot {
  lines: string[]
  capturedAt: number
}

/** 当前主进程中活跃的交互式 Shell（PTY）会话摘要，用于顶栏实例列表等 */
export interface TerminalInstanceSummary {
  commandName: string
  /** 配置文件中的 command 字段 */
  command: string
  sessionId?: string
  pid?: number
  /** 会话类型：如 terminal-pane（终端页独立 PTY）、monitoring（监控占用的默认槽）、default 等 */
  sessionKind: string
}

export type DetectedProjectType = 'nextjs' | 'vue' | 'react' | 'python' | 'java'

export interface DetectedProject {
  type: DetectedProjectType
  name: string
  rootPath: string
  command: string
  mode: CommandMode
  tags: string[]
  confidence: number
  evidence: string[]
}

export interface DetectProjectsResult {
  canceled: boolean
  rootPath?: string
  projects: DetectedProject[]
}

export interface ProjectSubdirectoryItem {
  name: string
  path: string
}

export interface ListProjectSubdirectoriesResult {
  canceled: boolean
  rootPath?: string
  subdirectories: ProjectSubdirectoryItem[]
}

export interface ProcessInspectorItem {
  pid: number
  name: string
  command: string
  cwd?: string
  parentPid?: number
  parentName?: string
  rootPid?: number
  rootName?: string
  rootCommand?: string
  listeningPorts: number[]
}

export interface PortInspectionResult {
  port: number
  processCount: number
  processes: ProcessInspectorItem[]
}

export interface ProcessKeywordInspectionResult {
  keyword: string
  processCount: number
  processes: ProcessInspectorItem[]
}

export type AppUpdateDisabledReason = 'not-packaged' | 'unsupported-platform'

/** 主进程通过 `app-update:status` 广播给渲染进程 */
export type AppUpdateBroadcastPayload =
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseDate?: string }
  | { phase: 'not-available'; fromManual?: boolean }
  | {
      phase: 'downloading'
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { phase: 'installing'; percent?: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }
