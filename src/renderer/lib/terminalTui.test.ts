import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTerminalTuiEntry } from './terminalTui'

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g

test('终端活动流使用时间、固定角色列与续行导轨', () => {
  const output = formatTerminalTuiEntry({
    at: new Date(2026, 6, 18, 18, 32, 17).getTime(),
    label: 'YOU',
    tone: 'user',
    content: '分析 CPU\r\n并检查内存'
  })

  assert.equal(
    output.replace(ANSI_PATTERN, ''),
    '\r\n18:32:17 │ YOU        │ 分析 CPU\r\n         │            │ 并检查内存\r\n'
  )
})

test('用户、AI、命令与风险状态使用不同的 ANSI 色彩层级', () => {
  const at = new Date(2026, 6, 18, 18, 32, 17).getTime()
  const user = formatTerminalTuiEntry({ at, label: 'YOU', tone: 'user', content: '用户消息' })
  const assistant = formatTerminalTuiEntry({ at, label: 'AI', tone: 'assistant', content: 'AI 消息' })
  const command = formatTerminalTuiEntry({ at, label: 'AI Command', tone: 'success', content: 'df -h' })
  const warning = formatTerminalTuiEntry({ at, label: '风险', tone: 'warning', content: '等待确认' })

  assert.match(user, /\x1b\[1;36mYOU/)
  assert.match(user, /\x1b\[1;37m18:32:17/)
  assert.match(assistant, /\x1b\[1;35mAI/)
  assert.match(command, /\x1b\[1;32mAI Command/)
  assert.match(warning, /\x1b\[1;33m风险/)
})

test('空内容不写入终端', () => {
  assert.equal(
    formatTerminalTuiEntry({ at: Date.now(), label: 'AI', tone: 'assistant', content: '  \n ' }),
    ''
  )
})

test('消息正文不能注入终端控制序列', () => {
  const output = formatTerminalTuiEntry({
    at: new Date(2026, 6, 18, 18, 32, 17).getTime(),
    label: 'AI',
    tone: 'assistant',
    content: '保留\x1b[2J正文\x1b]0;伪造标题\x07\n下一行\u0007'
  })

  const plainText = output.replace(ANSI_PATTERN, '')
  assert.match(plainText, /保留正文/)
  assert.match(plainText, /下一行/)
  assert.doesNotMatch(plainText, /伪造标题|\x1b|\x07/)
})
