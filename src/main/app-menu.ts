import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron'

export type AppNavigateTarget = 'home' | 'query' | 'monitoring' | 'editor' | 'browser'

export interface AppMenuHandlers {
  onOpen: () => void
  onHide: () => void
  onQuit: () => void
  onCheckUpdate: () => void
  onNavigate: (target: AppNavigateTarget) => void
  onFocusHomeSearch: () => void
  onReload: (force: boolean) => void
}

function roleItem(role: MenuItemConstructorOptions['role']): MenuItemConstructorOptions {
  return { role }
}

export function setupApplicationMenu(handlers: AppMenuHandlers): void {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.getName(),
      submenu: [
        roleItem('about'),
        { type: 'separator' },
        {
          label: '检查更新',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: handlers.onCheckUpdate
        },
        { type: 'separator' },
        roleItem('services'),
        { type: 'separator' },
        roleItem('hide'),
        roleItem('hideOthers'),
        roleItem('unhide'),
        { type: 'separator' },
        {
          label: '完全退出应用',
          accelerator: 'CmdOrCtrl+Q',
          click: handlers.onQuit
        }
      ]
    })
  }

  template.push(
    {
      label: '文件',
      submenu: [
        {
          label: '显示主窗口',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: handlers.onOpen
        },
        {
          label: '关闭窗口（后台运行）',
          accelerator: 'CmdOrCtrl+W',
          click: handlers.onHide
        },
        { type: 'separator' },
        {
          label: '完全退出应用',
          accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Q' : 'Alt+F4',
          click: handlers.onQuit
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        roleItem('undo'),
        roleItem('redo'),
        { type: 'separator' },
        roleItem('cut'),
        roleItem('copy'),
        roleItem('paste'),
        roleItem('delete'),
        roleItem('selectAll')
      ]
    },
    {
      label: '查看',
      submenu: [
        {
          label: '命令',
          accelerator: 'CmdOrCtrl+1',
          click: () => handlers.onNavigate('home')
        },
        {
          label: '日志',
          accelerator: 'CmdOrCtrl+2',
          click: () => handlers.onNavigate('query')
        },
        {
          label: '监控',
          accelerator: 'CmdOrCtrl+3',
          click: () => handlers.onNavigate('monitoring')
        },
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+4',
          click: () => handlers.onNavigate('editor')
        },
        {
          label: '浏览器',
          accelerator: 'CmdOrCtrl+6',
          click: () => handlers.onNavigate('browser')
        },
        { type: 'separator' },
        {
          label: '聚焦首页搜索',
          accelerator: 'CmdOrCtrl+K',
          click: handlers.onFocusHomeSearch
        },
        { type: 'separator' },
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => handlers.onReload(false)
        },
        {
          label: '强制重新加载',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => handlers.onReload(true)
        },
        roleItem('toggleDevTools'),
        { type: 'separator' },
        roleItem('resetZoom'),
        roleItem('zoomIn'),
        roleItem('zoomOut'),
        { type: 'separator' },
        roleItem('togglefullscreen')
      ]
    },
    {
      label: '窗口',
      submenu: [
        roleItem('minimize'),
        roleItem('zoom'),
        ...(process.platform === 'darwin' ? [roleItem('front')] : [])
      ]
    }
  )

  const menu = Menu.buildFromTemplate(template)

  Menu.setApplicationMenu(menu)
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || focused.isDestroyed()) return
  focused.webContents.send('app:menu-ready')
}
