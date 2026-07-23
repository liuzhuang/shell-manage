import assert from 'node:assert/strict'
import test from 'node:test'
import type { QueryAgentPhase } from '../shared/types'
import type { QueryAgentStepRequest } from '../shared/query-agent'
import { runQueryAgent } from './query-agent-runner'

test('执行命令后把脱敏输出交给下一步分析', async () => {
  const phases: QueryAgentPhase[] = []
  const requests: QueryAgentStepRequest[] = []

  const result = await runQueryAgent({
    requestStep: async (request) => {
      requests.push({ ...request, outputLines: [...request.outputLines] })
      return requests.length === 1
        ? { type: 'command', command: 'uptime' }
        : { type: 'reply', message: '系统负载正常。' }
    },
    executeCommand: async (command) => {
      assert.equal(command, 'uptime')
      return { status: 'completed', outputLines: ['load average: [redacted]'] }
    },
    onPhase: (phase) => {
      phases.push(phase)
    }
  })

  assert.deepEqual(requests, [
    { outputLines: [], forceReply: false },
    { outputLines: ['load average: [redacted]'], forceReply: false }
  ])
  assert.deepEqual(phases, ['generating_query', 'executing', 'analyzing_result', 'completed'])
  assert.equal(result.phase, 'completed')
  assert.equal(result.step?.type, 'reply')
  assert.equal(result.executedCommandCount, 1)
})

test('多步命令输出会累积交给最终分析', async () => {
  const requests: QueryAgentStepRequest[] = []

  const result = await runQueryAgent({
    requestStep: async (request) => {
      requests.push({ ...request, outputLines: [...request.outputLines] })
      if (requests.length === 1) return { type: 'command', command: 'uptime' }
      if (requests.length === 2) return { type: 'command', command: 'df -h' }
      return { type: 'reply', message: '负载与磁盘状态已分析。' }
    },
    executeCommand: async (command) => ({
      status: 'completed',
      outputLines: Array.from({ length: 45 }, (_, index) => `${command}-output-${index}`)
    })
  })

  assert.equal(requests[2].outputLines.length, 80)
  assert.equal(requests[2].outputLines[0], 'uptime-output-5')
  assert.equal(requests[2].outputLines.at(-1), 'df -h-output-44')
  assert.equal(result.phase, 'completed')
  assert.equal(result.executedCommandCount, 2)
})

test('三条命令后只请求一次强制总结且绝不执行第四条命令', async () => {
  const forceReplyValues: boolean[] = []
  const executedCommands: string[] = []

  const result = await runQueryAgent({
    requestStep: async ({ forceReply }) => {
      forceReplyValues.push(forceReply)
      const index = forceReplyValues.length
      return index <= 4
        ? { type: 'command', command: `command-${index}` }
        : { type: 'reply', message: '不应请求到这里。' }
    },
    executeCommand: async (command) => {
      executedCommands.push(command)
      return { status: 'completed', outputLines: [`${command}-output`] }
    }
  })

  assert.deepEqual(forceReplyValues, [false, false, false, true])
  assert.deepEqual(executedCommands, ['command-1', 'command-2', 'command-3'])
  assert.equal(result.phase, 'failed')
  assert.equal(result.step?.type, 'command')
})

test('相同命令只执行一次并使用首次输出强制总结', async () => {
  const requests: QueryAgentStepRequest[] = []
  const executedCommands: string[] = []
  const duplicateCommands: string[] = []

  const result = await runQueryAgent({
    requestStep: async (request) => {
      requests.push({ ...request, outputLines: [...request.outputLines] })
      if (requests.length < 3) return { type: 'command', command: 'df -h' }
      return { type: 'reply', message: '根分区使用率为 68%。' }
    },
    executeCommand: async (command) => {
      executedCommands.push(command)
      return { status: 'completed', outputLines: ['/dev/vda1 1.1T 761G 365G 68% /'] }
    },
    onDuplicateCommand: (command) => {
      duplicateCommands.push(command)
    }
  })

  assert.deepEqual(requests.map((request) => request.forceReply), [false, false, true])
  assert.deepEqual(requests[2].outputLines, ['/dev/vda1 1.1T 761G 365G 68% /'])
  assert.deepEqual(executedCommands, ['df -h'])
  assert.deepEqual(duplicateCommands, ['df -h'])
  assert.equal(result.phase, 'completed')
  assert.equal(result.executedCommandCount, 1)
})

test('人工确认执行后从 LangGraph checkpoint 恢复并继续分析', async () => {
  const phases: QueryAgentPhase[] = []
  const requests: QueryAgentStepRequest[] = []

  const result = await runQueryAgent({
    requestStep: async (request) => {
      requests.push({ ...request, outputLines: [...request.outputLines] })
      return requests.length === 1
        ? { type: 'command', command: 'df -h' }
        : { type: 'reply', message: '磁盘状态已分析。' }
    },
    executeCommand: async () => ({ status: 'waiting_for_review', message: '需要人工确认。' }),
    reviewCommand: async (review) => {
      assert.deepEqual(review, { command: 'df -h', message: '需要人工确认。' })
      return { status: 'completed', outputLines: ['/dev/vda1 1.1T 761G 365G 68% /'] }
    },
    onPhase: (phase) => {
      phases.push(phase)
    }
  })

  assert.deepEqual(requests[1].outputLines, ['/dev/vda1 1.1T 761G 365G 68% /'])
  assert.deepEqual(phases, ['generating_query', 'executing', 'waiting_for_review', 'analyzing_result', 'completed'])
  assert.equal(result.phase, 'completed')
  assert.equal(result.executedCommandCount, 1)
})

test('终止步骤立即停止且不再请求或执行', async () => {
  for (const terminalPhase of ['waiting_for_review', 'failed', 'cancelled'] as const) {
    const phases: QueryAgentPhase[] = []
    let requestCount = 0
    let executeCount = 0

    const result = await runQueryAgent({
      requestStep: async () => {
        requestCount += 1
        return { type: terminalPhase, message: 'stop' }
      },
      executeCommand: async () => {
        executeCount += 1
        return { status: 'completed', outputLines: [] }
      },
      onPhase: (phase) => {
        phases.push(phase)
      }
    })

    assert.equal(requestCount, 1, terminalPhase)
    assert.equal(executeCount, 0, terminalPhase)
    assert.deepEqual(phases, ['generating_query', terminalPhase], terminalPhase)
    assert.equal(result.phase, terminalPhase)
  }
})

test('执行边界返回终止状态时不再请求下一步', async () => {
  for (const terminalPhase of ['waiting_for_review', 'failed', 'cancelled'] as const) {
    const phases: QueryAgentPhase[] = []
    let requestCount = 0

    const result = await runQueryAgent({
      requestStep: async () => {
        requestCount += 1
        return requestCount === 1
          ? { type: 'command', command: 'uptime' }
          : { type: 'reply', message: '不应请求到这里。' }
      },
      executeCommand: async () => ({ status: terminalPhase, message: 'stop' }),
      onPhase: (phase) => {
        phases.push(phase)
      }
    })

    assert.equal(requestCount, 1, terminalPhase)
    assert.deepEqual(phases, ['generating_query', 'executing', terminalPhase], terminalPhase)
    assert.equal(result.phase, terminalPhase)
  }
})

test('执行期间取消后立即停止且不再请求分析', async () => {
  const phases: QueryAgentPhase[] = []
  let active = true
  let requestCount = 0

  const result = await runQueryAgent({
    requestStep: async () => {
      requestCount += 1
      return requestCount === 1
        ? { type: 'command', command: 'uptime' }
        : { type: 'reply', message: '不应请求到这里。' }
    },
    executeCommand: async () => {
      active = false
      return { status: 'completed', outputLines: ['ignored'] }
    },
    shouldContinue: () => active,
    onPhase: (phase) => {
      phases.push(phase)
    }
  })

  assert.equal(requestCount, 1)
  assert.deepEqual(phases, ['generating_query', 'executing', 'cancelled'])
  assert.equal(result.phase, 'cancelled')
})
