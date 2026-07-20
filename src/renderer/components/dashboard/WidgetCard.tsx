import { Panel } from '../Panel'
import type { DashboardWidgetData, DashboardWidgetSpec } from '../../lib/dashboard-types'
import { WidgetFactory } from './WidgetFactory'

interface WidgetCardProps {
  spec: DashboardWidgetSpec
  data: DashboardWidgetData
  onInspect: (widgetId: string) => void
  onDelete?: (widgetId: string) => void
  editable?: boolean
  active?: boolean
}

export function WidgetCard({ spec, data, onInspect, onDelete, editable = false, active = false }: WidgetCardProps) {
  return (
    <Panel
      style={{
        height: '100%',
        cursor: 'pointer',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderColor: active ? 'var(--accent)' : 'var(--border-subtle)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{spec.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{spec.kind}</span>
          {editable ? (
            <button
              data-testid={`dashboard-widget-delete-${spec.id}`}
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                console.info('[dashboard][delete] delete button clicked', {
                  widgetId: spec.id,
                  title: spec.title
                })
                onDelete?.(spec.id)
              }}
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xs)',
                background: 'color-mix(in srgb, var(--err) 14%, var(--panel))',
                color: 'var(--err)',
                fontSize: 11,
                lineHeight: 1,
                padding: '4px 6px',
                cursor: 'pointer'
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      </div>
      <button
        data-testid={`dashboard-widget-${spec.id}`}
        type="button"
        onClick={() => onInspect(spec.id)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'block',
          height: '100%'
        }}
      >
        <WidgetFactory kind={spec.kind} data={data} />
      </button>
    </Panel>
  )
}
