export const DOCK_FULLSCREEN_SCALE = 1.5

const DOCK_BASE_CARD_WIDTH = 120
const DOCK_BASE_CARD_HEIGHT = 62
const DOCK_BASE_GAP = 6
const DOCK_BASE_PADDING_X = 6
const DOCK_BASE_LABEL_BOTTOM = 76
const DOCK_BASE_EDIT_BOTTOM = 72
const DOCK_BASE_MODAL_MARGIN_BOTTOM = 72

export function getLogDashboardDockScale(expanded: boolean): number {
  return expanded ? DOCK_FULLSCREEN_SCALE : 1
}

export type LogDashboardDockLayout = {
  scale: number
  cardWidth: number
  cardHeight: number
  panelMaxWidth: string
  gap: number
  paddingX: number
  labelBottom: number
  editBottom: number
  modalMarginBottom: number
}

export function getLogDashboardDockLayout(expanded: boolean): LogDashboardDockLayout {
  const scale = getLogDashboardDockScale(expanded)
  const cardHeight = DOCK_BASE_CARD_HEIGHT * scale
  return {
    scale,
    cardWidth: DOCK_BASE_CARD_WIDTH * scale,
    cardHeight,
    panelMaxWidth: `min(${62 * scale}vw, ${920 * scale}px)`,
    gap: DOCK_BASE_GAP * scale,
    paddingX: DOCK_BASE_PADDING_X * scale,
    labelBottom: DOCK_BASE_LABEL_BOTTOM + (cardHeight - DOCK_BASE_CARD_HEIGHT),
    editBottom: DOCK_BASE_EDIT_BOTTOM + (cardHeight - DOCK_BASE_CARD_HEIGHT),
    modalMarginBottom: DOCK_BASE_MODAL_MARGIN_BOTTOM + (cardHeight - DOCK_BASE_CARD_HEIGHT)
  }
}
