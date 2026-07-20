export type Tokens = {
  color: {
    bg: {
      app: string
      panel: string
      panelSoft: string
      surface: string
      hover: string
      active: string
    }
    text: {
      primary: string
      secondary: string
      tertiary: string
      disabled: string
    }
    border: {
      subtle: string
      default: string
      strong: string
    }
    accent: {
      base: string
      strong: string
      soft: string
      ring: string
    }
    semantic: {
      legal: string
      premiumLuxe: string
      premiumPlus: string
    }
    status: {
      running: string
      success: string
      warning: string
      error: string
      queued: string
    }
  }
  shadow: {
    card: string
    hover: string
  }
  font: {
    ui: string
    mono: string
  }
  radius: {
    xs: number
    sm: number
    md: number
    lg: number
    pill: number
  }
  space: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
  }
}
export type ThemeName = 'dark' | 'light'
export type ThemePresetId = 'system' | 'coder' | 'girl'

type ModeColor = Omit<Tokens['color'], 'status'>
type StatusColor = Tokens['color']['status']

type ThemePalette = {
  id: string
  label: string
  dark: ModeColor
  light: ModeColor
  status: {
    dark: StatusColor
    light: StatusColor
  }
}

const typography = {
  ui: '"Nunito Sans", -apple-system, system-ui, Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"Geist Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace'
} as const

const radius = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  pill: 9999
} as const

const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 24,
  xl: 32
} as const

export const themePalettes = {
  system: {
    id: 'system',
    label: '夏日',
    dark: {
      bg: {
        app: '#1a1a1a',
        panel: '#1a1a1a',
        panelSoft: '#2a2a2a',
        surface: '#2a2a2a',
        hover: '#2f2f2f',
        active: '#3a3a3a'
      },
      text: {
        primary: '#f0f0f0',
        secondary: '#a0a0a0',
        tertiary: '#8a8a8a',
        disabled: '#666666'
      },
      border: {
        subtle: '#2a2a2a',
        default: '#3a3a3a',
        strong: '#4a4a4a'
      },
      accent: {
        base: '#ff385c',
        strong: '#e00b41',
        soft: 'rgba(255, 56, 92, 0.14)',
        ring: '#f0f0f0'
      },
      semantic: {
        legal: '#428bff',
        premiumLuxe: '#460479',
        premiumPlus: '#92174d'
      }
    },
    light: {
      bg: {
        app: '#ffffff',
        panel: '#ffffff',
        panelSoft: '#f2f2f2',
        surface: '#f2f2f2',
        hover: '#f6f6f6',
        active: '#ededed'
      },
      text: {
        primary: '#222222',
        secondary: '#6a6a6a',
        tertiary: '#7a7a7a',
        disabled: '#929292'
      },
      border: {
        subtle: '#ebebeb',
        default: '#c1c1c1',
        strong: '#9b9b9b'
      },
      accent: {
        base: '#ff385c',
        strong: '#e00b41',
        soft: 'rgba(255, 56, 92, 0.12)',
        ring: '#222222'
      },
      semantic: {
        legal: '#428bff',
        premiumLuxe: '#460479',
        premiumPlus: '#92174d'
      }
    },
    status: {
      dark: {
        running: '#428bff',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#c13515',
        queued: '#a0a0a0'
      },
      light: {
        running: '#428bff',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#c13515',
        queued: '#6a6a6a'
      }
    }
  },
  coder: {
    id: 'coder',
    label: '程序员',
    dark: {
      bg: {
        app: '#0b1020',
        panel: '#111827',
        panelSoft: '#1f2937',
        surface: '#1f2937',
        hover: '#223247',
        active: '#2a3d56'
      },
      text: {
        primary: '#e5e7eb',
        secondary: '#9ca3af',
        tertiary: '#6b7280',
        disabled: '#4b5563'
      },
      border: {
        subtle: '#1f2937',
        default: '#374151',
        strong: '#4b5563'
      },
      accent: {
        base: '#3b82f6',
        strong: '#1d4ed8',
        soft: 'rgba(59, 130, 246, 0.14)',
        ring: '#93c5fd'
      },
      semantic: {
        legal: '#60a5fa',
        premiumLuxe: '#8b5cf6',
        premiumPlus: '#ec4899'
      }
    },
    light: {
      bg: {
        app: '#fafafa',
        panel: '#ffffff',
        panelSoft: '#f7f7f7',
        surface: '#ffffff',
        hover: '#f2f2f2',
        active: '#ededed'
      },
      text: {
        primary: '#111111',
        secondary: '#666666',
        tertiary: '#8a8a8a',
        disabled: '#b0b0b0'
      },
      border: {
        subtle: '#eaeaea',
        default: '#d4d4d4',
        strong: '#a8a8a8'
      },
      accent: {
        base: '#0068d6',
        strong: '#0059c2',
        soft: 'rgba(0, 104, 214, 0.10)',
        ring: '#111111'
      },
      semantic: {
        legal: '#2563eb',
        premiumLuxe: '#7c3aed',
        premiumPlus: '#db2777'
      }
    },
    status: {
      dark: {
        running: '#60a5fa',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        queued: '#9ca3af'
      },
      light: {
        running: '#3b82f6',
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626',
        queued: '#64748b'
      }
    }
  },
  girl: {
    id: 'girl',
    label: '女生',
    dark: {
      bg: {
        app: '#231429',
        panel: '#2e1b36',
        panelSoft: '#3a2345',
        surface: '#3a2345',
        hover: '#452b52',
        active: '#553664'
      },
      text: {
        primary: '#f8ecf8',
        secondary: '#d4b8d9',
        tertiary: '#c09fc6',
        disabled: '#9979a2'
      },
      border: {
        subtle: '#4a2d55',
        default: '#6c3f78',
        strong: '#8b539a'
      },
      accent: {
        base: '#ff69b4',
        strong: '#ec4899',
        soft: 'rgba(255, 105, 180, 0.16)',
        ring: '#f9a8d4'
      },
      semantic: {
        legal: '#7dd3fc',
        premiumLuxe: '#a855f7',
        premiumPlus: '#f472b6'
      }
    },
    light: {
      bg: {
        app: '#fff8fc',
        panel: '#ffffff',
        panelSoft: '#fff0f7',
        surface: '#fff0f7',
        hover: '#ffe5f2',
        active: '#ffd7eb'
      },
      text: {
        primary: '#5b2a4c',
        secondary: '#8f4d79',
        tertiary: '#a8658b',
        disabled: '#c39bb5'
      },
      border: {
        subtle: '#ffe1ef',
        default: '#ffc8df',
        strong: '#f8a8cb'
      },
      accent: {
        base: '#ff5fa2',
        strong: '#ec4899',
        soft: 'rgba(255, 95, 162, 0.14)',
        ring: '#be185d'
      },
      semantic: {
        legal: '#38bdf8',
        premiumLuxe: '#c026d3',
        premiumPlus: '#db2777'
      }
    },
    status: {
      dark: {
        running: '#7dd3fc',
        success: '#4ade80',
        warning: '#fbbf24',
        error: '#fb7185',
        queued: '#d8b4fe'
      },
      light: {
        running: '#38bdf8',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#e11d48',
        queued: '#c084fc'
      }
    }
  }
} as const satisfies Record<string, ThemePalette>

let activeThemePaletteId: ThemePresetId = 'coder'

export function resolveThemePresetId(raw: unknown): ThemePresetId {
  return raw === 'system' || raw === 'coder' || raw === 'girl' ? raw : 'coder'
}

export function setActiveThemePaletteId(next: ThemePresetId): void {
  activeThemePaletteId = next
}

function buildTokens(mode: ThemeName, palette: ThemePalette): Tokens {
  const modeColor = mode === 'dark' ? palette.dark : palette.light
  const status = mode === 'dark' ? palette.status.dark : palette.status.light
  return {
    color: {
      ...modeColor,
      status
    },
    shadow: {
      card: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
      hover: 'rgba(0,0,0,0.08) 0px 4px 12px'
    },
    font: typography,
    radius,
    space
  }
}

export function getThemeTokens(mode: ThemeName): Tokens {
  return buildTokens(mode, themePalettes[activeThemePaletteId])
}

export const tokens = getThemeTokens('dark')
