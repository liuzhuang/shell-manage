import type { DetectedProject } from '../../shared/types'

export function projectKey(project: Pick<DetectedProject, 'type' | 'name' | 'rootPath'>): string {
  return `${project.type}-${project.name}-${project.rootPath}`.replace(/[^\w.-]+/g, '_')
}

export function ImportProjectsPanel(props: {
  rootPath: string
  projects: DetectedProject[]
  selectedKeys: Record<string, boolean>
  onToggle: (key: string) => void
}) {
  const { rootPath, projects, selectedKeys, onToggle } = props
  const selectedCount = projects.filter((project) => selectedKeys[projectKey(project)] !== false).length

  return (
    <div data-testid="import-projects-modal">
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>根目录：{rootPath}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        共识别 {projects.length} 项，已勾选 {selectedCount} 项
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {projects.map((project) => {
          const key = projectKey(project)
          const checked = selectedKeys[key] !== false
          return (
            <div
              data-testid={`import-project-row-${key}`}
              key={key}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: 10,
                background: checked ? 'var(--panel-soft)' : 'var(--panel)'
              }}
            >
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  data-testid={`import-project-checkbox-${key}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(key)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                    <strong>{project.name}</strong>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{project.type}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>置信度 {Math.round(project.confidence * 100)}%</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{project.rootPath}</div>
                  <code
                    style={{
                      display: 'block',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      background: 'var(--bg)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: '6px 8px',
                      marginBottom: 6
                    }}
                  >
                    {project.command}
                  </code>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>依据：{project.evidence.join('；')}</div>
                </div>
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
