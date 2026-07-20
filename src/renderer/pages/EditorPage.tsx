import { useState } from 'react'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'
import { YamlEditor } from '../components/YamlEditor'
import { VisualConfigEditor } from '../components/VisualConfigEditor'

export function EditorPage(props: {
  editorRaw: string
  editorError: string
  setEditorRaw: (text: string) => void
  saveEditor: () => Promise<{ ok: boolean; error?: string }>
  reloadEditor: () => Promise<void>
  locateLine?: number
  onLocated?: () => void
}) {
  const { editorRaw, editorError, setEditorRaw, saveEditor, reloadEditor, locateLine, onLocated } = props
  const [isVisualMode, setIsVisualMode] = useState(true)

  return (
    <div data-testid="editor-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <Panel
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          padding: 0
        }}
      >
        <div
          style={{
            width: '100%',
            padding: 16,
            boxSizing: 'border-box',
            display: 'grid',
            gap: 14,
            minHeight: 0
          }}
        >
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 18, lineHeight: 1.2, fontWeight: 700, letterSpacing: 0 }}>设置</h1>
              <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>
                管理命令、AI 和全局配置。保存后写回本地配置文件。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                data-testid="editor-mode-toggle"
                style={{ ...buttonStyle('muted'), borderRadius: 6 }}
                onClick={() => setIsVisualMode(!isVisualMode)}
              >
                {isVisualMode ? '源码编辑' : '可视化编辑'}
              </button>
              <button data-testid="editor-reload" style={{ ...buttonStyle('muted'), borderRadius: 6 }} onClick={reloadEditor}>
                重载
              </button>
              <button data-testid="editor-save" style={{ ...buttonStyle('primary'), borderRadius: 6 }} onClick={saveEditor}>
                保存配置
              </button>
            </div>
          </header>

          {isVisualMode ? (
            <VisualConfigEditor value={editorRaw} onChange={setEditorRaw} />
          ) : (
            <div style={{ height: 'calc(100vh - 188px)', minHeight: 420, display: 'flex' }}>
              <YamlEditor value={editorRaw} onChange={setEditorRaw} onSaveShortcut={() => void saveEditor()} locateLine={locateLine} onLocated={onLocated} />
            </div>
          )}

          <div
            data-testid="editor-status"
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              color: editorError ? 'var(--err)' : 'var(--muted)',
              background: 'var(--panel-soft)',
              fontSize: 12
            }}
          >
            {editorError ? `保存失败：${editorError}` : '配置状态：有效'}
          </div>
        </div>
      </Panel>
    </div>
  )
}
