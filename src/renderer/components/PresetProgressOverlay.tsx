export function PresetProgressOverlay({
  presetName,
  action,
  index,
  total,
  commandName,
  sequence
}: {
  presetName: string
  action: 'start' | 'stop'
  index: number
  total: number
  commandName: string
  sequence: string[]
}) {
  const safeTotal = Math.max(total, 1)
  const progress = Math.max(0, Math.min(1, (index + 1) / safeTotal))
  const percent = Math.round(progress * 100)
  const done = index + 1 >= safeTotal
  const deg = Math.round(progress * 360)
  const actionText = action === 'start' ? '正在启动' : '正在停止'

  return (
    <div
      data-testid="preset-progress-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 12, 18, 0.35)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000
      }}
    >
      <div
        style={{
          width: 280,
        borderRadius: 20,
          border: '1px solid var(--border-default)',
          background: 'var(--panel)',
          boxShadow: 'var(--shadow-card)',
          padding: 18,
          display: 'grid',
          gap: 12,
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>预设操作正在执行中</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{presetName}</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: 999,
              background: `conic-gradient(var(--accent) ${deg}deg, var(--panel-soft) ${deg}deg 360deg)`,
              display: 'grid',
              placeItems: 'center',
              animation: done ? undefined : 'presetPulse 1.6s ease-in-out infinite'
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 999,
                background: 'var(--panel)',
                border: '1px solid var(--border-subtle)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: done ? 'var(--ok)' : 'var(--accent)'
              }}
            >
              {percent}%
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {done ? actionText + '已完成' : '正在' + actionText + ': ' + commandName}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {Math.min(index + 1, safeTotal)} / {safeTotal}
        </div>
        <div style={{ textAlign: 'left', display: 'grid', gap: 5, maxHeight: 132, overflowY: 'auto', padding: '4px 2px 0' }}>
          {sequence.map((item, idx) => {
            const isDone = idx < index
            const isCurrent = idx === index && !done
            const marker = isDone || done ? '✓' : isCurrent ? '●' : '○'
            return (
              <div
                key={`${presetName}-${item}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '14px 1fr',
                  gap: 6,
                  fontSize: 11,
                  color: isDone || isCurrent ? 'var(--text)' : 'var(--muted)'
                }}
              >
                <span style={{ color: isDone ? 'var(--ok)' : isCurrent ? 'var(--accent)' : 'var(--muted)' }}>{marker}</span>
                <span>{item}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
