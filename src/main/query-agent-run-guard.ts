const DEFAULT_RUN_TTL_MS = 10 * 60 * 1000
const MAX_TRACKED_RUNS = 1_000

type RunState = {
  nextStepIndex: number
  touchedAt: number
}

export class QueryAgentRunGuard {
  private readonly runs = new Map<string, RunState>()

  constructor(private readonly ttlMs = DEFAULT_RUN_TTL_MS) {}

  reserveStep(agentRunId: string, stepIndex: number, now = Date.now()): boolean {
    this.removeExpired(now)
    const current = this.runs.get(agentRunId)
    if (!current) {
      if (stepIndex !== 1) return false
      this.ensureCapacity()
      this.runs.set(agentRunId, { nextStepIndex: 2, touchedAt: now })
      return true
    }
    if (stepIndex !== current.nextStepIndex || stepIndex > 4) return false
    current.nextStepIndex += 1
    current.touchedAt = now
    return true
  }

  finish(agentRunId: string): void {
    this.runs.delete(agentRunId)
  }

  clear(): void {
    this.runs.clear()
  }

  private removeExpired(now: number): void {
    for (const [agentRunId, state] of this.runs) {
      if (now - state.touchedAt >= this.ttlMs) this.runs.delete(agentRunId)
    }
  }

  private ensureCapacity(): void {
    if (this.runs.size < MAX_TRACKED_RUNS) return
    const oldest = [...this.runs.entries()]
      .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]
    if (oldest) this.runs.delete(oldest[0])
  }
}
