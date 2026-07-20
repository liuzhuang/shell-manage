import { useMemo, useState, type CSSProperties } from 'react'
import type { ProjectDirectory, ProjectSubdirectoryItem } from '../../shared/types'
import { ImportProjectDirectoriesModal } from '../components/ImportProjectDirectoriesModal'
import { Panel } from '../components/Panel'
import { createProjectId, readAppConfig, saveAppConfig, slugFromPath } from '../lib/config-write'
import { appendProjectSubdirectories } from '../lib/project-directories'
import { buttonStyle } from '../lib/uiStyles'

function formatCreatedAt(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const nameInputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text)',
  background: 'var(--panel)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none'
}

export function ProjectDirectoriesPage(props: {
  projectDirectories: ProjectDirectory[]
  onConfigChanged: () => Promise<void>
  onNotify: (message: string, tone?: 'success' | 'error' | 'warn' | 'info') => void
}) {
  const { projectDirectories, onConfigChanged, onNotify } = props
  const [busy, setBusy] = useState(false)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [importPreview, setImportPreview] = useState<{
    rootPath: string
    items: ProjectSubdirectoryItem[]
    selectedPaths: Record<string, boolean>
    confirming: boolean
  } | null>(null)

  const existingPaths = useMemo(() => new Set(projectDirectories.map((item) => item.path)), [projectDirectories])

  function getProjectName(project: ProjectDirectory): string {
    return nameDrafts[project.id] ?? project.name
  }

  async function handleAdd() {
    const picked = await window.api.pickProjectDirectory()
    if (picked.canceled || !picked.path) return

    if (projectDirectories.some((item) => item.path === picked.path)) {
      onNotify('该目录已在列表中', 'warn')
      return
    }

    const name = slugFromPath(picked.path)
    const entry: ProjectDirectory = {
      id: createProjectId(name),
      name,
      path: picked.path,
      createdAt: new Date().toISOString()
    }

    setBusy(true)
    try {
      const config = await readAppConfig()
      config.projectDirectories = [...(config.projectDirectories || []), entry]
      await saveAppConfig(config)
      await onConfigChanged()
      onNotify(`已添加：${name}`, 'success')
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportDirectory() {
    const result = await window.api.pickAndListProjectSubdirectories()
    if (result.canceled) return
    if (result.subdirectories.length === 0) {
      onNotify('该目录下没有可导入的子目录', 'warn')
      return
    }
    const selectedPaths: Record<string, boolean> = {}
    for (const item of result.subdirectories) {
      selectedPaths[item.path] = !existingPaths.has(item.path)
    }
    setImportPreview({
      rootPath: result.rootPath || '',
      items: result.subdirectories,
      selectedPaths,
      confirming: false
    })
  }

  async function confirmImportDirectories() {
    if (!importPreview) return
    const selected = importPreview.items.filter(
      (item) => importPreview.selectedPaths[item.path] !== false && !existingPaths.has(item.path)
    )
    if (selected.length === 0) {
      onNotify('请至少勾选一项再导入', 'warn')
      return
    }
    setImportPreview((prev) => (prev ? { ...prev, confirming: true } : prev))
    setBusy(true)
    try {
      const config = await readAppConfig()
      const { added, skipped } = await appendProjectSubdirectories(config, importPreview.rootPath, selected)
      await saveAppConfig(config)
      await onConfigChanged()
      setImportPreview(null)
      if (added === 0) {
        onNotify(`未导入新目录，已跳过 ${skipped} 项`, 'info')
      } else {
        onNotify(`已导入 ${added} 个项目目录${skipped > 0 ? `，跳过 ${skipped} 项重复` : ''}`, 'success')
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
      setImportPreview((prev) => (prev ? { ...prev, confirming: false } : prev))
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(project: ProjectDirectory) {
    const nextName = (nameDrafts[project.id] ?? project.name).trim()
    if (!nextName || nextName === project.name) {
      setNameDrafts((prev) => {
        const next = { ...prev }
        delete next[project.id]
        return next
      })
      return
    }
    if (projectDirectories.some((item) => item.id !== project.id && item.name === nextName)) {
      onNotify('项目名称已存在', 'warn')
      setNameDrafts((prev) => ({ ...prev, [project.id]: project.name }))
      return
    }

    setBusy(true)
    try {
      const config = await readAppConfig()
      config.projectDirectories = (config.projectDirectories || []).map((item) =>
        item.id === project.id ? { ...item, name: nextName } : item
      )
      await saveAppConfig(config)
      await onConfigChanged()
      setNameDrafts((prev) => {
        const next = { ...prev }
        delete next[project.id]
        return next
      })
      onNotify(`已更新项目名称：${nextName}`, 'success')
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(project: ProjectDirectory) {
    if (!window.confirm(`确定删除项目「${project.name}」吗？`)) return

    setBusy(true)
    try {
      const config = await readAppConfig()
      const nextDirectories = (config.projectDirectories || []).filter((item) => item.id !== project.id)
      config.projectDirectories = nextDirectories
      await saveAppConfig(config)
      await onConfigChanged()
      onNotify(`已删除：${project.name}`, 'info')
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="project-directories-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <Panel
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 1px 2px color-mix(in srgb, var(--text) 4%, transparent)',
          overflow: 'auto'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, flexShrink: 0 }}>项目目录</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
              给每个项目起一个名字并记下文件夹位置，写脚本时直接写这个名字，不用每次重新找路径
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              data-testid="project-directory-import"
              style={buttonStyle('outline')}
              disabled={busy}
              onClick={() => void handleImportDirectory()}
            >
              导入目录
            </button>
            <button
              type="button"
              data-testid="project-directory-add"
              style={buttonStyle('primary')}
              disabled={busy}
              onClick={() => void handleAdd()}
            >
              添加
            </button>
          </div>
        </div>

        {projectDirectories.length === 0 ? (
          <div
            data-testid="project-directories-empty"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 14,
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 32
            }}
          >
            暂无项目，点击「添加」选择目录，或使用「导入目录」批量导入子目录。
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 140px 72px',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--panel-soft)',
                borderBottom: '1px solid var(--border-default)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              <span>项目名称</span>
              <span>项目路径</span>
              <span>创建时间</span>
              <span />
            </div>
            {projectDirectories.map((project, index) => (
              <div
                key={project.id}
                data-testid={`project-directory-row-${project.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 140px 72px',
                  gap: 12,
                  padding: '12px 14px',
                  alignItems: 'center',
                  borderBottom: index < projectDirectories.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: 'var(--panel)'
                }}
              >
                <input
                  data-testid={`project-directory-name-${project.id}`}
                  style={nameInputStyle}
                  value={getProjectName(project)}
                  disabled={busy}
                  onChange={(event) => setNameDrafts((prev) => ({ ...prev, [project.id]: event.target.value }))}
                  onBlur={() => void handleRename(project)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') {
                      setNameDrafts((prev) => {
                        const next = { ...prev }
                        delete next[project.id]
                        return next
                      })
                      event.currentTarget.blur()
                    }
                  }}
                />
                <div style={{ fontSize: 13, color: 'var(--text-dim)', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>
                  {project.path}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatCreatedAt(project.createdAt)}</div>
                <button
                  type="button"
                  data-testid={`project-directory-delete-${project.id}`}
                  style={{ ...buttonStyle('danger'), padding: '6px 10px', fontSize: 11 }}
                  disabled={busy}
                  onClick={() => void handleDelete(project)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {importPreview ? (
        <ImportProjectDirectoriesModal
          rootPath={importPreview.rootPath}
          items={importPreview.items}
          selectedPaths={importPreview.selectedPaths}
          existingPaths={existingPaths}
          confirming={importPreview.confirming}
          onToggle={(path) =>
            setImportPreview((prev) =>
              prev
                ? {
                    ...prev,
                    selectedPaths: {
                      ...prev.selectedPaths,
                      [path]: prev.selectedPaths[path] === false
                    }
                  }
                : prev
            )
          }
          onClose={() => setImportPreview(null)}
          onConfirm={() => void confirmImportDirectories()}
        />
      ) : null}
    </div>
  )
}
