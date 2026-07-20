import type { AppConfig } from '../shared/types'

const LANGSMITH_ENV_KEYS = [
  'LANGCHAIN_TRACING_V2',
  'LANGCHAIN_ENDPOINT',
  'LANGCHAIN_API_KEY',
  'LANGCHAIN_PROJECT'
] as const

const initialValues = Object.fromEntries(
  LANGSMITH_ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof LANGSMITH_ENV_KEYS)[number], string | undefined>

export function applyLangSmithEnvironment(settings: AppConfig['settings']['langsmith']): void {
  if (!settings?.tracingV2) {
    LANGSMITH_ENV_KEYS.forEach(restoreInitialValue)
    return
  }
  process.env.LANGCHAIN_TRACING_V2 = 'true'
  setConfiguredOrRestore('LANGCHAIN_ENDPOINT', settings.endpoint)
  setConfiguredOrRestore('LANGCHAIN_API_KEY', settings.apiKey)
  setConfiguredOrRestore('LANGCHAIN_PROJECT', settings.project)
}

function setConfiguredOrRestore(key: (typeof LANGSMITH_ENV_KEYS)[number], value: string | undefined): void {
  const normalized = value?.trim()
  if (normalized) process.env[key] = normalized
  else restoreInitialValue(key)
}

function restoreInitialValue(key: (typeof LANGSMITH_ENV_KEYS)[number]): void {
  const initial = initialValues[key]
  if (initial === undefined) delete process.env[key]
  else process.env[key] = initial
}
