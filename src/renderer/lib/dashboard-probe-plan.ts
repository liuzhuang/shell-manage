import type { DashboardExecuteProbeResponse, ProbePlanStep } from '../../shared/types'

export type ProbePlanStepResult = {
  step: ProbePlanStep
  status: 'succeeded' | 'failed' | 'skipped'
  response?: DashboardExecuteProbeResponse
  message?: string
}

export type ProbePlanExecutionResult = {
  success: boolean
  steps: ProbePlanStepResult[]
  finalResponse?: DashboardExecuteProbeResponse
  validationError?: string
}

function isSuccessful(response: DashboardExecuteProbeResponse): boolean {
  return response.success && !response.isBlockedBySecurity && (response.execResult?.exitCode ?? 0) === 0
}

function validatePlan(steps: ProbePlanStep[]): string | undefined {
  if (steps.length === 0) return '探针计划没有可执行步骤'
  const stepIds = new Set<string>()
  for (const step of steps) {
    if (!step.stepId || stepIds.has(step.stepId)) return `探针步骤 ID 缺失或重复：${step.stepId || '(empty)'}`
    const dependencies = (step as { dependsOn?: unknown }).dependsOn
    if (
      dependencies !== undefined &&
      (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== 'string' || !dependency.trim()))
    ) {
      return `探针步骤 ${step.stepId} 的 dependsOn 格式无效`
    }
    stepIds.add(step.stepId)
  }

  for (const step of steps) {
    const missing = (step.dependsOn || []).find((dependency) => !stepIds.has(dependency))
    if (missing) return `探针步骤 ${step.stepId} 依赖不存在的步骤 ${missing}`
  }

  const remainingDependencies = new Map(steps.map((step) => [step.stepId, new Set(step.dependsOn || [])]))
  const ready = steps.filter((step) => remainingDependencies.get(step.stepId)?.size === 0).map((step) => step.stepId)
  let visited = 0
  while (ready.length > 0) {
    const completedStepId = ready.shift() as string
    visited += 1
    for (const [stepId, dependencies] of remainingDependencies) {
      if (!dependencies.delete(completedStepId) || dependencies.size > 0) continue
      ready.push(stepId)
    }
  }
  return visited === steps.length ? undefined : '探针步骤包含循环依赖'
}

export async function executeProbePlan(
  steps: ProbePlanStep[],
  execute: (step: ProbePlanStep) => Promise<DashboardExecuteProbeResponse>
): Promise<ProbePlanExecutionResult> {
  const validationError = validatePlan(steps)
  if (validationError) {
    return {
      success: false,
      validationError,
      steps: steps.map((step) => ({ step, status: 'skipped', message: validationError }))
    }
  }

  const pending = new Map(steps.map((step) => [step.stepId, step]))
  const results = new Map<string, ProbePlanStepResult>()
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((step) => (step.dependsOn || []).every((dependency) => results.has(dependency)))
    await Promise.all(
      ready.map(async (step) => {
        pending.delete(step.stepId)
        const failedDependency = (step.dependsOn || []).find((dependency) => results.get(dependency)?.status !== 'succeeded')
        if (failedDependency) {
          results.set(step.stepId, {
            step,
            status: 'skipped',
            message: `依赖步骤 ${failedDependency} 未成功`
          })
          return
        }
        try {
          const response = await execute(step)
          results.set(step.stepId, {
            step,
            status: isSuccessful(response) ? 'succeeded' : 'failed',
            response,
            message: response.message
          })
        } catch (error) {
          results.set(step.stepId, {
            step,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    )
  }

  const orderedResults = steps.map((step) => results.get(step.stepId) as ProbePlanStepResult)
  const finalResponse = [...orderedResults].reverse().find((result) => result.status === 'succeeded')?.response
  return {
    success: orderedResults.every((result) => result.status === 'succeeded'),
    steps: orderedResults,
    finalResponse
  }
}
