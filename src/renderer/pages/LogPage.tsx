import { useEffect, useMemo, useRef, useState } from 'react'
import { getProcessStateLabel, type RuntimeStatus } from '../lib/view-models'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'
import type { ProcessInspectorItem } from '../../shared/types'

export function LogPage({
  selectedCommand,
  status,
  lines,
  webUrl,
  onClearLogs,
  onBack,
  onOpenInBrowser,
  onActionError,
  onActionSuccess,
  onTrackAction
}: {
  selectedCommand: string
  status?: RuntimeStatus
  lines: string[]
  webUrl?: string
  onClearLogs: (commandName: string) => void
  onBack: () => void
  onOpenInBrowser?: (url: string) => void
  onActionError: (message: string) => void
  onActionSuccess: (message: string) => void
  onTrackAction: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const LOG_LOCK_BOTTOM_KEY = 'log.lockBottom'
  const [isKillingPort, setIsKillingPort] = useState(false)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [inspectorPort, setInspectorPort] = useState('')
  const [inspectorKeyword, setInspectorKeyword] = useState(selectedCommand)
  const [isInspectingPort, setIsInspectingPort] = useState(false)
  const [isInspectingKeyword, setIsInspectingKeyword] = useState(false)
  const [killingPidList, setKillingPidList] = useState<number[]>([])
  const [inspectorError, setInspectorError] = useState('')
  const [inspectedPort, setInspectedPort] = useState<number | undefined>(undefined)
  const [portProcesses, setPortProcesses] = useState<ProcessInspectorItem[]>([])
  const [inspectedKeyword, setInspectedKeyword] = useState('')
  const [keywordProcesses, setKeywordProcesses] = useState<ProcessInspectorItem[]>([])
  const [lockToBottom, setLockToBottom] = useState<boolean>(() => window.localStorage.getItem(LOG_LOCK_BOTTOM_KEY) !== '0')
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const conflictPort = useMemo(() => extractConflictPortFromLogs(lines), [lines])

  useEffect(() => {
    window.localStorage.setItem(LOG_LOCK_BOTTOM_KEY, lockToBottom ? '1' : '0')
  }, [lockToBottom])

  useEffect(() => {
    if (!lockToBottom) return
    if (!logContainerRef.current) return
    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
  }, [lines, lockToBottom])

  useEffect(() => {
    setInspectorKeyword(selectedCommand)
  }, [selectedCommand])

  const renderedLines = useMemo(
    () =>
      lines.map((line) => {
        const level = getLineLevel(line)
        return {
          text: line,
          color:
            level === 'error'
              ? 'var(--err)'
              : level === 'warn'
                ? 'var(--warn)'
                : level === 'info'
                  ? 'var(--text-dim)'
                  : 'var(--text-dim)'
        }
      }),
    [lines]
  )

  const inspectPortProcess = async (port: number) => {
    if (typeof window.api.inspectPortProcess !== 'function') {
      throw new Error('当前运行实例缺少 inspectPortProcess 接口。请重启应用（或重启 npm run dev）后重试。')
    }
    return window.api.inspectPortProcess(port)
  }

  const inspectProcessByKeyword = async (keyword: string) => {
    if (typeof window.api.inspectProcessByKeyword !== 'function') {
      throw new Error('当前运行实例缺少 inspectProcessByKeyword 接口。请重启应用（或重启 npm run dev）后重试。')
    }
    return window.api.inspectProcessByKeyword(keyword)
  }

  const refreshInspectorResults = async () => {
    const port = Number.parseInt(inspectorPort.trim(), 10)
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      try {
        const portResult = await inspectPortProcess(port)
        setInspectedPort(portResult.port)
        setPortProcesses(portResult.processes)
      } catch {
        // ignore refresh errors to avoid interrupting manual actions
      }
    }
    const keyword = inspectorKeyword.trim()
    if (keyword) {
      try {
        const keywordResult = await inspectProcessByKeyword(keyword)
        setInspectedKeyword(keywordResult.keyword)
        setKeywordProcesses(keywordResult.processes)
      } catch {
        // ignore refresh errors to avoid interrupting manual actions
      }
    }
  }

  const killProcessFromInspector = async (item: ProcessInspectorItem) => {
    const targetPid = item.rootPid || item.pid
    setKillingPidList((prev) => (prev.includes(targetPid) ? prev : [...prev, targetPid]))
    try {
      const result = await window.api.killProcessByPid(item.pid)
      onActionSuccess(
        `已清理进程：请求 PID ${result.requestedPid}，实际终止主进程 ${result.rootPid}${result.killedPids.length > 1 ? `（含 ${result.killedPids.length} 个目标）` : ''}`
      )
      await refreshInspectorResults()
    } catch (error) {
      onActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setKillingPidList((prev) => prev.filter((pid) => pid !== targetPid))
    }
  }

  return (
    <div
      data-testid="log-page"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Panel
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            flexShrink: 0
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                data-testid="log-back-icon"
                onClick={onBack}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.96)'
                  onTrackAction('log.back_home', 'click', 'success')
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1.06)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, var(--panel))'
                  e.currentTarget.style.color = 'var(--accent)'
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.18)'
                  e.currentTarget.style.transform = 'scale(1.06)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-default)'
                  e.currentTarget.style.background = 'var(--panel-soft)'
                  e.currentTarget.style.color = 'var(--text-dim)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
                title="返回上一级"
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 28,
                  width: 48,
                  height: 48,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--panel-soft)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 22,
                  lineHeight: 1,
                  flexShrink: 0,
                  transition:
                    'transform 150ms ease, border-color 150ms ease, background-color 150ms ease, color 150ms ease, box-shadow 150ms ease'
                }}
              >
                ←
              </button>
              <span style={{ color: 'var(--text-dim)' }}>首页总览</span>
              <span style={{ margin: '0 2px', color: 'var(--border-strong)' }}>/</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>运行日志</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedCommand || '未选择运行目标'}</div>
            <div data-testid="log-status" style={{ color: 'var(--muted)', fontSize: 12 }}>
              状态：{getProcessStateLabel(status?.state)} {status?.pid ? `· 进程 ID: ${status.pid}` : ''}
            </div>
            {webUrl && (
              <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>
                Web: {webUrl}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ fontSize: 11, color: conflictPort ? 'var(--warn)' : 'var(--muted)' }} data-testid="log-conflict-port-hint">
              {conflictPort ? `已识别冲突端口 :${conflictPort}` : `未识别到端口，回退按名称检索：${selectedCommand || '当前命令'}`}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  data-testid="log-open-web-builtin"
                  aria-label="内置打开"
                  title={webUrl ? '在内置浏览器打开' : '未检测到网站地址'}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    minWidth: 32,
                    minHeight: 32,
                    height: 32,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: webUrl ? 'var(--accent)' : 'var(--muted)',
                    cursor: webUrl ? 'pointer' : 'not-allowed',
                    opacity: webUrl ? 1 : 0.55
                  }}
                  onClick={() => {
                    onTrackAction('log.open_web_builtin', 'click', webUrl ? 'success' : 'fail')
                    if (!webUrl) {
                      onActionError('未检测到该命令的 Web 地址。请在配置文件中定义 webUrl 或等待日志输出链接。')
                      return
                    }
                    onOpenInBrowser?.(webUrl)
                  }}
                >
                  <BuiltinBrowserIcon size={22} />
                </button>
                <button
                  data-testid="log-open-web"
                  aria-label="用 Chrome 打开"
                  title={webUrl ? '用 Chrome 打开' : '未检测到网站地址'}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    minWidth: 32,
                    minHeight: 32,
                    height: 32,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: webUrl ? 'var(--text-dim)' : 'var(--muted)',
                    cursor: webUrl ? 'pointer' : 'not-allowed',
                    opacity: webUrl ? 1 : 0.55
                  }}
                  onClick={async () => {
                    onTrackAction('log.open_web', 'click', webUrl ? 'success' : 'fail')
                    if (!webUrl) {
                      onActionError('未检测到该命令的 Web 地址。请在配置文件中定义 webUrl 或等待日志输出链接。')
                      return
                    }
                    try {
                      await window.api.openExternal(webUrl)
                    } catch (error) {
                      onActionError(error instanceof Error ? error.message : String(error))
                    }
                  }}
                >
                  <BrowserIcon size={24} />
                </button>
              <button
                data-testid="log-stop"
                style={buttonStyle('muted')}
                onClick={async () => {
                  if (!selectedCommand) return
                  try {
                    onTrackAction('log.stop', 'click', 'success')
                    await window.api.processStop(selectedCommand)
                  } catch (error) {
                    onActionError(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                停止运行
              </button>
              <button
                data-testid="log-restart"
                style={buttonStyle('warn')}
                onClick={async () => {
                  if (!selectedCommand) return
                  try {
                    onTrackAction('log.restart', 'click', 'success')
                    await window.api.processRestart(selectedCommand)
                  } catch (error) {
                    onActionError(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                重新启动
              </button>
              <button
                data-testid="log-kill-port"
                style={buttonStyle(isKillingPort || !selectedCommand ? 'muted' : 'warn')}
                disabled={isKillingPort || !selectedCommand}
                onClick={async () => {
                  if (isKillingPort) return
                  setIsKillingPort(true)
                  try {
                    onTrackAction('log.kill_port', 'click', 'success')
                    if (conflictPort) {
                      const result = await window.api.killPortProcess(conflictPort)
                      onActionSuccess(
                        `已清理端口 :${result.port}，处理主进程 ${result.pids.length} 个${result.pids.length ? `（${result.pids.join(', ')}）` : ''}`
                      )
                    } else {
                      const result = await window.api.killPortProcessByKeyword(selectedCommand)
                      onActionSuccess(
                        `已按名称清理：匹配进程 ${result.processPids.length} 个，关联端口 ${result.ports.length} 个，最终处理主进程 ${result.killedPids.length} 个`
                      )
                    }
                  } catch (error) {
                    onActionError(error instanceof Error ? error.message : String(error))
                  } finally {
                    setIsKillingPort(false)
                  }
                }}
              >
                {isKillingPort
                  ? conflictPort
                    ? `正在清理 :${conflictPort}...`
                    : '正在按名称清理端口...'
                  : conflictPort
                    ? `清理 :${conflictPort} 端口`
                    : '按名称清理冲突端口'}
              </button>
              <button
                data-testid="log-inspector"
                style={buttonStyle(conflictPort ? 'warn' : 'muted')}
                onClick={() => {
                  onTrackAction('log.inspector.open', 'click', 'success')
                  if (conflictPort) setInspectorPort(String(conflictPort))
                  if (!inspectorKeyword.trim()) setInspectorKeyword(selectedCommand || '')
                  setIsInspectorOpen(true)
                  setInspectorError('')
                }}
              >
                端口排查工具
              </button>
              <button
                data-testid="log-clear"
                disabled={!selectedCommand}
                style={{
                  ...buttonStyle('outline'),
                  ...(!selectedCommand ? { opacity: 0.5, cursor: 'not-allowed' as const } : {})
                }}
                onClick={() => {
                  if (!selectedCommand) return
                  if (!lines.length) {
                    onActionError('当前没有可清空的日志内容')
                    return
                  }
                  onTrackAction('log.clear', 'click', 'success')
                  onClearLogs(selectedCommand)
                }}
              >
                清空日志
              </button>
              </div>
              <label
                htmlFor="log-lock-bottom-checkbox"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', userSelect: 'none' }}
              >
                <input
                  id="log-lock-bottom-checkbox"
                  data-testid="log-lock-bottom"
                  type="checkbox"
                  checked={lockToBottom}
                  onChange={(event) => setLockToBottom(event.target.checked)}
                  onClick={() => onTrackAction('log.lock_bottom.toggle', 'click', 'success')}
                />
                锁定底部
              </label>
            </div>
          </div>
        </div>
        <Panel
          soft
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div
            data-testid="log-lines"
            ref={logContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              whiteSpace: 'pre'
            }}
          >
            {renderedLines.length ? (
              renderedLines.map((line, idx) => (
                <div key={`${idx}-${line.text.slice(0, 8)}`} style={{ color: line.color }}>
                  {line.text}
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--muted)' }}>当前没有任何日志输出</div>
            )}
          </div>
        </Panel>
      </Panel>
      {isInspectorOpen && (
        <div
          role="presentation"
          onClick={() => setIsInspectorOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.62)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1300
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="端口冲突排查工具"
            data-testid="log-inspector-modal"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 860,
              maxWidth: '94vw',
              maxHeight: '88vh',
              overflow: 'auto',
              background: 'var(--panel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-strong)',
              padding: 18,
              boxShadow: 'var(--shadow-hover)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>端口冲突排查工具</div>
              <button type="button" style={buttonStyle('muted')} onClick={() => setIsInspectorOpen(false)}>
                关闭
              </button>
            </div>

            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: 12,
                background: 'var(--panel-soft)',
                fontSize: 12,
                lineHeight: 1.7,
                color: 'var(--muted)'
              }}
            >
              <div>
                <strong style={{ color: 'var(--text)' }}>PID</strong>（Process ID）是操作系统分配给每个进程的唯一编号。
              </div>
              <div>
                <strong style={{ color: 'var(--text)' }}>端口</strong> 是服务对外监听的网络入口，例如 `3000`、`8080`。
              </div>
              <div>
                <strong style={{ color: 'var(--text)' }}>PID 与端口关系</strong>：一个 PID 可以监听多个端口；一个端口在同一时刻通常只会被一个监听进程占用。
              </div>
              <div>
                <strong style={{ color: 'var(--text)' }}>Node / Next.js 多进程场景</strong>：`next dev` 常见为“主进程 + 子进程”模型，`ps` 看到的是启动命令进程，`lsof` 看到的是实际监听端口的子进程，PID 不一致通常是正常现象。
              </div>
              <div>处理冲突时优先关注“建议清理主进程”，避免只结束监听子进程后被父进程再次拉起。</div>
              <div>建议先按端口定位冲突进程，再结合命令与工作目录（cwd）确认该进程来自哪个项目路径。</div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 12,
                alignItems: 'start'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>按端口探测进程</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    data-testid="log-inspector-port-input"
                    value={inspectorPort}
                    onChange={(event) => setInspectorPort(event.target.value)}
                    placeholder="输入端口，如 3000"
                    style={{
                      flex: 1,
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      padding: '8px 10px',
                      fontSize: 12
                    }}
                  />
                  <button
                    type="button"
                    style={buttonStyle(isInspectingPort ? 'muted' : 'primary')}
                    disabled={isInspectingPort}
                    onClick={async () => {
                      const port = Number.parseInt(inspectorPort.trim(), 10)
                      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
                        setInspectorError('请输入合法端口号（1-65535）')
                        return
                      }
                      setInspectorError('')
                      setIsInspectingPort(true)
                      try {
                        const result = await inspectPortProcess(port)
                        setInspectedPort(result.port)
                        setPortProcesses(result.processes)
                      } catch (error) {
                        setInspectorError(error instanceof Error ? error.message : String(error))
                      } finally {
                        setIsInspectingPort(false)
                      }
                    }}
                  >
                    {isInspectingPort ? '探测中...' : '探测端口'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>按名称模糊匹配进程</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    data-testid="log-inspector-keyword-input"
                    value={inspectorKeyword}
                    onChange={(event) => setInspectorKeyword(event.target.value)}
                    placeholder="输入关键字，如 web / node / 项目名"
                    style={{
                      flex: 1,
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      padding: '8px 10px',
                      fontSize: 12
                    }}
                  />
                  <button
                    type="button"
                    style={buttonStyle(isInspectingKeyword ? 'muted' : 'primary')}
                    disabled={isInspectingKeyword}
                    onClick={async () => {
                      const keyword = inspectorKeyword.trim()
                      if (!keyword) {
                        setInspectorError('请输入进程名关键字')
                        return
                      }
                      setInspectorError('')
                      setIsInspectingKeyword(true)
                      try {
                        const result = await inspectProcessByKeyword(keyword)
                        setInspectedKeyword(result.keyword)
                        setKeywordProcesses(result.processes)
                      } catch (error) {
                        setInspectorError(error instanceof Error ? error.message : String(error))
                      } finally {
                        setIsInspectingKeyword(false)
                      }
                    }}
                  >
                    {isInspectingKeyword ? '匹配中...' : '模糊匹配'}
                  </button>
                </div>
              </div>
            </div>

            {inspectorError ? <div style={{ color: 'var(--err)', fontSize: 12 }}>{inspectorError}</div> : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 12,
                alignItems: 'start'
              }}
            >
              <InspectorResultPanel
                title={inspectedPort ? `端口 ${inspectedPort} 占用进程` : '端口占用结果'}
                emptyText="还没有端口探测结果"
                processes={portProcesses}
                killingPidList={killingPidList}
                onKillProcess={killProcessFromInspector}
              />
              <InspectorResultPanel
                title={inspectedKeyword ? `关键字“${inspectedKeyword}”匹配进程` : '名称匹配结果'}
                emptyText="还没有名称匹配结果"
                processes={keywordProcesses}
                killingPidList={killingPidList}
                onKillProcess={killProcessFromInspector}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 常见多色分瓣 + 中心蓝点（原创简化几何，非官方精修，表示「用浏览器打开」） */
function BuiltinBrowserIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <circle cx="7" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

function BrowserIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path fill="#EA4335" d="M12 12L12 3A9 9 0 0 1 19.79 16.5z" />
      <path fill="#FBBC04" d="M12 12L19.79 16.5A9 9 0 0 1 4.21 16.5z" />
      <path fill="#34A853" d="M12 12L4.21 16.5A9 9 0 0 1 12 3z" />
      <circle cx="12" cy="12" r="3.4" fill="#4285F4" />
      <circle cx="12" cy="12" r="1.1" fill="#fff" />
    </svg>
  )
}

function InspectorResultPanel({
  title,
  emptyText,
  processes,
  killingPidList,
  onKillProcess
}: {
  title: string
  emptyText: string
  processes: ProcessInspectorItem[]
  killingPidList: number[]
  onKillProcess: (item: ProcessInspectorItem) => Promise<void>
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        padding: 12,
        minHeight: 240,
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {processes.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, width: '100%' }}>
          {processes.map((item) => (
            <div
              key={item.pid}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--panel-soft)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 12,
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box'
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
                <span style={{ color: 'var(--text)' }}>
                  PID: <strong>{item.pid}</strong>
                </span>
                <span style={{ color: 'var(--text-dim)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>名称: {item.name}</span>
                <button
                  type="button"
                  style={buttonStyle('danger')}
                  disabled={killingPidList.includes(item.rootPid || item.pid)}
                  onClick={() => {
                    void onKillProcess(item)
                  }}
                >
                  {killingPidList.includes(item.rootPid || item.pid) ? 'KILL 中...' : `KILL ${item.rootPid || item.pid}`}
                </button>
              </div>
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  minWidth: 0,
                  maxWidth: '100%',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word'
                }}
              >
                命令: {item.command}
              </div>
              <div
                style={{
                  color: 'var(--text-dim)',
                  minWidth: 0,
                  maxWidth: '100%',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  lineHeight: 1.5
                }}
              >
                路径: {item.cwd || '未知（进程可能已退出或无权限）'}
              </div>
              <div style={{ color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>
                父进程: {item.parentPid ? `${item.parentPid}${item.parentName ? ` (${item.parentName})` : ''}` : '未知'}
              </div>
              <div
                style={{
                  color: item.rootPid && item.rootPid !== item.pid ? 'var(--warn)' : 'var(--text-dim)',
                  overflowWrap: 'anywhere'
                }}
              >
                建议清理主进程: {item.rootPid ? `${item.rootPid}${item.rootName ? ` (${item.rootName})` : ''}` : String(item.pid)}
              </div>
              <div style={{ color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>
                监听端口: {item.listeningPorts.length ? item.listeningPorts.join(', ') : '无 LISTEN 端口'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getLineLevel(line: string): 'info' | 'warn' | 'error' | 'other' {
  const upper = line.toUpperCase()
  if (upper.includes('ERROR') || upper.includes('ERR') || line.includes('错误') || line.includes('异常')) return 'error' // 错误 (Error) / 异常 (Exception)
  if (upper.includes('WARN') || upper.includes('WARNING') || line.includes('告警') || line.includes('警告')) return 'warn' // 警告 (Warning) / 告警 (Warn)
  if (upper.includes('INFO') || line.includes('信息')) return 'info' // 信息 (Info)
  return 'other'
}

function extractConflictPortFromLogs(lines: string[]): number | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const upper = line.toUpperCase()
    if (!upper.includes('EADDRINUSE') && !upper.includes('ADDRESS ALREADY IN USE') && !line.includes('端口被占用')) continue
    const extracted = extractPortFromLine(line)
    if (extracted) return extracted
  }
  return undefined
}

function extractPortFromLine(line: string): number | undefined {
  const patterns = [/:::(\d{2,5})\b/, /\[::\]:(\d{2,5})\b/, /:\s*(\d{2,5})\b/, /\bport\s+(\d{2,5})\b/i, /端口\s*(\d{2,5})/]
  for (const pattern of patterns) {
    const matched = line.match(pattern)
    if (!matched) continue
    const port = Number.parseInt(matched[1], 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) return port
  }
  return undefined
}
