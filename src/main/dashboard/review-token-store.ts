import { randomUUID } from 'node:crypto'

interface ReviewTokenRecord {
  widgetId: string
  stepId: string
  command: string
  expiresAt: number
}

export class ReviewTokenStore {
  private readonly records = new Map<string, ReviewTokenRecord>()

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  issue(widgetId: string, stepId: string, command: string): { tokenAuth: string; expiresAt: number } {
    const tokenAuth = randomUUID()
    const expiresAt = Date.now() + this.ttlMs
    this.records.set(tokenAuth, { widgetId, stepId, command, expiresAt })
    return { tokenAuth, expiresAt }
  }

  validate(tokenAuth: string, widgetId: string, stepId: string, command: string): boolean {
    const item = this.records.get(tokenAuth)
    if (!item) return false
    if (item.expiresAt < Date.now()) {
      this.records.delete(tokenAuth)
      return false
    }
    const matched = item.widgetId === widgetId && item.stepId === stepId && item.command === command
    return matched
  }
}
