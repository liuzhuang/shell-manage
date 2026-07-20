import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { emptyDashboardTab } from '../lib/dashboard-mock'
import type { DashboardDataMap, DashboardWidgetData, DashboardWidgetSpec } from '../lib/dashboard-types'
import type {
  AppConfig,
  CommandReviewItem,
  DashboardConfig,
  DashboardExecuteProbeResponse,
  DashboardIntentProgressPayload,
  DashboardLastGenerationFeedback,
  DashboardTab,
  QueryAiHistoryItem
} from '../../shared/types'
import { DashboardChatPanel } from '../components/dashboard/DashboardChatPanel'
import { DashboardCanvasPanel } from '../components/dashboard/DashboardCanvasPanel'
import { DashboardAuditPanel } from '../components/dashboard/DashboardAuditPanel'
import { executeProbePlan } from '../lib/dashboard-probe-plan'
import { timeseriesPointsFromProbe } from '../lib/dashboard-timeseries'

type DashboardChatMessage = {
  id: string
  role: 'ai' | 'user'
  text: string
}

type DashboardViewMode = 'Viewing' | 'Creating' | 'Editing' | 'Saving'

type ShellOption = {
  name: string
}

type ApprovedProbeToken = {
  tokenAuth: string
  expiresAt: number
}

const seedMessages: DashboardChatMessage[] = [
  { id: 'seed-1', role: 'ai' as const, text: '欢迎使用看板助手。可指定连接，也可直接描述目标，让 Agent 从候选连接中选择。' },
  { id: 'seed-2', role: 'ai' as const, text: '示例：给我一个包含 CPU、内存、慢 SQL、带宽走势和事件流的看板。' }
]

function dataFromProbe(spec: DashboardWidgetSpec, response: DashboardExecuteProbeResponse): DashboardWidgetData {
  const stdout = response.execResult?.stdout || ''
  const parsed = response.parsedData
  const exitCode = response.execResult?.exitCode ?? 0
  const isTimeout = exitCode === 124
  if (spec.kind === 'metric') {
    let valueText = 'N/A'
    if (Array.isArray(parsed) && parsed.length > 0) valueText = String(parsed[0])
    else if (typeof parsed === 'string' || typeof parsed === 'number') valueText = String(parsed)
    return {
      kind: 'metric',
      value: valueText,
      statusText: exitCode === 0 ? '已刷新' : isTimeout ? '连接较慢，已超时' : '执行异常',
      tone: exitCode === 0 ? 'ok' : 'warn'
    }
  }
  if (spec.kind === 'table') {
    const columns = spec.parserRule.keysMapping || ['col1', 'col2', 'col3']
    if (Array.isArray(parsed)) {
      const rows = parsed.map((item) => {
        if (Array.isArray(item)) return item.map((cell) => String(cell))
        if (item && typeof item === 'object') return columns.map((key) => String((item as Record<string, unknown>)[key] ?? ''))
        return [String(item)]
      })
      return { kind: 'table', columns, rows: rows.slice(0, 20) }
    }
    return { kind: 'table', columns, rows: [] }
  }
  if (spec.kind === 'timeseries') {
    return { kind: 'timeseries', points: timeseriesPointsFromProbe(parsed, stdout) }
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
  return { kind: 'event', lines: lines.length > 0 ? lines : ['暂无事件输出'] }
}

export function DashboardPage() {
  const [viewMode, setViewMode] = useState<DashboardViewMode>('Viewing')
  const [savedDashboardTab, setSavedDashboardTab] = useState<DashboardTab>(emptyDashboardTab)
  const [draftDashboardTab, setDraftDashboardTab] = useState<DashboardTab>(emptyDashboardTab)
  const [commandOptions, setCommandOptions] = useState<ShellOption[]>([])
  const [selectedCommandName, setSelectedCommandName] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMinimized, setAssistantMinimized] = useState(false)
  const [messages, setMessages] = useState<DashboardChatMessage[]>(seedMessages)
  const [input, setInput] = useState('')
  const [loadingIntent, setLoadingIntent] = useState(false)
  const [refreshSec, setRefreshSec] = useState(5)
  const [dataMap, setDataMap] = useState<DashboardDataMap>({})
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [commandReviewMap, setCommandReviewMap] = useState<Record<string, CommandReviewItem>>({})
  const [approvedTokenMap, setApprovedTokenMap] = useState<Record<string, ApprovedProbeToken>>({})
  const [approvingStepId, setApprovingStepId] = useState<string>()
  const [intentThreadId, setIntentThreadId] = useState<string>()
  const [lastGenerationFeedback, setLastGenerationFeedback] = useState<DashboardLastGenerationFeedback>()
  const [thinkingOffset, setThinkingOffset] = useState(0)
  const [thinkingDirection, setThinkingDirection] = useState<1 | -1>(1)
  const [intentProgressLines, setIntentProgressLines] = useState<string[]>([])
  const refreshInFlightRef = useRef(false)

  const thinkingPool = useMemo(
    () => [
      '正在分析当前大盘上下文...',
      '正在规划只读探针与布局...',
      '正在评估命令风险等级...',
      '正在生成组件与审计映射...',
      '正在尝试输出结构化 JSON...',
      '若模型输出非结构化，将自动修复...'
    ],
    []
  )

  const thinkingLines = useMemo(() => {
    if (!loadingIntent) return []
    if (intentProgressLines.length > 0) {
      return intentProgressLines.slice(-2)
    }
    const first = thinkingPool[thinkingOffset % thinkingPool.length]
    const second = thinkingPool[(thinkingOffset + 1) % thinkingPool.length]
    return [first, second]
  }, [intentProgressLines, loadingIntent, thinkingOffset, thinkingPool])

  const persistDashboardTab = useCallback(async (nextTab: DashboardTab) => {
    const raw = await window.api.configRead()
    const parsed = (yaml.load(raw) || {}) as AppConfig
    const current = parsed.dashboard
    const tabs = Array.isArray(current?.tabs) ? [...current.tabs] : []
    const existingIndex = tabs.findIndex((item) => item.id === nextTab.id)
    if (existingIndex >= 0) tabs[existingIndex] = nextTab
    else tabs.unshift(nextTab)
    parsed.dashboard = {
      version: current?.version || 1,
      activeTabId: nextTab.id,
      tabs
    }
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
  }, [])

  const isDirty = useMemo(() => JSON.stringify(draftDashboardTab) !== JSON.stringify(savedDashboardTab), [draftDashboardTab, savedDashboardTab])

  const selectedWidget = useMemo(
    () => draftDashboardTab.widgets.find((widget) => widget.id === selectedWidgetId) || null,
    [draftDashboardTab.widgets, selectedWidgetId]
  )

  const selectedCommand = useMemo(
    () => commandOptions.find((item) => item.name === selectedCommandName),
    [commandOptions, selectedCommandName]
  )

  const isSshProbeCommand = useCallback((command: string): boolean => /^\s*ssh(\s|$)/i.test(String(command || '')), [])

  const runRefresh = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    try {
      const nextDataMap: DashboardDataMap = {}
      const tasks = draftDashboardTab.widgets.map(async (widget) => {
        const planResult = await executeProbePlan(widget.probe.steps, async (step) => {
          const key = `${widget.id}:${step.stepId}`
          const isSsh = isSshProbeCommand(step.command)
          const effectiveTimeoutMs = isSsh
            ? Math.max(45_000, Number(step.timeoutMs) || 0)
            : Math.max(5_000, Number(step.timeoutMs) || 0)
          const response = await window.api.dashboardExecuteProbe({
            widgetId: widget.id,
            datasourceId: widget.datasourceId,
            stepId: step.stepId,
            command: step.command,
            riskLevel: step.riskLevel,
            timeoutMs: effectiveTimeoutMs,
            parserRule: widget.parserRule,
            tokenAuth: approvedTokenMap[key]?.tokenAuth
          })
          if (response.riskLevel === 'review' || response.riskLevel === 'blocked') {
            const reviewItem: CommandReviewItem = {
              widgetTitle: widget.title,
              widgetId: widget.id,
              stepId: step.stepId,
              commandToExecute: step.command,
              riskLevel: response.riskLevel,
              riskReason: response.message || '安全策略已提高此命令的风险等级。'
            }
            setCommandReviewMap((prev) => {
              const current = prev[key]
              if (
                current?.commandToExecute === reviewItem.commandToExecute &&
                current.riskLevel === reviewItem.riskLevel &&
                current.riskReason === reviewItem.riskReason
              ) {
                return prev
              }
              return { ...prev, [key]: reviewItem }
            })
          }
          return response
        })
        const failedStep = planResult.steps.find((item) => item.status === 'failed')
        const response: DashboardExecuteProbeResponse = planResult.success && planResult.finalResponse
          ? planResult.finalResponse
          : failedStep?.response || {
              success: false,
              isBlockedBySecurity: false,
              riskLevel: 'review',
              message: planResult.validationError || failedStep?.message || '探针计划未完整执行。'
            }
        if (!response.success || response.isBlockedBySecurity) {
          if (widget.kind === 'metric') {
            nextDataMap[widget.id] = {
              kind: 'metric',
              value: response.isBlockedBySecurity ? 'BLOCKED' : 'PENDING',
              statusText: response.message || '等待授权',
              tone: response.isBlockedBySecurity ? 'error' : 'warn'
            }
          } else if (widget.kind === 'table') {
            nextDataMap[widget.id] = { kind: 'table', columns: widget.parserRule.keysMapping || ['Message'], rows: [[response.message || '未执行']] }
          } else if (widget.kind === 'timeseries') {
            nextDataMap[widget.id] = { kind: 'timeseries', points: [] }
          } else {
            nextDataMap[widget.id] = { kind: 'event', lines: [response.message || '未执行'] }
          }
          return
        }
        nextDataMap[widget.id] = dataFromProbe(widget, response)
      })
      await Promise.allSettled(tasks)
      setDataMap(nextDataMap)
    } finally {
      refreshInFlightRef.current = false
    }
  }, [approvedTokenMap, draftDashboardTab.widgets, isSshProbeCommand])

  useEffect(() => {
    void (async () => {
      try {
        const raw = await window.api.configRead()
        const parsed = yaml.load(raw) as AppConfig
        const cfg = parsed?.dashboard as DashboardConfig | undefined
        const commands = (parsed?.commands || []).map((item) => ({ name: item.name }))
        setCommandOptions(commands)
        if (cfg?.tabs?.length) {
          const active = cfg.tabs.find((tab) => tab.id === cfg.activeTabId) || cfg.tabs[0]
          setSavedDashboardTab(active)
          setDraftDashboardTab(active)
        }
      } catch {
        // keep mock tab
      }
    })()
  }, [])

  useEffect(() => {
    void runRefresh()
  }, [runRefresh])

  useEffect(() => {
    if (viewMode !== 'Viewing') return undefined
    const timer = window.setInterval(() => {
      void runRefresh()
    }, refreshSec * 1000)
    return () => window.clearInterval(timer)
  }, [refreshSec, runRefresh, viewMode])

  useEffect(() => {
    const formatProgressLine = (payload: DashboardIntentProgressPayload): string => {
      const fixTail = payload.localFixes?.length ? ` | 修复: ${payload.localFixes.join('；')}` : ''
      const inputTail = payload.inputPreview ? ` | 输入: ${payload.inputPreview}` : ''
      const outputTail = payload.outputPreview ? ` | 输出: ${payload.outputPreview}` : ''
      return `[${payload.phase}] ${payload.message}${fixTail}${inputTail}${outputTail}`
    }
    const off = window.api.onDashboardIntentProgress((payload) => {
      if (!payload?.threadId) return
      if (intentThreadId && payload.threadId !== intentThreadId) return
      setIntentProgressLines((prev) => {
        const next = [...prev, formatProgressLine(payload)]
        return next.slice(-8)
      })
    })
    return () => {
      off?.()
    }
  }, [intentThreadId])

  useEffect(() => {
    if (!loadingIntent) {
      setThinkingOffset(0)
      setThinkingDirection(1)
      setIntentProgressLines([])
      return
    }
    const timer = window.setInterval(() => {
      setThinkingOffset((prev) => {
        const maxOffset = Math.max(0, thinkingPool.length - 2)
        if (maxOffset === 0) return 0
        let next = prev + thinkingDirection
        if (next >= maxOffset) {
          next = maxOffset
          setThinkingDirection(-1)
        } else if (next <= 0) {
          next = 0
          setThinkingDirection(1)
        }
        return next
      })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [loadingIntent, thinkingDirection, thinkingPool.length])

  const applyIntent = useCallback(async (creationMode: 'auto' | 'chat') => {
    const userText =
      creationMode === 'auto' ? '请基于当前命令上下文自动推荐一个运维看板。' : input.trim()
    if (!userText || loadingIntent) return
    const threadId = intentThreadId || globalThis.crypto?.randomUUID?.() || `dashboard-thread-${Date.now()}`
    if (!intentThreadId) setIntentThreadId(threadId)
    setIntentProgressLines([])
    if (creationMode === 'chat') {
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: userText }])
      setInput('')
    }
    console.info('[dashboard][ui] applyIntent start', {
      creationMode,
      threadId,
      selectedCommand: selectedCommand?.name || '(none)',
      actionType: draftDashboardTab.widgets.length > 0 ? 'UPDATE' : 'CREATE',
      userTextPreview: userText.slice(0, 120)
    })
    setLoadingIntent(true)
    try {
      const result = await window.api.dashboardIntent({
        actionType: draftDashboardTab.widgets.length > 0 ? 'UPDATE' : 'CREATE',
        creationMode,
        userQuery: userText,
        threadId,
        history: messages
          .slice(-20)
          .map((item): QueryAiHistoryItem => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: item.text
          })),
        context: {
          targetDatasourceId: selectedCommand?.name || draftDashboardTab.contextLabel,
          selectedShellCommandName: selectedCommand?.name,
          envInfo: '',
          currentDashboardState: draftDashboardTab,
          lastGenerationFeedback
        }
      })
      if (result.threadId && result.threadId !== intentThreadId) setIntentThreadId(result.threadId)
      setDraftDashboardTab(result.draftDashboard)
      setViewMode('Editing')
      const widgetsCount = result.draftDashboard.widgets.length
      const widgetIdSet = new Set(result.draftDashboard.widgets.map((item) => item.id))
      const layoutIds = result.draftDashboard.gridLayout.map((item) => item.i)
      const renderedWidgetCount = layoutIds.filter((id) => widgetIdSet.has(id)).length
      const layoutMatch =
        widgetsCount === renderedWidgetCount &&
        result.draftDashboard.gridLayout.length === widgetsCount &&
        new Set(layoutIds).size === layoutIds.length
      const nextFeedback: DashboardLastGenerationFeedback = {
        parse: {
          parsedBy: result.intentDiagnostics?.parsedBy,
          repairAttempted: result.intentDiagnostics?.repairAttempted,
          semanticErrorCount: result.intentDiagnostics?.semanticErrorCount,
          semanticErrors: result.intentDiagnostics?.semanticErrors || []
        },
        render: {
          widgetsCount,
          renderedWidgetCount,
          layoutMatch,
          isBlankCanvas: widgetsCount > 0 && renderedWidgetCount === 0
        }
      }
      setLastGenerationFeedback(nextFeedback)
      console.info('[dashboard][ui] feedback updated', {
        threadId: result.threadId || threadId,
        feedback: nextFeedback
      })
      console.info('[dashboard][ui] applyIntent done', {
        creationMode,
        threadId: result.threadId || threadId,
        widgets: result.draftDashboard.widgets.length,
        widgetIds: result.draftDashboard.widgets.map((item) => item.id),
        commandsToReview: result.commandsToReview.length,
        assistantPreview: (result.assistantReply || '').slice(0, 160)
      })
      const reviewMap: Record<string, CommandReviewItem> = {}
      result.commandsToReview.forEach((item) => {
        reviewMap[`${item.widgetId}:${item.stepId}`] = item
      })
      setCommandReviewMap(reviewMap)
      setApprovedTokenMap({})
      const aiText =
        result.assistantReply ||
        `已生成看板草稿，组件 ${result.draftDashboard.widgets.length} 个。${result.commandsToReview.length > 0 ? `其中 ${result.commandsToReview.length} 条命令需要审查授权。` : ''}`
      const localFixSummary =
        result.intentDiagnostics?.localFixes && result.intentDiagnostics.localFixes.length > 0
          ? `\n\n本地语义修复：\n- ${result.intentDiagnostics.localFixes.join('\n- ')}`
          : ''
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'ai', text: `${aiText}${localFixSummary}` }])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dashboard][ui] applyIntent failed', {
        creationMode,
        threadId,
        error: message
      })
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'ai', text: `生成失败：${message}` }])
    } finally {
      setLoadingIntent(false)
    }
  }, [draftDashboardTab, input, intentThreadId, lastGenerationFeedback, loadingIntent, messages, selectedCommand])

  const handleApprove = useCallback(async (widgetId: string, stepId: string, command: string) => {
    setApprovingStepId(stepId)
    try {
      const issued = await window.api.dashboardApproveReview({ widgetId, stepId, command })
      const key = `${widgetId}:${stepId}`
      const approval = { tokenAuth: issued.tokenAuth, expiresAt: issued.expiresAt }
      setApprovedTokenMap((prev) => ({ ...prev, [key]: approval }))
      window.setTimeout(() => {
        setApprovedTokenMap((prev) => {
          if (prev[key]?.tokenAuth !== approval.tokenAuth) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
      }, Math.max(0, issued.expiresAt - Date.now()))
    } finally {
      setApprovingStepId(undefined)
    }
  }, [])

  const handleEnterCreating = useCallback(() => {
    if (isDirty && !window.confirm('当前有未保存改动，进入创建模式前将保留草稿，是否继续？')) return
    setViewMode('Creating')
  }, [isDirty])

  const handleEnterEditing = useCallback(() => {
    setViewMode('Editing')
  }, [])

  const handleCancelEditing = useCallback(() => {
    if (isDirty && !window.confirm('你有未保存改动，确定放弃并退出编辑吗？')) return
    setDraftDashboardTab(savedDashboardTab)
    setCommandReviewMap({})
    setSelectedWidgetId(null)
    setViewMode('Viewing')
  }, [isDirty, savedDashboardTab])

  const handleSaveDraft = useCallback(async () => {
    setViewMode('Saving')
    try {
      await persistDashboardTab(draftDashboardTab)
      setSavedDashboardTab(draftDashboardTab)
      setMessages((prev) => [...prev, { id: `save-${Date.now()}`, role: 'ai', text: '看板草稿已保存。' }])
      setViewMode('Viewing')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages((prev) => [...prev, { id: `save-err-${Date.now()}`, role: 'ai', text: `保存失败：${message}` }])
      setViewMode('Editing')
    }
  }, [draftDashboardTab, persistDashboardTab])

  const handleDeleteWidget = useCallback((widgetId: string) => {
    let removedTitle = ''
    let removed = false
    setDraftDashboardTab((prev) => {
      const target = prev.widgets.find((item) => item.id === widgetId)
      if (!target) {
        console.warn('[dashboard][delete] target widget not found in draft', {
          widgetId,
          draftWidgetIds: prev.widgets.map((item) => item.id)
        })
        return prev
      }
      removedTitle = target.title
      removed = true
      const next = {
        ...prev,
        updatedAt: Date.now(),
        widgets: prev.widgets.filter((item) => item.id !== widgetId),
        gridLayout: prev.gridLayout.filter((item) => item.i !== widgetId)
      }
      console.info('[dashboard][delete] applied to draft', {
        widgetId,
        title: target.title,
        widgetCountBefore: prev.widgets.length,
        widgetCountAfter: next.widgets.length
      })
      return next
    })
    if (!removed) return

    setDataMap((prev) => {
      const next = { ...prev }
      delete next[widgetId]
      return next
    })
    setSelectedWidgetId((prev) => (prev === widgetId ? null : prev))
    setCommandReviewMap((prev) => {
      const next: Record<string, CommandReviewItem> = {}
      Object.entries(prev).forEach(([key, value]) => {
        if (value.widgetId !== widgetId) next[key] = value
      })
      return next
    })
    setApprovedTokenMap((prev) => {
      const next: Record<string, ApprovedProbeToken> = {}
      Object.entries(prev).forEach(([key, value]) => {
        if (!key.startsWith(`${widgetId}:`)) next[key] = value
      })
      return next
    })
    setMessages((prev) => [...prev, { id: `del-${Date.now()}`, role: 'ai', text: `已从草稿中删除组件「${removedTitle || widgetId}」。` }])
  }, [])

  const openAssistant = useCallback(() => {
    setAssistantOpen(true)
    setAssistantMinimized(false)
    if (viewMode === 'Viewing') setViewMode('Creating')
  }, [viewMode])

  const modeLabel = useMemo(() => {
    if (viewMode === 'Viewing') return '查看模式'
    if (viewMode === 'Creating') return '创建模式'
    if (viewMode === 'Saving') return '保存中'
    return '编辑模式'
  }, [viewMode])

  const modeColor = useMemo(() => {
    if (viewMode === 'Saving') return 'var(--run)'
    if (viewMode === 'Creating') return 'var(--accent)'
    if (viewMode === 'Editing') return 'var(--warn)'
    return 'var(--muted)'
  }, [viewMode])

  useEffect(() => {
    if (navigator.webdriver) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  return (
    <div data-testid="dashboard-page" style={{ height: '100%', display: 'flex', gap: 12, minHeight: 0, position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          zIndex: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 'var(--radius-pill)',
          border: `1px solid color-mix(in srgb, ${modeColor} 28%, var(--border-default))`,
          background: 'color-mix(in srgb, var(--panel) 84%, transparent)',
          color: 'var(--text-dim)',
          fontSize: 11,
          fontWeight: 600,
          backdropFilter: 'blur(8px)'
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: modeColor
          }}
        />
        {modeLabel}
        {isDirty ? ' · 有未保存更改' : ''}
      </div>
      <DashboardCanvasPanel
        mode={viewMode}
        isDirty={isDirty}
        isIntentLoading={loadingIntent}
        title={draftDashboardTab.name}
        contextLabel={selectedCommand?.name || draftDashboardTab.contextLabel}
        refreshSec={refreshSec}
        onRefreshSecChange={setRefreshSec}
        widgets={draftDashboardTab.widgets}
        gridLayout={draftDashboardTab.gridLayout}
        dataMap={dataMap}
        selectedWidgetId={selectedWidgetId || undefined}
        commandOptions={commandOptions}
        selectedCommandName={selectedCommandName}
        onSelectCommand={setSelectedCommandName}
        onOpenAssistant={openAssistant}
        onEnterCreating={handleEnterCreating}
        onEnterEditing={handleEnterEditing}
        onCancelEditing={handleCancelEditing}
        onAutoRecommend={() => {
          void applyIntent('auto')
        }}
        onSave={() => {
          void handleSaveDraft()
        }}
        onInspect={(widgetId) => {
          setSelectedWidgetId(widgetId)
        }}
        onDeleteWidget={handleDeleteWidget}
      />

      <DashboardAuditPanel
        selectedWidget={selectedWidget}
        commandReviewMap={commandReviewMap}
        approvedTokenMap={approvedTokenMap}
        approvingStepId={approvingStepId}
        onApprove={(widgetId, stepId, command) => {
          void handleApprove(widgetId, stepId, command)
        }}
      />

      {assistantOpen ? (
        <div
          role="presentation"
          onClick={() => setAssistantOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.48)',
            backdropFilter: 'blur(2px)',
            zIndex: 1200,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: 20
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="看板助手弹窗"
            className="ui-dialog-panel"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 460,
              maxWidth: '92vw',
              height: 'min(760px, calc(100vh - 40px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setAssistantOpen(false)
                  setAssistantMinimized(true)
                }}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--panel-soft)',
                  color: 'var(--text)',
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                最小化
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssistantOpen(false)
                  setAssistantMinimized(false)
                }}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--panel-soft)',
                  color: 'var(--text)',
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                关闭
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <DashboardChatPanel
                messages={messages}
                input={input}
                loading={loadingIntent}
                thinkingLines={thinkingLines}
                progressLines={intentProgressLines}
                onInputChange={setInput}
                onSubmit={() => {
                  void applyIntent('chat')
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {assistantMinimized && !assistantOpen ? (
        <button
          data-testid="dashboard-assistant-restore"
          type="button"
          onClick={() => {
            setAssistantOpen(true)
            setAssistantMinimized(false)
          }}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 1100,
            border: '1px solid var(--border-default)',
            borderRadius: 999,
            background: 'var(--panel-soft)',
            color: 'var(--text)',
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          打开看板助手
        </button>
      ) : null}

      {isDirty && viewMode !== 'Saving' ? (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 20,
            transform: 'translateX(-50%)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--panel) 86%, transparent)',
            boxShadow: 'var(--shadow-hover)',
            backdropFilter: 'blur(12px)'
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>草稿已修改，是否保存变更？</span>
          <button
            type="button"
            style={{
              border: '1px solid color-mix(in srgb, var(--accent) 36%, var(--border-default))',
              borderRadius: 'var(--radius-xs)',
              background: 'color-mix(in srgb, var(--accent) 16%, var(--panel-soft))',
              color: 'var(--text)',
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
            onClick={() => {
              void handleSaveDraft()
            }}
          >
            立即保存
          </button>
          <button
            type="button"
            style={{
              border: '1px solid color-mix(in srgb, var(--warn) 26%, var(--border-default))',
              borderRadius: 'var(--radius-xs)',
              background: 'color-mix(in srgb, var(--warn) 10%, var(--panel-soft))',
              color: 'var(--warn)',
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={handleCancelEditing}
          >
            放弃更改
          </button>
        </div>
      ) : null}
    </div>
  )
}
