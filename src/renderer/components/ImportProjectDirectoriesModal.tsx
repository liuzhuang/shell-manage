import type { ProjectSubdirectoryItem } from '../../shared/types'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from './Panel'

export function ImportProjectDirectoriesModal(props: {
  rootPath: string
  items: ProjectSubdirectoryItem[]
  selectedPaths: Record<string, boolean>
  existingPaths: Set<string>
  onToggle: (path: string) => void
  onClose: () => void
  onConfirm: () => void
  confirming: boolean
}) {
  const { rootPath, items, selectedPaths, existingPaths, onToggle, onClose, onConfirm, confirming } = props
  const selectedCount = items.filter((item) => selectedPaths[item.path] !== false && !existingPaths.has(item.path)).length

  return (
    <div
      data-testid="import-project-directories-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.52)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20
      }}
      onClick={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <Panel style={{ width: 'min(760px, 96vw)', maxHeight: '86vh', overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>导入子目录</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>父目录：{rootPath}</div>
            </div>
            <button type="button" data-testid="import-project-directories-close" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            共 {items.length} 个子目录，已勾选 {selectedCount} 项
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>该目录下没有可导入的子目录</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((item) => {
                const duplicated = existingPaths.has(item.path)
                const checked = !duplicated && selectedPaths[item.path] !== false
                return (
                  <div
                    key={item.path}
                    data-testid={`import-project-directory-row-${item.name}`}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 14,
                      padding: 10,
                      background: checked ? 'var(--panel-soft)' : 'var(--panel)',
                      opacity: duplicated ? 0.6 : 1
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: duplicated ? 'not-allowed' : 'pointer' }}>
                      <input
                        type="checkbox"
                        data-testid={`import-project-directory-checkbox-${item.name}`}
                        checked={checked}
                        disabled={duplicated}
                        onChange={() => onToggle(item.path)}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                          <strong>{item.name}</strong>
                          {duplicated ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>已在列表中</span> : null}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{item.path}</div>
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button type="button" data-testid="import-project-directories-cancel" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-testid="import-project-directories-confirm"
              style={buttonStyle('primary')}
              onClick={onConfirm}
              disabled={confirming || selectedCount === 0}
            >
              {confirming ? '导入中…' : '确认导入'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
