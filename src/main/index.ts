import { app, BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '../shared/types'
import { ConfigLoader } from './config-loader'
import { LlmService } from './llm-service'
import { syncLaunchAtLogin } from './login-item'
import { registerIpcHandlers, type IpcRuntimeControl, broadcast } from './ipc-handlers'
import { setupAutoUpdater } from './auto-updater'
import { ProcessManager } from './process-manager'
import { normalizeRuntimeEnv } from './shell-runtime'
import { TrayManager } from './tray-manager'
import { setupApplicationMenu } from './app-menu'
import { captureLangSmithEnvironment } from './langsmith-env'

captureLangSmithEnvironment()

let mainWindow: BrowserWindow | undefined
let currentConfig: AppConfig
let isQuitting = false
let hasRunQuitCleanup = false
let isQuitCleanupRunning = false
// electron-vite 5+ 注入 ELECTRON_RENDERER_URL；旧版/文档曾使用 VITE_DEV_SERVER_URL
const devRendererUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL
const isDevRuntime = Boolean(devRendererUrl)
const packagedAppName = 'ShellManage'
const devAppName = `${packagedAppName}-开发版`
const runtimeHome = process.env.SHELL_MANAGE_HOME

// Set name before ready so macOS dock/menu do not fall back to "Electron".
app.setName(app.isPackaged ? packagedAppName : devAppName)

if (runtimeHome) {
  app.setPath('userData', join(runtimeHome, '.shell-manage', 'userdata'))
}

const configLoader = new ConfigLoader()
const processManager = new ProcessManager(
  (payload) => broadcast('process:status', payload),
  (payload) => broadcast('process:output', payload)
)
const llmService = new LlmService()
const trayManager = new TrayManager()
let ipcRuntimeControl: IpcRuntimeControl | undefined

function resolveIconPath(fileName: string): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icons', fileName)]
    : [join(process.cwd(), 'resources', 'icons', fileName)]
  return candidates.find((item) => existsSync(item))
}

function createFallbackDockIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="96" y="120" width="832" height="784" rx="182" fill="#1F232B"/>
  <rect x="132" y="168" width="760" height="688" rx="142" fill="#2A313D"/>
  <path d="M330 402 L456 512 L330 620" stroke="#F8FAFF" stroke-width="60" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="518" y1="620" x2="702" y2="620" stroke="#F8FAFF" stroke-width="58" stroke-linecap="round"/>
</svg>`
  const data = Buffer.from(svg).toString('base64')
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${data}`).resize({ width: 512, height: 512 })
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (process.platform === 'darwin') app.dock.show()
  if (mainWindow.isVisible()) {
    mainWindow.focus()
    return
  }
  // 首次启动尚未 ready 时，由 ready-to-show 负责最大化并展示窗口。
  if (mainWindow.webContents.isLoading()) return
  mainWindow.show()
  mainWindow.focus()
}

function hideToBackground(): void {
  if (!mainWindow) return
  mainWindow.hide()
  if (process.platform === 'darwin') app.dock.hide()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1320,
    height: 860,
    backgroundColor: '#121417',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#161A20',
            symbolColor: '#D8DEE9',
            height: 34
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    },
    title: isDevRuntime ? devAppName : packagedAppName
  })

  if (devRendererUrl) {
    mainWindow.loadURL(devRendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
    if (process.platform === 'darwin') app.dock.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      hideToBackground()
    }
  })

  mainWindow.on('show', () => {
    if (process.platform === 'darwin') app.dock.show()
  })
}

app.whenReady().then(async () => {
  await normalizeRuntimeEnv()
  captureLangSmithEnvironment()

  if (process.platform === 'darwin') {
    const dockIconPath = resolveIconPath('icon.png')
    app.dock.setIcon(dockIconPath ?? createFallbackDockIcon())
  }

  configLoader.ensureConfigFile()
  currentConfig = configLoader.readParsed()
  syncLaunchAtLogin(currentConfig.settings.launchAtLogin === true)
  processManager.syncConfig(currentConfig.commands)

  ipcRuntimeControl = registerIpcHandlers(
    configLoader,
    processManager,
    llmService,
    () => currentConfig,
    (next) => {
      currentConfig = next
    }
  )

  setupAutoUpdater(broadcast)

  setupApplicationMenu({
    onOpen: showMainWindow,
    onHide: hideToBackground,
    onQuit: () => {
      isQuitting = true
      app.quit()
    },
    onCheckUpdate: () => {
      mainWindow?.webContents.send('app:check-update')
    },
    onNavigate: (target) => {
      mainWindow?.webContents.send('app:navigate', { target })
      showMainWindow()
    },
    onFocusHomeSearch: () => {
      mainWindow?.webContents.send('app:focus-home-search')
      showMainWindow()
    },
    onReload: (force) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('app:reload-request', { force })
    }
  })

  configLoader.watch(() => {
    try {
      currentConfig = configLoader.readParsed()
      syncLaunchAtLogin(currentConfig.settings.launchAtLogin === true)
      processManager.syncConfig(currentConfig.commands)
      broadcast('config:loaded', currentConfig)
    } catch (error) {
      broadcast('config:error', { error: error instanceof Error ? error.message : String(error) })
    }
  })

  createWindow()
  if (mainWindow) ipcRuntimeControl.attachMainWindow(mainWindow)
  trayManager.init({
    onOpen: showMainWindow,
    onHide: hideToBackground,
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })
  broadcast('config:loaded', currentConfig)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    showMainWindow()
  })
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (hasRunQuitCleanup) return
  event.preventDefault()
  if (isQuitCleanupRunning) return
  isQuitCleanupRunning = true
  void (async () => {
    try {
      await Promise.allSettled([processManager.stopAllRunning(), ipcRuntimeControl?.shutdown()])
    } finally {
      hasRunQuitCleanup = true
      isQuitCleanupRunning = false
      app.quit()
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
