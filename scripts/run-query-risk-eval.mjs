import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const childMarker = 'SHELL_MANAGE_QUERY_RISK_EVAL_CHILD'
const apiKeyEnvironmentName = 'SHELL_MANAGE_QUERY_RISK_EVAL_API_KEY'
const modelEnvironmentName = 'SHELL_MANAGE_QUERY_RISK_EVAL_MODEL'
const electronStubUrl = 'data:text/javascript,export const app={getPath:()=>process.cwd()}'

function fail(code, message, environmentName) {
  process.stderr.write(`${JSON.stringify({ type: 'error', code, message, environmentName })}\n`)
  process.exitCode = 2
}

function main() {
  if (!process.env[apiKeyEnvironmentName]?.trim()) {
    fail('missing_api_key', `Missing required environment variable ${apiKeyEnvironmentName}.`, apiKeyEnvironmentName)
    return
  }
  if (!process.env[modelEnvironmentName]?.trim()) {
    fail('missing_model', `Missing required environment variable ${modelEnvironmentName}.`, modelEnvironmentName)
    return
  }

  const provider = process.env.SHELL_MANAGE_QUERY_RISK_EVAL_PROVIDER?.trim() || 'openai'
  if (provider !== 'openai' && provider !== 'deepseek') {
    fail('invalid_provider', 'SHELL_MANAGE_QUERY_RISK_EVAL_PROVIDER must be openai or deepseek.', 'SHELL_MANAGE_QUERY_RISK_EVAL_PROVIDER')
    return
  }

  const result = spawnSync(process.execPath, [
    '--experimental-transform-types',
    '--import',
    `data:text/javascript,import{register}from'node:module';register(${JSON.stringify(import.meta.url)})`,
    fileURLToPath(new URL('./query-risk-eval-child.mjs', import.meta.url))
  ], {
    stdio: 'inherit',
    env: { ...process.env, [childMarker]: '1' }
  })

  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: electronStubUrl, shortCircuit: true }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const canResolveTypeScript = error?.code === 'ERR_MODULE_NOT_FOUND'
      && context.parentURL?.startsWith('file:')
      && (specifier.startsWith('.') || specifier.startsWith('file:'))
      && extname(new URL(specifier, context.parentURL).pathname) === ''
    if (!canResolveTypeScript) throw error

    const unresolvedPath = fileURLToPath(new URL(specifier, context.parentURL))
    for (const suffix of ['.ts', '/index.ts']) {
      const candidate = `${unresolvedPath}${suffix}`
      try {
        await access(candidate)
        return nextResolve(pathToFileURL(candidate).href, context)
      } catch {}
    }
    throw error
  }
}

if (process.env[childMarker] !== '1') main()
