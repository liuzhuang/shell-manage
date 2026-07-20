import type { CollaborationImportDraft, ProjectDirectory } from '../../shared/types'
import {
  missingProjectSlotsForScript,
  projectRowNeedsPath,
  resolveAvailableProjectNamesAfterImport
} from '../lib/collaboration-bundle'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from './Panel'

export function ImportCollaborationModal(props: {
  draft: CollaborationImportDraft
  existingProjectDirectories: ProjectDirectory[]
  confirming: boolean
  onDraftChange: (draft: CollaborationImportDraft) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { draft, existingProjectDirectories, confirming, onDraftChange, onClose, onConfirm } = props

  const namesAfterImport = resolveAvailableProjectNamesAfterImport(existingProjectDirectories, draft.projects)

  const selectedProjectCount = draft.projects.filter((row) => row.selected).length
  const selectedScriptCount = draft.scripts.filter((row) => row.selected).length

  function updateProject(name: string, patch: Partial<(typeof draft.projects)[number]>) {
    onDraftChange({
      ...draft,
      projects: draft.projects.map((row) => (row.name === name ? { ...row, ...patch } : row))
    })
  }

  function updateScript(name: string, patch: Partial<(typeof draft.scripts)[number]>) {
    onDraftChange({
      ...draft,
      scripts: draft.scripts.map((row) => (row.name === name ? { ...row, ...patch } : row))
    })
  }

  async function pickPathForProject(name: string) {
    const picked = await window.api.pickProjectDirectory()
    if (picked.canceled || !picked.path) return
    updateProject(name, { path: picked.path })
  }

  return (
    <div
      data-testid="import-collaboration-modal"
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
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>从剪贴板导入协作包</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                请为每个项目名选择本机文件夹，脚本才能通过项目名找到路径
              </div>
            </div>
            <button type="button" data-testid="import-collaboration-close" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
          </div>

          {draft.projects.length > 0 && (
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>项目名</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {draft.projects.map((row) => {
                  const needsPath = projectRowNeedsPath(row)
                  const boundPath = row.existingPath || row.path
                  return (
                    <div
                      key={row.name}
                      data-testid={`import-collaboration-project-${row.name}`}
                      style={{
                        border: `1px solid ${needsPath ? 'color-mix(in srgb, var(--warn) 40%, var(--border-subtle))' : 'var(--border-subtle)'}`,
                        borderRadius: 14,
                        padding: 10,
                        background: row.selected ? 'var(--panel-soft)' : 'var(--panel)',
                        opacity: row.selected ? 1 : 0.72
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) => updateProject(row.name, { selected: event.target.checked })}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.name}</div>
                          {row.existingPath ? (
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>本机已有：{row.existingPath}</div>
                          ) : boundPath ? (
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{boundPath}</div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--warn)' }}>请选择本机文件夹</div>
                          )}
                        </div>
                        {row.selected && !row.existingPath ? (
                          <button
                            type="button"
                            data-testid={`import-collaboration-pick-path-${row.name}`}
                            style={{ ...buttonStyle('outline'), padding: '4px 8px', fontSize: 11, flexShrink: 0 }}
                            disabled={confirming}
                            onClick={() => void pickPathForProject(row.name)}
                          >
                            选择文件夹
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {draft.scripts.length > 0 && (
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>脚本</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {draft.scripts.map((row) => {
                  const missing = row.selected ? missingProjectSlotsForScript(row.content, namesAfterImport) : []
                  return (
                    <div
                      key={row.name}
                      data-testid={`import-collaboration-script-${row.name}`}
                      style={{
                        border: `1px solid ${missing.length > 0 ? 'color-mix(in srgb, var(--warn) 40%, var(--border-subtle))' : 'var(--border-subtle)'}`,
                        borderRadius: 14,
                        padding: 10,
                        background: row.selected ? 'var(--panel-soft)' : 'var(--panel)'
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) => updateScript(row.name, { selected: event.target.checked })}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                            <strong>{row.name}</strong>
                            {row.hasConflict ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>与现有脚本同名</span>
                            ) : null}
                          </div>
                          {row.hasConflict && row.selected ? (
                            <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  type="radio"
                                  name={`conflict-${row.name}`}
                                  checked={row.conflictAction === 'skip'}
                                  onChange={() => updateScript(row.name, { conflictAction: 'skip' })}
                                />
                                跳过
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  type="radio"
                                  name={`conflict-${row.name}`}
                                  checked={row.conflictAction === 'overwrite'}
                                  onChange={() => updateScript(row.name, { conflictAction: 'overwrite' })}
                                />
                                覆盖
                              </label>
                            </div>
                          ) : null}
                          {missing.length > 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--warn)' }}>
                              未绑定项目名：{missing.map((item) => `{{${item}}}`).join('、')}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            已勾选 {selectedProjectCount} 个项目名、{selectedScriptCount} 个脚本
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" data-testid="import-collaboration-cancel" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-testid="import-collaboration-confirm"
              style={buttonStyle('primary')}
              onClick={onConfirm}
              disabled={confirming}
            >
              {confirming ? '导入中…' : '确认导入'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
