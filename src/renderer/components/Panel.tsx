import type { CSSProperties, ReactNode } from 'react'

export function Panel({ children, soft = false, style, className, ...rest }: { children: ReactNode; soft?: boolean; style?: CSSProperties; className?: string; [key: `data-${string}`]: string | undefined }) {
  return (
    <div
      className={className}
      style={{
        background: soft ? 'var(--panel-soft)' : 'var(--panel)',
        border: `1px solid var(--border-subtle)`,
        borderRadius: soft ? 'var(--radius-md)' : 'var(--radius-lg)',
        boxShadow: soft ? 'none' : 'var(--shadow-card)',
        padding: 12,
        transition:
          'border-color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-slow) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard)',
        ...style
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
