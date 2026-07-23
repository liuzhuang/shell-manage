import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeToolCallingModel } from 'langchain'
import type { AppConfig, QueryAiRequest } from '../shared/types'
import {
  LlmService,
  parseQueryAiAction,
  QUERY_AGENT_RESPONSE_SCHEMA,
  type StructuredAgentInvocation
} from './llm-service'

const config: AppConfig = {
  commands: [],
  presets: [],
  settings: {
    llm: { provider: 'openai', endpoint: '', apiKey: '', model: 'test' },
    logBufferLines: 1000
  }
}

const request: QueryAiRequest = {
  requestId: 'test',
  input: '查看支付失败',
  history: [],
  sessionLogs: [],
  queryOutputLines: []
}

test('Query Agent fails closed when the model is unavailable', async () => {
  await assert.rejects(new LlmService().chatToShell(request, config, () => undefined), /配置有效的 AI API Key/)
})

test('AI 查日志使用不含终端上下文的独立 LLM 风险判断，并采用更严格结果', async () => {
  const invocations: StructuredAgentInvocation[] = []
  const phases: string[] = []
  const service = new LlmService(async (invocation) => {
    invocations.push(invocation)
    if (invocation.responseSchema.title === 'query_agent_action') {
      return {
        type: 'command',
        message: '查看系统状态',
        command: 'uptime',
        riskLevel: 'safe',
        riskReason: '生成阶段认为是只读查询。'
      }
    }
    return {
      riskLevel: 'review',
      riskReason: '独立判断要求人工确认。',
      isUncertain: false
    }
  })
  const result = await service.chatToShell(
    {
      ...request,
      agentRunId: 'agent-run-1',
      stepIndex: 2,
      input: '查看状态 INPUT_SECRET',
      history: [{ role: 'user', content: 'HISTORY_SECRET' }],
      sessionLogs: ['TERMINAL_SECRET'],
      queryOutputLines: ['QUERY_OUTPUT_SECRET']
    },
    {
      ...config,
      settings: {
        ...config.settings,
        llm: { ...config.settings.llm, apiKey: 'test-key' }
      }
    },
    (phase) => {
      phases.push(phase)
    }
  )

  assert.equal(invocations.length, 2)
  const riskInvocation = invocations[1]
  const riskInput = riskInvocation.messages
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n')
  assert.match(riskInput, /uptime/)
  assert.doesNotMatch(riskInput, /INPUT_SECRET|HISTORY_SECRET|TERMINAL_SECRET|QUERY_OUTPUT_SECRET/)
  assert.deepEqual(phases, ['generating_query', 'assessing_risk'])
  assert.equal(invocations[0].runName, 'query-agent-generate')
  assert.equal(invocations[1].runName, 'query-agent-assess-risk')
  assert.equal(invocations[0].metadata?.agentRunId, 'agent-run-1')
  assert.equal(invocations[1].metadata?.stepIndex, 2)
  assert.match(invocations[0].systemPrompt, /当前、实时或最新.*必须使用 command/u)
  assert.equal(result.action.riskLevel, 'review')
  assert.match(result.action.riskReason, /独立判断要求人工确认/)
  assert.ok((result.stats.estimatedTokens || 0) > 100)
})

test('独立 LLM 风险判断无效、不确定或调用失败时停止自动执行', async () => {
  const invalidAssessments: unknown[] = [
    null,
    { riskLevel: 'safe', riskReason: '', isUncertain: false },
    { riskLevel: 'safe', riskReason: '无法确定命令真实作用。', isUncertain: true },
    { riskLevel: 'safe', riskReason: '缺少不确定标记。' }
  ]

  for (const assessment of invalidAssessments) {
    let invocationCount = 0
    const service = new LlmService(async () => {
      invocationCount += 1
      if (invocationCount === 1) {
        return {
          type: 'command',
          message: '查看系统状态',
          command: 'uptime',
          riskLevel: 'safe',
          riskReason: '生成阶段认为是只读查询。'
        }
      }
      return assessment
    })
    const result = await service.chatToShell(
      request,
      {
        ...config,
        settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
      },
      () => undefined
    )
    assert.equal(result.action.riskLevel, 'review')
  }

  let invocationCount = 0
  const failedService = new LlmService(async () => {
    invocationCount += 1
    if (invocationCount === 1) {
      return {
        type: 'command',
        message: '查看系统状态',
        command: 'uptime',
        riskLevel: 'safe',
        riskReason: '生成阶段认为是只读查询。'
      }
    }
    throw new Error('risk model timeout')
  })
  const failedResult = await failedService.chatToShell(
    request,
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )
  assert.equal(failedResult.action.riskLevel, 'review')
  assert.match(failedResult.action.riskReason, /独立风险判断暂不可用/)
})

test('独立风险模型提示明确禁止把临时目录删除降级为 safe', async () => {
  let capturedInvocation: StructuredAgentInvocation | undefined
  const service = new LlmService(async (invocation) => {
    capturedInvocation = invocation
    return {
      riskLevel: 'blocked',
      riskReason: '删除操作具有不可逆副作用。',
      isUncertain: false
    }
  })

  const result = await service.assessCommandRisk(
    'rm -rf /tmp/shell-manage-risk-eval',
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    }
  )

  assert.equal(result.riskLevel, 'blocked')
  assert.match(capturedInvocation?.systemPrompt || '', /rm、rmdir、unlink、shred、find -delete/u)
  assert.match(capturedInvocation?.systemPrompt || '', /\/tmp.*不得降级/u)
})

test('Query Agent 结构化响应必须包含风险判断', () => {
  assert.deepEqual(
    QUERY_AGENT_RESPONSE_SCHEMA.required,
    ['type', 'message', 'riskLevel', 'riskReason']
  )
})

test('Query Agent 使用 LangChain 内置重试修复缺失字段的结构化响应', async () => {
  const service = new LlmService()
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{
        name: 'query_agent_action',
        id: 'missing-type',
        args: { message: '格式不完整', riskLevel: 'safe', riskReason: '只读查询。' }
      }],
      [{
        name: 'query_agent_action',
        id: 'valid-retry',
        args: { type: 'reply', message: '已修复结构化输出。', riskLevel: 'safe', riskReason: '无需执行命令。' }
      }]
    ]
  })
  Object.defineProperty(service, 'createModel', { value: () => model })

  const result = await service.chatToShell(
    request,
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )

  assert.equal(result.action.type, 'reply')
  assert.equal(result.answer, '已修复结构化输出。')
})

test('Query Agent 风险字段缺失时保留命令但不得重试为 safe', async () => {
  const service = new LlmService()
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{
        name: 'query_agent_action',
        id: 'missing-risk',
        args: { type: 'command', message: '查看系统状态', command: 'uptime', riskReason: '只读查询。' }
      }],
      [{
        name: 'query_agent_action',
        id: 'unsafe-retry',
        args: { type: 'command', message: '查看系统状态', command: 'uptime', riskLevel: 'safe', riskReason: '只读查询。' }
      }],
      [{
        name: 'query_command_risk_assessment',
        id: 'independent-safe',
        args: { riskLevel: 'safe', riskReason: '只读查询。', isUncertain: false }
      }]
    ]
  })
  Object.defineProperty(service, 'createModel', { value: () => model })

  const result = await service.chatToShell(
    request,
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )

  assert.equal(result.action.command, 'uptime')
  assert.equal(result.action.riskLevel, 'review')
  assert.match(result.action.riskReason, /首次返回的风险字段不完整/)
})

test('独立风险结构无效时不重试并降为手动确认', async () => {
  const service = new LlmService()
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{
        name: 'query_agent_action',
        id: 'generated-command',
        args: { type: 'command', message: '查看系统状态', command: 'uptime', riskLevel: 'safe', riskReason: '只读查询。' }
      }],
      [{
        name: 'query_command_risk_assessment',
        id: 'missing-risk-level',
        args: { riskReason: '只读查询。', isUncertain: false }
      }],
      [{
        name: 'query_command_risk_assessment',
        id: 'unsafe-retry',
        args: { riskLevel: 'safe', riskReason: '只读查询。', isUncertain: false }
      }]
    ]
  })
  Object.defineProperty(service, 'createModel', { value: () => model })

  const result = await service.chatToShell(
    request,
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )

  assert.equal(result.action.riskLevel, 'review')
  assert.match(result.action.riskReason, /独立风险判断暂不可用/)
})

test('Query Agent 拒绝超过执行与追踪边界的模型输出', () => {
  assert.throws(() => parseQueryAiAction({
    type: 'command',
    message: '执行检查',
    command: 'x'.repeat(12_001),
    riskLevel: 'safe',
    riskReason: '只读检查'
  }), /命令过长/u)
  assert.throws(() => parseQueryAiAction({
    type: 'reply',
    message: 'x'.repeat(12_001),
    riskLevel: 'safe',
    riskReason: '无需执行'
  }), /回复过长/u)
  assert.throws(() => parseQueryAiAction({
    type: 'reply',
    message: '完成',
    riskLevel: 'safe',
    riskReason: 'x'.repeat(4_001)
  }), /风险理由过长/u)
})

test('达到三条命令上限后，系统指令强制模型总结且不得继续返回命令', async () => {
  const invocations: StructuredAgentInvocation[] = []
  const service = new LlmService(async (invocation) => {
    invocations.push(invocation)
    return {
      type: 'reply',
      message: '已根据三次查询结果完成总结。',
      riskLevel: 'safe',
      riskReason: '未继续生成命令。'
    }
  })

  await service.chatToShell(
    { ...request, forceReply: true },
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )

  assert.equal(invocations.length, 1)
  assert.match(invocations[0].systemPrompt, /不得返回 command/)
})

test('取消信号会传入 Agent 调用并中止当前生成', async () => {
  const controller = new AbortController()
  const service = new LlmService(async (invocation) => {
    if (!invocation.signal) {
      return {
        type: 'reply',
        message: '未收到取消信号。',
        riskLevel: 'safe',
        riskReason: '测试响应。'
      }
    }
    return new Promise((_, reject) => {
      invocation.signal?.addEventListener('abort', () => {
        reject(new DOMException('已取消', 'AbortError'))
      }, { once: true })
    })
  })

  const pending = service.chatToShell(
    request,
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined,
    controller.signal
  )
  controller.abort()

  await assert.rejects(pending, { name: 'AbortError' })
})

test('进入模型与 LangSmith 追踪前会脱敏用户输入、历史和私钥内容', async () => {
  const invocations: StructuredAgentInvocation[] = []
  const service = new LlmService(async (invocation) => {
    invocations.push(invocation)
    return {
      type: 'reply',
      message: '已完成脱敏分析。',
      riskLevel: 'safe',
      riskReason: '未生成命令。'
    }
  })

  await service.chatToShell(
    {
      ...request,
      input: 'token=input-secret\n-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
      history: [{ role: 'user', content: 'password: history-secret' }],
      targetLogPath: '/tmp/app.log?api_key=path-secret',
      rememberedLogPaths: ['/var/log/app.log', '/opt/app/logs/error.log']
    },
    {
      ...config,
      settings: { ...config.settings, llm: { ...config.settings.llm, apiKey: 'test-key' } }
    },
    () => undefined
  )

  const tracedInput = invocations[0].messages
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n')
  assert.doesNotMatch(tracedInput, /input-secret|history-secret|path-secret|private-material/)
  assert.match(tracedInput, /\[REDACTED\]|\[PRIVATE KEY REDACTED\]/)
  assert.match(tracedInput, /\/var\/log\/app\.log/)
  assert.match(tracedInput, /\/opt\/app\/logs\/error\.log/)
})

test('Query Agent 使用 command 结构，并保留明确的风险理由', () => {
  assert.deepEqual(
    parseQueryAiAction({
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel: 'safe',
      riskReason: '只读取系统运行状态。'
    }),
    {
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel: 'safe',
      riskReason: '只读取系统运行状态。'
    }
  )
})

test('Query Agent 风险缺失或格式错误时降为手动确认，不生成 fallback 命令', () => {
  for (const riskLevel of [undefined, 'unknown']) {
    const action = parseQueryAiAction({
      type: 'command',
      message: '查看系统状态',
      command: 'uptime',
      riskLevel,
      riskReason: ''
    })
    assert.equal(action.command, 'uptime')
    assert.equal(action.riskLevel, 'review')
    assert.match(action.riskReason, /手动确认/)
  }
})

test('Query Agent 拒绝旧业务路由类型和无命令的 command action', () => {
  assert.throws(
    () => parseQueryAiAction({ type: 'propose_command', message: 'x', command: 'uptime', riskLevel: 'safe', riskReason: 'x' }),
    /未知操作/
  )
  assert.throws(
    () => parseQueryAiAction({ type: 'command', message: 'x', riskLevel: 'safe', riskReason: 'x' }),
    /单行命令/
  )
})
