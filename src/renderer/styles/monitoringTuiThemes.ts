import type { ThemeName } from './tokens'

/** 页面级 TUI 风格（与 App 全局亮/暗色独立组合 → 每变体 2 套，共 8 套含 Mono） */
export type MonitoringTuiVariant = 'matrix' | 'ember' | 'slate' | 'mono'

export interface MonitoringTuiSkin {
  shell: { bg: string; border: string; text: string }
  subtitle: string
  meta: string
  panelRaised: { bg: string; border: string; text: string }
  panelInset: { bg: string; border: string; text: string }
  panelDeep: { bg: string; border: string; label: string }
  anomaly: { border: string; detail: string }
  rule: { on: string; off: string }
  statusDot: { ok: string; warn: string; error: string; idle: string }
  severity: { danger: string; warn: string; info: string }
  chart: string
  error: string
  control: { bg: string; border: string; color: string }
  buttonMuted: { bg: string; border: string; color: string }
  buttonPrimary: { bg: string; border: string; color: string }
}

const matrix: Record<ThemeName, MonitoringTuiSkin> = {
  dark: {
    shell: { bg: '#020504', border: '#184c35', text: '#8aff97' },
    subtitle: '#5dcf79',
    meta: '#72df8e',
    panelRaised: { bg: '#021d15', border: '#1f7d4f', text: '#87f5a7' },
    panelInset: { bg: '#02120e', border: '#1a6c48', text: '#89f9ad' },
    panelDeep: { bg: '#01170f', border: '#1f7d4f', label: '#64d585' },
    anomaly: { border: '#255f42', detail: '#5fd27f' },
    rule: { on: '#8aff97', off: '#4a8f5d' },
    statusDot: { ok: '#3dff7f', warn: '#ffd866', error: '#ff6f6f', idle: '#4a8f5d' },
    severity: { danger: '#ff6f6f', warn: '#ffd866', info: '#8aff97' },
    chart: '#8eff9f',
    error: '#ff9d9d',
    control: { bg: '#03150f', border: '#2a6b4a', color: '#b8ffc8' },
    buttonMuted: { bg: '#062a1c', border: '#2d7a52', color: '#9cf0b0' },
    buttonPrimary: { bg: '#0d3d28', border: '#3d9d62', color: '#e8ffe8' }
  },
  light: {
    shell: { bg: '#f0fdf4', border: '#86efac', text: '#14532d' },
    subtitle: '#166534',
    meta: '#15803d',
    panelRaised: { bg: '#ecfdf5', border: '#6ee7b7', text: '#064e3b' },
    panelInset: { bg: '#f7fee7', border: '#bef264', text: '#365314' },
    panelDeep: { bg: '#ecfccb', border: '#a3e635', label: '#3f6212' },
    anomaly: { border: '#86efac', detail: '#166534' },
    rule: { on: '#15803d', off: '#86efac' },
    statusDot: { ok: '#16a34a', warn: '#ca8a04', error: '#dc2626', idle: '#4ade80' },
    severity: { danger: '#b91c1c', warn: '#a16207', info: '#15803d' },
    chart: '#166534',
    error: '#b91c1c',
    control: { bg: '#ffffff', border: '#bbf7d0', color: '#14532d' },
    buttonMuted: { bg: '#f0fdf4', border: '#86efac', color: '#166534' },
    buttonPrimary: { bg: '#dcfce7', border: '#22c55e', color: '#14532d' }
  }
}

const ember: Record<ThemeName, MonitoringTuiSkin> = {
  dark: {
    shell: { bg: '#140a04', border: '#6b4423', text: '#ffc46b' },
    subtitle: '#e8a54b',
    meta: '#d4a574',
    panelRaised: { bg: '#1c1008', border: '#7a4820', text: '#ffcf8a' },
    panelInset: { bg: '#160c06', border: '#5c3a1a', text: '#ffd699' },
    panelDeep: { bg: '#120802', border: '#6b3d18', label: '#c9a87a' },
    anomaly: { border: '#8b4513', detail: '#d9a066' },
    rule: { on: '#ffc46b', off: '#8b6914' },
    statusDot: { ok: '#7cff6b', warn: '#ffd866', error: '#ff7a7a', idle: '#a67c52' },
    severity: { danger: '#ff8a8a', warn: '#ffd866', info: '#ffe0a8' },
    chart: '#ffb86b',
    error: '#ffb4b4',
    control: { bg: '#1a0f08', border: '#7a4a28', color: '#ffe8c8' },
    buttonMuted: { bg: '#221208', border: '#8b552e', color: '#ffd9a0' },
    buttonPrimary: { bg: '#3d2410', border: '#c27830', color: '#fff6e8' }
  },
  light: {
    shell: { bg: '#fff8f0', border: '#fbbf24', text: '#78350f' },
    subtitle: '#92400e',
    meta: '#b45309',
    panelRaised: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    panelInset: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412' },
    panelDeep: { bg: '#ffedd5', border: '#fb923c', label: '#7c2d12' },
    anomaly: { border: '#fdba74', detail: '#9a3412' },
    rule: { on: '#c2410c', off: '#fdba74' },
    statusDot: { ok: '#16a34a', warn: '#ca8a04', error: '#dc2626', idle: '#d97706' },
    severity: { danger: '#b91c1c', warn: '#a16207', info: '#c2410c' },
    chart: '#b45309',
    error: '#b91c1c',
    control: { bg: '#ffffff', border: '#fde68a', color: '#78350f' },
    buttonMuted: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
    buttonPrimary: { bg: '#fef3c7', border: '#f59e0b', color: '#78350f' }
  }
}

const slate: Record<ThemeName, MonitoringTuiSkin> = {
  dark: {
    shell: { bg: '#060e14', border: '#1e3a5f', text: '#7dd3fc' },
    subtitle: '#38bdf8',
    meta: '#67e8f9',
    panelRaised: { bg: '#0c1926', border: '#2563ab', text: '#bae6fd' },
    panelInset: { bg: '#081018', border: '#1d4ed8', text: '#93c5fd' },
    panelDeep: { bg: '#040c12', border: '#1e40af', label: '#7dd3fc' },
    anomaly: { border: '#1e4976', detail: '#7dd3fc' },
    rule: { on: '#7dd3fc', off: '#3b6f9a' },
    statusDot: { ok: '#4ade80', warn: '#fbbf24', error: '#f87171', idle: '#38bdf8' },
    severity: { danger: '#fca5a5', warn: '#fcd34d', info: '#a5f3fc' },
    chart: '#7ee8ff',
    error: '#fecaca',
    control: { bg: '#0a1620', border: '#2563ab', color: '#e0f2fe' },
    buttonMuted: { bg: '#0f1f2e', border: '#2d4a7c', color: '#bae6fd' },
    buttonPrimary: { bg: '#172554', border: '#3b82f6', color: '#f0f9ff' }
  },
  light: {
    shell: { bg: '#f0f9ff', border: '#bae6fd', text: '#0c4a6e' },
    subtitle: '#0369a1',
    meta: '#0284c7',
    panelRaised: { bg: '#e0f2fe', border: '#7dd3fc', text: '#075985' },
    panelInset: { bg: '#f8fafc', border: '#93c5fd', text: '#1e3a8a' },
    panelDeep: { bg: '#eff6ff', border: '#60a5fa', label: '#1d4ed8' },
    anomaly: { border: '#93c5fd', detail: '#1e40af' },
    rule: { on: '#0369a1', off: '#7dd3fc' },
    statusDot: { ok: '#16a34a', warn: '#ca8a04', error: '#dc2626', idle: '#0284c7' },
    severity: { danger: '#b91c1c', warn: '#a16207', info: '#0369a1' },
    chart: '#0369a1',
    error: '#b91c1c',
    control: { bg: '#ffffff', border: '#bae6fd', color: '#0c4a6e' },
    buttonMuted: { bg: '#f0f9ff', border: '#7dd3fc', color: '#0369a1' },
    buttonPrimary: { bg: '#dbeafe', border: '#2563eb', color: '#1e3a8a' }
  }
}

/** 素墨：仅黑白灰阶，布局与对比度关系对齐 matrix / ember / slate，无彩色强调 */
const mono: Record<ThemeName, MonitoringTuiSkin> = {
  dark: {
    shell: { bg: '#09090b', border: '#3f3f46', text: '#fafafa' },
    subtitle: '#a1a1aa',
    meta: '#71717a',
    panelRaised: { bg: '#18181b', border: '#52525b', text: '#e4e4e7' },
    panelInset: { bg: '#0c0c0f', border: '#3f3f46', text: '#d4d4d8' },
    panelDeep: { bg: '#050506', border: '#52525b', label: '#a1a1aa' },
    anomaly: { border: '#52525b', detail: '#d4d4d8' },
    rule: { on: '#f4f4f5', off: '#71717a' },
    statusDot: { ok: '#d4d4d8', warn: '#a8a29e', error: '#78716c', idle: '#52525b' },
    severity: { danger: '#e7e5e4', warn: '#d6d3d1', info: '#e4e4e7' },
    chart: '#d4d4d8',
    error: '#e7e5e4',
    control: { bg: '#18181b', border: '#52525b', color: '#f4f4f5' },
    buttonMuted: { bg: '#27272a', border: '#52525b', color: '#e4e4e7' },
    buttonPrimary: { bg: '#3f3f46', border: '#71717a', color: '#fafafa' }
  },
  light: {
    shell: { bg: '#fafafa', border: '#e4e4e7', text: '#18181b' },
    subtitle: '#52525b',
    meta: '#71717a',
    panelRaised: { bg: '#f4f4f5', border: '#d4d4d8', text: '#27272a' },
    panelInset: { bg: '#ffffff', border: '#e4e4e7', text: '#3f3f46' },
    panelDeep: { bg: '#fafafa', border: '#d4d4d4', label: '#52525b' },
    anomaly: { border: '#d4d4d8', detail: '#3f3f46' },
    rule: { on: '#18181b', off: '#a1a1aa' },
    statusDot: { ok: '#3f3f46', warn: '#71717a', error: '#27272a', idle: '#a1a1aa' },
    severity: { danger: '#44403c', warn: '#57534e', info: '#3f3f46' },
    chart: '#52525b',
    error: '#44403c',
    control: { bg: '#ffffff', border: '#e4e4e7', color: '#18181b' },
    buttonMuted: { bg: '#fafafa', border: '#d4d4d8', color: '#3f3f46' },
    buttonPrimary: { bg: '#e4e4e7', border: '#a1a1aa', color: '#18181b' }
  }
}

const byVariant: Record<MonitoringTuiVariant, Record<ThemeName, MonitoringTuiSkin>> = {
  matrix,
  ember,
  slate,
  mono
}

export function getMonitoringTuiSkin(variant: MonitoringTuiVariant, theme: ThemeName): MonitoringTuiSkin {
  return byVariant[variant][theme]
}

/**
 * 统一跟随全局主题模板（CSS 变量）：
 * 监控页不再维护独立颜色开关，配色由 App 主题模板统一驱动。
 */
export function getMonitoringSystemSkin(_theme: ThemeName): MonitoringTuiSkin {
  return {
    shell: {
      bg: 'color-mix(in srgb, var(--accent-soft) 46%, var(--panel) 54%)',
      border: 'color-mix(in srgb, var(--accent) 58%, var(--border-default) 42%)',
      text: 'var(--text)'
    },
    subtitle: 'var(--accent-strong)',
    meta: 'color-mix(in srgb, var(--accent-strong) 62%, var(--muted) 38%)',
    panelRaised: {
      bg: 'color-mix(in srgb, var(--accent-soft) 34%, var(--panel-soft) 66%)',
      border: 'color-mix(in srgb, var(--accent) 52%, var(--border-subtle) 48%)',
      text: 'var(--text)'
    },
    panelInset: {
      bg: 'color-mix(in srgb, var(--accent-soft) 24%, var(--panel) 76%)',
      border: 'color-mix(in srgb, var(--accent) 42%, var(--border-subtle) 58%)',
      text: 'var(--text)'
    },
    panelDeep: {
      bg: 'color-mix(in srgb, var(--accent-soft) 20%, var(--panel-soft) 80%)',
      border: 'color-mix(in srgb, var(--accent) 36%, var(--border-subtle) 64%)',
      label: 'var(--accent-strong)'
    },
    anomaly: {
      border: 'color-mix(in srgb, var(--accent) 42%, var(--border-subtle) 58%)',
      detail: 'color-mix(in srgb, var(--accent-strong) 56%, var(--muted) 44%)'
    },
    rule: { on: 'var(--accent-strong)', off: 'var(--text-disabled)' },
    statusDot: {
      ok: 'var(--ok)',
      warn: 'var(--warn)',
      error: 'var(--err)',
      idle: 'var(--idle)'
    },
    severity: {
      danger: 'var(--err)',
      warn: 'var(--warn)',
      info: 'var(--accent-strong)'
    },
    chart: 'var(--accent-strong)',
    error: 'var(--err)',
    control: {
      bg: 'color-mix(in srgb, var(--accent-soft) 22%, var(--panel-soft) 78%)',
      border: 'color-mix(in srgb, var(--accent) 52%, var(--border-default) 48%)',
      color: 'var(--text)'
    },
    buttonMuted: {
      bg: 'color-mix(in srgb, var(--accent-soft) 48%, var(--panel-soft) 52%)',
      border: '1px solid color-mix(in srgb, var(--accent) 58%, var(--border-subtle) 42%)',
      color: 'var(--accent-strong)'
    },
    buttonPrimary: {
      bg: 'var(--accent)',
      border: '1px solid var(--accent-strong)',
      color: 'var(--panel)'
    }
  }
}

export const MONITORING_TUI_VARIANT_OPTIONS: Array<{ id: MonitoringTuiVariant; label: string }> = [
  { id: 'matrix', label: '矩阵绿 Phosphor' },
  { id: 'ember', label: '琥珀铜 Amber' },
  { id: 'slate', label: '极寒蓝 Ice' },
  { id: 'mono', label: '素墨灰 Mono' }
]

export const MONITORING_TUI_VARIANT_STORAGE_KEY = 'monitoring.tuiVariant.v1'

export function loadMonitoringTuiVariant(): MonitoringTuiVariant {
  try {
    const raw = window.localStorage.getItem(MONITORING_TUI_VARIANT_STORAGE_KEY)
    if (raw === 'matrix' || raw === 'ember' || raw === 'slate' || raw === 'mono') return raw
  } catch {
    /* ignore */
  }
  return 'matrix'
}

export function persistMonitoringTuiVariant(variant: MonitoringTuiVariant): void {
  try {
    window.localStorage.setItem(MONITORING_TUI_VARIANT_STORAGE_KEY, variant)
  } catch {
    /* ignore */
  }
}
