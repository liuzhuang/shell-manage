import type { ProcessOutputPayload as SharedProcessOutputPayload, ProcessState } from '../../shared/types'

export type RuntimeStatus = {
  state: ProcessState
  pid?: number
  restarts?: number
  message?: string
  configChanged?: boolean
  exitCode?: number
}

export type ProcessOutputPayload = SharedProcessOutputPayload

export function getProcessStateLabel(state?: ProcessState): string {
  switch (state) {
    case 'running':
      return '运行中'
    case 'restarting':
      return '重启中'
    case 'error':
      return '异常'
    case 'idle':
    default:
      return '空闲'
  }
}
