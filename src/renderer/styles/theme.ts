import {
  getThemeTokens,
  resolveThemePresetId,
  setActiveThemePaletteId,
  type ThemeName,
  type ThemePresetId,
  type Tokens
} from './tokens'

const THEME_STORAGE_KEY = 'shell-manage-theme'
const THEME_PRESET_STORAGE_KEY = 'shell-manage-theme-preset'

function setRootVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value)
}

function applyTokenSet(tokens: Tokens) {
  setRootVar('--font-ui', tokens.font.ui)
  setRootVar('--font-mono', tokens.font.mono)

  setRootVar('--bg', tokens.color.bg.app)
  setRootVar('--panel', tokens.color.bg.panel)
  setRootVar('--panel-soft', tokens.color.bg.panelSoft)
  setRootVar('--surface', tokens.color.bg.surface)
  setRootVar('--bg-hover', tokens.color.bg.hover)
  setRootVar('--bg-active', tokens.color.bg.active)
  setRootVar('--panel-active', tokens.color.bg.active)

  setRootVar('--text', tokens.color.text.primary)
  setRootVar('--muted', tokens.color.text.secondary)
  setRootVar('--text-dim', tokens.color.text.tertiary)
  setRootVar('--text-disabled', tokens.color.text.disabled)

  setRootVar('--border-subtle', tokens.color.border.subtle)
  setRootVar('--border-default', tokens.color.border.default)
  setRootVar('--border-strong', tokens.color.border.strong)

  setRootVar('--accent', tokens.color.accent.base)
  setRootVar('--accent-strong', tokens.color.accent.strong)
  setRootVar('--accent-soft', tokens.color.accent.soft)
  setRootVar('--focus-ring', tokens.color.accent.ring)
  setRootVar('--legal', tokens.color.semantic.legal)
  setRootVar('--luxe', tokens.color.semantic.premiumLuxe)
  setRootVar('--plus', tokens.color.semantic.premiumPlus)

  setRootVar('--run', tokens.color.status.running)
  setRootVar('--ok', tokens.color.status.success)
  setRootVar('--warn', tokens.color.status.warning)
  setRootVar('--err', tokens.color.status.error)
  setRootVar('--idle', tokens.color.status.queued)
  setRootVar('--shadow-card', tokens.shadow.card)
  setRootVar('--shadow-hover', tokens.shadow.hover)

  setRootVar('--radius-xs', `${tokens.radius.xs}px`)
  setRootVar('--radius-sm', `${tokens.radius.sm}px`)
  setRootVar('--radius-md', `${tokens.radius.md}px`)
  setRootVar('--radius-lg', `${tokens.radius.lg}px`)
  setRootVar('--radius-pill', `${tokens.radius.pill}px`)

  setRootVar('--space-xs', `${tokens.space.xs}px`)
  setRootVar('--space-sm', `${tokens.space.sm}px`)
  setRootVar('--space-md', `${tokens.space.md}px`)
  setRootVar('--space-lg', `${tokens.space.lg}px`)
  setRootVar('--space-xl', `${tokens.space.xl}px`)
}

export function applyTheme(name: ThemeName) {
  applyTokenSet(getThemeTokens(name))
  document.documentElement.dataset.theme = name
}

export function applyThemePreset(rawPreset: unknown): ThemePresetId {
  const preset = resolveThemePresetId(rawPreset)
  setActiveThemePaletteId(preset)
  document.documentElement.dataset.themePreset = preset
  return preset
}

export function resolveInitialThemePreset(): ThemePresetId {
  try {
    const stored = window.localStorage.getItem(THEME_PRESET_STORAGE_KEY)
    return resolveThemePresetId(stored)
  } catch {
    return 'coder'
  }
}

export function persistThemePreset(preset: ThemePresetId): void {
  try {
    window.localStorage.setItem(THEME_PRESET_STORAGE_KEY, preset)
  } catch {
    // ignore storage errors
  }
}

export function resolveInitialTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // ignore storage errors
  }
  return 'light'
}

export function persistTheme(name: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, name)
  } catch {
    // ignore storage errors
  }
}
