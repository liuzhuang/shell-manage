import { DEMO_COMMANDS } from '../lib/demoCommands'

export function DemoCommandsPanel(props: { installed: boolean }) {
  const { installed } = props

  return (
    <div data-testid="demo-commands-modal">
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.55 }}>
        {installed
          ? '演示命令已写入配置，可直接在首页启动体验。如需移除，可点击下方清理。'
          : '将导入 3 条演示命令，帮助体验后台任务、交互终端和日志分析全流程。'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, fontWeight: 600 }}>演示命令</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {DEMO_COMMANDS.map((command) => (
          <div
            key={command.name}
            data-testid={`demo-command-row-${command.name}`}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 14,
              padding: 10,
              background: 'var(--panel-soft)'
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
              <strong>{command.name}</strong>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{command.mode || 'service'}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{command.tags?.join(', ')}</span>
            </div>
            <code
              style={{
                display: 'block',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '6px 8px'
              }}
            >
              {command.command}
            </code>
          </div>
        ))}
      </div>
    </div>
  )
}
