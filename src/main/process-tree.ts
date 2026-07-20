import treeKill from 'tree-kill'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function killProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    treeKill(pid, signal, () => resolve())
  })
}

export async function terminateProcessTreeWithEscalation(
  pid: number,
  hasExited: () => boolean,
  graceMs: number
): Promise<void> {
  await killProcessTree(pid, 'SIGTERM')
  if (hasExited()) return
  await delay(graceMs)
  if (hasExited()) return
  await killProcessTree(pid, 'SIGKILL')
}
