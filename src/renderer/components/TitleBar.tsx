import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Panel } from './Panel'
import { ThemeToggleE } from './ThemeToggleE'
import {
  BrowserIllustrationIcon,
  CollaborationIllustrationIcon,
  CommandIllustrationIcon,
  KeyIllustrationIcon,
  LogsIllustrationIcon,
  MonitoringIllustrationIcon,
  SettingsIllustrationIcon
} from './Sidebar'
import { chipStyle } from '../lib/uiStyles'
import type { AppPage } from '../hooks/useNavigation'
import type { ThemeName, ThemePresetId } from '../styles/tokens'
import type { AppUpdateBroadcastPayload, TerminalInstanceSummary } from '../../shared/types'

const TITLE_BAR_HEIGHT = 46

const THEME_PRESET_OPTIONS: Array<{ id: ThemePresetId; label: string; desc: string }> = [
  { id: 'coder', label: '程序员', desc: '默认高对比，偏蓝冷色' },
  { id: 'system', label: '夏日', desc: '明快暖色，轻盈平衡' },
  { id: 'girl', label: '女生', desc: '偏粉柔和，观感轻巧' }
]

function sessionKindLabel(kind: string): string {
  switch (kind) {
    case 'terminal-pane':
      return '终端页 · 独立会话'
    case 'monitoring':
      return 'AI 监控 · 默认会话槽'
    case 'default':
      return '默认会话槽（AI 日志等）'
    default:
      return `来源：${kind}`
  }
}

function pageMeta(page: AppPage): {
  label: string
  Icon: (props: { size: number; variant?: 'default' | 'titlebar' }) => ReactElement
} {
  if (page === 'home' || page === 'log' || page === 'terminal') return { label: '命令', Icon: CommandIllustrationIcon }
  if (page === 'multiLog' || page === 'query') return { label: page === 'multiLog' ? '日志看板' : '日志', Icon: LogsIllustrationIcon }
  if (page === 'dashboard' || page === 'monitoring') return { label: page === 'dashboard' ? '可视化看板' : '监控', Icon: MonitoringIllustrationIcon }
  if (page === 'browser') return { label: '浏览器', Icon: BrowserIllustrationIcon }
  if (page === 'ssh-keys') return { label: '密钥', Icon: KeyIllustrationIcon }
  if (page === 'collaboration') return { label: '协作', Icon: CollaborationIllustrationIcon }
  return { label: '设置', Icon: SettingsIllustrationIcon }
}

export function TitleBar({
  page,
  onChange,
  theme,
  themePreset,
  onToggleTheme,
  onSelectThemePreset,
  runningOverview,
  terminalInstanceCount,
  updateUi,
  onCheckUpdate,
  onDownloadUpdate,
  onQuitAndInstall
}: {
  page: AppPage
  onChange: (page: AppPage) => void
  theme: ThemeName
  themePreset: ThemePresetId
  onToggleTheme: () => void
  onSelectThemePreset: (preset: ThemePresetId) => void
  runningOverview: {
    runningCount: number
    totalCount: number
    names: string[]
  }
  terminalInstanceCount: number
  updateUi?: AppUpdateBroadcastPayload | null
  onCheckUpdate?: () => void
  onDownloadUpdate?: () => void
  onQuitAndInstall?: () => void
}) {
  const dragRegionStyle = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
  const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties
  const currentPage = pageMeta(page)
  const presetLabel = themePreset === 'coder' ? '程序员' : themePreset === 'girl' ? '女生' : '夏日'
  const [showThemePresetPopup, setShowThemePresetPopup] = useState(false)
  const themePresetPopupRef = useRef<HTMLDivElement | null>(null)
  const [showShellInstancesOverlay, setShowShellInstancesOverlay] = useState(false)
  const [shellInstances, setShellInstances] = useState<TerminalInstanceSummary[]>([])

  useEffect(() => {
    if (!showShellInstancesOverlay) return
    void window.api
      .terminalListInstances()
      .then((r) => setShellInstances(r.instances))
      .catch(() => setShellInstances([]))
  }, [showShellInstancesOverlay, terminalInstanceCount])

  useEffect(() => {
    if (!showShellInstancesOverlay) return
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowShellInstancesOverlay(false)
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [showShellInstancesOverlay])

  useEffect(() => {
    if (!showThemePresetPopup) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (themePresetPopupRef.current && !themePresetPopupRef.current.contains(target)) {
        setShowThemePresetPopup(false)
      }
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowThemePresetPopup(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [showThemePresetPopup])
  type UpdateChip = { text: string; action: 'install' | 'retry' | 'download' | null }
  const updateChip: UpdateChip | null =
    updateUi == null
      ? null
      : updateUi.phase === 'checking'
        ? { text: '正在检查更新…', action: null }
        : updateUi.phase === 'available'
          ? { text: `发现新版本 ${updateUi.version}`, action: 'download' }
          : updateUi.phase === 'downloading'
            ? { text: `正在下载更新 ${Math.round(updateUi.percent)}%`, action: null }
            : updateUi.phase === 'downloaded'
              ? { text: `新版本 ${updateUi.version} 已就绪`, action: 'install' }
              : updateUi.phase === 'error'
                ? {
                    text: `更新失败：${updateUi.message.slice(0, 48)}${updateUi.message.length > 48 ? '…' : ''}`,
                    action: 'retry'
                  }
                : null

  return (
    <Panel
      style={{
        padding: 0,
        paddingRight: 14,
        borderRadius: 0,
        minHeight: TITLE_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        ...dragRegionStyle
      }}
    >
      <div
        data-testid="titlebar-page-illustration"
        style={{
          width: TITLE_BAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'stretch',
          margin: 0,
          padding: 0,
          lineHeight: 0,
          overflow: 'hidden',
          ...noDragRegionStyle
        }}
      >
        <currentPage.Icon size={TITLE_BAR_HEIGHT} variant="titlebar" />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 0 10px 10px'
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{currentPage.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, ...noDragRegionStyle }}>
          {updateChip && (
            <div
              data-testid="update-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 11,
                color: 'var(--text)',
                background:
                  updateChip.action === 'install'
                    ? 'color-mix(in srgb, var(--ok) 10%, var(--panel-soft))'
                    : updateChip.action === 'retry'
                      ? 'color-mix(in srgb, var(--warn) 10%, var(--panel-soft))'
                      : 'var(--panel-soft)',
                fontWeight: 600,
                maxWidth: 360
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{updateChip.text}</span>
              {updateChip.action === 'install' && onQuitAndInstall && (
                <button
                  type="button"
                  data-testid="update-restart-install"
                  style={{ ...chipStyle(true), borderRadius: 'var(--radius-xs)', padding: '2px 8px', flexShrink: 0 }}
                  onClick={onQuitAndInstall}
                >
                  重启并安装
                </button>
              )}
              {updateChip.action === 'retry' && onCheckUpdate && (
                <button
                  type="button"
                  style={{ ...chipStyle(true), borderRadius: 'var(--radius-xs)', padding: '2px 8px', flexShrink: 0 }}
                  onClick={onCheckUpdate}
                >
                  重试
                </button>
              )}
              {updateChip.action === 'download' && onDownloadUpdate && (
                <button
                  type="button"
                  data-testid="update-download-now"
                  style={{ ...chipStyle(true), borderRadius: 'var(--radius-xs)', padding: '2px 8px', flexShrink: 0 }}
                  onClick={onDownloadUpdate}
                >
                  立即下载
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            data-testid="top-terminal-instance-overview"
            title="查看当前 Shell 实例与命令"
            onClick={() => setShowShellInstancesOverlay((open) => !open)}
            style={{
              display: 'none',
              padding: '6px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 11,
              color: 'var(--text-dim)',
              background: 'var(--panel-soft)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition:
                'border-color var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
            }}
          >
            Shell实例 {terminalInstanceCount}
          </button>
          {showShellInstancesOverlay && (
            <div
              data-testid="shell-instances-overlay-backdrop"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 300,
                background: 'rgba(0, 0, 0, 0.42)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start',
                paddingTop: 52,
                paddingLeft: 16,
                paddingRight: 16,
                paddingBottom: 24
              }}
              onClick={() => setShowShellInstancesOverlay(false)}
              role="presentation"
            >
              <div
                data-testid="shell-instances-overlay-panel"
                className="ui-dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Shell 实例列表"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(560px, 100%)',
                  maxHeight: 'min(72vh, 640px)',
                  overflow: 'auto',
                  padding: 14,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--panel)',
                  boxShadow: 'var(--shadow-hover)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                    gap: 12
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Shell 实例</span>
                  <button
                    type="button"
                    data-testid="shell-instances-overlay-close"
                    style={{
                      ...chipStyle(false),
                      borderRadius: 'var(--radius-xs)',
                      padding: '4px 10px',
                      flexShrink: 0
                    }}
                    onClick={() => setShowShellInstancesOverlay(false)}
                  >
                    关闭
                  </button>
                </div>
                {shellInstances.length >= 2 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginBottom: 12,
                      lineHeight: 1.5,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'color-mix(in srgb, var(--accent) 6%, var(--panel-soft))',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    {
                      '同一命令可能出现多条：「终端」里每个分屏会单独起一条 PTY；「AI 监控」开启时还会占用该命令的默认会话槽（无会话 id），用于执行监控与探测，与终端页会话相互独立。'
                    }
                  </div>
                )}
                {shellInstances.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                    当前没有活跃的 Shell 实例（交互式终端会话）。
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {shellInstances.map((item, idx) => (
                      <li
                        key={`${item.commandName}-${item.sessionId ?? 'default'}-${item.pid ?? idx}`}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--panel-soft)'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 8,
                            marginBottom: 6
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.commandName}</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                            {item.pid != null ? `PID ${item.pid}` : ''}
                            {item.sessionId ? `${item.pid != null ? ' · ' : ''}会话 ${item.sessionId}` : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 6 }}>
                          {sessionKindLabel(item.sessionKind)}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            color: 'var(--muted)',
                            lineHeight: 1.45,
                            wordBreak: 'break-all',
                            whiteSpace: 'pre-wrap'
                          }}
                        >
                          {item.command || '（未配置 command）'}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <div
            data-testid="top-running-overview"
            style={{
              display: 'none',
              padding: '6px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 11,
              color: 'var(--text-dim)',
              background: 'color-mix(in srgb, var(--panel-soft) 74%, transparent)',
              fontWeight: 500
            }}
          >
            运行中任务 {runningOverview.runningCount}/{runningOverview.totalCount}
          </div>
          <ThemeToggleE theme={theme} onToggle={onToggleTheme} />
          <div ref={themePresetPopupRef} style={{ position: 'relative', display: 'none' }}>
            <button
              data-testid="theme-preset-toggle"
              style={{ ...chipStyle(false), borderRadius: 'var(--radius-xs)', padding: '4px 10px' }}
              onClick={() => setShowThemePresetPopup((prev) => !prev)}
              title="点击选择主题模板"
            >
              主题模板：{presetLabel}
            </button>
            {showThemePresetPopup && (
              <div
                data-testid="theme-preset-popup"
                className="ui-popover"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  minWidth: 220,
                  padding: 8,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--panel)',
                  boxShadow: 'var(--shadow-hover)',
                  zIndex: 100
                }}
              >
                {THEME_PRESET_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`theme-preset-option-${item.id}`}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      borderRadius: 'var(--radius-xs)',
                      border: `1px solid ${themePreset === item.id ? 'var(--accent)' : 'var(--border-subtle)'}`,
                      background: themePreset === item.id ? 'color-mix(in srgb, var(--accent) 12%, var(--panel))' : 'var(--panel-soft)',
                      color: 'var(--text)',
                      padding: '8px 10px',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      onSelectThemePreset(item.id)
                      setShowThemePresetPopup(false)
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}
