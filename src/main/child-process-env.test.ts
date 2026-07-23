import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChildProcessEnvironment } from './child-process-env'

test('子进程环境不会继承应用配置注入的 LangSmith 密钥', () => {
  const source: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    LANGSMITH_API_KEY: 'langsmith-secret',
    LANGCHAIN_API_KEY: 'legacy-secret',
    LANGSMITH_PROJECT: 'shell-manage'
  }

  const result = buildChildProcessEnvironment(source)

  assert.deepEqual(result, {
    PATH: '/usr/bin:/bin',
    LANGSMITH_PROJECT: 'shell-manage'
  })
  assert.equal(source.LANGSMITH_API_KEY, 'langsmith-secret')
  assert.equal(source.LANGCHAIN_API_KEY, 'legacy-secret')
})
