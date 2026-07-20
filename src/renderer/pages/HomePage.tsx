import { useEffect, useRef, useState } from 'react'
import type { AppConfig, LogViewPreset } from '../../shared/types'
import { type RuntimeStatus } from '../lib/view-models'
import { buttonStyle, chipStyle, inputStyle } from '../lib/uiStyles'
import type { CommandCreateStep } from '../components/CommandFormModal'
import { Panel } from '../components/Panel'
import { LogDashboardPresetsPanel } from '../components/LogDashboardPresetsPanel'
import { TerminalIcon } from '../components/icons/TerminalIcon'
import { ServiceIcon } from '../components/icons/ServiceIcon'
import { PlayIcon } from '../components/icons/PlayIcon'
import { StopIcon } from '../components/icons/StopIcon'
import { ListIcon } from '../components/icons/ListIcon'
import { XIcon } from '../components/icons/XIcon'

export function HomePage(props: {
  config: AppConfig
  statusMap: Record<string, RuntimeStatus>
  terminalStatusMap: Record<string, 'running' | 'idle'>
  tags: string[]
  activeTag: string
  keyword: string
  filteredCommands: AppConfig['commands']
  colorByState: (state: RuntimeStatus['state']) => string
  onTagChange: (tag: string) => void
  onKeywordChange: (text: string) => void
  onOpenLog: (commandName: string) => void
  onOpenTerminal: (commandName: string) => void
  /** 同步当前命令（便于用户稍后自行打开日志/终端页时已是正确选中项） */
  onMarkActiveCommand: (commandName: string) => void
  onOpenContextMenu: (payload: { x: number; y: number; commandName: string; preferNative?: boolean }) => void
  onActionError: (message: string) => void
  onBeginImportDirectory: (entry: 'pick' | 'shortcut') => Promise<void>
  onBeginDemoImport: (entry: 'pick' | 'shortcut') => void
  importDetecting: boolean
  onOpenAddLogDashboard: () => void
  onOpenCommandFormForCreate: (step?: CommandCreateStep) => void
  showDemoHint: boolean
  onDismissDemoHint: () => void
  onReorderCommands: (draggedCommandName: string, targetCommandName: string) => Promise<void>
  onReorderTags: (draggedTag: string, targetTag: string) => Promise<void>
  logViewPresets: LogViewPreset[]
  onOpenPreset: (name: string) => void
  onRenamePreset: (oldName: string, nextName: string) => void
  onDeletePreset: (name: string) => void
  onTrackAction: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
  onAfterCommandRun?: () => void
}) {
  const {
    config,
    statusMap,
    terminalStatusMap,
    tags,
    activeTag,
    keyword,
    filteredCommands,
    onTagChange,
    onKeywordChange,
    onOpenLog,
    onOpenTerminal,
    onMarkActiveCommand,
    onOpenContextMenu,
    onActionError,
    onBeginImportDirectory,
    onBeginDemoImport,
    importDetecting,
    onOpenAddLogDashboard,
    onOpenCommandFormForCreate,
    showDemoHint,
    onDismissDemoHint,
    onReorderCommands,
    onReorderTags,
    logViewPresets,
    onOpenPreset,
    onRenamePreset,
    onDeletePreset,
    onTrackAction,
    onAfterCommandRun
  } = props
  const [draggingTag, setDraggingTag] = useState<string | null>(null)
  const [draggingCommandName, setDraggingCommandName] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!createMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) {
        setCreateMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCreateMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [createMenuOpen])

  return (
    <div data-testid="home-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Panel style={{ padding: '14px 16px' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div
            className="home-search-field"
            style={{
              position: 'relative',
              display: 'none',
              alignItems: 'center',
              width: '100%',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              background: 'color-mix(in srgb, var(--panel-soft) 65%, transparent)',
              opacity: 0.9
            }}
          >
              <input
                data-testid="home-search"
                className="home-search-input"
                style={{
                  ...inputStyle,
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: 'transparent',
                  padding: '7px 32px 7px 10px',
                  width: '100%',
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  boxShadow: 'none',
                  transition:
                    'color var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard)'
                }}
                placeholder="搜索命令或标签..."
                value={keyword}
                onChange={(e) => {
                  onTrackAction('home.search.input', 'change', 'success')
                  onKeywordChange(e.target.value)
                }}
              />
              {keyword && (
                <button
                  aria-label="清空搜索词"
                  onClick={() => {
                    onTrackAction('home.search.clear', 'click', 'success')
                    onKeywordChange('')
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                  borderRadius: 'var(--radius-pill)',
                  transition: 'background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <XIcon size={14} />
                </button>
              )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                minHeight: 40
              }}
            >
            {tags.map((tag) => (
              <button 
                data-testid={`tag-${tag}`} 
                key={tag} 
                draggable={tag !== '全部'}
                style={{
                  ...chipStyle(activeTag === tag),
                  borderRadius: 'var(--radius-xs)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 36,
                  padding: '7px 14px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap'
                }} 
                onClick={() => onTagChange(tag)}
                onDragStart={(event) => {
                  if (tag === '全部') return
                  event.dataTransfer.setData('text/shell-manage-tag', tag)
                  event.dataTransfer.effectAllowed = 'move'
                  setDraggingTag(tag)
                }}
                onDragOver={(event) => {
                  if (tag === '全部') return
                  event.preventDefault()
                }}
                onDrop={async (event) => {
                  if (tag === '全部') return
                  event.preventDefault()
                  const dragged = event.dataTransfer.getData('text/shell-manage-tag') || draggingTag
                  if (!dragged || dragged === tag) return
                  try {
                    await onReorderTags(dragged, tag)
                  } catch (error) {
                    onActionError(error instanceof Error ? error.message : String(error))
                  }
                  setDraggingTag(null)
                }}
                onDragEnd={() => setDraggingTag(null)}
              >
                {tag}
              </button>
            ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, justifySelf: 'end', marginTop: 2 }}>
            <div ref={createMenuRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
              <div
                style={{
                  display: 'inline-flex',
                  borderRadius: 'var(--radius-xs)',
                  overflow: 'hidden',
                  border: '1px solid color-mix(in srgb, var(--text) 35%, transparent)',
                  boxShadow: '0 1px 0 color-mix(in srgb, var(--text) 18%, transparent)'
                }}
              >
                <button
                  data-testid="command-create-trigger"
                  style={{
                    ...buttonStyle('primary'),
                    borderRadius: 0,
                    border: 'none',
                    borderRight: '1px solid color-mix(in srgb, var(--panel) 28%, transparent)',
                    padding: '4px 12px',
                    whiteSpace: 'nowrap',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setCreateMenuOpen(false)
                    onOpenCommandFormForCreate('pick')
                  }}
                  onMouseDown={() => onTrackAction('home.command.create.trigger', 'click', 'success')}
                >
                  ＋ 添加命令
                </button>
                <button
                  type="button"
                  data-testid="command-create-menu-trigger"
                  aria-label="更多添加方式"
                  aria-expanded={createMenuOpen}
                  style={{
                    ...buttonStyle('primary'),
                    borderRadius: 0,
                    border: 'none',
                    padding: '4px 8px',
                    minWidth: 28,
                    fontWeight: 600
                  }}
                  onClick={() => setCreateMenuOpen((open) => !open)}
                >
                  ▾
                </button>
              </div>
              {createMenuOpen ? (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    zIndex: 20,
                    minWidth: 168,
                    padding: 4,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--panel)',
                    boxShadow: 'var(--shadow-hover)'
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="command-create-menu-manual"
                    style={{
                      ...buttonStyle('muted'),
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)'
                    }}
                    onClick={() => {
                      setCreateMenuOpen(false)
                      onOpenCommandFormForCreate('manual')
                    }}
                  >
                    手动填写命令
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="command-create-menu-ai"
                    style={{
                      ...buttonStyle('muted'),
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)'
                    }}
                    onClick={() => {
                      setCreateMenuOpen(false)
                      onTrackAction('home.ai_prompt_guide.trigger', 'click', 'success')
                      onOpenCommandFormForCreate('ai')
                    }}
                  >
                    AI 添加命令
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="command-create-menu-import"
                    style={{
                      ...buttonStyle('muted'),
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)'
                    }}
                    onClick={() => {
                      setCreateMenuOpen(false)
                      void onBeginImportDirectory('shortcut')
                    }}
                    disabled={importDetecting}
                  >
                    {importDetecting ? '识别中…' : '导入目录'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="command-create-menu-demo"
                    style={{
                      ...buttonStyle('muted'),
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)'
                    }}
                    onClick={() => {
                      setCreateMenuOpen(false)
                      onBeginDemoImport('shortcut')
                    }}
                  >
                    导入演示命令
                  </button>
                </div>
              ) : null}
            </div>
            </div>
          </div>
          {showDemoHint && (
            <div
              data-testid="demo-hint"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-default))',
                background: 'color-mix(in srgb, var(--accent) 10%, var(--panel-soft))'
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                新手建议：先点 <strong style={{ color: 'var(--text)' }}>添加命令 → 导入演示命令</strong>
                ，即可体验后台任务、交互终端和日志分析全流程。
              </div>
              <button
                data-testid="demo-hint-dismiss"
                style={{ ...buttonStyle('muted'), padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                onClick={onDismissDemoHint}
              >
                知道了
              </button>
            </div>
          )}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        {filteredCommands.map((cmd, index) => {
          const mode = cmd.mode || 'service'
          const status = statusMap[cmd.name]
          const state = mode === 'terminal' ? (terminalStatusMap[cmd.name] || 'idle') : (status?.state ?? 'idle')
          const isRunning = state === 'running' || state === 'restarting'
          const isError = state === 'error'
          const canOpenServiceLog = mode === 'service' && (isRunning || isError)
          const runtimeHint =
            mode === 'terminal'
              ? isRunning ? '正在运行' : ''
              : status?.message

          const modeIcon = mode === 'terminal' ? <TerminalIcon size={15} /> : <ServiceIcon size={15} />
          const primaryIcon =
            mode === 'terminal'
              ? isRunning
                ? <ListIcon size={13} />
                : <PlayIcon size={13} />
              : canOpenServiceLog
                ? <ListIcon size={13} />
                : <PlayIcon size={13} />
          const primaryLabel =
            mode === 'terminal'
              ? (isRunning ? '继续会话' : '打开窗口')
              : canOpenServiceLog
                ? '查看日志'
                : '启动'
          const statusLabel = isRunning ? (state === 'restarting' ? '正在重启' : '正在运行') : isError ? '运行异常' : '未启动'
          const hasMeta =
            Boolean(status?.pid) ||
            (typeof status?.exitCode === 'number' && !isRunning) ||
            (typeof status?.restarts === 'number' && status.restarts > 0)
          return (
            <Panel 
              key={cmd.name} 
              soft 
              className="panel-card"
              style={{ 
                ['--card-index' as string]: String(index),
                padding: '16px 18px 14px',
                display: 'flex', 
                flexDirection: 'column', 
                gap: 10,
                height: 124,
                background: isRunning
                  ? 'color-mix(in srgb, var(--accent-soft) 55%, var(--panel) 45%)'
                  : 'var(--panel)',
                borderRadius: 8,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition:
                  'transform var(--motion-normal) var(--ease-out-strong), box-shadow var(--motion-slow) var(--ease-out-strong), border-color var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard)',
                border: isRunning
                  ? '1px solid color-mix(in srgb, var(--accent) 46%, var(--border-default))'
                  : '1px solid var(--border-subtle)',
                cursor: 'pointer'
              }}
              data-card-index={index}
            >
              <div
                data-testid={`command-row-${cmd.name}`}
                draggable
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateRows: '36px 22px 22px',
                  gap: 7,
                  minHeight: 0
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onOpenContextMenu({ x: event.clientX, y: event.clientY, commandName: cmd.name, preferNative: true })
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/shell-manage-command', cmd.name)
                  event.dataTransfer.effectAllowed = 'move'
                  setDraggingCommandName(cmd.name)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={async (event) => {
                  event.preventDefault()
                  const dragged = event.dataTransfer.getData('text/shell-manage-command') || draggingCommandName
                  if (!dragged || dragged === cmd.name) return
                  try {
                    await onReorderCommands(dragged, cmd.name)
                  } catch (error) {
                    onActionError(error instanceof Error ? error.message : String(error))
                  }
                  setDraggingCommandName(null)
                }}
                onDragEnd={() => setDraggingCommandName(null)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto auto', gap: 8, alignItems: 'start', minHeight: 0 }}>
                  <span
                    title={mode === 'terminal' ? '命令交互窗口' : '后台服务模式'}
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 16,
                      height: 28,
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-dim)',
                      boxShadow: 'none',
                      opacity: 0.82
                    }}
                  >
                    {modeIcon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 15, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cmd.name}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        color: 'var(--muted)',
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        visibility: runtimeHint ? 'visible' : 'hidden'
                      }}
                    >
                      {runtimeHint || 'placeholder'}
                    </div>
                  </div>
                  {isRunning || isError ? (
                    <StatusRing
                      state={state}
                      label={statusLabel}
                    />
                  ) : null}
                  <button
                    className="command-card-more"
                    data-testid={`command-more-${cmd.name}`}
                    aria-label={`${cmd.name} 更多操作`}
                    style={{
                      ...buttonStyle('muted'),
                      width: 30,
                      height: 30,
                      padding: 0,
                      gridColumn: 4,
                      border: 'none',
                      borderRadius: 'var(--radius-xs)',
                      background: 'transparent',
                      color: 'var(--text)',
                      fontSize: 18,
                      lineHeight: 1,
                      boxShadow: 'none'
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onTrackAction('home.command.more', 'click', 'success')
                      const rect = event.currentTarget.getBoundingClientRect()
                      onOpenContextMenu({
                        x: Math.round(rect.right),
                        y: Math.round(rect.bottom + 4),
                        commandName: cmd.name,
                        preferNative: false
                      })
                    }}
                  >
                    ...
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, height: 22, alignItems: 'center', overflow: 'hidden' }}>
                  {hasMeta ? (
                    <>
                    {status?.pid ? (
                      <MetaPill label="PID" value={String(status.pid)} />
                    ) : null}
                    {typeof status?.exitCode === 'number' && !isRunning ? (
                      <MetaPill label="状态码" value={String(status.exitCode)} tone={status.exitCode === 0 ? 'normal' : 'err'} />
                    ) : null}
                    {typeof status?.restarts === 'number' && status.restarts > 0 ? (
                      <MetaPill label="已重试" value={`${status.restarts}次`} tone="warn" />
                    ) : null}
                    </>
                  ) : null}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 64px', alignItems: 'center', gap: 12, height: 22 }}>
                  <button
                    className="command-card-action"
                    data-testid={`command-run-${cmd.name}`}
                    style={{ 
                      ...buttonStyle('outline'),
                      ['--press-scale' as string]: '0.964',
                      padding: '2px 8px 2px 0',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text)',
                      fontWeight: 650,
                      boxShadow: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: 8,
                      width: 'fit-content'
                    }}
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        onTrackAction('home.command.run', 'click', 'success')
                        if (mode === 'terminal') {
                          if (isRunning) {
                            onOpenTerminal(cmd.name)
                            return
                          }
                          onMarkActiveCommand(cmd.name)
                          onOpenTerminal(cmd.name)
                          onAfterCommandRun?.()
                          return
                        }
                        if (canOpenServiceLog) {
                          onOpenLog(cmd.name)
                          return
                        }
                        await window.api.processStart(cmd.name)
                        onMarkActiveCommand(cmd.name)
                        onAfterCommandRun?.()
                      } catch (error) {
                        onActionError(error instanceof Error ? error.message : String(error))
                      }
                    }}
                  >
                    <span style={{ display: 'grid', placeItems: 'center', width: 16, flex: '0 0 16px' }}>
                      {primaryIcon}
                    </span>
                    {primaryLabel}
                  </button>
                  {isRunning ? (
                    <button
                      className="command-card-stop"
                      data-testid={`command-stop-${cmd.name}`}
                      style={{
                        ...buttonStyle('muted'),
                        ['--press-scale' as string]: '0.97',
                        padding: '2px 6px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-dim)',
                        boxShadow: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 600
                      }}
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          onTrackAction('home.command.stop', 'click', 'success')
                          if (mode === 'terminal') await window.api.terminalStopAllForCommand(cmd.name)
                          else await window.api.processStop(cmd.name)
                        } catch (error) {
                          onActionError(error instanceof Error ? error.message : String(error))
                        }
                      }}
                    >
                      <StopIcon size={13} />
                      停止
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'right' }}>{statusLabel}</div>
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      <LogDashboardPresetsPanel
        logViewPresets={logViewPresets}
        onOpenPreset={onOpenPreset}
        onRenamePreset={onRenamePreset}
        onDeletePreset={onDeletePreset}
        onAddPreset={() => {
          onTrackAction('home.batch_logs.add_trigger', 'click', 'success')
          onOpenAddLogDashboard()
        }}
      />

    </div>
  )
}

function StatusRing({
  state,
  label,
  testId
}: {
  state: RuntimeStatus['state'] | 'idle'
  label: string
  testId?: string
}) {
  const isError = state === 'error'
  const glyph = isError ? '!' : state === 'idle' ? '✓' : '⌁'
  const ringColor = isError ? 'var(--err)' : state === 'idle' ? 'var(--text-dim)' : 'var(--accent)'
  return (
    <span
      title={label}
      aria-label={label}
      data-testid={testId}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 36,
        height: 36,
        borderRadius: 999,
        border: `3px solid color-mix(in srgb, ${ringColor} ${isError ? 18 : 12}%, var(--border-subtle))`,
        background: 'var(--panel)',
        color: ringColor,
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 1
      }}
    >
      {glyph}
    </span>
  )
}

function MetaPill({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' | 'err' }) {
  const toneColorMap = {
    normal: 'var(--muted)',
    warn: 'var(--warn)',
    err: 'var(--err)'
  }
  const toneBgMap = {
    normal: 'var(--panel-soft)',
    warn: 'color-mix(in srgb, var(--warn) 12%, transparent)',
    err: 'color-mix(in srgb, var(--err) 12%, transparent)'
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        border: `1px solid color-mix(in srgb, ${toneColorMap[tone]} 20%, transparent)`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 10,
        background: toneBgMap[tone],
        color: toneColorMap[tone],
        fontWeight: 500
      }}
    >
      <span style={{ opacity: 0.8 }}>{label}</span>
      <strong style={{ fontSize: 10, color: 'var(--text)', opacity: 0.9 }}>{value}</strong>
    </span>
  )
}
