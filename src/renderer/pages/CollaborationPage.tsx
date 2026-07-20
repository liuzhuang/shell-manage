import { useState, type CSSProperties } from 'react'
import type {
  CollaborationExportDraft,
  CollaborationImportDraft,
  DeployScriptConfig,
  ProjectDirectory,
  SshKeyConfig
} from '../../shared/types'
import { ExportCollaborationModal } from '../components/ExportCollaborationModal'
import { ImportCollaborationModal } from '../components/ImportCollaborationModal'
import {
  buildCollaborationExportDraft,
  buildCollaborationImportDraft,
  buildCollaborationShareFromExportDraft,
  formatCollaborationMergeSummary,
  mergeCollaborationImportIntoConfig,
  parseCollaborationShare,
  serializeCollaborationShare,
  validateCollaborationExportDraft,
  validateCollaborationImportDraft
} from '../lib/collaboration-bundle'
import { readAppConfig, saveAppConfig } from '../lib/config-write'
import { buttonStyle } from '../lib/uiStyles'
import { ProjectDirectoriesPage } from './ProjectDirectoriesPage'
import { DeployScriptEditorPage } from './DeployScriptEditorPage'

export type CollaborationTab = 'directories' | 'scripts'

const tabButtonStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: -1,
  padding: '10px 2px 9px',
  border: 'none',
  borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--text)' : 'var(--muted)',
  fontSize: 13,
  fontWeight: active ? 600 : 500,
  fontFamily: 'var(--font-ui)',
  cursor: 'pointer',
  transition:
    'border-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
})

const tabCountStyle: CSSProperties = {
  color: 'var(--text-dim)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums'
}

export function CollaborationPage(props: {
  projectDirectories: ProjectDirectory[]
  deployScripts: DeployScriptConfig[]
  sshKeys: SshKeyConfig[]
  onConfigChanged: () => Promise<void>
  onNotify: (message: string, tone?: 'success' | 'error' | 'warn' | 'info') => void
  onExecuteDeploy: (payload: { scriptId: string; content: string; scriptName: string }) => Promise<void>
  onTrackAction?: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const { projectDirectories, deployScripts, sshKeys, onConfigChanged, onNotify, onExecuteDeploy, onTrackAction } = props
  const [tab, setTab] = useState<CollaborationTab>('directories')
  const [exportDraft, setExportDraft] = useState<CollaborationExportDraft | null>(null)
  const [exportConfirming, setExportConfirming] = useState(false)
  const [importDraft, setImportDraft] = useState<CollaborationImportDraft | null>(null)
  const [importConfirming, setImportConfirming] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)

  function switchTab(next: CollaborationTab) {
    if (next === tab) return
    onTrackAction?.(`collaboration.tab.${next === 'directories' ? 'directories' : 'scripts'}`, 'open', 'success')
    setTab(next)
  }

  function openExportModal() {
    const draft = buildCollaborationExportDraft({ projectDirectories, deployScripts })
    if (draft.projects.length === 0 && draft.scripts.length === 0) {
      onNotify('当前没有可分享的项目目录或脚本', 'warn')
      return
    }
    setExportDraft(draft)
  }

  async function confirmExportCollaboration() {
    if (!exportDraft || exportConfirming) return
    const validation = validateCollaborationExportDraft(exportDraft)
    if (!validation.ok) {
      onNotify(validation.message, 'warn')
      return
    }

    const share = buildCollaborationShareFromExportDraft(exportDraft)
    if (!share.projectDirectories?.length && !share.deployScripts?.length) {
      onNotify('请至少勾选一项再分享', 'warn')
      return
    }

    setExportConfirming(true)
    try {
      const text = serializeCollaborationShare(share)
      await navigator.clipboard.writeText(text)
      setExportDraft(null)
      onTrackAction?.('collaboration.export', 'submit', 'success')
      onNotify('协作包已复制，发给同事后让对方在协作页点「导入」', 'success')
    } catch (error) {
      onTrackAction?.('collaboration.export', 'submit', 'fail')
      onNotify(error instanceof Error ? error.message : '复制失败', 'error')
    } finally {
      setExportConfirming(false)
    }
  }

  async function handleImportFromClipboard() {
    if (shareBusy) return
    setShareBusy(true)
    try {
      const text = await navigator.clipboard.readText()
      const parsed = parseCollaborationShare(text)
      if (!parsed.ok) {
        onNotify(parsed.message, 'warn')
        return
      }
      const config = await readAppConfig()
      setImportDraft(buildCollaborationImportDraft(config, parsed.share))
      onTrackAction?.('collaboration.import', 'parse', 'success')
    } catch (error) {
      onTrackAction?.('collaboration.import', 'parse', 'fail')
      onNotify(error instanceof Error ? error.message : '读取剪贴板失败', 'error')
    } finally {
      setShareBusy(false)
    }
  }

  async function confirmImportCollaboration() {
    if (!importDraft || importConfirming) return
    const config = await readAppConfig()
    const validation = validateCollaborationImportDraft(config, importDraft)
    if (!validation.ok) {
      onNotify(validation.message, 'warn')
      return
    }

    setImportConfirming(true)
    try {
      const result = mergeCollaborationImportIntoConfig(config, importDraft)
      await saveAppConfig(config)
      await onConfigChanged()
      setImportDraft(null)
      onTrackAction?.('collaboration.import', 'merge', 'success')
      onNotify(formatCollaborationMergeSummary(result), 'success')
    } catch (error) {
      onTrackAction?.('collaboration.import', 'merge', 'fail')
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setImportConfirming(false)
    }
  }

  return (
    <>
      <div
        data-testid="collaboration-page"
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <header data-testid="collaboration-header" style={{ flexShrink: 0, padding: '8px 16px 0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  margin: 0,
                  color: 'var(--text)',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.3
                }}
              >
                协作
              </h1>
              <p style={{ margin: '5px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>
                先配置项目目录，再编写脚本并执行。
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                data-testid="collaboration-import-bundle"
                style={buttonStyle('outline')}
                disabled={shareBusy}
                onClick={() => void handleImportFromClipboard()}
              >
                导入
              </button>
              <button
                type="button"
                data-testid="collaboration-copy-bundle"
                style={buttonStyle('primary')}
                disabled={shareBusy}
                onClick={openExportModal}
              >
                分享
              </button>
            </div>
          </div>

          <nav
            data-testid="collaboration-inner-nav"
            role="tablist"
            aria-label="协作子页面"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              marginTop: 18,
              borderBottom: '1px solid var(--border-subtle)'
            }}
          >
            <button
              type="button"
              id="collaboration-tab-scripts"
              role="tab"
              data-testid="collaboration-nav-scripts"
              aria-selected={tab === 'scripts'}
              aria-controls="collaboration-panel-scripts"
              style={tabButtonStyle(tab === 'scripts')}
              onClick={() => switchTab('scripts')}
            >
              <span>脚本</span>
              <span style={tabCountStyle}>{deployScripts.length}</span>
            </button>
            <button
              type="button"
              id="collaboration-tab-directories"
              role="tab"
              data-testid="collaboration-nav-directories"
              aria-selected={tab === 'directories'}
              aria-controls="collaboration-panel-directories"
              style={tabButtonStyle(tab === 'directories')}
              onClick={() => switchTab('directories')}
            >
              <span>项目目录</span>
              <span style={tabCountStyle}>{projectDirectories.length}</span>
            </button>
          </nav>
        </header>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div
            id="collaboration-panel-directories"
            role="tabpanel"
            aria-labelledby="collaboration-tab-directories"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              display: tab === 'directories' ? 'block' : 'none'
            }}
          >
            <ProjectDirectoriesPage
              projectDirectories={projectDirectories}
              onConfigChanged={onConfigChanged}
              onNotify={onNotify}
            />
          </div>
          <div
            id="collaboration-panel-scripts"
            role="tabpanel"
            aria-labelledby="collaboration-tab-scripts"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: tab === 'scripts' ? 'flex' : 'none',
              flexDirection: 'column'
            }}
          >
            <DeployScriptEditorPage
              deployScripts={deployScripts}
              projectDirectories={projectDirectories}
              sshKeys={sshKeys}
              onConfigChanged={onConfigChanged}
              onNotify={onNotify}
              onExecuteDeploy={onExecuteDeploy}
            />
          </div>
        </div>
      </div>

      {exportDraft ? (
        <ExportCollaborationModal
          draft={exportDraft}
          confirming={exportConfirming}
          onDraftChange={setExportDraft}
          onClose={() => {
            if (!exportConfirming) setExportDraft(null)
          }}
          onConfirm={() => void confirmExportCollaboration()}
        />
      ) : null}

      {importDraft ? (
        <ImportCollaborationModal
          draft={importDraft}
          existingProjectDirectories={projectDirectories}
          confirming={importConfirming}
          onDraftChange={setImportDraft}
          onClose={() => {
            if (!importConfirming) setImportDraft(null)
          }}
          onConfirm={() => void confirmImportCollaboration()}
        />
      ) : null}
    </>
  )
}
