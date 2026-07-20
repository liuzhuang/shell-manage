import type { CommandConfig } from '../../shared/types'

export const DEMO_COMMAND_NAMES = ['demo-service', 'demo-bad-exit', 'demo-terminal']
export const DEMO_PRESET_NAMES = ['演示-后台与异常', '演示-全流程']

export const DEMO_COMMANDS: CommandConfig[] = [
  {
    name: 'demo-service',
    command: `node -e "console.log('demo-service started'); let i=0; setInterval(()=>console.log('demo-service tick '+(++i)), 1000)"`,
    tags: ['演示'],
    mode: 'service',
    autoRestart: false
  },
  {
    name: 'demo-bad-exit',
    command: `node -e "console.error('demo-bad-exit boom'); process.exit(2)"`,
    tags: ['演示'],
    mode: 'service',
    autoRestart: false
  },
  {
    name: 'demo-terminal',
    command: `node -e "console.log('demo-terminal ready'); let i=0; setInterval(()=>console.log('demo-terminal heartbeat '+(++i)), 3000)"`,
    tags: ['演示'],
    mode: 'terminal'
  }
]

export const DEMO_PRESETS = [
  {
    name: '演示-后台与异常',
    sequence: [
      { command: 'demo-service', delay: 2 },
      { command: 'demo-bad-exit' }
    ]
  },
  {
    name: '演示-全流程',
    sequence: [
      { command: 'demo-service', delay: 2 },
      { command: 'demo-terminal', delay: 2 },
      { command: 'demo-bad-exit' }
    ]
  }
]
