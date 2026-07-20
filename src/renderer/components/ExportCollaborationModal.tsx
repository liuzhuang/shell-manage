import type { CollaborationExportDraft } from '../../shared/types'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from './Panel'

export function ExportCollaborationModal(props: {
  draft: CollaborationExportDraft
  confirming: boolean
  onDraftChange: (draft: CollaborationExportDraft) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { draft, confirming, onDraftChange, onClose, onConfirm } = props

  const selectedProjectCount = draft.projects.filter((row) => row.selected).length
  const selectedScriptCount = draft.scripts.filter((row) => row.selected).length

  function updateProject(id: string, patch: Partial<(typeof draft.projects)[number]>) {
    onDraftChange({
      ...draft,
      projects: draft.projects.map((row) => (row.id === id ? { ...row, ...patch } : row))
    })
  }

  function updateScript(id: string, patch: Partial<(typeof draft.scripts)[number]>) {
    onDraftChange({
      ...draft,
      scripts: draft.scripts.map((row) => (row.id === id ? { ...row, ...patch } : row))
    })
  }

  const empty = draft.projects.length === 0 && draft.scripts.length === 0

  return (
    <div
      data-testid="export-collaboration-modal"
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
        <Panel style={{ width: 'min(820px, 96vw)', maxHeight: '86vh', overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>选择要分享的内容</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                导出为与 config.yaml 相同的 YAML 片段（projectDirectories / deployScripts），不含本机 path
              </div>
            </div>
            <button type="button" data-testid="export-collaboration-close" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
          </div>

          {empty ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '24px 0', textAlign: 'center' }}>
              当前没有可分享的项目目录或脚本
            </div>
          ) : (
            <>
              {draft.projects.length > 0 && (
                <section style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>项目目录</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {draft.projects.map((row) => (
                      <div
                        key={row.id}
                        data-testid={`export-collaboration-project-${row.id}`}
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 14,
                          padding: 10,
                          background: row.selected ? 'var(--panel-soft)' : 'var(--panel)',
                          opacity: row.selected ? 1 : 0.72
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(event) => updateProject(row.id, { selected: event.target.checked })}
                          />
                          <span style={{ fontWeight: 600 }}>{row.name}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {draft.scripts.length > 0 && (
                <section style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>脚本</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {draft.scripts.map((row) => (
                      <div
                        key={row.id}
                        data-testid={`export-collaboration-script-${row.id}`}
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 14,
                          padding: 10,
                          background: row.selected ? 'var(--panel-soft)' : 'var(--panel)',
                          opacity: row.selected ? 1 : 0.72
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(event) => updateScript(row.id, { selected: event.target.checked })}
                            style={{ marginTop: 2 }}
                          />
                          <span style={{ fontWeight: 600 }}>{row.name}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                将分享 {selectedProjectCount} 个项目名、{selectedScriptCount} 个脚本
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" data-testid="export-collaboration-cancel" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-testid="export-collaboration-confirm"
              style={buttonStyle('primary')}
              onClick={onConfirm}
              disabled={confirming || empty || (selectedProjectCount === 0 && selectedScriptCount === 0)}
            >
              {confirming ? '复制中…' : '复制到剪贴板'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
