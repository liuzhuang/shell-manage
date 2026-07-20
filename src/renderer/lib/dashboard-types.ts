import type {
  DashboardGridLayoutItem,
  DashboardRiskLevel,
  DashboardTab,
  DashboardWidgetKind,
  WidgetSpec
} from '../../shared/types'

export type { DashboardGridLayoutItem, DashboardRiskLevel, DashboardTab, DashboardWidgetKind, WidgetSpec as DashboardWidgetSpec }

export interface MetricWidgetData {
  kind: 'metric'
  value: string
  statusText: string
  tone: 'ok' | 'warn' | 'error'
}

export interface TableWidgetData {
  kind: 'table'
  columns: string[]
  rows: string[][]
}

export interface TimeseriesWidgetData {
  kind: 'timeseries'
  unit?: string
  points: Array<{ label: string; value: number }>
}

export interface EventWidgetData {
  kind: 'event'
  lines: string[]
}

export type DashboardWidgetData = MetricWidgetData | TableWidgetData | TimeseriesWidgetData | EventWidgetData

export type DashboardDataMap = Record<string, DashboardWidgetData>
