import { useEffect, useState } from 'react'
import type { LogViewPreset } from '../../shared/types'
import { useWindowFullscreen } from '../hooks/useWindowFullscreen'
import { getLogDashboardDockLayout } from '../lib/logDashboardDock'
import { readSidebarWidth } from './Sidebar'

const MUTED_GRADIENTS = [
  'linear-gradient(135deg, #3b4a5c, #4a5568)',
  'linear-gradient(135deg, #4a4458, #5b4f6a)',
  'linear-gradient(135deg, #3d5a5a, #4a6b6b)',
  'linear-gradient(135deg, #5c4a3b, #6b5a4a)',
  'linear-gradient(135deg, #3b4a6b, #4a5a7c)',
  'linear-gradient(135deg, #5a4a5c, #6b5a6d)',
  'linear-gradient(135deg, #4a5a4a, #5b6b5b)',
  'linear-gradient(135deg, #5c5040, #6d6050)'
]

function getGradient(index: number): string {
  return MUTED_GRADIENTS[index % MUTED_GRADIENTS.length]
}

export function LogDashboardPresetsPanel({
  logViewPresets,
  onOpenPreset,
  onRenamePreset,
  onDeletePreset,
  onAddPreset
}: {
  logViewPresets: LogViewPreset[]
  onOpenPreset: (name: string) => void
  onRenamePreset: (oldName: string, nextName: string) => void
  onDeletePreset: (name: string) => void
  onAddPreset: () => void
}) {
  const [sidebarOffset, setSidebarOffset] = useState(readSidebarWidth)
  const [editingPresetName, setEditingPresetName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [addCardHovered, setAddCardHovered] = useState(false)
  const isWindowFullscreen = useWindowFullscreen()
  const dock = getLogDashboardDockLayout(isWindowFullscreen)
  const { scale: dockScale } = dock

  useEffect(() => {
    const syncOffset = () => {
      const next = readSidebarWidth()
      setSidebarOffset((prev) => (prev === next ? prev : next))
    }
    const timer = window.setInterval(syncOffset, 400)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      {editingPresetName ? (
        <div
          style={{
            position: 'fixed',
            left: sidebarOffset + 8,
            bottom: dock.editBottom,
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--panel) 90%, black)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <input
            autoFocus
            value={editingNameValue}
            onChange={(e) => setEditingNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingPresetName(null)
                setEditingNameValue('')
              }
              if (e.key === 'Enter') {
                const nextName = editingNameValue.trim()
                if (!nextName || nextName === editingPresetName) {
                  setEditingPresetName(null)
                  setEditingNameValue('')
                  return
                }
                onRenamePreset(editingPresetName, nextName)
                setEditingPresetName(null)
                setEditingNameValue('')
              }
            }}
            style={{
              width: 180,
              height: 28,
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border-default)',
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              padding: '0 8px',
              fontSize: 12
            }}
            placeholder="输入新的预设名称"
          />
          <button
            type="button"
            onClick={() => {
              const nextName = editingNameValue.trim()
              if (!nextName || nextName === editingPresetName) {
                setEditingPresetName(null)
                setEditingNameValue('')
                return
              }
              onRenamePreset(editingPresetName, nextName)
              setEditingPresetName(null)
              setEditingNameValue('')
            }}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xs)',
              background: 'color-mix(in srgb, var(--accent) 26%, var(--panel-soft))',
              color: 'var(--text)',
              height: 28,
              padding: '0 10px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingPresetName(null)
              setEditingNameValue('')
            }}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--panel-soft)',
              color: 'var(--text-dim)',
              height: 28,
              padding: '0 8px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            取消
          </button>
        </div>
      ) : null}

      <div
        data-testid="log-dashboard-dock-label"
        style={{
          position: 'fixed',
          left: sidebarOffset + 8,
          bottom: dock.labelBottom,
          zIndex: 12,
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-disabled)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
          opacity: 0.65
        }}
      >
        日志看板
      </div>

      <div
        data-testid="log-dashboard-presets-panel"
        style={{
          position: 'fixed',
          left: sidebarOffset,
          bottom: 0,
          maxWidth: dock.panelMaxWidth,
          zIndex: 12,
          display: 'flex',
          alignItems: 'flex-end',
          gap: dock.gap,
          overflowX: 'auto',
          padding: `0 ${dock.paddingX}px`,
          scrollbarWidth: 'none',
          pointerEvents: 'auto'
        }}
      >
        {logViewPresets.length === 0 ? (
          <div
            data-testid="log-dashboard-empty-hint"
            style={{
              flexShrink: 0,
              alignSelf: 'center',
              fontSize: 10 * dockScale,
              color: 'var(--text-disabled)',
              padding: `0 ${4 * dockScale}px ${18 * dockScale}px`,
              whiteSpace: 'nowrap',
              opacity: 0.65
            }}
          >
            还没有看板
          </div>
        ) : null}
        {logViewPresets.map((preset, idx) => (
          <div
            key={preset.name}
            data-testid={`log-dashboard-preset-item-${preset.name}`}
            style={{
              flexShrink: 0,
              width: dock.cardWidth,
              height: dock.cardHeight,
              position: 'relative',
              overflow: 'visible'
            }}
          >
            <div
              onClick={() => onOpenPreset(preset.name)}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 6 * dockScale,
                overflow: 'hidden',
                cursor: 'pointer',
                transform: 'skewX(-8deg)',
                transition: 'transform 0.2s'
              }}
            >
              <div style={{ position: 'absolute', inset: 0, background: getGradient(idx) }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)' }} />
            </div>

            <div style={{ position: 'absolute', top: 2 * dockScale, right: 2 * dockScale, display: 'flex', gap: 2 * dockScale, zIndex: 3 }}>
              <button
                type="button"
                data-testid={`log-dashboard-preset-rename-${preset.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingPresetName(preset.name)
                  setEditingNameValue(preset.name)
                }}
                style={{
                  border: 'none',
                  background: 'rgba(0,0,0,0.5)',
                  color: 'rgba(255,255,255,0.75)',
                  borderRadius: 4 * dockScale,
                  width: 16 * dockScale,
                  height: 16 * dockScale,
                  fontSize: 9 * dockScale,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0
                }}
                title="重命名"
              >
                ✎
              </button>
              <button
                type="button"
                data-testid={`log-dashboard-preset-delete-${preset.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeletePreset(preset.name)
                }}
                style={{
                  border: 'none',
                  background: 'rgba(0,0,0,0.5)',
                  color: 'rgba(255,255,255,0.75)',
                  borderRadius: 4 * dockScale,
                  width: 16 * dockScale,
                  height: 16 * dockScale,
                  fontSize: 9 * dockScale,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0
                }}
                title="删除"
              >
                ×
              </button>
            </div>

            <div
              data-testid={`log-dashboard-preset-open-${preset.name}`}
              onClick={() => onOpenPreset(preset.name)}
              style={{
                position: 'absolute',
                bottom: 7 * dockScale,
                left: 12 * dockScale,
                right: 8 * dockScale,
                cursor: 'pointer',
                zIndex: 2
              }}
            >
              <div
                style={{
                  fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', var(--font-mono)",
                  fontSize: 10 * dockScale,
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {preset.name}
              </div>
              <div
                style={{
                  fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', var(--font-mono)",
                  fontSize: 8 * dockScale,
                  color: 'rgba(255,255,255,0.6)',
                  marginTop: 1 * dockScale
                }}
              >
                {preset.commandNames.length} commands
              </div>
            </div>
          </div>
        ))}

        <div
          data-testid="log-dashboard-add-trigger"
          title="添加日志看板"
          onClick={onAddPreset}
          onMouseEnter={() => setAddCardHovered(true)}
          onMouseLeave={() => setAddCardHovered(false)}
          style={{
            flexShrink: 0,
            width: dock.cardWidth,
            height: dock.cardHeight,
            position: 'relative',
            overflow: 'visible',
            cursor: 'pointer',
            opacity: addCardHovered ? 1 : 0.72,
            transition: 'opacity 0.2s'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 6 * dockScale,
              overflow: 'hidden',
              transform: addCardHovered ? 'skewX(-8deg) scale(1.02)' : 'skewX(-8deg)',
              transition: 'transform 0.2s, background 0.2s, border-color 0.2s',
              border: addCardHovered
                ? '1px dashed color-mix(in srgb, var(--accent) 24%, var(--border-default))'
                : '1px dashed var(--border-subtle)',
              background: addCardHovered
                ? 'color-mix(in srgb, var(--accent) 5%, var(--panel-soft))'
                : 'color-mix(in srgb, var(--panel-soft) 55%, transparent)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
              color: addCardHovered ? 'color-mix(in srgb, var(--accent) 55%, var(--muted))' : 'var(--text-dim)',
              fontSize: 10 * dockScale,
              fontWeight: addCardHovered ? 600 : 500,
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', var(--font-mono)",
              transition: 'color 0.2s, font-weight 0.2s'
            }}
          >
            <span style={{ fontSize: 14 * dockScale, lineHeight: 1, marginBottom: 2 * dockScale, opacity: 0.85 }}>＋</span>
            添加看板
          </div>
        </div>
      </div>
    </>
  )
}
