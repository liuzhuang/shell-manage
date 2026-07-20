type ToastTone = 'success' | 'warn' | 'error' | 'info'

export function Toast({ text, tone = 'info' }: { text: string; tone?: ToastTone }) {
  if (!text) return null
  const styleByTone: Record<ToastTone, { background: string; color: string; borderColor: string }> = {
    success: {
      background: 'color-mix(in srgb, var(--ok) 14%, var(--panel))',
      color: 'var(--ok)',
      borderColor: 'color-mix(in srgb, var(--ok) 28%, var(--border-default))'
    },
    warn: {
      background: 'color-mix(in srgb, var(--warn) 14%, var(--panel))',
      color: 'var(--warn)',
      borderColor: 'color-mix(in srgb, var(--warn) 28%, var(--border-default))'
    },
    error: {
      background: 'color-mix(in srgb, var(--err) 14%, var(--panel))',
      color: 'var(--err)',
      borderColor: 'color-mix(in srgb, var(--err) 28%, var(--border-default))'
    },
    info: { background: 'var(--panel-soft)', color: 'var(--text-dim)', borderColor: 'var(--border-default)' }
  }

  return (
    <div
      data-testid="global-toast"
      className="global-toast"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: styleByTone[tone].background,
        color: styleByTone[tone].color,
        border: `1px solid ${styleByTone[tone].borderColor}`,
        borderRadius: 14,
        padding: '10px 12px',
        fontSize: 12,
        fontFamily: 'var(--font-ui)',
        boxShadow: 'var(--shadow-card)',
        maxWidth: 'min(56ch, calc(100vw - 32px))',
        lineHeight: 1.45
      }}
    >
      {text}
    </div>
  )
}
