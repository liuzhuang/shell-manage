import type { DashboardTab } from '../../shared/types'

const now = Date.now()

export const emptyDashboardTab: DashboardTab = {
  id: 'dashboard-draft',
  name: '可视化看板',
  contextLabel: '',
  createdAt: now,
  updatedAt: now,
  widgets: [],
  gridLayout: []
}
