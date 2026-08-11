import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiOnboardingPrompt, buildPublicAccessSetupPrompt } from './ai-onboarding-prompt'

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

test('公网访问提示词只做准备，不执行发布或开启隧道', () => {
  const base = {
    configPath: '/tmp/.shell-manage/config.yaml',
    commandName: 'demo',
    command: 'cd "/tmp/demo" && npm run dev -- --token secret-value',
    webUrl: 'http://user:password@localhost:4173'
  }
  const vercelPrompt = buildPublicAccessSetupPrompt({ ...base, provider: 'vercel' })
  const cloudflarePrompt = buildPublicAccessSetupPrompt({ ...base, provider: 'cloudflare' })
  const cpolarPrompt = buildPublicAccessSetupPrompt({ ...base, provider: 'cpolar' })

  assert.match(vercelPrompt, /vercel deploy --dry/)
  assert.match(vercelPrompt, /禁止执行 vercel deploy --prod/)
  assert.match(vercelPrompt, /返回 ShellManage.*点击.*发布/)
  assert.doesNotMatch(vercelPrompt, /cpolar|cloudflared/)
  assert.match(cloudflarePrompt, /禁止执行 cloudflared tunnel/)
  assert.doesNotMatch(cloudflarePrompt, /cpolar|vercel deploy/)
  assert.match(cpolarPrompt, /禁止执行 cpolar http/)
  assert.match(cpolarPrompt, /cpolar-connect/)
  assert.match(cpolarPrompt, /不要.*token.*聊天/)
  assert.match(cpolarPrompt, /Host.*显式重写.*回环地址/)
  assert.match(cpolarPrompt, /Host 是 "http:".*不要把 http:.*allowedHosts/)
  assert.match(cpolarPrompt, /不要设置 allowedHosts: true/)
  assert.doesNotMatch(cpolarPrompt, /cloudflared|vercel deploy/)
  for (const prompt of [vercelPrompt, cloudflarePrompt, cpolarPrompt]) {
    assert.doesNotMatch(prompt, /secret-value|user:password/)
    assert.match(prompt, /\[REDACTED\]/)
  }
})
