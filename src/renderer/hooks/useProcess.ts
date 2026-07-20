import { useEffect, useMemo, useState } from 'react'
import type { ProcessState } from '../../shared/types'
import type { ProcessOutputPayload, RuntimeStatus } from '../lib/view-models'

export function useProcessState(logBufferLines: number) {
  const [statusMap, setStatusMap] = useState<Record<string, RuntimeStatus>>({})
  const [logMap, setLogMap] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const offStatus = window.api.onProcessStatus((payload) => {
      setStatusMap((prev) => ({
        ...prev,
        [payload.commandName]: {
          state: payload.state,
          pid: payload.pid,
          restarts: payload.restarts,
          message: payload.message,
          configChanged: payload.configChanged
        }
      }))
    })
    const offOutput = window.api.onProcessOutput((payload) => pushProcessLog(payload))
    return () => {
      offStatus?.()
      offOutput?.()
    }
  }, [logBufferLines])

  function pushProcessLog(payload: ProcessOutputPayload) {
    setLogMap((prev) => {
      const lines = [...(prev[payload.commandName] || []), payload.line]
      return {
        ...prev,
        [payload.commandName]: lines.slice(-logBufferLines)
      }
    })
  }

  function clearProcessLogs(commandName: string) {
    if (!commandName) return
    setLogMap((prev) => ({
      ...prev,
      [commandName]: []
    }))
  }

  function colorByState(state: ProcessState): string {
    switch (state) {
      case 'running':
        return 'var(--ok)'
      case 'restarting':
        return 'var(--ok)'
      case 'error':
        return 'var(--err)'
      default:
        return 'var(--text-disabled)'
    }
  }

  const runningSummary = useMemo(() => {
    let running = 0
    let error = 0
    Object.values(statusMap).forEach((status) => {
      if (status.state === 'running') running += 1
      if (status.state === 'error') error += 1
    })
    return { running, error }
  }, [statusMap])

  return {
    statusMap,
    logMap,
    clearProcessLogs,
    colorByState,
    runningSummary
  }
}
