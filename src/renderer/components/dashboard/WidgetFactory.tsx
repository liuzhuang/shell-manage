import type { DashboardWidgetData } from '../../lib/dashboard-types'
import type { DashboardWidgetKind } from '../../../shared/types'

interface WidgetFactoryProps {
  kind: DashboardWidgetKind
  data: DashboardWidgetData
}

const toneColor: Record<'ok' | 'warn' | 'error', string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  error: 'var(--err)'
}

export function WidgetFactory({ kind, data }: WidgetFactoryProps) {
  if (kind === 'metric' && data.kind === 'metric') {
    return (
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{data.value}</div>
        <div style={{ fontSize: 12, color: toneColor[data.tone], fontWeight: 600 }}>{data.statusText}</div>
      </div>
    )
  }

  if (kind === 'table' && data.kind === 'table') {
    return (
      <div style={{ overflow: 'auto', maxHeight: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th
                  key={column}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    color: 'var(--text-dim)',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${rowIndex}-${cellIndex}`}
                    style={{
                      padding: '7px 8px',
                      color: 'var(--text)',
                      borderBottom: '1px solid var(--border-subtle)',
                      whiteSpace: cellIndex === row.length - 1 ? 'nowrap' : 'normal',
                      overflow: cellIndex === row.length - 1 ? 'hidden' : 'visible',
                      textOverflow: cellIndex === row.length - 1 ? 'ellipsis' : 'clip',
                      maxWidth: cellIndex === row.length - 1 ? 280 : undefined
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (kind === 'timeseries' && data.kind === 'timeseries') {
    const max = Math.max(...data.points.map((point) => point.value), 1)
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flex: 1, minHeight: 0, paddingBottom: 4 }}>
        {data.points.map((point) => (
          <div key={point.label} style={{ flex: 1, minWidth: 0 }}>
            <div
              title={`${point.label}: ${point.value}${data.unit || ''}`}
              style={{
                width: '100%',
                height: `${Math.max(8, (point.value / max) * 100)}%`,
                borderRadius: 3,
                background: 'var(--accent)',
                opacity: 0.9
              }}
            />
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'event' && data.kind === 'event') {
    return (
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.lines.map((line, index) => (
          <div
            key={`event-line-${index}`}
            style={{
              fontSize: 12,
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {line}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>
      组件类型与数据不匹配，暂无法展示。
    </div>
  )
}

