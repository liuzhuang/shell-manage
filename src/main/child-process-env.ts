const PRIVATE_OBSERVABILITY_ENV_KEYS = [
  'LANGSMITH_API_KEY',
  'LANGCHAIN_API_KEY'
] as const

export function buildChildProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment = { ...source }
  for (const key of PRIVATE_OBSERVABILITY_ENV_KEYS) delete environment[key]
  return environment
}
