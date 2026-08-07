import assert from 'node:assert/strict'
import test from 'node:test'
import { getThemeTokens, setActiveThemePaletteId } from './tokens'

test('程序员暗色主题使用 Codex 桌面色板', () => {
  setActiveThemePaletteId('coder')
  const color = getThemeTokens('dark').color

  assert.deepEqual(color.bg, {
    app: '#181818',
    panel: '#232323',
    panelSoft: '#282828',
    surface: '#2d2d2d',
    hover: 'rgba(255, 255, 255, 0.078)',
    active: 'rgba(255, 255, 255, 0.12)'
  })
  assert.deepEqual(color.text, {
    primary: 'rgba(255, 255, 255, 0.88)',
    secondary: 'rgba(255, 255, 255, 0.71)',
    tertiary: 'rgba(255, 255, 255, 0.498)',
    disabled: 'rgba(255, 255, 255, 0.498)'
  })
  assert.deepEqual(color.border, {
    subtle: 'rgba(255, 255, 255, 0.042)',
    default: 'rgba(255, 255, 255, 0.084)',
    strong: 'rgba(255, 255, 255, 0.156)'
  })
  assert.deepEqual(color.accent, {
    base: '#339cff',
    strong: '#83c3ff',
    soft: '#0d273f',
    ring: 'rgba(131, 195, 255, 0.76)'
  })
  assert.deepEqual(color.status, {
    running: '#339cff',
    success: '#40c977',
    warning: '#ff8549',
    error: '#ff6764',
    queued: 'rgba(255, 255, 255, 0.498)'
  })
})
