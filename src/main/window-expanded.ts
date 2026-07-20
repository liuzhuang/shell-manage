import { BrowserWindow, screen } from 'electron'

const WORK_AREA_TOLERANCE = 32

/** 窗口占满可用工作区：原生全屏、最大化，或贴近屏幕可用区域（macOS 保留程序坞/菜单栏）。 */
export function readWindowExpanded(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  if (win.isFullScreen() || win.isMaximized()) return true

  const bounds = win.getBounds()
  const { workArea } = screen.getDisplayMatching(bounds)
  return (
    Math.abs(bounds.x - workArea.x) <= WORK_AREA_TOLERANCE &&
    Math.abs(bounds.y - workArea.y) <= WORK_AREA_TOLERANCE &&
    Math.abs(bounds.width - workArea.width) <= WORK_AREA_TOLERANCE &&
    Math.abs(bounds.height - workArea.height) <= WORK_AREA_TOLERANCE
  )
}
