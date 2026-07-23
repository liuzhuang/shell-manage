import type { AppConfig } from '../shared/types'

export type LangSmithEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  'LANGSMITH_TRACING' | 'LANGSMITH_API_KEY' | 'LANGSMITH_ENDPOINT' | 'LANGSMITH_PROJECT'
>>

let capturedLangSmithEnvironment: LangSmithEnvironment | undefined

export function captureLangSmithEnvironment(
  environment: LangSmithEnvironment = process.env
): void {
  const apiKey = environment.LANGSMITH_API_KEY?.trim()
  if (!capturedLangSmithEnvironment?.LANGSMITH_API_KEY && apiKey) {
    capturedLangSmithEnvironment = {
      LANGSMITH_TRACING: environment.LANGSMITH_TRACING?.trim(),
      LANGSMITH_API_KEY: apiKey,
      LANGSMITH_ENDPOINT: environment.LANGSMITH_ENDPOINT?.trim(),
      LANGSMITH_PROJECT: environment.LANGSMITH_PROJECT?.trim()
    }
  }
  capturedLangSmithEnvironment ??= {}
  delete environment.LANGSMITH_TRACING
  delete environment.LANGSMITH_API_KEY
  delete environment.LANGSMITH_ENDPOINT
  delete environment.LANGSMITH_PROJECT
}

export function resolveLangSmithSettings(
  settings: AppConfig['settings']['langsmith'],
  environment: LangSmithEnvironment = capturedLangSmithEnvironment ?? process.env
): NonNullable<AppConfig['settings']['langsmith']> {
  const environmentApiKey = environment.LANGSMITH_API_KEY?.trim()
  if (environmentApiKey) {
    const environmentTracing = environment.LANGSMITH_TRACING?.trim().toLowerCase()
    return {
      ...(environmentTracing ? { tracing: environmentTracing !== 'false' } : {}),
      apiKey: environmentApiKey,
      endpoint: environment.LANGSMITH_ENDPOINT?.trim() || undefined,
      project: environment.LANGSMITH_PROJECT?.trim() || undefined
    }
  }
  return {
    ...(settings?.tracing !== undefined ? { tracing: settings.tracing } : {}),
    apiKey: settings?.apiKey?.trim(),
    endpoint: settings?.endpoint?.trim(),
    project: settings?.project?.trim()
  }
}

export function isLangSmithTracingConfigured(
  settings: AppConfig['settings']['langsmith']
): boolean {
  if (settings?.tracing === false) return false
  const apiKey = settings?.apiKey?.trim()
  return Boolean(apiKey && !apiKey.toLowerCase().includes('xxxxx'))
}
