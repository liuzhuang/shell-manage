import assert from 'node:assert/strict'
import test from 'node:test'
import type { RunTreeConfig } from 'langsmith'
import { QueryAgentTraceStore } from './query-agent-trace'

class FakeRunTree {
  readonly children: FakeRunTree[] = []
  readonly endCalls: Array<{
    outputs?: Record<string, unknown>
    error?: string
    metadata?: Record<string, unknown>
  }> = []
  postCount = 0
  patchCount = 0

  constructor(readonly config: RunTreeConfig) {}

  createChild(config: RunTreeConfig): FakeRunTree {
    const child = new FakeRunTree(config)
    this.children.push(child)
    return child
  }

  async postRun(): Promise<void> {
    this.postCount += 1
  }

  async end(
    outputs?: Record<string, unknown>,
    error?: string,
    _endTime?: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.endCalls.push({ outputs, error, metadata })
  }

  async patchRun(): Promise<void> {
    this.patchCount += 1
  }
}

class FailingPostRunTree extends FakeRunTree {
  async postRun(): Promise<void> {
    throw new Error('trace backend unavailable')
  }
}

test('仅在 LangSmith API Key 有效时创建 Query Agent 根追踪', async () => {
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config) => {
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })

  assert.equal(await store.start({ agentRunId: 'run-disabled', langsmithApiKey: '   ' }), undefined)
  assert.equal(await store.start({ agentRunId: 'run-placeholder', langsmithApiKey: 'lsv2_pt_xxxxx' }), undefined)
  assert.equal(roots.length, 0)

  const root = await store.start({
    agentRunId: 'run-enabled',
    langsmithApiKey: 'trace-secret',
    input: '检查 token=root-secret 的服务状态',
    selectedCommand: 'demo token=selected-secret',
    provider: 'openai',
    model: 'gpt-test'
  })
  assert.equal(root, roots[0])
  assert.equal(roots[0].postCount, 1)
  assert.deepEqual(roots[0].config.inputs, {
    input: '检查 token=[REDACTED] 的服务状态'
  })
  assert.deepEqual(roots[0].config.metadata, {
    agentRunId: 'run-enabled',
    selectedCommand: 'demo token=[REDACTED]',
    provider: 'openai',
    model: 'gpt-test'
  })
  assert.deepEqual(roots[0].config.tags, ['shell-manage', 'query-agent'])
  assert.equal(roots[0].config.tracingEnabled, true)
  assert.doesNotMatch(JSON.stringify(roots[0].config), /trace-secret/u)
  assert.doesNotMatch(JSON.stringify(roots[0].config), /root-secret|selected-secret/u)
})

test('同一 agentRunId 复用根追踪并可交给 withRunTree', async () => {
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config) => {
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })

  const first = await store.start({ agentRunId: 'run-reused', langsmithApiKey: 'trace-secret' })
  const second = await store.start({ agentRunId: 'run-reused', langsmithApiKey: 'trace-secret' })

  assert.equal(second, first)
  assert.equal(store.getRoot('run-reused'), first)
  assert.equal(roots.length, 1)
  assert.equal(roots[0].postCount, 1)
})

test('每次运行都把当前 LangSmith 连接交给工厂，不能复用首个 API Key 或 endpoint', async () => {
  const connections: Array<{ apiKey: string; endpoint?: string; project?: string }> = []
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config, connection) => {
    connections.push({ ...connection })
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })

  await store.start({
    agentRunId: 'run-config-a',
    langsmithApiKey: 'trace-key-a',
    langsmithEndpoint: 'https://trace-a.example',
    langsmithProject: 'project-a'
  })
  await store.start({
    agentRunId: 'run-config-b',
    langsmithApiKey: 'trace-key-b',
    langsmithEndpoint: 'https://trace-b.example',
    langsmithProject: 'project-b'
  })

  assert.deepEqual(connections, [
    { apiKey: 'trace-key-a', endpoint: 'https://trace-a.example', project: 'project-a' },
    { apiKey: 'trace-key-b', endpoint: 'https://trace-b.example', project: 'project-b' }
  ])
  assert.equal(roots[0].config.project_name, 'project-a')
  assert.equal(roots[1].config.project_name, 'project-b')
  assert.doesNotMatch(JSON.stringify(roots.map((root) => root.config)), /trace-key-a|trace-key-b/u)
})

test('根追踪创建失败时清理缓存，不能污染后续 Agent 调用', async () => {
  const store = new QueryAgentTraceStore((config) => new FailingPostRunTree(config))

  await assert.rejects(
    store.start({ agentRunId: 'run-post-failed', langsmithApiKey: 'trace-secret' }),
    /trace backend unavailable/u
  )

  assert.equal(store.getRoot('run-post-failed'), undefined)
})

test('tool 子追踪记录脱敏命令、输出、状态和耗时', async () => {
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config) => {
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })
  await store.start({ agentRunId: 'run-tool', langsmithApiKey: 'trace-secret' })

  const recorded = await store.recordToolRun({
    agentRunId: 'run-tool',
    stepIndex: 2,
    command: 'curl https://example.test --token command-token',
    output: [
      'password=output-password',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'private-key-body',
      '-----END OPENSSH PRIVATE KEY-----',
      'lsv2_pt_abcdefghijklmnopqrstuvwxyz123456'
    ].join('\n'),
    status: 'completed',
    durationMs: 127
  })

  assert.equal(recorded, true)
  const child = roots[0].children[0]
  assert.equal(child.config.run_type, 'tool')
  assert.deepEqual(child.config.inputs, {
    command: 'curl https://example.test --token [REDACTED]'
  })
  assert.deepEqual(child.endCalls, [{
    outputs: {
      output: 'password=[REDACTED]\n[PRIVATE KEY REDACTED]\n[REDACTED]',
      status: 'completed',
      durationMs: 127,
      stepIndex: 2
    },
    error: undefined,
    metadata: { status: 'completed', durationMs: 127, stepIndex: 2 }
  }])
  assert.equal(child.postCount, 1)
  assert.equal(child.patchCount, 1)

  const recordedJson = JSON.stringify({ config: child.config, endCalls: child.endCalls })
  assert.doesNotMatch(
    recordedJson,
    /command-token|output-password|private-key-body|lsv2_pt_abcdefghijklmnopqrstuvwxyz123456/u
  )
})

test('tool 子追踪只接受单调递增的前三步', async () => {
  const store = new QueryAgentTraceStore((config) => new FakeRunTree(config))
  await store.start({ agentRunId: 'run-monotonic', langsmithApiKey: 'trace-secret' })
  const tool = (stepIndex: number) => store.recordToolRun({
    agentRunId: 'run-monotonic',
    stepIndex,
    command: `command-${stepIndex}`,
    output: 'ok',
    status: 'completed',
    durationMs: 1
  })

  assert.equal(await tool(1), true)
  assert.equal(await tool(1), false)
  assert.equal(await tool(3), true)
  assert.equal(await tool(2), false)
  assert.equal(await tool(4), false)
})

test('finish 记录结果后删除根追踪且重复调用幂等', async () => {
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config) => {
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })
  await store.start({ agentRunId: 'run-finish', langsmithApiKey: 'trace-secret' })

  await store.finish({
    agentRunId: 'run-finish',
    phase: 'failed',
    executedCommandCount: 2,
    stepCount: 3,
    durationMs: 456,
    stats: {
      durationMs: 321,
      estimatedTokens: 789,
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'stats-secret'
    } as never,
    finalAnswer: 'token=final-answer-secret',
    error: new Error([
      'token=finish-token',
      '-----BEGIN PRIVATE KEY-----',
      'finish-private-key',
      '-----END PRIVATE KEY-----'
    ].join('\n'))
  })
  await store.finish({
    agentRunId: 'run-finish',
    phase: 'completed',
    executedCommandCount: 3
  })

  assert.deepEqual(roots[0].endCalls, [{
    outputs: {
      phase: 'failed',
      executedCommandCount: 2,
      stepCount: 3,
      durationMs: 456,
      stats: {
        durationMs: 321,
        estimatedTokens: 789,
        provider: 'openai',
        model: 'gpt-test'
      },
      finalAnswer: 'token=[REDACTED]'
    },
    error: 'Error: token=[REDACTED]\n[PRIVATE KEY REDACTED]',
    metadata: {
      phase: 'failed',
      executedCommandCount: 2,
      stepCount: 3,
      durationMs: 456,
      stats: {
        durationMs: 321,
        estimatedTokens: 789,
        provider: 'openai',
        model: 'gpt-test'
      }
    }
  }])
  assert.equal(roots[0].patchCount, 1)
  assert.equal(store.getRoot('run-finish'), undefined)
  assert.equal(await store.recordToolRun({
    agentRunId: 'run-finish',
    stepIndex: 1,
    command: 'uptime',
    output: 'ok',
    status: 'completed',
    durationMs: 1
  }), false)

  const recordedJson = JSON.stringify(roots[0].endCalls)
  assert.doesNotMatch(recordedJson, /finish-token|finish-private-key|final-answer-secret|stats-secret/u)
})

test('shutdown 会结束全部尚未收口的根追踪', async () => {
  const roots: FakeRunTree[] = []
  const store = new QueryAgentTraceStore((config) => {
    const root = new FakeRunTree(config)
    roots.push(root)
    return root
  })
  await store.start({ agentRunId: 'run-a', langsmithApiKey: 'trace-secret' })
  await store.start({ agentRunId: 'run-b', langsmithApiKey: 'trace-secret' })

  await store.finishAll('应用退出')

  assert.equal(store.getRoot('run-a'), undefined)
  assert.equal(store.getRoot('run-b'), undefined)
  assert.deepEqual(roots.map((root) => root.endCalls[0]), [
    {
      outputs: { phase: 'cancelled', executedCommandCount: 0 },
      error: '应用退出',
      metadata: { phase: 'cancelled', executedCommandCount: 0 }
    },
    {
      outputs: { phase: 'cancelled', executedCommandCount: 0 },
      error: '应用退出',
      metadata: { phase: 'cancelled', executedCommandCount: 0 }
    }
  ])
})

test('shutdown 可等待显式 Client 的后台 trace 批次', async () => {
  let flushCount = 0
  const store = new QueryAgentTraceStore((config) => Object.assign(new FakeRunTree(config), {
    client: {
      async awaitPendingTraceBatches(): Promise<void> {
        flushCount += 1
      }
    }
  }))
  await store.start({ agentRunId: 'run-flush', langsmithApiKey: 'trace-secret' })

  await store.finishAll('应用退出')
  await store.flushPending()
  await store.flushPending()

  assert.equal(flushCount, 1)
})
