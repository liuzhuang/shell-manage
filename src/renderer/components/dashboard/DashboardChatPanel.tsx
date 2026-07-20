import { inputStyle, buttonStyle } from '../../lib/uiStyles'

interface DashboardChatMessage {
  id: string
  role: 'ai' | 'user'
  text: string
}

interface DashboardChatPanelProps {
  messages: DashboardChatMessage[]
  input: string
  loading: boolean
  thinkingLines?: string[]
  progressLines?: string[]
  onInputChange: (value: string) => void
  onSubmit: () => void
}

export function DashboardChatPanel({
  messages,
  input,
  loading,
  thinkingLines = [],
  progressLines = [],
  onInputChange,
  onSubmit
}: DashboardChatPanelProps) {
  return (
    <div
      data-testid="dashboard-chat-panel"
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          padding: '14px 16px',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text)'
        }}
      >
        看板助手
      </div>

      <div data-testid="dashboard-chat-messages" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              alignSelf: message.role === 'ai' ? 'flex-start' : 'flex-end',
              maxWidth: '92%',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.55,
              background: message.role === 'ai' ? 'var(--accent-soft)' : 'var(--panel-soft)',
              color: 'var(--text)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {message.text}
          </div>
        ))}
      </div>

      {loading && thinkingLines.length > 0 ? (
        <div
          data-testid="dashboard-thinking-strip"
          style={{
            borderTop: '1px dashed var(--border-subtle)',
            borderBottom: '1px dashed var(--border-subtle)',
            padding: '6px 10px',
            minHeight: 44,
            background: 'var(--panel-soft)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2
          }}
        >
          <div
            data-testid="dashboard-thinking-line-1"
            style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {thinkingLines[0]}
          </div>
          <div
            data-testid="dashboard-thinking-line-2"
            style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {thinkingLines[1] || ''}
          </div>
        </div>
      ) : null}

      {loading && progressLines.length > 0 ? (
        <div
          data-testid="dashboard-progress-strip"
          style={{
            borderTop: '1px dashed var(--border-subtle)',
            padding: '8px 10px',
            background: 'var(--panel-soft)',
            maxHeight: 140,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          {progressLines.map((line, index) => (
            <div
              key={`${index}-${line.slice(0, 20)}`}
              style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          data-testid="dashboard-chat-input"
          rows={3}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder="输入自然语言创建或修改看板..."
          style={{
            ...inputStyle,
            resize: 'none',
            fontSize: 12
          }}
        />
        <button data-testid="dashboard-chat-submit" type="button" onClick={onSubmit} disabled={loading} style={buttonStyle('primary')}>
          {loading ? '处理中...' : '生成/更新看板'}
        </button>
      </div>
    </div>
  )
}
