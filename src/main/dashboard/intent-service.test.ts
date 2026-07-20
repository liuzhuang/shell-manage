import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommandConfig, ProbePlanStep } from '../../shared/types'

const intentServicePath = './intent-service.ts'
const loadIntentService = () => import(intentServicePath) as Promise<typeof import('./intent-service')>

test('仅解析用户明确选择的连接命令', async () => {
  const { resolveSelectedShellCommand } = await loadIntentService()
  const commands: CommandConfig[] = [
    { name: 'production', command: 'ssh prod', tags: ['prod'] },
    { name: 'staging', command: 'ssh staging', tags: ['test'] }
  ]

  assert.equal(resolveSelectedShellCommand(undefined, commands), undefined)
  assert.equal(resolveSelectedShellCommand('missing', commands), undefined)
  assert.deepEqual(resolveSelectedShellCommand(' Production ', commands), commands[0])
})

test('连接命令始终由应用封装，探针文本不能绕过', async () => {
  const { composeStepCommand } = await loadIntentService()
  const step: ProbePlanStep = {
    stepId: 'probe',
    command: 'echo "ssh prod"',
    shellType: 'bash',
    timeoutMs: 5000,
    riskLevel: 'safe'
  }
  const composed = composeStepCommand('ssh prod', step)
  assert.notEqual(composed, step.command)
  assert.match(composed, /^ssh prod /u)
})

test('Agent 未精确选择候选连接时失败关闭', async () => {
  const { resolveDashboardShellCommand } = await loadIntentService()
  const commands: CommandConfig[] = [
    { name: 'production', command: 'ssh prod', tags: ['prod'] },
    { name: 'staging', command: 'ssh staging', tags: ['test'] }
  ]
  assert.equal(resolveDashboardShellCommand(undefined, 'Production', commands)?.name, 'production')
  assert.throws(
    () => resolveDashboardShellCommand(undefined, 'prod-master-typo', commands),
    /未从候选连接中选择有效目标/u
  )
  assert.equal(resolveDashboardShellCommand(undefined, 'local', []), undefined)
})
