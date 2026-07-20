import type { CSSProperties } from 'react'

const radiusMd = 'var(--radius-sm)'
const radiusSm = 'var(--radius-xs)'
const radiusPill = 'var(--radius-pill)'
const borderDefault = '1px solid var(--border-default)'
const borderStrong = '1px solid var(--border-strong)'
const pressScalePrimary = { ['--press-scale' as string]: '0.964' } as CSSProperties
const pressScaleMuted = { ['--press-scale' as string]: '0.978' } as CSSProperties
const pressScaleWarn = { ['--press-scale' as string]: '0.972' } as CSSProperties
const pressScaleDanger = { ['--press-scale' as string]: '0.97' } as CSSProperties

export const inputStyle: CSSProperties = {
  width: '100%',
  border: borderDefault,
  borderRadius: radiusMd,
  background: 'var(--panel)',
  padding: '12px 16px',
  fontSize: '16px',
  outline: 'none',
  color: 'var(--text)',
  fontFamily: 'var(--font-ui)',
  transition:
    'border-color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard)'
}

export function chipStyle(active: boolean): CSSProperties {
  return {
    border: active ? borderStrong : borderDefault,
    borderRadius: radiusSm,
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 600,
    background: active ? 'var(--panel)' : 'var(--panel-soft)',
    color: active ? 'var(--text)' : 'var(--muted)',
    cursor: 'pointer',
    transition:
      'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
    ...pressScaleMuted
  }
}

export function buttonStyle(variant: 'primary' | 'muted' | 'outline' | 'warn' | 'danger'): CSSProperties {
  if (variant === 'primary') {
    return {
      border: '1px solid var(--text)',
      borderRadius: radiusMd,
      padding: '8px 14px',
      fontSize: '12px',
      fontWeight: 700,
      background: 'var(--text)',
      color: 'var(--panel)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition:
        'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
      boxShadow: '0 1px 0 color-mix(in srgb, var(--text) 26%, transparent)',
      ...pressScalePrimary
    }
  }
  if (variant === 'outline') {
    return {
      border: borderStrong,
      borderRadius: radiusMd,
      padding: '8px 12px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'transparent',
      color: 'var(--text)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition:
        'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
      ...pressScaleMuted
    }
  }
  if (variant === 'warn') {
    return {
      border: borderDefault,
      borderRadius: radiusMd,
      padding: '8px 12px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'color-mix(in srgb, var(--warn) 12%, var(--panel))',
      color: 'var(--warn)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition:
        'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
      ...pressScaleWarn
    }
  }
  if (variant === 'danger') {
    return {
      border: borderDefault,
      borderRadius: radiusMd,
      padding: '8px 12px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'color-mix(in srgb, var(--err) 12%, var(--panel))',
      color: 'var(--err)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition:
        'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
      ...pressScaleDanger
    }
  }
  return {
    border: borderDefault,
    borderRadius: radiusMd,
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 500,
    background: 'var(--panel)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    transition:
      'transform var(--motion-fast) var(--ease-out-strong), background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-normal) var(--ease-standard)',
    ...pressScaleMuted
  }
}
