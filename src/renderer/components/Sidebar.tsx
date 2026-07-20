import { useEffect, useState } from 'react'
import type { AppPage } from '../hooks/useNavigation'
import type { ThemeName } from '../styles/tokens'
import type { AppUpdateBroadcastPayload } from '../../shared/types'
import { SystemEventTicker } from './SystemEventTicker'
import { ThemeToggleE } from './ThemeToggleE'
import { MoonIcon } from './icons/MoonIcon'
import { SunIcon } from './icons/SunIcon'

const SIDEBAR_ICON_ONLY_KEY = 'sidebar.iconOnly'
export const SIDEBAR_WIDTH_EXPANDED = 160
export const SIDEBAR_WIDTH_ICON_ONLY = 56
export const SIDEBAR_WIDTH_ICON_ONLY_DARWIN = 78

function getIconOnlySidebarWidth(): number {
  return window.api.getPlatform() === 'darwin' ? SIDEBAR_WIDTH_ICON_ONLY_DARWIN : SIDEBAR_WIDTH_ICON_ONLY
}

export function readSidebarWidth(): number {
  try {
    return window.localStorage.getItem(SIDEBAR_ICON_ONLY_KEY) === '1' ? getIconOnlySidebarWidth() : SIDEBAR_WIDTH_EXPANDED
  } catch {
    return SIDEBAR_WIDTH_EXPANDED
  }
}

export type RecentCommandPage = 'log' | 'terminal' | 'monitoring'

export interface RecentCommandPageItem {
  commandName: string
  page: RecentCommandPage
  updatedAt: number
}

type SidebarNavIconProps = {
  size: number
  variant?: 'default' | 'titlebar'
}

function illustrationSvgProps(size: number, variant?: SidebarNavIconProps['variant']) {
  const isTitlebar = variant === 'titlebar'
  return {
    width: size,
    height: size,
    viewBox: isTitlebar ? '6 6 52 52' : '0 0 64 64',
    ...(isTitlebar ? { preserveAspectRatio: 'xMidYMid slice' as const } : {})
  }
}

export function CommandIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="command-illustration-bg" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="command-illustration-screen" x1="15" y1="17" x2="49" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#111827" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
      </defs>
      <path d="M12 12c7-6 26-7 35 0 9 7 10 25 1 35-9 11-29 11-38 0-8-10-5-28 2-35Z" fill="url(#command-illustration-bg)" opacity=".24" />
      <rect x="12" y="16" width="40" height="32" rx="8" fill="url(#command-illustration-screen)" />
      <rect x="12" y="16" width="40" height="9" rx="8" fill="#1f2937" />
      <circle cx="19" cy="21" r="2" fill="#fb7185" />
      <circle cx="26" cy="21" r="2" fill="#facc15" />
      <circle cx="33" cy="21" r="2" fill="#34d399" />
      <path d="m22 32 5 4-5 4" stroke="#93c5fd" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 41h12" stroke="#bfdbfe" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 52h28" stroke="#1e3a8a" strokeWidth="4" strokeLinecap="round" opacity=".5" />
    </svg>
  )
}

export function LogsIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="logs-illustration-paper" x1="17" y1="8" x2="49" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fafc" />
          <stop offset="1" stopColor="#c7d2fe" />
        </linearGradient>
      </defs>
      <path d="M13 13c9-8 28-8 38 1 8 8 7 27-2 36-10 10-29 8-38-3-8-10-6-27 2-34Z" fill="#8b5cf6" opacity=".2" />
      <path d="M20 8h21l11 11v33a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" fill="url(#logs-illustration-paper)" />
      <path d="M41 8v9a4 4 0 0 0 4 4h7" fill="#a5b4fc" />
      <rect x="22" y="25" width="7" height="5" rx="2.5" fill="#7c3aed" />
      <rect x="34" y="26" width="12" height="3" rx="1.5" fill="#6366f1" opacity=".72" />
      <rect x="22" y="35" width="7" height="5" rx="2.5" fill="#22c55e" />
      <rect x="34" y="36" width="15" height="3" rx="1.5" fill="#64748b" opacity=".55" />
      <rect x="22" y="45" width="7" height="5" rx="2.5" fill="#f97316" />
      <rect x="34" y="46" width="10" height="3" rx="1.5" fill="#64748b" opacity=".55" />
    </svg>
  )
}

export function MonitoringIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <radialGradient id="monitoring-illustration-glow" cx="0" cy="0" r="1" gradientTransform="translate(32 32) rotate(90) scale(28)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0f766e" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="url(#monitoring-illustration-glow)" opacity=".24" />
      <circle cx="32" cy="32" r="21" fill="#042f2e" />
      <circle cx="32" cy="32" r="16" stroke="#2dd4bf" strokeWidth="3" opacity=".45" />
      <circle cx="32" cy="32" r="8" stroke="#99f6e4" strokeWidth="3" opacity=".8" />
      <path d="M32 32 47 18" stroke="#facc15" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4" fill="#f8fafc" />
      <path d="M15 44c6-6 9-1 14-6 6-6 10-2 20-10" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49" cy="18" r="4" fill="#fde68a" />
    </svg>
  )
}

export function SettingsIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="settings-illustration-gear" x1="12" y1="9" x2="54" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" />
          <stop offset="1" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <path d="M14 16c9-9 27-10 37-1 9 9 8 28-2 37-10 9-29 7-37-3-8-10-6-25 2-33Z" fill="#f97316" opacity=".18" />
      <path d="M35 8 39 14c2 1 4 1 6 2l7-3 5 9-6 5v10l6 5-5 9-7-3c-2 1-4 2-6 2l-4 6H25l-4-6c-2 0-4-1-6-2l-7 3-5-9 6-5V27l-6-5 5-9 7 3c2-1 4-2 6-2l4-6h10Z" fill="url(#settings-illustration-gear)" />
      <circle cx="30" cy="32" r="11" fill="#fff7ed" />
      <circle cx="30" cy="32" r="5" fill="#fb923c" />
      <circle cx="47" cy="18" r="7" fill="#fde68a" />
      <path d="M44 18h6M47 15v6" stroke="#b45309" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function KeyIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="key-illustration-metal" x1="11" y1="46" x2="52" y2="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f59e0b" />
          <stop offset=".55" stopColor="#fde047" />
          <stop offset="1" stopColor="#fef3c7" />
        </linearGradient>
      </defs>
      <path d="M13 13c8-7 28-8 38 2 8 8 8 26-1 36-10 10-30 9-39-2-8-10-6-28 2-36Z" fill="#f59e0b" opacity=".18" />
      <circle cx="42" cy="22" r="14" fill="url(#key-illustration-metal)" />
      <circle cx="42" cy="22" r="6" fill="#111827" opacity=".72" />
      <path d="M33 32 13 52" stroke="url(#key-illustration-metal)" strokeWidth="9" strokeLinecap="round" />
      <path d="M20 45h11M15 50h8" stroke="#b45309" strokeWidth="5" strokeLinecap="round" />
      <path d="M43 12c5 0 9 4 9 9" stroke="#fff7ed" strokeWidth="3" strokeLinecap="round" opacity=".75" />
    </svg>
  )
}

export function BrowserIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="browser-illustration-frame" x1="10" y1="12" x2="54" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M12 14c8-7 28-8 38 1 9 8 9 26 0 35-10 10-30 9-40-2-8-10-6-27 2-34Z" fill="#38bdf8" opacity=".2" />
      <rect x="14" y="18" width="36" height="28" rx="6" fill="url(#browser-illustration-frame)" />
      <rect x="14" y="18" width="36" height="8" rx="6" fill="#1e3a8a" opacity=".85" />
      <circle cx="20" cy="22" r="2" fill="#f87171" />
      <circle cx="26" cy="22" r="2" fill="#facc15" />
      <circle cx="32" cy="22" r="2" fill="#4ade80" />
      <circle cx="32" cy="36" r="9" stroke="#e0f2fe" strokeWidth="3" />
      <path d="M32 31v5l3 3" stroke="#e0f2fe" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function CollaborationIllustrationIcon({ size, variant }: SidebarNavIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...illustrationSvgProps(size, variant)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="collab-illustration-left" x1="8" y1="16" x2="35" y2="53" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="collab-illustration-right" x1="31" y1="10" x2="57" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <path d="M14 13c8-8 28-9 38 1 8 9 7 27-2 36-10 10-29 8-38-3-8-10-6-26 2-34Z" fill="#14b8a6" opacity=".16" />
      <path d="M25 32h16" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
      <path d="M23 42c-9 0-15 5-15 12h30c0-7-6-12-15-12Z" fill="url(#collab-illustration-left)" />
      <circle cx="23" cy="29" r="10" fill="#bbf7d0" />
      <path d="M45 36c-8 0-13 5-13 11h26c0-6-5-11-13-11Z" fill="url(#collab-illustration-right)" />
      <circle cx="45" cy="25" r="9" fill="#ddd6fe" />
      <circle cx="34" cy="18" r="5" fill="#f8fafc" />
      <path d="M31 18h6M34 15v6" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function readIconOnlyPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_ICON_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

function formatVersionShort(raw: string): string {
  if (!raw) return '…'
  const s = raw.trim().replace(/^v/i, '')
  const [a, b] = s.split('.')
  if (a && b !== undefined) return `v${a}.${b}`
  return `v${s.slice(0, 5)}`
}

interface SidebarProps {
  page: AppPage
  onChange: (page: AppPage) => void
  theme: ThemeName
  onToggleTheme: () => void
  updateUi?: AppUpdateBroadcastPayload | null
  appVersion: string
  onCheckUpdate?: () => void
  onDownloadUpdate?: () => void
  onQuitAndInstall?: () => void
  tickerEvents: string[]
  recentCommandPages: RecentCommandPageItem[]
  onOpenRecentCommandPage: (item: RecentCommandPageItem) => void
  onRemoveRecentCommandPage: (commandName: string) => void
}

function testIdSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function Sidebar({
  page,
  onChange,
  theme,
  onToggleTheme,
  updateUi,
  appVersion,
  onCheckUpdate,
  onDownloadUpdate,
  onQuitAndInstall,
  tickerEvents,
  recentCommandPages,
  onOpenRecentCommandPage,
  onRemoveRecentCommandPage
}: SidebarProps) {
  const isMac = window.api.getPlatform() === 'darwin'
  const [iconOnly, setIconOnly] = useState(readIconOnlyPreference)
  const [hoveredRecentCommand, setHoveredRecentCommand] = useState<string | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_ICON_ONLY_KEY, iconOnly ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [iconOnly])

  const tabTestIdById: Record<string, string> = {
    home: 'tab-home',
    browser: 'tab-browser',
    query: 'tab-log-analysis',
    monitoring: 'tab-monitoring',
    editor: 'tab-editor',
    'ssh-keys': 'tab-ssh-keys',
    collaboration: 'tab-collaboration'
  }

  const items = [
    {
      id: 'home',
      label: '命令',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      )
    },
    {
      id: 'browser',
      label: '浏览器',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      )
    },
    {
      id: 'query',
      label: '日志',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      )
    },
    {
      id: 'monitoring',
      label: '监控',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="m7 15 4-4 3 3 5-7" />
        </svg>
      )
    },
    {
      id: 'ssh-keys',
      label: '密钥',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
          <path d="m21 2-9.6 9.6" />
          <circle cx="7.5" cy="15.5" r="5.5" />
        </svg>
      )
    },
    {
      id: 'collaboration',
      label: '协作',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    {
      id: 'editor',
      label: '设置',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M10 13l-2 2 2 2" />
          <path d="M14 17l2-2-2-2" />
        </svg>
      )
    }
  ]

  const isActive = (id: string) => {
    if (id === 'home') return page === 'home' || page === 'log' || page === 'terminal'
    if (id === 'browser') return page === 'browser'
    return page === id
  }

  const w = iconOnly ? getIconOnlySidebarWidth() : SIDEBAR_WIDTH_EXPANDED
  const sidebarTopInset = isMac ? 34 : 0
  const sidebarPaddingTop = (iconOnly ? 14 : 16) + sidebarTopInset
  const versionTitle = appVersion ? `v${appVersion} Stable` : ''
  const seamBtnLabel = iconOnly ? '展开侧栏' : '仅显示图标'
  const updateLabel =
    updateUi?.phase === 'checking'
      ? '正在检查更新…'
      : updateUi?.phase === 'available'
        ? `发现新版本 ${updateUi.version}`
        : updateUi?.phase === 'downloading'
          ? `正在下载 ${Math.round(updateUi.percent)}%`
          : updateUi?.phase === 'downloaded'
            ? `版本 ${updateUi.version} 已就绪`
            : updateUi?.phase === 'not-available'
              ? '已是最新版本'
              : updateUi?.phase === 'error'
                ? `更新失败：${updateUi.message}`
                : ''

  const showCollapsedBrand = iconOnly && !isMac

  return (
    <div
      style={{
        position: 'relative',
        width: w,
        minWidth: w,
        flexShrink: 0,
        height: '100%',
        overflow: 'visible',
        zIndex: 2
      }}
    >
      <div
        data-sidebar-collapsed={iconOnly ? 'true' : 'false'}
        className="sidebar-window-drag-region"
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--panel)',
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          padding: iconOnly ? '14px 0' : '16px 10px',
          paddingTop: sidebarPaddingTop,
          gap: iconOnly ? 12 : 20
        }}
      >
      {(showCollapsedBrand || !iconOnly) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: iconOnly ? 'center' : 'flex-start',
            padding: iconOnly ? 0 : '0 4px',
            marginBottom: iconOnly ? 8 : 12
          }}
        >
          {iconOnly ? (
            <div
              title="Shell"
              style={{
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: -0.5,
                color: 'var(--text)',
                lineHeight: 1
              }}
            >
              S<span style={{ color: 'var(--accent)' }}>.</span>
            </div>
          ) : (
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: -0.8, color: 'var(--text)', lineHeight: 1.2 }}>
              Shell
              <span style={{ color: 'var(--accent)', marginLeft: 2 }}>.</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => {
          const active = isActive(item.id)
          return (
            <button
              key={item.id}
              data-testid={tabTestIdById[item.id]}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => onChange(item.id as AppPage)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: iconOnly ? 'center' : 'flex-start',
                gap: iconOnly ? 0 : 10,
                padding: iconOnly ? '10px 8px' : '8px 10px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: active ? 'var(--panel-soft)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition:
                  'background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-slow) var(--ease-out-strong)',
                boxShadow: active ? 'var(--shadow-card)' : 'none'
              }}
              className="sidebar-nav-button"
            >
              <span style={{ color: active ? 'var(--accent)' : 'var(--muted)', display: 'flex', flexShrink: 0 }}>{item.icon}</span>
              {!iconOnly ? item.label : null}
            </button>
          )
        })}
      </div>
      {recentCommandPages.length > 0 && (
        <>
          <div
            aria-hidden
            style={{
              height: 1,
              background: 'var(--border-default)',
              margin: '2px 6px 0'
            }}
          />
          <div
            data-testid="sidebar-recent-section"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingTop: 8
            }}
          >
          {!iconOnly && (
            <div style={{ padding: '0 10px', fontSize: 11, color: 'var(--muted)', opacity: 0.85, fontWeight: 600, letterSpacing: '0.03em' }}>
              最近打开
            </div>
          )}
          {recentCommandPages.map((item) => {
            const itemTestId = `sidebar-recent-item-${testIdSafe(item.commandName)}`
            const removeTestId = `sidebar-recent-remove-${testIdSafe(item.commandName)}`
            const itemLabel = item.commandName
            const isHovered = hoveredRecentCommand === item.commandName
            return (
              <div
                key={`${item.commandName}-${item.page}`}
                onMouseEnter={() => setHoveredRecentCommand(item.commandName)}
                onMouseLeave={() => setHoveredRecentCommand((prev) => (prev === item.commandName ? null : prev))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <button
                  data-testid={itemTestId}
                  type="button"
                  title={itemLabel}
                  onClick={() => onOpenRecentCommandPage(item)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: iconOnly ? 'center' : 'flex-start',
                    gap: iconOnly ? 0 : 8,
                    padding: iconOnly ? '10px 8px' : '8px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-dim)',
                    opacity: 0.92,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
                  }}
                  className="sidebar-nav-button"
                >
                  {!iconOnly && (
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {itemLabel}
                    </span>
                  )}
                </button>
                {!iconOnly && (
                  <button
                    data-testid={removeTestId}
                    type="button"
                    aria-label={`删除最近命令 ${item.commandName}`}
                    title="删除最近入口"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveRecentCommandPage(item.commandName)
                    }}
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: '1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent)',
                      background: 'transparent',
                      color: 'var(--text-dim)',
                      opacity: isHovered ? 0.72 : 0,
                      pointerEvents: isHovered ? 'auto' : 'none',
                      cursor: 'pointer',
                      lineHeight: 1,
                      transition:
                        'opacity var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard)'
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.opacity = '0.9'
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.opacity = '0.72'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
          </div>
        </>
      )}

      <div
        data-testid="sidebar-footer"
        style={{
          marginTop: 'auto',
          padding: iconOnly ? '0 2px' : '0 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: iconOnly ? 6 : 10,
          alignItems: iconOnly ? 'stretch' : 'stretch',
          minWidth: 0
        }}
      >
        <SystemEventTicker events={tickerEvents} compact={iconOnly} />
        <div
          data-testid="sidebar-theme-control"
          className={`sidebar-theme-control${iconOnly ? ' sidebar-theme-control--compact' : ''}`}
        >
          {!iconOnly && (
            <span data-testid="sidebar-theme-label" className="sidebar-theme-label">
              {theme === 'dark' ? <MoonIcon size={14} /> : <SunIcon size={14} />}
              {theme === 'dark' ? '暗色' : '浅色'}
            </span>
          )}
          <ThemeToggleE theme={theme} onToggle={onToggleTheme} />
        </div>
        {updateLabel && (
          <button
            type="button"
            data-testid="update-banner"
            className="sidebar-update-banner"
            title={updateLabel}
            disabled={updateUi?.phase !== 'available' && updateUi?.phase !== 'downloaded'}
            onClick={updateUi?.phase === 'downloaded' ? onQuitAndInstall : onDownloadUpdate}
          >
            {iconOnly ? (updateUi?.phase === 'downloaded' ? '↻' : updateUi?.phase === 'available' ? '↓' : '…') : updateLabel}
          </button>
        )}
        {iconOnly ? (
          <button
            type="button"
            data-testid="sidebar-check-update"
            aria-label="检查更新"
            title="检查更新"
            onClick={() => onCheckUpdate?.()}
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              background: 'transparent',
              padding: '6px 0',
              margin: 0,
              color: 'var(--muted)',
              opacity: 0.55,
              cursor: 'pointer',
              transition:
                'opacity var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.85'
              e.currentTarget.style.background = 'var(--panel-soft)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.55'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            data-testid="sidebar-check-update"
            onClick={() => onCheckUpdate?.()}
            style={{
              alignSelf: 'flex-start',
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              fontSize: 10,
              lineHeight: 1.4,
              color: 'var(--muted)',
              opacity: 0.55,
              cursor: 'pointer',
              fontWeight: 500,
              letterSpacing: '0.03em',
              transition: 'opacity var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.85'
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.textUnderlineOffset = '3px'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.55'
              e.currentTarget.style.textDecoration = 'none'
            }}
          >
            检查更新
          </button>
        )}
        <div
          data-testid="sidebar-app-version"
          title={versionTitle}
          style={{
            fontSize: iconOnly ? 9 : 11,
            color: 'var(--text-dim)',
            padding: iconOnly ? '6px 4px' : '12px',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--panel-soft)',
            opacity: 0.7,
            textAlign: 'center',
            lineHeight: iconOnly ? 1.35 : 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: iconOnly ? 'nowrap' : 'normal',
          }}
        >
          {appVersion ? (iconOnly ? formatVersionShort(appVersion) : `v${appVersion} Stable`) : '…'}
        </div>
      </div>
      </div>

      <button
        type="button"
        data-testid="sidebar-seam-toggle"
        aria-expanded={!iconOnly}
        aria-label={seamBtnLabel}
        title={seamBtnLabel}
        onClick={() => setIconOnly((prev) => !prev)}
        className="sidebar-seam-toggle"
      >
        <span aria-hidden />
      </button>
    </div>
  )
}
