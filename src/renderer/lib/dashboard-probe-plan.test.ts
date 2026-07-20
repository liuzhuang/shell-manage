import assert from 'node:assert/strict'
import test from 'node:test'
import type { DashboardExecuteProbeResponse, ProbePlanStep } from '../../shared/types'
import { executeProbePlan } from './dashboard-probe-plan'

function step(stepId: string, dependsOn?: string[]): ProbePlanStep {
  return { stepId, dependsOn, command: stepId, shellType: 'bash', timeoutMs: 5000, riskLevel: 'safe' }
}

function response(stdout: string, exitCode = 0): DashboardExecuteProbeResponse {
  return {
    success: true,
    isBlockedBySecurity: false,
    execResult: { exitCode, stdout, stderr: '', durationMs: 1 }
  }
}

test('并发执行独立步骤，并在依赖完成后继续', async () => {
  let running = 0
  let maxRunning = 0
  const calls: string[] = []
  const result = await executeProbePlan([step('a'), step('b'), step('c', ['a', 'b'])], async (current) => {
    calls.push(current.stepId)
    running += 1
    maxRunning = Math.max(maxRunning, running)
    await Promise.resolve()
    running -= 1
    return response(current.stepId)
  })

  assert.equal(result.success, true)
  assert.equal(maxRunning, 2)
  assert.deepEqual(calls.slice(0, 2).sort(), ['a', 'b'])
  assert.equal(calls[2], 'c')
  assert.equal(result.finalResponse?.execResult?.stdout, 'c')
})

test('失败步骤会阻断依赖步骤，但不阻断独立分支', async () => {
  const calls: string[] = []
  const result = await executeProbePlan([step('a'), step('b', ['a']), step('c')], async (current) => {
    calls.push(current.stepId)
    return response(current.stepId, current.stepId === 'a' ? 1 : 0)
  })

  assert.equal(result.success, false)
  assert.deepEqual(calls.sort(), ['a', 'c'])
  assert.deepEqual(result.steps.map(({ status }) => status), ['failed', 'skipped', 'succeeded'])
  assert.equal(result.finalResponse?.execResult?.stdout, 'c')
})

test('缺失依赖时不执行任何步骤', async () => {
  let calls = 0
  const result = await executeProbePlan([step('a', ['missing'])], async () => {
    calls += 1
    return response('unexpected')
  })

  assert.equal(calls, 0)
  assert.match(result.validationError || '', /不存在/)
  assert.equal(result.steps[0].status, 'skipped')
})

test('循环依赖时不执行任何步骤', async () => {
  let calls = 0
  const result = await executeProbePlan([step('a', ['b']), step('b', ['a'])], async () => {
    calls += 1
    return response('unexpected')
  })

  assert.equal(calls, 0)
  assert.match(result.validationError || '', /循环依赖/)
  assert.deepEqual(result.steps.map(({ status }) => status), ['skipped', 'skipped'])
})

test('非法 dependsOn 时失败关闭', async () => {
  let calls = 0
  const invalid = { ...step('a'), dependsOn: 'b' } as unknown as ProbePlanStep
  const result = await executeProbePlan([invalid], async () => {
    calls += 1
    return response('unexpected')
  })

  assert.equal(calls, 0)
  assert.match(result.validationError || '', /dependsOn/)
})
