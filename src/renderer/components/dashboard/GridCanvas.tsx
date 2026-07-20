import type { DashboardDataMap, DashboardWidgetSpec } from '../../lib/dashboard-types'
import type { DashboardGridLayoutItem } from '../../../shared/types'
import { WidgetCard } from './WidgetCard'

interface GridCanvasProps {
  widgets: DashboardWidgetSpec[]
  gridLayout: DashboardGridLayoutItem[]
  dataMap: DashboardDataMap
  onInspect: (widgetId: string) => void
  onDeleteWidget?: (widgetId: string) => void
  selectedWidgetId?: string
  editable?: boolean
}

export function GridCanvas({ widgets, gridLayout, dataMap, onInspect, onDeleteWidget, selectedWidgetId, editable = false }: GridCanvasProps) {
  const widgetById = new Map(widgets.map((item) => [item.id, item]))

  return (
    <div
      data-testid="dashboard-grid-canvas"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(24, minmax(0, 1fr))',
        gridAutoRows: 88,
        gap: 12,
        padding: 12
      }}
    >
      {gridLayout.map((item) => {
        const spec = widgetById.get(item.i)
        const data = dataMap[item.i]
        if (!spec || !data) return null
        return (
          <div data-testid={`dashboard-grid-item-${item.i}`} key={item.i} style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}`, minHeight: 0 }}>
            <WidgetCard
              spec={spec}
              data={data}
              onInspect={onInspect}
              onDelete={onDeleteWidget}
              editable={editable}
              active={selectedWidgetId === spec.id}
            />
          </div>
        )
      })}
    </div>
  )
}
