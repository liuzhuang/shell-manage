import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiOnboardingPrompt } from './ai-onboarding-prompt'

test('AI 接入提示词要求展示差异并在明确确认后才写配置', () => {
  const prompt = buildAiOnboardingPrompt({
    configPath: '/tmp/.shell-manage/config.yaml',
    existingCommandNames: ['dev']
  })

  assert.match(prompt, /展示.*拟修改|最小.*差异/)
  assert.match(prompt, /明确确认/)
  assert.match(prompt, /未.*确认.*不得写入/)
  assert.match(prompt, /确认后.*写入/)
  assert.match(prompt, /覆盖.*再次确认|二次确认/)
  assert.doesNotMatch(prompt, /自动写入配置文件/)
})
