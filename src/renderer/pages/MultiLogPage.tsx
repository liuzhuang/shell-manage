import { useEffect, useMemo, useRef } from 'react'
import type { RuntimeStatus } from '../lib/view-models'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'
import { getProcessStateLabel } from '../lib/view-models'

export function MultiLogPage({
  commandNames,
  statusMap,
  logMap,
  onBack,
  onRemoveCommand,
  onOpenCommandLog
}: {
  commandNames: string[]
  statusMap: Record<string, RuntimeStatus>
  logMap: Record<string, string[]>
  onBack: () => void
  onRemoveCommand: (name: string) => void
  onOpenCommandLog: (name: string) => void
}) {
  if (commandNames.length === 0) {
    return (
      <div data-testid="multi-log-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>没有选中的命令日志</div>
        <button type="button" style={buttonStyle('muted')} onClick={onBack}>
          返回首页
        </button>
      </div>
    )
  }

  const columns = commandNames.length <= 2 ? commandNames.length : commandNames.length <= 4 ? 2 : 3

  return (
    <div data-testid="multi-log-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button
          data-testid="multi-log-back"
          onClick={onBack}
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 14,
            width: 24,
            height: 24,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--panel-soft)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 14,
            lineHeight: 1
          }}
        >
          ←
        </button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>日志看板</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>（{commandNames.length} 个命令）</span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 10,
          overflow: 'auto'
        }}
      >
        {commandNames.map((name) => (
          <LogPane
            key={name}
            commandName={name}
            status={statusMap[name]}
            lines={(logMap[name] || []).slice(-300)}
            onRemove={() => onRemoveCommand(name)}
            onOpenDetail={() => onOpenCommandLog(name)}
          />
        ))}
      </div>
    </div>
  )
}

function LogPane({
  commandName,
  status,
  lines,
  onRemove,
  onOpenDetail
}: {
  commandName: string
  status?: RuntimeStatus
  lines: string[]
  onRemove: () => void
  onOpenDetail: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [lines])

  const stateLabel = getProcessStateLabel(status?.state)
  const stateColor =
    status?.state === 'running' || status?.state === 'restarting'
      ? 'var(--ok)'
      : status?.state === 'error'
        ? 'var(--err)'
        : 'var(--muted)'

  const renderedLines = useMemo(
    () =>
      lines.map((line) => ({
        text: line,
        color: getLineColor(line)
      })),
    [lines]
  )

  return (
    <Panel
      soft
      data-testid={`multi-log-pane-${commandName}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 200,
        maxHeight: '100%',
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: stateColor, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {commandName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{stateLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            data-testid={`multi-log-open-detail-${commandName}`}
            onClick={onOpenDetail}
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: 12,
              lineHeight: 1,
              borderRadius: 'var(--radius-xs)'
            }}
            title="查看命令日志详情"
          >
            ↗
          </button>
          <button
            type="button"
            data-testid={`multi-log-remove-${commandName}`}
            onClick={onRemove}
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: 14,
              lineHeight: 1,
              borderRadius: 'var(--radius-xs)'
            }}
            title="移除此日志面板"
          >
            ×
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '6px 10px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap'
        }}
      >
        {renderedLines.length ? (
          renderedLines.map((line, idx) => (
            <div key={`${idx}-${line.text.slice(0, 8)}`} style={{ color: line.color }}>
              {line.text}
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--muted)', paddingTop: 16, textAlign: 'center' }}>暂无日志输出</div>
        )}
      </div>
    </Panel>
  )
}

function getLineColor(line: string): string {
  const upper = line.toUpperCase()
  if (upper.includes('ERROR') || upper.includes('ERR') || line.includes('错误') || line.includes('异常')) return 'var(--err)'
  if (upper.includes('WARN') || upper.includes('WARNING') || line.includes('告警') || line.includes('警告')) return 'var(--warn)'
  return 'var(--text-dim)'
}
