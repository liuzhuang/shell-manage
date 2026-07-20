import assert from 'node:assert/strict'
import test from 'node:test'

const sparkleOutputPath = './sparkle-output.ts'
const loadSparkleOutput = () => import(sparkleOutputPath) as Promise<typeof import('./sparkle-output')>

test('parseSparkleOutputLine parses download progress', async () => {
  const { parseSparkleOutputLine } = await loadSparkleOutput()
  assert.deepEqual(parseSparkleOutputLine('Downloaded 640 out of 1000 bytes (64%)'), {
    kind: 'download',
    transferred: 640,
    total: 1000,
    percent: 64
  })
})

test('parseSparkleOutputLine parses extraction and installation stages', async () => {
  const { parseSparkleOutputLine } = await loadSparkleOutput()
  assert.deepEqual(parseSparkleOutputLine('Extracting Update (30%)'), {
    kind: 'installing',
    percent: 30
  })
  assert.deepEqual(parseSparkleOutputLine('Installing Update...'), { kind: 'installing' })
  assert.equal(parseSparkleOutputLine('Checking for Updates...'), null)
})

test('formatSparkleExitError maps actionable Sparkle exit codes', async () => {
  const { formatSparkleExitError } = await loadSparkleOutput()
  assert.match(formatSparkleExitError(4, ''), /没有找到/)
  assert.match(formatSparkleExitError(5, ''), /取消/)
  assert.match(formatSparkleExitError(8, ''), /权限/)
  assert.equal(formatSparkleExitError(1, 'Error: invalid feed'), 'Error: invalid feed')
  assert.match(formatSparkleExitError(null, ''), /unknown/)
})
