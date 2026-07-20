import { Menu, Tray, app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class TrayManager {
  private tray?: Tray
  private contextMenu?: Menu

  init(options: { onOpen: () => void; onHide: () => void; onQuit: () => void }): void {
    const { onOpen, onHide, onQuit } = options
    const iconPathCandidates = app.isPackaged
      ? [join(process.resourcesPath, 'icons', 'trayTemplate.png'), join(process.resourcesPath, 'icons', 'icon.png')]
      : [join(process.cwd(), 'resources', 'icons', 'trayTemplate.png'), join(process.cwd(), 'resources', 'icons', 'icon.png')]
    const iconPath = iconPathCandidates.find((item) => existsSync(item))
    const candidateIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined
    const icon = candidateIcon && !candidateIcon.isEmpty() ? candidateIcon : createFallbackTrayIcon()
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip(app.getName())

    // 右键 / 双指点击 时弹出的菜单：仅保留隐藏与退出。
    // 注意：不调用 setContextMenu，否则在 macOS 上左键单击也会弹菜单，
    // 无法实现"左键直接打开程序"的交互。
    this.contextMenu = Menu.buildFromTemplate([
      {
        label: '隐藏到后台',
        click: onHide
      },
      { type: 'separator' },
      {
        label: '完全退出应用',
        click: onQuit
      }
    ])

    this.tray.on('click', () => {
      onOpen()
    })

    this.tray.on('double-click', () => {
      onOpen()
    })

    this.tray.on('right-click', () => {
      if (this.tray && this.contextMenu) {
        this.tray.popUpContextMenu(this.contextMenu)
      }
    })
  }
}

function createFallbackTrayIcon() {
  // A simple terminal-like glyph so tray icon is visible without external assets.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <rect x="2" y="4" width="18" height="14" rx="3" fill="black"/>
  <path d="M6.2 8.2 L8.9 10.6 L6.2 13" stroke="white" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="10.7" y1="13" x2="15.8" y2="13" stroke="white" stroke-width="1.7" stroke-linecap="round"/>
</svg>`
  const data = Buffer.from(svg).toString('base64')
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${data}`).resize({ width: 18, height: 18 })
}
