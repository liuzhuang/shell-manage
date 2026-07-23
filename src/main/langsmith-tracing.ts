import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain'
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises'
import { Client, type ClientConfig } from 'langsmith'
import { createHash } from 'node:crypto'
import type { AppConfig } from '../shared/types'
import { redactSensitiveText } from '../shared/terminal-context'
import {
  isLangSmithTracingConfigured,
  resolveLangSmithSettings,
  type LangSmithEnvironment
} from './langsmith-env'

const tracerByConfigFingerprint = new Map<string, { client: Client; tracer: LangChainTracer }>()

export function buildLangSmithClientConfig(
  settings: AppConfig['settings']['langsmith'],
  environment?: LangSmithEnvironment
): ClientConfig | undefined {
  const resolved = resolveLangSmithSettings(settings, environment)
  if (!isLangSmithTracingConfigured(resolved)) return undefined
  const apiKey = resolved.apiKey?.trim()
  if (!apiKey) return undefined
  const endpoint = resolved.endpoint?.trim()
  return {
    apiKey,
    ...(endpoint ? { apiUrl: endpoint } : {}),
    anonymizer: anonymizeLangSmithPayload,
    hideInputs: false,
    hideOutputs: false
  }
}

export function anonymizeLangSmithPayload(value: Record<string, unknown>): Record<string, unknown> {
  return redactTraceValue(value, '', new WeakSet<object>()) as Record<string, unknown>
}

function redactTraceValue(
  value: unknown,
  key: string,
  seen: WeakSet<object>
): unknown {
  if (isSensitiveTraceKey(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactSensitiveText(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item, '', seen))
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactTraceValue(childValue, childKey, seen)
    ])
  )
}

function isSensitiveTraceKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  return [
    'apikey',
    'authorization',
    'password',
    'passwd',
    'privatekey',
    'clientsecret',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'credential',
    'credentials'
  ].includes(normalized)
}

export function createLangSmithTracer(
  settings: AppConfig['settings']['langsmith'],
  environment?: LangSmithEnvironment
): LangChainTracer | undefined {
  const resolved = resolveLangSmithSettings(settings, environment)
  const clientConfig = buildLangSmithClientConfig(resolved, {})
  if (!clientConfig) return undefined
  const project = resolved.project?.trim()
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      apiKey: clientConfig.apiKey,
      apiUrl: clientConfig.apiUrl,
      project: project || ''
    }))
    .digest('hex')
  const existing = tracerByConfigFingerprint.get(fingerprint)
  if (existing) return existing.tracer
  const client = new Client(clientConfig)
  const tracer = new LangChainTracer({
    client,
    _awaitHandler: true,
    ...(project ? { projectName: project } : {})
  })
  tracerByConfigFingerprint.set(fingerprint, { client, tracer })
  return tracer
}

export async function flushLangSmithTracing(): Promise<void> {
  await awaitAllCallbacks()
  const clients = [...tracerByConfigFingerprint.values()].map((entry) => entry.client)
  tracerByConfigFingerprint.clear()
  await Promise.allSettled(clients.map(async (client) => {
    await client.awaitPendingTraceBatches()
    client.cleanup()
  }))
}
