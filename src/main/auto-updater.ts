import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateBroadcastPayload, AppUpdateDisabledReason } from '../shared/types'
import { formatSparkleExitError, parseSparkleOutputLine } from './sparkle-output'
import { buildChildProcessEnvironment } from './child-process-env'

const STATUS_CHANNEL = 'app-update:status'

/** Playwright：在未打包环境下模拟一次「手动检查 → 已是最新」流程（不设则走下方禁用逻辑） */
const E2E_UPDATE_SIM = process.env.SHELL_MANAGE_E2E_UPDATE_SIM
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
    if (E2E_UPDATE_SIM === 'manual') {
      send({ phase: 'downloading', percent: 0, transferred: 0, total: 100, bytesPerSecond: 0 })
      await new Promise((r) => setTimeout(r, 250))
      send({ phase: 'downloading', percent: 64, transferred: 64, total: 100, bytesPerSecond: 64 })
      await new Promise((r) => setTimeout(r, 250))
      send({ phase: 'installing', percent: 30 })
      return { ok: true as const }
    }
    return { ok: false as const, reason: 'not-packaged' as const }
  })

  ipcMain.handle('app-update:check', async (_e, opts?: { manual?: boolean }) => {
    send({ phase: 'checking' })
    // 留出时间让 E2E 能稳定断言顶栏「检查中」状态
    await new Promise((r) => setTimeout(r, 450))
    send(
      E2E_UPDATE_SIM === 'manual'
        ? { phase: 'available', version: '99.0.0' }
        : { phase: 'not-available', fromManual: Boolean(opts?.manual) }
    )
    return { ok: true as const }
  })
  ipcMain.handle('app-update:quit-and-install', async () => {
    return { ok: false as const, reason: 'not-packaged' as const }
  })
}

export function setupAutoUpdater(broadcast: (channel: string, payload: unknown) => void): void {
  if (E2E_UPDATE_SIM === '1' || E2E_UPDATE_SIM === 'manual') {
    registerE2eAutoUpdateHandlers(broadcast)
    return
  }

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
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
  const usesSparkle = process.platform === 'darwin'
  let availableVersion: string | undefined
  let sparkleUpdaterProcess: ChildProcessWithoutNullStreams | undefined

  autoUpdater.autoDownload = !usesSparkle
  autoUpdater.autoInstallOnAppQuit = !usesSparkle

  autoUpdater.on('checking-for-update', () => {
    send({ phase: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    pendingManualCheck = false
    updatePipelineActive = true
    availableVersion = info.version
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
    // Windows 使用 electron-updater；macOS 等待用户点击后交给 Sparkle 完成下载、校验与安装。
    if (!usesSparkle) void autoUpdater.downloadUpdate()
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
    if (usesSparkle) return { ok: false as const, reason: 'unsupported-platform' as const }
    autoUpdater.quitAndInstall(false, true)
    return { ok: true as const }
  })

  ipcMain.handle('app-update:download', async () => {
    if (usesSparkle) {
      if (sparkleUpdaterProcess && sparkleUpdaterProcess.exitCode == null) {
        return { ok: true as const }
      }

      const updaterExecutable = join(process.resourcesPath, 'sparkle.app', 'Contents', 'MacOS', 'sparkle')
      const applicationBundle = resolve(process.resourcesPath, '..', '..')
      if (!existsSync(updaterExecutable) || !existsSync(applicationBundle)) {
        const message = '更新组件缺失，请重新安装最新版 ShellManage'
        send({ phase: 'error', message })
        return { ok: false as const, error: message }
      }

      const args = [
        '--check-immediately',
        '--allow-major-upgrades',
        '--interactive',
        '--user-agent-name',
        'ShellManage',
        '--verbose',
        applicationBundle
      ]

      updatePipelineActive = true
      send({ phase: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })

      const child = spawn(updaterExecutable, args, { env: buildChildProcessEnvironment() })
      sparkleUpdaterProcess = child
      child.stdin.end()
      child.stdout.resume()

      let stderrBuffer = ''
      let lastErrorLine = ''
      let lastTransferred = 0
      let lastProgressAt = Date.now()
      let failedToStart = false

      const handleSparkleLine = (line: string): void => {
        if (!line) return
        if (line.startsWith('Error:') || line.includes('cannot be performed')) lastErrorLine = line

        const event = parseSparkleOutputLine(line)
        if (event?.kind === 'download') {
          const now = Date.now()
          const elapsedSeconds = Math.max((now - lastProgressAt) / 1000, 0.001)
          const bytesPerSecond = Math.max(0, Math.round((event.transferred - lastTransferred) / elapsedSeconds))
          lastTransferred = event.transferred
          lastProgressAt = now
          send({
            phase: 'downloading',
            percent: event.percent,
            transferred: event.transferred,
            total: event.total,
            bytesPerSecond
          })
          return
        }

        if (event?.kind === 'installing') send({ phase: 'installing', percent: event.percent })
      }

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        lines.forEach(handleSparkleLine)
      })

      child.on('error', (error) => {
        failedToStart = true
        if (sparkleUpdaterProcess === child) sparkleUpdaterProcess = undefined
        updatePipelineActive = false
        send({ phase: 'error', message: `无法启动更新组件：${error.message}` })
      })

      child.on('close', (code) => {
        if (stderrBuffer) handleSparkleLine(stderrBuffer.trim())
        if (sparkleUpdaterProcess === child) sparkleUpdaterProcess = undefined
        if (code === 0 || failedToStart) return

        updatePipelineActive = false
        send({ phase: 'error', message: formatSparkleExitError(code, lastErrorLine) })
      })

      console.info(`[auto-updater] Sparkle started for ${availableVersion ?? 'latest'} (${process.arch})`)
      return { ok: true as const }
    }
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
