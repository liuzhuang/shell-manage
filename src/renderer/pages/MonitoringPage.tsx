import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject, ReactNode } from 'react'
import { buttonStyle, inputStyle } from '../lib/uiStyles'
import type { ThemeName } from '../styles/tokens'
import {
  getMonitoringSystemSkin
} from '../styles/monitoringTuiThemes'

interface MetricSnapshot {
  cpuUsage?: number
  load1m?: number
  memoryUsage?: number
  diskUsage?: number
  diskUsedBytes?: number
  diskTotalBytes?: number
  netRxKbps?: number
  netTxKbps?: number
}

type DeviceKind = 'local-mac' | 'local-windows' | 'remote-linux' | 'unknown'
type RiskLevel = 'normal' | 'warning' | 'critical' | 'idle'

interface MonitoringDeviceRow {
  name: string
  kind: DeviceKind
  label: string
  selected: boolean
  metrics: MetricSnapshot
  risk: RiskLevel
  riskText: string
  lastSeenText: string
}

interface OverviewMetricCard {
  id: 'cpu' | 'memory' | 'disk' | 'network'
  title: string
  label: string
  value: string
  series: number[]
  tone: RiskLevel
}

interface MonitoringCommandInfo {
  name: string
  command: string
  sshKeyId?: string
}

interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  text: string
  at: number
  expandable?: boolean
}

const MONITORING_LAST_COMMAND_KEY = 'monitoring.lastCommand.v1'
const MONITORING_PINNED_COMMANDS_KEY = 'monitoring.pinnedCommands.v1'
const LOCAL_DEVICE_NAME = '本机'
const METRIC_POLL_INTERVAL_MS = 5000

/** 与指标行分离：一次抓取在终端输出中用起止标记包裹，便于从流中解析 */
const TOP_BLOCK_BEGIN = '__MON_TOP_BEGIN__'
const TOP_BLOCK_END = '__MON_TOP_END__'

export function MonitoringPage({
  commandName,
  commands,
  onSelectCommand,
  onActionError,
  onMonitoringEvent,
  theme
}: {
  commandName: string
  commands: MonitoringCommandInfo[]
  onSelectCommand: (name: string) => void
  onActionError: (message: string) => void
  onMonitoringEvent: (text: string) => void
  /** 与 TitleBar 一致：浅色 / 深色，与 TUI 风格组合为 6 套皮肤 */
  theme: ThemeName
}) {
  const metricPollTimerRef = useRef<number | null>(null)
  const actionErrorRef = useRef(onActionError)
  const monitorDispatchSeqRef = useRef(0)
  const currentCommandRef = useRef(commandName)
  const traceIdRef = useRef<string>(createTraceId())
  const previousNetSnapshotRef = useRef<{ rxBytes: number; txBytes: number; at: number } | null>(null)
  const topCapturePhaseRef = useRef<'idle' | 'capturing'>('idle')
  const topLinesAccRef = useRef<string[]>([])
  const topLoadTimeoutRef = useRef<number | null>(null)
  /** 与切换离开本页一致：窗口隐藏（最小化、挂托盘等）时不跑定时采集 */
  const pageHostVisibleRef = useRef(typeof document !== 'undefined' && !document.hidden)
  const [sessionState, setSessionState] = useState<'running' | 'idle'>('idle')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [switchNotice, setSwitchNotice] = useState('')
  const [pinnedCommandNames, setPinnedCommandNames] = useState<string[]>(() => loadPinnedCommands())
  const [showAddCommandPopover, setShowAddCommandPopover] = useState(false)
  const addCommandPopoverRef = useRef<HTMLDivElement | null>(null)
  const chatByCommandRef = useRef<Map<string, ChatMessage[]>>(new Map())
  const metricCpuCacheRef = useRef<Map<string, number>>(new Map())
  const [deviceCpuCache, setDeviceCpuCache] = useState<Record<string, number>>({})
  const prevCommandRef = useRef('')
  const chatComposingRef = useRef(false)
  const [latestMetrics, setLatestMetrics] = useState<MetricSnapshot>({})
  currentCommandRef.current = commandName
  const [cpuSeries, setCpuSeries] = useState<number[]>([])
  const [loadSeries, setLoadSeries] = useState<number[]>([])
  const [memorySeries, setMemorySeries] = useState<number[]>([])
  const [diskSeries, setDiskSeries] = useState<number[]>([])
  const [netRxSeries, setNetRxSeries] = useState<number[]>([])
  const [netTxSeries, setNetTxSeries] = useState<number[]>([])
  const [topOutputLines, setTopOutputLines] = useState<string[]>([])
  const [topLoading, setTopLoading] = useState(false)
  const [topCapturedAt, setTopCapturedAt] = useState<number | null>(null)
  const [topLastKind, setTopLastKind] = useState<'process' | 'threads' | null>(null)
  const [topSnapshotIntervalMs, setTopSnapshotIntervalMs] = useState(0)
  const [latestChunk, setLatestChunk] = useState('')
  const [lastMetricAt, setLastMetricAt] = useState<number | null>(null)
  const [lastPollError, setLastPollError] = useState('')
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [pageHostVisible, setPageHostVisible] = useState(() => typeof document !== 'undefined' && !document.hidden)
  const skin = useMemo(() => getMonitoringSystemSkin(theme), [theme])
  const inputSkin: CSSProperties = useMemo(
    () => ({
      ...inputStyle,
      background: skin.control.bg,
      border: `1px solid ${skin.control.border}`,
      color: skin.control.color
    }),
    [skin]
  )
  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    const sync = () => {
      const v = !document.hidden
      pageHostVisibleRef.current = v
      setPageHostVisible(v)
      if (v) setNowTick(Date.now())
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    if (!showAddCommandPopover) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addCommandPopoverRef.current && !addCommandPopoverRef.current.contains(target)) {
        setShowAddCommandPopover(false)
      }
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAddCommandPopover(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [showAddCommandPopover])

  const pinnedCommands = useMemo(
    () =>
      pinnedCommandNames
        .map((name) => commands.find((item) => item.name === name))
        .filter((item): item is MonitoringCommandInfo => Boolean(item)),
    [commands, pinnedCommandNames]
  )

  const availableCommandsToAdd = useMemo(
    () => commands.filter((item) => !pinnedCommandNames.includes(item.name)),
    [commands, pinnedCommandNames]
  )

  useEffect(() => {
    setPinnedCommandNames((prev) => {
      const filtered = prev.filter((name) => commands.some((item) => item.name === name))
      if (filtered.length !== prev.length) persistPinnedCommands(filtered)
      return filtered
    })
  }, [commands])

  useEffect(() => {
    persistPinnedCommands(pinnedCommandNames)
  }, [pinnedCommandNames])

  useEffect(() => {
    if (commandName === LOCAL_DEVICE_NAME) return
    const validInPinned = commandName && pinnedCommands.some((item) => item.name === commandName)
    if (validInPinned) return
    const saved = loadLastCommand()
    if (saved === LOCAL_DEVICE_NAME) {
      onSelectCommand(saved)
      return
    }
    if (saved && pinnedCommands.some((item) => item.name === saved)) {
      onSelectCommand(saved)
      return
    }
    onSelectCommand(LOCAL_DEVICE_NAME)
  }, [commandName, pinnedCommands, onSelectCommand])

  useEffect(() => {
    if (!commandName) return
    persistLastCommand(commandName)
  }, [commandName])

  useEffect(() => {
    if (!commandName || !pageHostVisible) return
    let disposed = false
    const targetCommand = commandName
    const stillCurrent = () => !disposed && currentCommandRef.current === targetCommand
    const isLocalDevice = commandName === LOCAL_DEVICE_NAME
    if (!isLocalDevice && sessionState !== 'running') return
    if (metricPollTimerRef.current) window.clearInterval(metricPollTimerRef.current)
    const dispatchSnapshot = async () => {
      try {
        if (isLocalDevice) {
          monitorDispatchSeqRef.current += 1
          onMonitoringEvent(`本机采样#${monitorDispatchSeqRef.current}`)
          const snapshot = await window.api.monitoringGetLocalSnapshot()
          if (!stillCurrent()) return
          applyMetricSnapshot(
            {
              cpuUsage: snapshot.cpuUsage,
              load1m: snapshot.load1m,
              memoryUsage: snapshot.memoryUsage,
              diskUsage: snapshot.diskUsage,
              diskUsedBytes: snapshot.diskUsedBytes,
              diskTotalBytes: snapshot.diskTotalBytes,
              netRxKbps: snapshot.netRxKbps,
              netTxKbps: snapshot.netTxKbps
            },
            snapshot.capturedAt
          )
          setLastPollError('')
          return
        }
        const metricCommand = buildLinuxMetricSnapshotCommand()
        monitorDispatchSeqRef.current += 1
        onMonitoringEvent(`监控执行#${monitorDispatchSeqRef.current}：${compactMonitoringCommand(metricCommand)}`)
        await window.api.terminalInput(targetCommand, `${metricCommand}\n`, { source: 'monitoring', traceId: traceIdRef.current })
        if (!stillCurrent()) return
        setLastPollError('')
      } catch (error) {
        if (!stillCurrent()) return
        setLastPollError(error instanceof Error ? error.message : String(error))
      }
    }
    void dispatchSnapshot()
    metricPollTimerRef.current = window.setInterval(() => {
      void dispatchSnapshot()
    }, METRIC_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      if (metricPollTimerRef.current) window.clearInterval(metricPollTimerRef.current)
      metricPollTimerRef.current = null
    }
  }, [commandName, sessionState, pageHostVisible, onMonitoringEvent])

  useEffect(() => {
    if (!pageHostVisible) return
    const timer = window.setInterval(() => {
      setNowTick(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [pageHostVisible])

  useEffect(() => {
    if (!commandName) return
    traceIdRef.current = createTraceId()
  }, [commandName])

  useEffect(() => {
    // 切换监控目标时清空上一命令的可视化状态，避免残留造成“串台”错觉。
    setSessionState('idle')
    setLatestChunk('')
    setLatestMetrics({})
    setCpuSeries([])
    setLoadSeries([])
    setMemorySeries([])
    setDiskSeries([])
    setNetRxSeries([])
    setNetTxSeries([])
    setTopOutputLines([])
    setTopLoading(false)
    setTopCapturedAt(null)
    setTopLastKind(null)
    setLastMetricAt(null)
    setLastPollError('')
    monitorDispatchSeqRef.current = 0
    previousNetSnapshotRef.current = null
    topCapturePhaseRef.current = 'idle'
    topLinesAccRef.current = []
    if (topLoadTimeoutRef.current !== null) {
      window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = null
    }
  }, [commandName])

  useEffect(() => {
    return () => {
      if (topLoadTimeoutRef.current !== null) {
        window.clearTimeout(topLoadTimeoutRef.current)
        topLoadTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (typeof latestMetrics.cpuUsage === 'number' && commandName) {
      metricCpuCacheRef.current.set(commandName, latestMetrics.cpuUsage)
      setDeviceCpuCache((prev) => ({ ...prev, [commandName]: latestMetrics.cpuUsage! }))
    }
  }, [commandName, latestMetrics.cpuUsage])

  const chatMessagesRef = useRef(chatMessages)
  chatMessagesRef.current = chatMessages

  useEffect(() => {
    if (!commandName) {
      setChatMessages([])
      return
    }
    const previous = prevCommandRef.current
    if (previous && previous !== commandName) {
      chatByCommandRef.current.set(previous, chatMessagesRef.current)
      setSwitchNotice(`已从 ${previous} 切换到 ${commandName} · 指标与 Chat 已隔离`)
    }
    prevCommandRef.current = commandName
    const restored = chatByCommandRef.current.get(commandName)
    if (restored && restored.length > 0) {
      setChatMessages(restored)
    } else {
      setChatMessages([
        {
          id: createChatId(),
          role: 'system',
          text: `已切换至 ${commandName}`,
          at: Date.now()
        }
      ])
    }
  }, [commandName])

  useEffect(() => {
    if (!commandName) return
    if (commandName === LOCAL_DEVICE_NAME) {
      setSessionState('running')
      return
    }
    let disposed = false
    void window.api
      .terminalStart(commandName, { source: 'monitoring', traceId: traceIdRef.current })
      .then((result) => {
        if (disposed) return
        setSessionState(result.state || 'running')
        onMonitoringEvent(`监控会话命令：${commandName}`)
      })
      .catch((error) => actionErrorRef.current(error instanceof Error ? error.message : String(error)))

    const offObserver = window.api.onTerminalObserver((payload) => {
      if (payload.commandName !== commandName) return
      setLatestChunk(payload.chunk)
      ingestTopSnapshotLines(payload.chunk)
      evaluateChunk(payload.chunk)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.commandName !== commandName) return
      setSessionState(payload.state)
    })

    return () => {
      disposed = true
      offObserver?.()
      offStatus?.()
    }
  }, [commandName, onMonitoringEvent])

  const metricLagSec = useMemo(() => {
    if (!lastMetricAt) return null
    return Math.floor((nowTick - lastMetricAt) / 1000)
  }, [lastMetricAt, nowTick])
  function ingestTopSnapshotLines(chunk: string): void {
    const segments = chunk.split(/\r?\n/)
    for (const raw of segments) {
      const line = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
      const trimmedEnd = line.trimEnd()

      if (topCapturePhaseRef.current === 'idle') {
        if (trimmedEnd.includes(TOP_BLOCK_BEGIN)) {
          topCapturePhaseRef.current = 'capturing'
          topLinesAccRef.current = []
          const after = trimmedEnd.split(TOP_BLOCK_BEGIN)[1] ?? ''
          const rest = after.trimStart()
          if (rest.length > 0 && !rest.includes(TOP_BLOCK_END)) topLinesAccRef.current.push(rest)
          else if (rest.includes(TOP_BLOCK_END)) {
            const body = rest.split(TOP_BLOCK_END)[0]?.trimEnd() ?? ''
            if (body.length > 0) topLinesAccRef.current.push(body)
            finalizeTopSnapshot()
          }
        }
        continue
      }

      if (trimmedEnd.includes(TOP_BLOCK_END)) {
        const before = trimmedEnd.split(TOP_BLOCK_END)[0] ?? ''
        if (before.trim().length > 0) topLinesAccRef.current.push(before.trimEnd())
        finalizeTopSnapshot()
        continue
      }

      if (trimmedEnd.startsWith('__MON_METRIC__')) continue

      topLinesAccRef.current.push(trimmedEnd)
    }
  }

  function finalizeTopSnapshot(): void {
    setTopOutputLines([...topLinesAccRef.current])
    topLinesAccRef.current = []
    topCapturePhaseRef.current = 'idle'
    setTopLoading(false)
    setTopCapturedAt(Date.now())
    if (topLoadTimeoutRef.current !== null) {
      window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = null
    }
  }

  async function runTopSnapshot(mode: 'process' | 'threads'): Promise<void> {
    if (!commandName) return
    if (commandName === LOCAL_DEVICE_NAME) {
      setTopLastKind(mode)
      setTopLoading(true)
      try {
        const snapshot = await window.api.monitoringGetLocalTopSnapshot(mode)
        setTopOutputLines(snapshot.lines)
        setTopCapturedAt(snapshot.capturedAt)
      } catch (error) {
        onActionError(error instanceof Error ? error.message : String(error))
      } finally {
        setTopLoading(false)
      }
      return
    }
    const topCmd = mode === 'threads' ? 'top -bn1 -H' : 'top -bn1'
    const cmd = `echo '${TOP_BLOCK_BEGIN}'; COLUMNS=240 LC_ALL=C ${topCmd} 2>/dev/null | head -n 40; echo '${TOP_BLOCK_END}'`
    try {
      await window.api.terminalStart(commandName, { source: 'monitoring', traceId: traceIdRef.current })
      setTopLastKind(mode)
      setTopLoading(true)
      onMonitoringEvent(`监控执行：${compactMonitoringCommand(cmd)}`)
      if (topLoadTimeoutRef.current !== null) window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = window.setTimeout(() => {
        topLoadTimeoutRef.current = null
        if (topCapturePhaseRef.current === 'capturing') {
          topCapturePhaseRef.current = 'idle'
          topLinesAccRef.current = []
          setTopLoading(false)
        }
      }, 15000)
      await window.api.terminalInput(commandName, `${cmd}\n`, { source: 'monitoring', traceId: traceIdRef.current })
    } catch (error) {
      setTopLoading(false)
      if (topLoadTimeoutRef.current !== null) {
        window.clearTimeout(topLoadTimeoutRef.current)
        topLoadTimeoutRef.current = null
      }
      onActionError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (!commandName || topSnapshotIntervalMs <= 0) return
    const timer = window.setInterval(() => {
      if (!topLoading) void runTopSnapshot('process')
    }, topSnapshotIntervalMs)
    return () => window.clearInterval(timer)
  }, [commandName, topLoading, topSnapshotIntervalMs])

  function evaluateChunk(chunk: string): void {
    const parsed = extractMetrics(chunk, previousNetSnapshotRef.current)
    const metrics = parsed.metrics
    previousNetSnapshotRef.current = parsed.nextNetSnapshot
    if (parsed.source === 'linux_metric_line') {
      setLastMetricAt(Date.now())
    }
    applyMetricSnapshot(metrics)
  }

  function applyMetricSnapshot(metrics: MetricSnapshot, capturedAt?: number): void {
    setLatestMetrics(metrics)
    if (typeof capturedAt === 'number') setLastMetricAt(capturedAt)
    if (typeof metrics.cpuUsage === 'number') setCpuSeries((prev) => [...prev, metrics.cpuUsage!].slice(-42))
    if (typeof metrics.load1m === 'number') setLoadSeries((prev) => [...prev, metrics.load1m!].slice(-42))
    if (typeof metrics.memoryUsage === 'number') setMemorySeries((prev) => [...prev, metrics.memoryUsage!].slice(-42))
    if (typeof metrics.diskUsage === 'number') setDiskSeries((prev) => [...prev, metrics.diskUsage!].slice(-42))
    if (typeof metrics.netRxKbps === 'number') setNetRxSeries((prev) => [...prev, metrics.netRxKbps!].slice(-42))
    if (typeof metrics.netTxKbps === 'number') setNetTxSeries((prev) => [...prev, metrics.netTxKbps!].slice(-42))
  }

  function pushChatMessage(message: Omit<ChatMessage, 'id'> & { id?: string }, targetCommand = commandName): void {
    if (!targetCommand) return
    const entry: ChatMessage = {
      id: message.id ?? createChatId(),
      role: message.role,
      text: message.text.trim() || '（空结果）',
      at: message.at,
      expandable: message.expandable
    }
    const base = targetCommand === currentCommandRef.current ? chatMessagesRef.current : chatByCommandRef.current.get(targetCommand) || []
    const next = [...base, entry]
    chatByCommandRef.current.set(targetCommand, next)
    if (targetCommand === currentCommandRef.current) {
      setChatMessages(() => {
        chatByCommandRef.current.set(targetCommand, next)
        chatMessagesRef.current = next
        return next
      })
    }
  }

  async function sendChatMessage(): Promise<void> {
    const targetCommand = commandName
    const text = chatInput.trim()
    if (!text || !targetCommand || chatSending || aiLoading) return
    const historySource = chatMessagesRef.current
    pushChatMessage({ role: 'user', text, at: Date.now() }, targetCommand)
    setChatInput('')
    setChatSending(true)
    try {
      const { text: bufferText } = await window.api.terminalGetBuffer(targetCommand)
      const sessionLogs = sanitizeLines(bufferText).slice(-140)
      const history = historySource
        .filter((item): item is ChatMessage & { role: 'user' | 'assistant' } => item.role === 'user' || item.role === 'assistant')
        .slice(-12)
        .map((item) => ({
          role: item.role,
          content: item.text
        }))
      const result = await window.api.queryAiChat({
        requestId: `monitoring-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input: text,
        history,
        selectedCommand: targetCommand,
        sessionLogs,
        queryOutputLines: []
      })
      pushChatMessage(
        {
          role: 'assistant',
          text: result.answer.trim() || '未提取到有效回复。',
          at: Date.now(),
          expandable: true
        },
        targetCommand
      )
    } catch (error) {
      pushChatMessage(
        {
          role: 'assistant',
          text: error instanceof Error ? error.message : String(error),
          at: Date.now()
        },
        targetCommand
      )
    } finally {
      setChatSending(false)
    }
  }
  /**
   * 完整一次分析：先 IPC `terminal:get-buffer` 拉主进程缓冲，再 IPC `query:ai-chat` 调模型。
   * 无可用行时跳过 LLM，但仍已执行缓冲拉取。
   */
  async function refreshAiInsight(): Promise<void> {
    const targetCommand = commandName
    if (!targetCommand) return
    setAiLoading(true)
    try {
      const { text } = await window.api.terminalGetBuffer(targetCommand)
      const lines = sanitizeLines(text).slice(-140)
      if (lines.length === 0) {
        pushChatMessage(
          {
            role: 'assistant',
            text: '当前监控流暂无可分析输出（已拉取缓冲区，无可送模型的内容）。',
            at: Date.now()
          },
          targetCommand
        )
        return
      }
      const result = await window.api.queryAiChat({
        requestId: `monitoring-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input:
          '你是 AI 监控助手。请结合下方会话输出，输出最多 3 条简洁结论：是否存在异常或风险、严重度、建议下一步。若需告警式提示，请明确写出「告警」或风险点。',
        history: [],
        selectedCommand: targetCommand,
        sessionLogs: lines,
        queryOutputLines: []
      })
      pushChatMessage(
        {
          role: 'assistant',
          text: result.answer.trim() || '未提取到有效洞察。',
          at: Date.now(),
          expandable: true
        },
        targetCommand
      )
    } catch {
      pushChatMessage(
        {
          role: 'assistant',
          text: buildFallbackInsight(latestChunk),
          at: Date.now(),
          expandable: true
        },
        targetCommand
      )
    } finally {
      setAiLoading(false)
    }
  }

  function addPinnedCommand(name: string): void {
    const normalized = name.trim()
    if (!normalized) return
    if (!commands.some((item) => item.name === normalized)) return
    setPinnedCommandNames((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]))
    onSelectCommand(normalized)
    setShowAddCommandPopover(false)
  }

  function removePinnedCommand(name: string): void {
    setPinnedCommandNames((prev) => {
      const next = prev.filter((item) => item !== name)
      if (commandName === name) onSelectCommand(next[0] ?? '')
      return next
    })
  }

  const localDeviceName = LOCAL_DEVICE_NAME
  const localDeviceKind: DeviceKind = useMemo(() => {
    const platform = window.api.getPlatform()
    if (platform === 'darwin') return 'local-mac'
    if (platform === 'win32') return 'local-windows'
    return 'unknown'
  }, [])
  const metricsStale = metricLagSec !== null && metricLagSec > 12
  const isInitialCollecting = Boolean(commandName && sessionState === 'running' && !lastMetricAt && !lastPollError)
  const deviceRows: MonitoringDeviceRow[] = useMemo(() => {
    const localSelected = commandName === localDeviceName
    const localMetrics = localSelected ? latestMetrics : {}
    const localRisk = riskByMetric(localMetrics, localSelected ? metricsStale : false)
    return [
      {
        name: localDeviceName,
        kind: localDeviceKind,
        label: localDeviceKind === 'local-mac' ? '本机 Mac' : localDeviceKind === 'local-windows' ? '本机 Windows' : '本机',
        selected: localSelected,
        metrics: localMetrics,
        risk: localRisk,
        riskText: riskText(localRisk),
        lastSeenText: localSelected && isInitialCollecting ? '正在采集' : localSelected ? formatLastSeen(lastMetricAt, nowTick) : '等待采样'
      },
      ...pinnedCommands.map((item) => {
        const selected = item.name === commandName
        const metrics = selected ? latestMetrics : { cpuUsage: deviceCpuCache[item.name] ?? metricCpuCacheRef.current.get(item.name) }
        const risk = riskByMetric(metrics, selected ? metricsStale : false)
        return {
          name: item.name,
          kind: 'remote-linux' as const,
          label: inferDeviceMeta(item).label,
          selected,
          metrics,
          risk,
          riskText: riskText(risk),
          lastSeenText: selected && isInitialCollecting ? '正在采集' : selected ? formatLastSeen(lastMetricAt, nowTick) : '等待采样'
        }
      })
    ]
  }, [commandName, deviceCpuCache, isInitialCollecting, lastMetricAt, latestMetrics, localDeviceKind, metricsStale, nowTick, pinnedCommands])
  const overviewCards: OverviewMetricCard[] = useMemo(
    () => [
      {
        id: 'cpu',
        title: 'CPU 使用率',
        label: `Load 1m ${fmtLoad(latestMetrics.load1m)}`,
        value: fmtPct(latestMetrics.cpuUsage),
        series: cpuSeries.length > 0 ? cpuSeries : loadSeries,
        tone: riskByMetric({ cpuUsage: latestMetrics.cpuUsage }, metricsStale)
      },
      {
        id: 'memory',
        title: 'Memory',
        label: '内存',
        value: fmtPct(latestMetrics.memoryUsage),
        series: memorySeries,
        tone: riskByMetric({ memoryUsage: latestMetrics.memoryUsage }, metricsStale)
      },
      {
        id: 'disk',
        title: 'Disk Usage',
        label:
          typeof latestMetrics.diskUsedBytes === 'number' && typeof latestMetrics.diskTotalBytes === 'number'
            ? `已用 ${fmtBytes(latestMetrics.diskUsedBytes)} / ${fmtBytes(latestMetrics.diskTotalBytes)}`
            : '根磁盘占用',
        value: fmtPct(latestMetrics.diskUsage),
        series: diskSeries,
        tone: riskByMetric({ diskUsage: latestMetrics.diskUsage }, metricsStale)
      },
      {
        id: 'network',
        title: 'Network',
        label: `Rx ${fmtKbps(latestMetrics.netRxKbps)} · Tx ${fmtKbps(latestMetrics.netTxKbps)}`,
        value: fmtKbps(latestMetrics.netRxKbps),
        series: netRxSeries.length > 0 ? netRxSeries : netTxSeries,
        tone: metricsStale ? 'warning' : 'normal'
      }
    ],
    [cpuSeries, diskSeries, latestMetrics, loadSeries, memorySeries, metricsStale, netRxSeries, netTxSeries]
  )
  const selectedDeviceRow = deviceRows.find((row) => row.selected)
  const latestAssistantMessage = [...chatMessages].reverse().find((message) => message.role === 'assistant')
  const selectedDeviceStatusText = isInitialCollecting ? '正在采集首批数据…' : sessionState === 'running' ? '采集中' : '空闲'

  return (
    <div
      data-testid="monitoring-page"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fafafa',
        color: '#171717',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        overflow: 'hidden'
      }}
    >
      <div data-testid="monitoring-workspace" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid #e5e5e5',
            background: '#fff',
            flexWrap: 'wrap'
          }}
        >
          <div ref={addCommandPopoverRef} style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid="monitoring-device-selector"
              onClick={() => setShowAddCommandPopover((prev) => !prev)}
              style={{
                minWidth: 156,
                minHeight: 40,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 18,
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid #e5e5e5',
                background: '#fff',
                color: '#171717',
                fontSize: 14,
                fontWeight: 500,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              <span>{selectedDeviceRow?.name || LOCAL_DEVICE_NAME}</span>
              <span aria-hidden style={{ color: '#737373', fontSize: 16, lineHeight: 1 }}>⌄</span>
            </button>
            {showAddCommandPopover ? (
              <div
                data-testid="monitoring-add-command-popover"
                className="ui-popover"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 'calc(100% + 8px)',
                  width: 320,
                  maxHeight: 380,
                  overflowY: 'auto',
                  borderRadius: 8,
                  border: '1px solid #e5e5e5',
                  background: '#fff',
                  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.10)',
                  padding: 8,
                  zIndex: 20
                }}
              >
                <div style={{ padding: '6px 8px 10px', borderBottom: '1px solid #eeeeee', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, color: '#171717' }}>监控设备</div>
                  <div style={{ fontSize: 11, color: '#737373', marginTop: 3 }}>本机默认启用；需要远程监控时，从已有命令中添加。</div>
                </div>
                {deviceRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    data-testid={`monitoring-device-selector-option-${row.name}`}
                    onClick={() => {
                      onSelectCommand(row.name)
                      setShowAddCommandPopover(false)
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      textAlign: 'left',
                      marginBottom: 6,
                      borderRadius: 6,
                      border: '1px solid #e5e5e5',
                      background: row.selected ? '#f5f5f5' : '#fff',
                      color: '#171717',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontFamily: 'inherit'
                    }}
                  >
                    <span>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 650 }}>{row.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#737373', marginTop: 2 }}>{row.label}</span>
                    </span>
                    <span style={{ color: row.selected ? '#171717' : '#a3a3a3', fontSize: 12 }}>{row.selected ? '已选' : row.riskText}</span>
                  </button>
                ))}
                <div style={{ padding: '10px 8px 6px', color: '#737373', fontSize: 11, borderTop: '1px solid #eeeeee', marginTop: 4 }}>添加监控设备</div>
                {commands.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#737373', padding: 8 }}>暂无可添加的监控设备。请先在命令列表添加 SSH 或长期运行的命令。</div>
                ) : availableCommandsToAdd.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#737373', padding: 8 }}>其他可选设备都已加入监控列表。</div>
                ) : (
                  availableCommandsToAdd.map((item) => {
                    const meta = inferDeviceMeta(item)
                    return (
                      <button
                        key={item.name}
                        type="button"
                        data-testid={`monitoring-add-command-option-${item.name}`}
                        onClick={() => addPinnedCommand(item.name)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          marginBottom: 6,
                          borderRadius: 6,
                          border: '1px solid #e5e5e5',
                          background: '#fafafa',
                          color: '#171717',
                          padding: '8px 10px',
                          cursor: 'pointer',
                          fontFamily: 'inherit'
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: '#737373', marginTop: 2 }}>{meta.label}</div>
                      </button>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...buttonStyle('primary'), fontSize: 12, padding: '8px 12px' }}
              onClick={() => void refreshAiInsight()}
              disabled={aiLoading || !commandName}
              data-testid="monitoring-analyze-button"
            >
              {aiLoading ? '分析中…' : '拉取并分析'}
            </button>
          </div>
        </div>

        <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, padding: 16, overflow: 'hidden' }}>
          <main style={{ minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: 16 }}>
            <div data-testid="monitoring-overview-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {overviewCards.map((card) => (
                <MonitoringMetricCard key={card.id} card={card} />
              ))}
            </div>

            <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: 10 }}>
              <div
                data-testid="monitoring-process-snapshot-panel"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#171717' }}>进程快照</div>
                  <div style={{ fontSize: 12, color: '#737373', marginTop: 3 }}>
                    {topCapturedAt ? `${topLastKind === 'threads' ? '线程' : '进程'} · ${formatTime(topCapturedAt)}` : '尚未抓取'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <select
                    aria-label="进程快照采集频率"
                    value={topSnapshotIntervalMs}
                    onChange={(event) => setTopSnapshotIntervalMs(Number(event.target.value))}
                    style={{
                      ...inputSkin,
                      width: 116,
                      height: 34,
                      padding: '0 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      background: '#fff',
                      color: '#171717'
                    }}
                  >
                    <option value={0}>手动</option>
                    <option value={60000}>每 1 分钟</option>
                    <option value={300000}>每 5 分钟</option>
                  </select>
                  <button type="button" style={snapshotButtonStyle} disabled={!commandName || topLoading} onClick={() => void runTopSnapshot('process')}>
                    {topLoading ? '抓取中…' : '抓取进程'}
                  </button>
                  <button type="button" style={snapshotButtonStyle} disabled={!commandName || topLoading} onClick={() => void runTopSnapshot('threads')}>
                    抓取线程
                  </button>
                </div>
              </div>
              <div
                data-testid="monitoring-selected-device"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedDeviceRow?.name || '未选择设备'}</div>
                  <div style={{ fontSize: 12, color: '#737373', marginTop: 3 }}>
                    {selectedDeviceRow ? `${selectedDeviceRow.label} · ${selectedDeviceRow.riskText}` : '从设备表选择监控目标'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#737373', whiteSpace: 'nowrap' }}>
                  {selectedDeviceStatusText}
                </div>
              </div>
              <DeviceHealthTable rows={deviceRows} onSelectCommand={onSelectCommand} />
            </div>
          </main>

          <AiInsightSidebar
            aiLoading={aiLoading}
            chatComposingRef={chatComposingRef}
            chatInput={chatInput}
            chatMessages={chatMessages}
            chatSending={chatSending}
            inputSkin={inputSkin}
            latestAssistantMessage={latestAssistantMessage}
            onChatInputChange={setChatInput}
            onSendChatMessage={sendChatMessage}
            selectedCommand={commandName}
            setChatComposing={(value) => {
              chatComposingRef.current = value
            }}
            switchNotice={switchNotice}
            topOutputLines={topOutputLines}
          />
        </div>
      </div>
    </div>
  )
}

function MiniLineChart({ series, tone }: { series: number[]; tone: RiskLevel }) {
  const width = 180
  const height = 42
  const values = series.length > 0 ? series.slice(-28) : [0, 0]
  const max = Math.max(...values, 1)
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width
      const y = height - (Math.max(0, value) / max) * (height - 8) - 4
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const color = tone === 'critical' ? '#dc2626' : tone === 'warning' ? '#d97706' : '#171717'

  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ width: '100%', height: 42, display: 'block' }}>
      <path d={`M0 ${height - 4}H${width}`} stroke="#e5e5e5" strokeWidth="1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MonitoringMetricCard({ card }: { card: OverviewMetricCard }) {
  return (
    <section
      data-testid={`monitoring-metric-card-${card.id}`}
      style={{
        minHeight: 142,
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 10,
        padding: 16,
        border: '1px solid #e5e5e5',
        borderRadius: 8,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#171717' }}>{card.title}</div>
          <div style={{ fontSize: 11, color: '#737373', marginTop: 4 }}>{card.label}</div>
        </div>
        <RiskPill risk={card.tone} />
      </div>
      <div style={{ alignSelf: 'end', fontSize: 30, lineHeight: 1, fontWeight: 700, letterSpacing: 0 }}>{card.value}</div>
      <MiniLineChart series={card.series} tone={card.tone} />
    </section>
  )
}

function DeviceHealthTable({ rows, onSelectCommand }: { rows: MonitoringDeviceRow[]; onSelectCommand: (name: string) => void }) {
  return (
    <div
      data-testid="monitoring-device-rail"
      style={{
        minHeight: 0,
        display: 'grid',
        overflow: 'hidden'
      }}
    >
      <div
        data-testid="monitoring-device-table"
        style={{
          minHeight: 0,
          overflow: 'auto',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
            <tr style={{ color: '#737373', textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
              <Th>设备</Th>
              <Th>CPU</Th>
              <Th>内存</Th>
              <Th>磁盘</Th>
              <Th>网络</Th>
              <Th>风险</Th>
              <Th>最近采集</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selectable = true
              return (
                <tr
                  key={row.name}
                  data-testid={`monitoring-device-row-${row.name}`}
                  tabIndex={selectable ? 0 : -1}
                  aria-disabled={!selectable}
                  onClick={() => {
                    if (selectable) onSelectCommand(row.name)
                  }}
                  onKeyDown={(event) => {
                    if (!selectable) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectCommand(row.name)
                    }
                  }}
                  style={{
                    cursor: selectable ? 'pointer' : 'default',
                    background: row.selected ? '#f5f5f5' : '#fff',
                    borderBottom: '1px solid #f0f0f0'
                  }}
                >
                  <Td>
                    <div data-testid={`monitoring-device-item-${row.name}`} style={{ fontWeight: 650, color: '#171717' }}>
                      {row.name}
                    </div>
                    <div style={{ color: '#737373', marginTop: 2 }}>{row.label}</div>
                  </Td>
                  <Td mono>{fmtPct(row.metrics.cpuUsage)}</Td>
                  <Td mono>{fmtPct(row.metrics.memoryUsage)}</Td>
                  <Td mono>{fmtPct(row.metrics.diskUsage)}</Td>
                  <Td mono>
                    Rx {fmtKbps(row.metrics.netRxKbps)}
                    <br />
                    Tx {fmtKbps(row.metrics.netTxKbps)}
                  </Td>
                  <Td>
                    <RiskPill risk={row.risk} text={row.riskText} />
                  </Td>
                  <Td>{row.lastSeenText}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AiInsightSidebar({
  aiLoading,
  chatComposingRef,
  chatInput,
  chatMessages,
  chatSending,
  inputSkin,
  latestAssistantMessage,
  onChatInputChange,
  onSendChatMessage,
  selectedCommand,
  setChatComposing,
  switchNotice,
  topOutputLines
}: {
  aiLoading: boolean
  chatComposingRef: MutableRefObject<boolean>
  chatInput: string
  chatMessages: ChatMessage[]
  chatSending: boolean
  inputSkin: CSSProperties
  latestAssistantMessage?: ChatMessage
  onChatInputChange: (value: string) => void
  onSendChatMessage: () => Promise<void>
  selectedCommand: string
  setChatComposing: (value: boolean) => void
  switchNotice: string
  topOutputLines: string[]
}) {
  return (
    <aside
      data-testid="monitoring-ai-sidebar"
      style={{
        minWidth: 0,
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto',
        border: '1px solid #e5e5e5',
        borderRadius: 8,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden'
      }}
    >
      <div style={{ minHeight: 0, overflowY: 'auto', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>
        <SidebarSection title="AI 总结">
          {latestAssistantMessage ? (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, color: '#171717' }}>
              <div style={{ color: '#737373', fontSize: 11, marginBottom: 6 }}>{formatInsightCollectedAt(latestAssistantMessage.at)}</div>
              {latestAssistantMessage.text}
            </div>
          ) : (
            <EmptyText>{selectedCommand ? '还没有 AI 结论。点击「拉取并分析」开始。' : '选择设备后可生成监控总结。'}</EmptyText>
          )}
          {aiLoading ? <EmptyText>AI 正在分析中…</EmptyText> : null}
        </SidebarSection>

        <SidebarSection title="对话记录">
          <div data-testid="monitoring-chat-timeline" style={{ display: 'grid', gap: 8 }}>
            {chatMessages.map((message) => (
              <div
                key={message.id}
                style={{
                  padding: '8px 10px',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  background: message.role === 'user' ? '#fafafa' : '#fff',
                  color: '#171717',
                  fontSize: 12,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap'
                }}
              >
                <div style={{ marginBottom: 4, color: '#737373', fontSize: 11 }}>
                  {message.role === 'user' ? '你' : message.role === 'assistant' ? 'AI' : '系统'} · {formatTime(message.at)}
                </div>
                {message.text}
              </div>
            ))}
            {chatMessages.length === 0 ? <EmptyText>暂无对话记录。</EmptyText> : null}
          </div>
        </SidebarSection>

        <SidebarSection title="Top 进程">
          {topOutputLines.length > 0 ? (
            <pre style={topPreStyle}>{topOutputLines.slice(0, 8).join('\n')}</pre>
          ) : (
            <EmptyText>暂无 top 快照。</EmptyText>
          )}
        </SidebarSection>

        {switchNotice ? (
          <div
            data-testid="monitoring-switch-notice"
            style={{
              padding: '9px 10px',
              borderRadius: 8,
              border: '1px solid #d4d4d4',
              background: '#fafafa',
              fontSize: 12,
              color: '#404040'
            }}
          >
            {switchNotice}
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: '1px solid #e5e5e5', padding: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
        <textarea
          data-testid="monitoring-chat-input"
          value={chatInput}
          onChange={(e) => onChatInputChange(e.target.value)}
          onCompositionStart={() => setChatComposing(true)}
          onCompositionEnd={() => setChatComposing(false)}
          placeholder="询问这台设备的状态"
          disabled={!selectedCommand || chatSending || aiLoading}
          rows={2}
          style={{
            ...inputSkin,
            width: '100%',
            minHeight: 44,
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.45,
            background: '#fff',
            color: '#171717',
            border: '1px solid #e5e5e5'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              const native = e.nativeEvent as KeyboardEvent
              const isImeComposing =
                chatComposingRef.current || native.isComposing || (native as unknown as { keyCode?: number }).keyCode === 229
              if (isImeComposing) return
              e.preventDefault()
              void onSendChatMessage()
            }
          }}
        />
        <button
          type="button"
          data-testid="monitoring-chat-send"
          style={sidebarButtonStyle}
          disabled={!selectedCommand || chatSending || aiLoading || !chatInput.trim()}
          onClick={() => void onSendChatMessage()}
        >
          发送
        </button>
      </div>
    </aside>
  )
}

function SidebarSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#171717' }}>{title}</h3>
      {children}
    </section>
  )
}

function EmptyText({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: '#737373', lineHeight: 1.6 }}>{children}</div>
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th>
}

function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td style={{ padding: '12px', verticalAlign: 'top', color: '#404040', fontFamily: mono ? 'var(--font-mono)' : undefined, whiteSpace: 'nowrap' }}>
      {children}
    </td>
  )
}

function RiskPill({ risk, text }: { risk: RiskLevel; text?: string }) {
  const styles: Record<RiskLevel, { bg: string; border: string; color: string }> = {
    normal: { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
    warning: { bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
    critical: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
    idle: { bg: '#fafafa', border: '#e5e5e5', color: '#737373' }
  }
  const style = styles[risk]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.color,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap'
      }}
    >
      {text ?? riskText(risk)}
    </span>
  )
}

const topPreStyle: CSSProperties = {
  margin: 0,
  maxHeight: 132,
  overflow: 'auto',
  border: '1px solid #e5e5e5',
  borderRadius: 6,
  background: '#fafafa',
  padding: 10,
  color: '#171717',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
}

const snapshotButtonStyle: CSSProperties = {
  ...buttonStyle('muted'),
  height: 34,
  padding: '0 12px',
  border: '1px solid #e5e5e5',
  borderRadius: 6,
  background: '#fff',
  color: '#171717',
  fontSize: 12,
  fontWeight: 600
}

const sidebarButtonStyle: CSSProperties = {
  ...buttonStyle('muted'),
  padding: '8px 12px',
  border: '1px solid #e5e5e5',
  borderRadius: 6,
  background: '#fff',
  color: '#171717',
  fontSize: 12
}

function inferDeviceMeta(command: MonitoringCommandInfo): { label: string; icon: string } {
  const isRemote = Boolean(command.sshKeyId) || /\bssh\b/i.test(command.command)
  return isRemote ? { label: '远程服务器（SSH）', icon: '🌐' } : { label: '本地命令', icon: '💻' }
}

function createChatId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extractMetrics(
  chunk: string,
  previousNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
): {
  source: 'linux_metric_line' | 'regex_fallback'
  metrics: MetricSnapshot
  nextNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
} {
  const metricLine = chunk
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())
    .find((line) => line.startsWith('__MON_METRIC__'))
  if (metricLine) {
    const parsed = parseLinuxMetricLine(metricLine, previousNetSnapshot)
    const text = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    let metrics = parsed.metrics
    if (typeof metrics.cpuUsage !== 'number') {
      const cpuFallback = matchPct(
        text,
        [/cpu[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)\s*%/i, /(\d{1,3}(?:\.\d+)?)\s*%\s*id/i],
        (value, raw) => (/%\s*id/i.test(raw) ? Math.max(0, 100 - value) : value)
      )
      if (typeof cpuFallback === 'number') metrics = { ...metrics, cpuUsage: cpuFallback }
    }
    return { source: 'linux_metric_line', metrics, nextNetSnapshot: parsed.nextNetSnapshot }
  }

  const text = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  const cpuUsage = matchPct(text, [/cpu[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)\s*%/i, /(\d{1,3}(?:\.\d+)?)\s*%\s*id/i], (value, raw) =>
    /%\s*id/i.test(raw) ? Math.max(0, 100 - value) : value
  )
  const load1m = matchNum(text, [/load average[:\s]+(\d+(?:\.\d+)?)/i, /load[:\s]+(\d+(?:\.\d+)?)/i])
  const memoryUsage = matchPct(text, [/mem(?:ory)?[^0-9]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i, /ram[^0-9]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i])
  const diskUsage = matchPct(text, [/(\d{1,3})%\s+\/[a-z0-9/_-]+/i])
  const netRxKbps = matchKbps(text, [/rx[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i, /receive[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i])
  const netTxKbps = matchKbps(text, [/tx[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i, /send[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i])
  return {
    source: 'regex_fallback',
    metrics: { cpuUsage, load1m, memoryUsage, diskUsage, netRxKbps, netTxKbps },
    nextNetSnapshot: previousNetSnapshot
  }
}

function matchPct(text: string, patterns: RegExp[], transform?: (value: number, raw: string) => number): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1]) {
      const value = Number(hit[1])
      if (Number.isFinite(value)) {
        const next = transform ? transform(value, hit[0]) : value
        return Math.max(0, Math.min(100, next))
      }
    }
  }
  return undefined
}

function matchNum(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1]) {
      const value = Number(hit[1])
      if (Number.isFinite(value)) return value
    }
  }
  return undefined
}

function matchKbps(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1] && hit?.[2]) {
      const value = Number(hit[1])
      const unit = hit[2].toLowerCase()
      if (!Number.isFinite(value)) continue
      if (unit === 'kb/s') return value
      if (unit === 'mb/s') return value * 1024
      if (unit === 'gb/s') return value * 1024 * 1024
    }
  }
  return undefined
}

function parseLinuxMetricLine(
  line: string,
  previousNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
): {
  metrics: MetricSnapshot
  nextNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
} {
  const cpuUsage = parseKeyNumber(line, 'cpu')
  const load1m = parseKeyNumber(line, 'load')
  const memoryUsage = parseKeyNumber(line, 'mem')
  const diskUsage = parseKeyNumber(line, 'disk')
  const netRaw = parseKeyString(line, 'net')
  let netRxKbps: number | undefined
  let netTxKbps: number | undefined
  let nextNetSnapshot = previousNetSnapshot
  if (netRaw && netRaw.includes(',')) {
    const [rxText, txText] = netRaw.split(',')
    const rxBytes = Number(rxText)
    const txBytes = Number(txText)
    const now = Date.now()
    if (Number.isFinite(rxBytes) && Number.isFinite(txBytes)) {
      if (previousNetSnapshot && now > previousNetSnapshot.at) {
        const elapsedSec = (now - previousNetSnapshot.at) / 1000
        if (elapsedSec > 0.3) {
          netRxKbps = Math.max(0, (rxBytes - previousNetSnapshot.rxBytes) / 1024 / elapsedSec)
          netTxKbps = Math.max(0, (txBytes - previousNetSnapshot.txBytes) / 1024 / elapsedSec)
        }
      }
      nextNetSnapshot = { rxBytes, txBytes, at: now }
    }
  }
  return {
    metrics: { cpuUsage, load1m, memoryUsage, diskUsage, netRxKbps, netTxKbps },
    nextNetSnapshot
  }
}

function parseKeyNumber(line: string, key: string): number | undefined {
  const hit = line.match(new RegExp(`${key}=([0-9]+(?:\\.[0-9]+)?)`, 'i'))
  if (!hit?.[1]) return undefined
  const value = Number(hit[1])
  return Number.isFinite(value) ? value : undefined
}

function parseKeyString(line: string, key: string): string | undefined {
  const hit = line.match(new RegExp(`${key}=([^\\s]+)`, 'i'))
  return hit?.[1]
}

function sanitizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trimEnd())
    .filter((line) => line.length > 0)
}

function buildFallbackInsight(chunk: string): string {
  const text = chunk.toLowerCase()
  const rows: string[] = []
  if (/error|exception|fatal/.test(text)) rows.push('- 发现错误关键词，建议查看最近错误栈。')
  if (/timeout|connection reset/.test(text)) rows.push('- 发现超时/连接异常，建议检查网络与下游服务。')
  if (/oom|out of memory/.test(text)) rows.push('- 发现潜在内存压力，建议检查内存占用与限额。')
  if (rows.length === 0) rows.push('- 未发现高风险关键词，建议继续观察。')
  return rows.slice(0, 3).join('\n')
}

function fmtPct(value?: number): string {
  return typeof value === 'number' ? `${value.toFixed(0)}%` : '--'
}

function fmtLoad(value?: number): string {
  return typeof value === 'number' ? value.toFixed(2) : '--'
}

function fmtKbps(value?: number): string {
  if (typeof value !== 'number') return '--'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} GB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(2)} MB/s`
  return `${value.toFixed(0)} KB/s`
}

function fmtBytes(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = value
  let unitIndex = 0
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 || next >= 10 ? 0 : 1
  return `${next.toFixed(precision)} ${units[unitIndex]}`
}

function riskByMetric(metrics: MetricSnapshot, stale = false): RiskLevel {
  const hasCoreMetric =
    typeof metrics.cpuUsage === 'number' ||
    typeof metrics.memoryUsage === 'number' ||
    typeof metrics.diskUsage === 'number'
  if (!hasCoreMetric) return 'idle'
  if (
    (typeof metrics.cpuUsage === 'number' && metrics.cpuUsage >= 90) ||
    (typeof metrics.memoryUsage === 'number' && metrics.memoryUsage >= 90) ||
    (typeof metrics.diskUsage === 'number' && metrics.diskUsage >= 92)
  ) {
    return 'critical'
  }
  if (stale) return 'warning'
  if (
    (typeof metrics.cpuUsage === 'number' && metrics.cpuUsage >= 75) ||
    (typeof metrics.memoryUsage === 'number' && metrics.memoryUsage >= 80) ||
    (typeof metrics.diskUsage === 'number' && metrics.diskUsage >= 85)
  ) {
    return 'warning'
  }
  return 'normal'
}

function riskText(level: RiskLevel): string {
  if (level === 'critical') return '异常'
  if (level === 'warning') return '需关注'
  if (level === 'idle') return '未采集'
  return '正常'
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString()
}

function formatLastSeen(at: number | null, now: number): string {
  if (!at) return '等待采样'
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 5) return '刚刚'
  if (seconds < 60) return `${seconds}s 前`
  return `${Math.floor(seconds / 60)}m 前`
}

/** AI 分析完成时刻，用于列表极小号时间戳 */
function formatInsightCollectedAt(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return String(at)
  }
}

function persistLastCommand(commandName: string): void {
  try {
    window.localStorage.setItem(MONITORING_LAST_COMMAND_KEY, commandName)
  } catch {
    // ignore storage failures
  }
}

function loadPinnedCommands(): string[] {
  try {
    const raw = window.localStorage.getItem(MONITORING_PINNED_COMMANDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function persistPinnedCommands(names: string[]): void {
  try {
    window.localStorage.setItem(MONITORING_PINNED_COMMANDS_KEY, JSON.stringify(names))
  } catch {
    // ignore storage failures
  }
}

function loadLastCommand(): string {
  try {
    return window.localStorage.getItem(MONITORING_LAST_COMMAND_KEY) || ''
  } catch {
    return ''
  }
}

function createTraceId(): string {
  return `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function buildLinuxMetricSnapshotCommand(): string {
  // procps-ng top 空闲字段为「96.5 id」，非「%id」
  return `echo "__MON_METRIC__ cpu=$(c=$(LC_ALL=C top -bn1 2>/dev/null | awk -F',' '/Cpu\\(s\\)|%Cpu/{for(i=1;i<=NF;i++){if($i~/[0-9.]+[ \t]+id/){gsub(/[^0-9.]/,"",$i);if(length($i)){printf "%.2f",100-$i;exit}}}}'); [ -z "$c" ] && c=$(awk '/^cpu /{t=0;for(i=2;i<=NF;i++)t+=$i;printf "%.2f",(t-$5)*100/t}' /proc/stat); printf '%s' "$c") load=$(awk '{print $1}' /proc/loadavg) mem=$(free | awk '/Mem:/{printf "%.2f",$3/$2*100}') disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}') net=$(cat /proc/net/dev | awk -F'[: ]+' 'NR>2{rx+=$3;tx+=$11} END{printf "%d,%d",rx,tx}')"`
}

function compactMonitoringCommand(command: string): string {
  const normalized = command.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 86) return normalized
  return `${normalized.slice(0, 86)}...`
}
