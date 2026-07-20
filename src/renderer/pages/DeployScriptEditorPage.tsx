import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeployScriptConfig, ProjectDirectory, SshKeyConfig, TemplatePreviewResult } from '../../shared/types'
import { TemplateSlotEditor } from '../components/TemplateSlotEditor'
import { Panel } from '../components/Panel'
import { readAppConfig, saveAppConfig } from '../lib/config-write'
import { fillTemplatePreviewHtml } from '../lib/template-slot-html'
import { buttonStyle } from '../lib/uiStyles'
import './DeployScriptEditorPage.css'

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

const AUTO_SAVE_DELAY_MS = 500
const DEFAULT_SCRIPT_NAME = '未命名脚本'

function hasPersistableDraft(script: DeployScriptConfig | null): boolean {
  if (!script) return false
  return Boolean(script.name.trim() || script.content.trim())
}

function normalizeDraftForSave(script: DeployScriptConfig): DeployScriptConfig {
  return {
    ...script,
    name: script.name.trim() || DEFAULT_SCRIPT_NAME
  }
}

function snapshotDraft(script: DeployScriptConfig): string {
  return JSON.stringify(normalizeDraftForSave(script))
}

export function DeployScriptEditorPage(props: {
  deployScripts: DeployScriptConfig[]
  projectDirectories: ProjectDirectory[]
  sshKeys: SshKeyConfig[]
  onConfigChanged: () => Promise<void>
  onNotify: (message: string, tone?: 'success' | 'error' | 'warn' | 'info') => void
  onExecuteDeploy: (payload: { scriptId: string; content: string; scriptName: string }) => Promise<void>
}) {
  const { deployScripts, projectDirectories, sshKeys, onConfigChanged, onNotify, onExecuteDeploy } = props
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<DeployScriptConfig | null>(null)
  const [preview, setPreview] = useState<TemplatePreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [executing, setExecuting] = useState(false)
  const convertTimerRef = useRef<number | null>(null)
  const autoSaveTimerRef = useRef<number | null>(null)
  const lastAutoConvertedRef = useRef('')
  const lastSavedSnapshotRef = useRef('')
  const draftRef = useRef<DeployScriptConfig | null>(null)
  const persistInFlightRef = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const knownSlots = useMemo(() => {
    const set = new Set<string>()
    for (const item of projectDirectories) {
      const name = item.name.trim()
      if (name) set.add(name)
    }
    for (const key of sshKeys) {
      const label = key.label.trim()
      if (label) set.add(label)
    }
    return [...set]
  }, [projectDirectories, sshKeys])

  useEffect(() => {
    if (mode !== 'edit' || !draft || !draft.content.trim()) {
      setPreview(null)
      return
    }
    const timer = window.setTimeout(() => {
      void window.api
        .deployPreviewTemplate({
          content: draft.content,
          projectDirectories
        })
        .then((result) => {
          setPreview(result)
        })
        .catch(() => setPreview(null))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [draft, mode, projectDirectories, sshKeys])

  useEffect(() => {
    if (mode !== 'edit' || !draft?.content.trim()) return
    const raw = draft.content
    if (raw === lastAutoConvertedRef.current) return

    const looksLikeRawScript =
      /(?:^|\s)-i\s+\S+/.test(raw) ||
      /(?:^|\n)\s*(?:export\s+)?SSH_KEY\s*=\s*["']/.test(raw) ||
      /\b\S+@\d{1,3}(?:\.\d{1,3}){3}\b/.test(raw) ||
      /\/(?:Users|home)\/\S+/.test(raw)
    if (!looksLikeRawScript) return

    if (convertTimerRef.current) window.clearTimeout(convertTimerRef.current)
    convertTimerRef.current = window.setTimeout(() => {
      convertTimerRef.current = null
      void window.api
        .deployConvertToTemplate({
          script: raw,
          projectDirectories
        })
        .then((result) => {
          if (result.replacements.length === 0 || result.content === raw) return
          lastAutoConvertedRef.current = result.content
          setDraft((prev) =>
            prev
              ? {
                  ...prev,
                  content: result.content,
                  sshKeyRef: result.sshKeyRef ?? prev.sshKeyRef
                }
              : prev
          )
          onNotify(`已自动替换 ${result.replacements.length} 处为插槽`, 'info')
        })
        .catch(() => {})
    }, 500)

    return () => {
      if (convertTimerRef.current) window.clearTimeout(convertTimerRef.current)
    }
  }, [draft?.content, mode, projectDirectories, onNotify])

  async function persistDraft(
    script: DeployScriptConfig | null,
    options?: { refreshConfig?: boolean; notifyOnSave?: boolean }
  ): Promise<boolean> {
    if (!script || !hasPersistableDraft(script)) return false

    const saved = normalizeDraftForSave(script)
    const snapshot = snapshotDraft(script)
    if (snapshot === lastSavedSnapshotRef.current) return true

    if (persistInFlightRef.current) {
      await persistInFlightRef.current
      if (snapshot === lastSavedSnapshotRef.current) return true
    }

    const persistPromise = (async () => {
      try {
        const config = await readAppConfig()
        const scripts = [...(config.deployScripts || [])]
        const index = scripts.findIndex((item) => item.id === saved.id)
        if (index >= 0) scripts[index] = saved
        else scripts.push(saved)
        config.deployScripts = scripts
        config.activeDeployScriptId = saved.id
        await saveAppConfig(config)
        lastSavedSnapshotRef.current = snapshot
        if (options?.refreshConfig) {
          await onConfigChanged()
        }
        if (options?.notifyOnSave) {
          onNotify('脚本已保存', 'success')
        }
        return true
      } catch (error) {
        onNotify(error instanceof Error ? error.message : String(error), 'error')
        return false
      } finally {
        persistInFlightRef.current = null
      }
    })()

    persistInFlightRef.current = persistPromise
    return persistPromise
  }

  function scheduleAutoSave(script: DeployScriptConfig | null) {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    if (mode !== 'edit' || !script || !hasPersistableDraft(script)) return

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void persistDraft(script, { refreshConfig: false })
    }, AUTO_SAVE_DELAY_MS)
  }

  async function flushAutoSave(options?: { refreshConfig?: boolean; notifyOnSave?: boolean }) {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    return persistDraft(draftRef.current, options)
  }

  useEffect(() => {
    if (mode !== 'edit' || !draft) return
    scheduleAutoSave(draft)
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    }
  }, [draft, mode])

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
      void persistDraft(draftRef.current, { refreshConfig: false })
    }
  }, [])

  async function handleExecuteDeploy(script: Pick<DeployScriptConfig, 'id' | 'name' | 'content'>) {
    const name = script.name.trim() || '未命名脚本'
    if (!script.content.trim()) {
      onNotify('脚本内容为空，无法执行', 'warn')
      return
    }
    setExecuting(true)
    try {
      const validation = await window.api.deployValidateScript({
        scriptId: script.id,
        content: script.content
      })
      if (!validation.ok) {
        const parts: string[] = []
        if (validation.missingSlots.length > 0) {
          parts.push(`未填充：${validation.missingSlots.map((slot) => `{{${slot}}}`).join('、')}`)
        }
        if (validation.unknownSlots.length > 0) {
          parts.push(`未知插槽：${validation.unknownSlots.map((slot) => `{{${slot}}}`).join('、')}`)
        }
        onNotify(parts.join('；') || '脚本校验失败', 'error')
        return
      }
      await onExecuteDeploy({ scriptId: script.id, content: script.content, scriptName: name })
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setExecuting(false)
    }
  }

  function handleAdd() {
    const script: DeployScriptConfig = {
      id: `deploy-${Date.now()}`,
      name: '',
      content: '',
      createdAt: new Date().toISOString()
    }
    setDraft(script)
    lastAutoConvertedRef.current = ''
    lastSavedSnapshotRef.current = ''
    setMode('edit')
  }

  function handleEdit(script: DeployScriptConfig) {
    setDraft({ ...script })
    lastAutoConvertedRef.current = script.content
    lastSavedSnapshotRef.current = snapshotDraft(script)
    setMode('edit')
  }

  async function handleDelete(script: DeployScriptConfig) {
    if (!window.confirm(`确定删除脚本「${script.name}」吗？`)) return
    setBusy(true)
    try {
      const config = await readAppConfig()
      const nextScripts = (config.deployScripts || []).filter((item) => item.id !== script.id)
      config.deployScripts = nextScripts
      if (config.activeDeployScriptId === script.id) {
        config.activeDeployScriptId = nextScripts[0]?.id
      }
      await saveAppConfig(config)
      await onConfigChanged()
      onNotify(`已删除：${script.name}`, 'info')
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!draft) return
    if (!draft.name.trim()) {
      onNotify('请填写脚本名称', 'warn')
      return
    }
    setBusy(true)
    try {
      const ok = await flushAutoSave({ refreshConfig: true, notifyOnSave: true })
      if (!ok) return
      setMode('list')
      setDraft(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleBack() {
    setBusy(true)
    try {
      await flushAutoSave({ refreshConfig: true })
    } finally {
      setBusy(false)
      setMode('list')
      setDraft(null)
    }
  }

  if (mode === 'list') {
    return (
      <div data-testid="deploy-script-editor-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
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
              <div style={{ fontSize: 18, fontWeight: 700, flexShrink: 0 }}>脚本</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
                写清楚要执行的操作，需要用到哪个项目时，在脚本里写上该项目的名字，运行时会自动找到对应文件夹
              </div>
            </div>
            <button type="button" data-testid="deploy-script-add" style={buttonStyle('primary')} disabled={busy} onClick={handleAdd}>
              添加
            </button>
          </div>

          {deployScripts.length === 0 ? (
            <div
              data-testid="deploy-scripts-empty"
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
              暂无脚本，点击「添加」创建。
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 140px 1fr',
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
                <span>脚本名称</span>
                <span>创建时间</span>
                <span />
              </div>
              {deployScripts.map((script, index) => (
                <div
                  key={script.id}
                  data-testid={`deploy-script-row-${script.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 140px 1fr',
                    gap: 12,
                    padding: '12px 14px',
                    alignItems: 'center',
                    borderBottom: index < deployScripts.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{script.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatCreatedAt(script.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid={`deploy-script-run-${script.id}`}
                      style={{ ...buttonStyle('primary'), padding: '6px 10px', fontSize: 11 }}
                      disabled={busy || executing}
                      onClick={() => void handleExecuteDeploy(script)}
                    >
                      执行
                    </button>
                    <button
                      type="button"
                      data-testid={`deploy-script-edit-${script.id}`}
                      style={{ ...buttonStyle('outline'), padding: '6px 10px', fontSize: 11 }}
                      disabled={busy}
                      onClick={() => handleEdit(script)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      data-testid={`deploy-script-delete-${script.id}`}
                      style={{ ...buttonStyle('danger'), padding: '6px 10px', fontSize: 11 }}
                      disabled={busy}
                      onClick={() => void handleDelete(script)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    )
  }

  if (!draft) return null

  const scriptContent = draft.content

  const previewHtml =
    preview && scriptContent ? fillTemplatePreviewHtml(scriptContent, preview.slotValues) : ''

  return (
    <div data-testid="deploy-script-editor-page" className="deployTunerPage">
      <div className="deployTunerToolbar">
        <button
          type="button"
          className="deployTunerBackBtn"
          data-testid="deploy-script-back"
          disabled={busy}
          onClick={() => void handleBack()}
          title="返回列表"
        >
          ←
        </button>
        <label className="deployNameLabel" htmlFor="deploy-script-name">
          脚本名称
        </label>
        <input
          id="deploy-script-name"
          data-testid="deploy-script-name"
          className="deployNameInput"
          type="text"
          value={draft.name}
          placeholder="输入脚本名称"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <button type="button" className="deployTunerBtnPrimary" disabled={busy} onClick={() => void handleSave()}>
          保存
        </button>
      </div>

      <div className="deployTunerCols">
        <section className="deployPanel">
          <TemplateSlotEditor
            testId="deploy-script-content"
            className="deployEditor"
            value={scriptContent}
            knownSlots={knownSlots}
            onChange={(content) => setDraft({ ...draft, content })}
          />
        </section>

        <section className="deployPanel deployPreviewPanel">
          <div className="deployPreviewHead">实时预览</div>
          <div className="deployPreviewBody">
            {!scriptContent.trim() ? (
              <div className="deployPreviewEmpty">输入脚本内容后，插槽将按配置的项目目录与 SSH 密钥在此解析预览。</div>
            ) : !preview ? (
              <div className="deployPreviewEmpty">预览加载中…</div>
            ) : (
              <div className="deploySample">
                <div className="deployRendered" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
