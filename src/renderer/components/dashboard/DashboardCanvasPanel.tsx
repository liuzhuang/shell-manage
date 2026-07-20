import { GridCanvas } from './GridCanvas'
import type { DashboardDataMap, DashboardWidgetSpec } from '../../lib/dashboard-types'
import type { DashboardGridLayoutItem } from '../../../shared/types'

interface DashboardCanvasPanelProps {
  mode: 'Viewing' | 'Creating' | 'Editing' | 'Saving'
  isDirty: boolean
  isIntentLoading: boolean
  title: string
  contextLabel: string
  refreshSec: number
  onRefreshSecChange: (value: number) => void
  widgets: DashboardWidgetSpec[]
  gridLayout: DashboardGridLayoutItem[]
  dataMap: DashboardDataMap
  selectedWidgetId?: string
  onInspect: (widgetId: string) => void
  onDeleteWidget: (widgetId: string) => void
  commandOptions: Array<{ name: string }>
  selectedCommandName: string
  onSelectCommand: (name: string) => void
  onOpenAssistant: () => void
  onEnterCreating: () => void
  onEnterEditing: () => void
  onCancelEditing: () => void
  onAutoRecommend: () => void
  onSave: () => void
}

const refreshOptions = [5, 10, 30, 60] as const

export function DashboardCanvasPanel(props: DashboardCanvasPanelProps) {
  const {
    mode,
    isDirty,
    isIntentLoading,
    title,
    contextLabel,
    refreshSec,
    onRefreshSecChange,
    widgets,
    gridLayout,
    dataMap,
    selectedWidgetId,
    onInspect,
    onDeleteWidget,
    commandOptions,
    selectedCommandName,
    onSelectCommand,
    onOpenAssistant,
    onEnterCreating,
    onEnterEditing,
    onCancelEditing,
    onAutoRecommend,
    onSave
  } = props
  const isEditing = mode === 'Editing' || mode === 'Creating'
  return (
    <main
      data-testid="dashboard-canvas-panel"
      style={{
        flex: 1,
        minWidth: 0,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <header
        data-testid="dashboard-canvas-header"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Context: {contextLabel}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>频率</span>
          <select
            data-testid="dashboard-refresh-select"
            value={String(refreshSec)}
            onChange={(event) => onRefreshSecChange(Number(event.target.value))}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              padding: '6px 8px',
              fontSize: 12
            }}
          >
            {refreshOptions.map((item) => (
              <option key={item} value={item}>
                {item}s
              </option>
            ))}
          </select>
          <button
            data-testid="dashboard-open-assistant"
            type="button"
            onClick={onOpenAssistant}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              padding: '6px 10px',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            看板助手
          </button>
          {mode === 'Viewing' ? (
            <>
              <button
                data-testid="dashboard-enter-creating"
                type="button"
                onClick={onEnterCreating}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-soft)',
                  color: 'var(--text)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                创建看板
              </button>
              <button
                data-testid="dashboard-enter-editing"
                type="button"
                onClick={onEnterEditing}
                disabled={widgets.length === 0}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--panel)',
                  color: widgets.length === 0 ? 'var(--text-dim)' : 'var(--text)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: widgets.length === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                编辑看板
              </button>
            </>
          ) : (
            <>
              <button
                data-testid="dashboard-cancel-editing"
                type="button"
                onClick={onCancelEditing}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                退出编辑
              </button>
              <button
                data-testid="dashboard-save-draft"
                type="button"
                onClick={onSave}
                disabled={mode === 'Saving'}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: mode === 'Saving' ? 'var(--panel-soft)' : 'var(--accent)',
                  color: mode === 'Saving' ? 'var(--text-dim)' : 'var(--bg)',
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: mode === 'Saving' ? 'not-allowed' : 'pointer'
                }}
              >
                {mode === 'Saving' ? '保存中...' : '保存改动'}
              </button>
            </>
          )}
        </div>
      </header>

      <div data-testid="dashboard-grid-wrapper" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {widgets.length === 0 ? (
          <div
            data-testid="dashboard-empty-state"
            style={{
              height: '100%',
              minHeight: 320,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24
            }}
          >
            <div
              style={{
                width: 'min(760px, 100%)',
                border: '1px dashed var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                background: 'var(--panel-soft)'
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>当前看板为空</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                可指定连接，也可交由 Agent 根据候选连接决定。生成结果先进入草稿，保存后才会生效。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  data-testid="dashboard-command-select"
                  value={selectedCommandName}
                  onChange={(event) => onSelectCommand(event.target.value)}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--panel)',
                    color: 'var(--text)',
                    padding: '7px 10px',
                    fontSize: 12
                  }}
                >
                  <option value="">{commandOptions.length === 0 ? '暂无命令' : '由 Agent 选择连接'}</option>
                  {commandOptions.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  data-testid="dashboard-empty-auto-recommend"
                  type="button"
                  disabled={commandOptions.length === 0 || isIntentLoading}
                  onClick={onAutoRecommend}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent-soft)',
                    color: commandOptions.length === 0 || isIntentLoading ? 'var(--text-dim)' : 'var(--text)',
                    padding: '7px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: commandOptions.length === 0 || isIntentLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isIntentLoading ? '推荐中...' : '一键自动推荐'}
                </button>
                <button
                  data-testid="dashboard-empty-open-assistant"
                  type="button"
                  disabled={commandOptions.length === 0}
                  onClick={onOpenAssistant}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--panel)',
                    color: commandOptions.length === 0 ? 'var(--text-dim)' : 'var(--text)',
                    padding: '7px 12px',
                    fontSize: 12,
                    cursor: commandOptions.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  通过助手创建
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              minHeight: '100%',
              padding: isEditing ? 8 : 0,
              background: isEditing
                ? 'linear-gradient(0deg, color-mix(in srgb, var(--text) 8%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 8%, transparent) 1px, transparent 1px)'
                : 'transparent',
              backgroundSize: isEditing ? '24px 24px' : undefined
            }}
          >
            <GridCanvas
              widgets={widgets}
              gridLayout={gridLayout}
              dataMap={dataMap}
              selectedWidgetId={selectedWidgetId}
              editable={mode === 'Editing' || mode === 'Creating'}
              onDeleteWidget={mode === 'Editing' || mode === 'Creating' ? onDeleteWidget : undefined}
              onInspect={onInspect}
            />
          </div>
        )}
      </div>
    </main>
  )
}
