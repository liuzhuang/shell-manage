import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateBroadcastPayload, AppUpdateDisabledReason } from '../shared/types'

const STATUS_CHANNEL = 'app-update:status'

/** Playwright：在未打包环境下模拟一次「手动检查 → 已是最新」流程（不设则走下方禁用逻辑） */
const E2E_UPDATE_SIM = process.env.SHELL_MANAGE_E2E_UPDATE_SIM === '1'
function registerDisabledAutoUpdateHandlers(reason: AppUpdateDisabledReason): void {
  ipcMain.handle('app-update:check', async () => {
    return { ok: false as const, reason }
  })
  ipcMain.handle('app-update:quit-and-install', async () => {
    return { ok: false as const, reason }
  })
  ipcMain.handle('app-update:download', async () => {
    return { ok: false as const, reason }
  })
}

function registerE2eAutoUpdateHandlers(broadcast: (channel: string, payload: unknown) => void): void {
  function send(payload: AppUpdateBroadcastPayload): void {
    broadcast(STATUS_CHANNEL, payload)
  }

  ipcMain.handle('app-update:download', async () => {
    return { ok: false as const, reason: 'not-packaged' as const }
  })

  ipcMain.handle('app-update:check', async (_e, opts?: { manual?: boolean }) => {
    send({ phase: 'checking' })
    // 留出时间让 E2E 能稳定断言顶栏「检查中」状态
    await new Promise((r) => setTimeout(r, 450))
    send({ phase: 'not-available', fromManual: Boolean(opts?.manual) })
    return { ok: true as const }
  })
  ipcMain.handle('app-update:quit-and-install', async () => {
    return { ok: false as const, reason: 'not-packaged' as const }
  })
}

export function setupAutoUpdater(broadcast: (channel: string, payload: unknown) => void): void {
  if (E2E_UPDATE_SIM) {
    registerE2eAutoUpdateHandlers(broadcast)
    return
  }

  if (process.platform !== 'win32') {
    registerDisabledAutoUpdateHandlers('unsupported-platform')
    return
  }
  if (!app.isPackaged) {
    registerDisabledAutoUpdateHandlers('not-packaged')
    return
  }

  ipcMain.removeHandler('app-update:check')
  ipcMain.removeHandler('app-update:quit-and-install')
  ipcMain.removeHandler('app-update:download')

  function send(payload: AppUpdateBroadcastPayload): void {
    broadcast(STATUS_CHANNEL, payload)
  }

  let pendingManualCheck = false
  /** 已出现「有新版本」或正在下载时，后台错误须推到界面（否则只打日志，顶栏会一直停在「发现新版本」） */
  let updatePipelineActive = false

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    send({ phase: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    pendingManualCheck = false
    updatePipelineActive = true
    send({
      phase: 'available',
      version: info.version,
      releaseDate:
        typeof info.releaseDate === 'string'
          ? info.releaseDate
          : info.releaseDate != null
            ? String(info.releaseDate)
            : undefined
    })
    // 部分环境下仅依赖 autoDownload 不会可靠触发下载，显式拉取一次
    void autoUpdater.downloadUpdate()
  })

  autoUpdater.on('update-not-available', () => {
    send({ phase: 'not-available', fromManual: pendingManualCheck })
    pendingManualCheck = false
  })

  autoUpdater.on('error', (err) => {
    const message = err.message
    if (pendingManualCheck || updatePipelineActive) {
      send({ phase: 'error', message })
    } else {
      console.warn('[auto-updater]', message)
    }
    pendingManualCheck = false
    updatePipelineActive = false
  })

  autoUpdater.on('download-progress', (p) => {
    updatePipelineActive = true
    send({
      phase: 'downloading',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    pendingManualCheck = false
    updatePipelineActive = false
    send({ phase: 'downloaded', version: info.version })
  })

  ipcMain.handle('app-update:check', async (_e, opts?: { manual?: boolean }) => {
    if (opts?.manual) pendingManualCheck = true
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true as const }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (opts?.manual) send({ phase: 'error', message })
      else console.warn('[auto-updater]', message)
      pendingManualCheck = false
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('app-update:quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
    return { ok: true as const }
  })

  ipcMain.handle('app-update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true as const }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      send({ phase: 'error', message })
      return { ok: false as const, error: message }
    }
  })

  void autoUpdater.checkForUpdates().catch((e) => {
    console.warn('[auto-updater]', e instanceof Error ? e.message : e)
  })

  const sixHoursMs = 6 * 60 * 60 * 1000
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((e) => {
      console.warn('[auto-updater]', e instanceof Error ? e.message : e)
    })
  }, sixHoursMs)
}
