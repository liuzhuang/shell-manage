export type SparkleOutputEvent =
  | { kind: 'download'; transferred: number; total: number; percent: number }
  | { kind: 'installing'; percent?: number }

export function parseSparkleOutputLine(line: string): SparkleOutputEvent | null {
  const download = line.match(/Downloaded (\d+) out of (\d+) bytes \((\d+)%\)/)
  if (download) {
    return {
      kind: 'download',
      transferred: Number(download[1]),
      total: Number(download[2]),
      percent: Number(download[3])
    }
  }

  const extraction = line.match(/Extracting Update \((\d+)%\)/)
  if (extraction) return { kind: 'installing', percent: Number(extraction[1]) }
  if (line.includes('Installing Update...')) return { kind: 'installing' }
  return null
}

export function formatSparkleExitError(code: number | null, lastErrorLine: string): string {
  if (code === 4) return '没有找到可安装的新版本，请重新检查更新'
  if (code === 5) return '已取消更新授权'
  if (code === 8) return '没有权限替换应用，请将 ShellManage 安装到「应用程序」后重试'
  return lastErrorLine || `更新失败（Sparkle 退出码 ${code ?? 'unknown'}）`
}
