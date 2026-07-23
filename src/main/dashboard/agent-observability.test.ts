import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DASHBOARD_AGENT_EVAL_CASES,
  DASHBOARD_AGENT_NAMES,
  buildDashboardDelegationInstructions,
  buildDashboardTraceConfig,
  createDashboardModelCallCollector,
  evaluateDashboardAgentRun,
  selectDashboardAgentRoute
} from './agent-observability'

test('代表性任务覆盖全部 5 个 Dashboard agent 的选择决策', () => {
  assert.equal(DASHBOARD_AGENT_NAMES.length, 5)
  assert.deepEqual(
    DASHBOARD_AGENT_EVAL_CASES.map((item) => item.expectedAgent),
    DASHBOARD_AGENT_NAMES
  )
  assert.equal(new Set(DASHBOARD_AGENT_NAMES).size, 5)
})

test('路由仅在未明确选择连接时委派 session context agent', () => {
  const resolving = selectDashboardAgentRoute({
    actionType: 'CREATE',
    selectedShellCommandName: undefined
  })
  assert.equal(resolving.name, 'create:resolve-context')
  assert.deepEqual(resolving.expectedAgents, DASHBOARD_AGENT_NAMES)

  const selected = selectDashboardAgentRoute({
    actionType: 'UPDATE',
    selectedShellCommandName: '生产环境'
  })
  assert.equal(selected.name, 'update:selected-context')
  assert.deepEqual(selected.expectedAgents, DASHBOARD_AGENT_NAMES.slice(1))

  const instructions = buildDashboardDelegationInstructions(selected)
  assert.equal(instructions.includes('route=update:selected-context'), true)
  assert.equal(instructions.includes('session-context-agent'), false)
  for (const agentName of DASHBOARD_AGENT_NAMES.slice(1)) {
    assert.equal(instructions.includes(agentName), true)
  }
  assert.equal(instructions.includes('task 工具'), true)
})

test('运行评估统计委派命中、完成修复、延迟、模型调用与可见 token', () => {
  const route = selectDashboardAgentRoute({
    actionType: 'CREATE',
    selectedShellCommandName: undefined
  })
  const metrics = evaluateDashboardAgentRun({
    route,
    messages: [
      {
        type: 'ai',
        content: '',
        tool_calls: [
          { name: 'task', args: { subagent_type: 'session-context-agent' } },
          { name: 'task', args: { subagent_type: 'read-only-planner-agent' } },
          { name: 'task', args: { subagent_type: 'general-purpose' } }
        ],
        usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
      },
      {
        type: 'ai',
        content: '{}',
        usage_metadata: { input_tokens: 80, output_tokens: 30, total_tokens: 110 }
      }
    ],
    repairMessages: [
      {
        type: 'ai',
        content: '{}',
        usage_metadata: { input_tokens: 40, output_tokens: 10, total_tokens: 50 }
      }
    ],
    completed: true,
    repairAttempted: true,
    latencyMs: {
      total: 900,
      agentInit: 100,
      invoke: 600,
      repair: 200
    }
  })

  assert.equal(metrics.delegationCount, 3)
  assert.equal(metrics.matchedDelegationCount, 2)
  assert.equal(metrics.delegationHitRate, 0.4)
  assert.deepEqual(metrics.observedAgents, [
    'session-context-agent',
    'read-only-planner-agent'
  ])
  assert.deepEqual(metrics.unexpectedAgents, ['general-purpose'])
  assert.equal(metrics.completed, true)
  assert.equal(metrics.repairAttempted, true)
  assert.equal(metrics.repairSucceeded, true)
  assert.deepEqual(metrics.latencyMs, {
    total: 900,
    agentInit: 100,
    invoke: 600,
    repair: 200
  })
  assert.deepEqual(metrics.modelCalls, {
    orchestrator: 2,
    delegated: 3,
    repair: 1,
    minimumTotal: 6
  })
  assert.deepEqual(metrics.usage, {
    inputTokens: 220,
    outputTokens: 60,
    totalTokens: 280,
    observedMessageCount: 3
  })
})

test('LangSmith 配置携带 agentName、route、repair 和 calls 维度', () => {
  const route = selectDashboardAgentRoute({
    actionType: 'CREATE',
    selectedShellCommandName: undefined
  })
  const config = buildDashboardTraceConfig({
    threadId: 'thread-1',
    agentName: 'dashboard-orchestrator',
    route,
    repair: false,
    calls: route.expectedAgents.length
  })

  assert.equal(config.runName, 'dashboard-orchestrator')
  assert.deepEqual(config.configurable, { thread_id: 'thread-1' })
  assert.deepEqual(config.metadata, {
    agentName: 'dashboard-orchestrator',
    route: 'create:resolve-context',
    repair: false,
    calls: 5,
    callCountKind: 'planned',
    expectedAgents: [...DASHBOARD_AGENT_NAMES]
  })
  assert.deepEqual(config.tags, [
    'dashboard',
    'agentName:dashboard-orchestrator',
    'route:create:resolve-context',
    'repair:false',
    'calls:5'
  ])
})

test('checkpoint 累计消息只评估最后一个 HumanMessage 之后的当前轮', () => {
  const metrics = evaluateDashboardAgentRun({
    route: selectDashboardAgentRoute({ actionType: 'CREATE' }),
    messages: [
      {
        type: 'ai',
        content: '',
        tool_calls: [{ name: 'task', args: { subagent_type: 'session-context-agent' } }],
        usage_metadata: { input_tokens: 900, output_tokens: 90, total_tokens: 990 }
      },
      { type: 'human', content: '当前轮' },
      {
        type: 'ai',
        content: '{}',
        tool_calls: [{ name: 'task', args: { subagent_type: 'read-only-planner-agent' } }],
        usage_metadata: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }
      }
    ],
    completed: true,
    repairAttempted: false,
    latencyMs: { total: 100 }
  })

  assert.equal(metrics.delegationCount, 1)
  assert.deepEqual(metrics.observedAgents, ['read-only-planner-agent'])
  assert.equal(metrics.modelCalls.orchestrator, 1)
  assert.deepEqual(metrics.usage, {
    inputTokens: 20,
    outputTokens: 5,
    totalTokens: 25,
    observedMessageCount: 1
  })
})

test('callback collector 汇总 DeepAgents 嵌套模型调用和实际 usage', () => {
  const collector = createDashboardModelCallCollector()
  const callback = collector.callback as any
  callback.handleChatModelStart({}, [], 'orchestrator-run')
  callback.handleChatModelStart({}, [], 'orchestrator-run')
  callback.handleChatModelStart({}, [], 'subagent-run')
  callback.handleLLMEnd({
    generations: [[{
      text: '',
      message: {
        type: 'ai',
        content: '{}',
        usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
      }
    }]]
  }, 'orchestrator-run')
  callback.handleLLMEnd({
    generations: [[{
      text: '',
      message: {
        type: 'ai',
        content: '{}',
        usage_metadata: { input_tokens: 60, output_tokens: 15, total_tokens: 75 }
      }
    }]]
  }, 'subagent-run')

  const observation = collector.snapshot()
  assert.deepEqual(observation, {
    totalCalls: 2,
    completedCalls: 2,
    usageReportedCalls: 2,
    inputTokens: 160,
    outputTokens: 35,
    totalTokens: 195
  })

  const metrics = evaluateDashboardAgentRun({
    route: selectDashboardAgentRoute({ actionType: 'CREATE' }),
    messages: [{ type: 'human', content: '当前轮' }, { type: 'ai', content: '{}' }],
    completed: true,
    repairAttempted: false,
    latencyMs: { total: 100 },
    modelObservation: observation
  })
  assert.equal(metrics.modelCalls.total, 2)
  assert.equal(metrics.modelCalls.completed, 2)
  assert.equal(metrics.modelCalls.usageReported, 2)
  assert.deepEqual(metrics.usage, {
    inputTokens: 160,
    outputTokens: 35,
    totalTokens: 195,
    observedMessageCount: 2,
    source: 'callback'
  })
})
