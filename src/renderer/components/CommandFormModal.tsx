import type { AppConfig, DetectedProject } from '../../shared/types'
import { AiOnboardingPromptPanel, useAiOnboardingPrompt } from './AiOnboardingPromptPanel'
import { DemoCommandsPanel } from './DemoCommandsPanel'
import { ImportProjectsPanel } from './ImportProjectsPanel'
import { buttonStyle } from '../lib/uiStyles'

export type CommandFormMode = 'create' | 'edit'
export type CommandCreateStep = 'pick' | 'manual' | 'ai' | 'import' | 'demo'

export type ImportPreviewState = {
  rootPath: string
  projects: DetectedProject[]
  selectedKeys: Record<string, boolean>
  confirming: boolean
}

export type CommandFormDraft = {
  originalName?: string
  name: string
  command: string
  commandSegments?: string[]
  allowTrailingEmptySegment?: boolean
  tags: string
  mode: 'service' | 'terminal'
  autoRestart: boolean
  webUrl: string
  sshKeyId?: string
  iconDataUrl?: string
  iconFilePath?: string
}

export type CommandFormState = {
  mode: CommandFormMode
  createStep: CommandCreateStep
  draft: CommandFormDraft
}

type CommandFormModalProps = {
  form: CommandFormState
  config: AppConfig
  existingCommandNames: string[]
  onClose: () => void
  onCreateStepChange: (step: CommandCreateStep) => void
  onFormChange: (updater: (prev: CommandFormState) => CommandFormState) => void
  onSubmit: () => void
  onPickMacosApp: () => void
  onFetchWebIcon: () => void
  onCopyError: (message: string) => void
  importPreview: ImportPreviewState | null
  importDetecting: boolean
  onBeginImportDirectory: (entry: 'pick' | 'shortcut') => void
  onImportToggle: (key: string) => void
  onConfirmImport: () => void
  demoPresetInstalled: boolean
  demoConfirming: boolean
  onBeginDemoImport: (entry: 'pick' | 'shortcut') => void
  onConfirmDemoImport: () => void
  onCleanupDemoCommands: () => void
}

function splitInteractiveCommands(command: string): string[] {
  const segments = command.split('|||').map((item) => item.trim())
  return segments.some((item) => item.length > 0) ? segments : ['']
}

function joinInteractiveCommands(segments: string[]): string {
  return segments.map((item) => item.trim()).join(' ||| ')
}

function compactInteractiveSegments(segments: string[]): string[] {
  const cleaned = segments.map((item) => item.trim()).filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : ['']
}

function resolveRenderableSegments(draft: CommandFormDraft): string[] {
  const segments = draft.commandSegments || splitInteractiveCommands(draft.command)
  if (draft.allowTrailingEmptySegment) return segments
  return compactInteractiveSegments(segments)
}

function modalWidthForStep(step: CommandCreateStep): number {
  if (step === 'pick') return 480
  if (step === 'ai' || step === 'demo') return 720
  if (step === 'import') return 980
  return 560
}

const PICK_MODE_TAG_STYLE = {
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 7px',
  borderRadius: 999,
  background: 'var(--accent-soft)',
  color: 'var(--accent-strong)',
  border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border-subtle))'
} as const

function PickModeTags(props: { tags: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
      {props.tags.map((tag) => (
        <span key={tag} style={PICK_MODE_TAG_STYLE}>
          {tag}
        </span>
      ))}
    </div>
  )
}

function PickModeCard(props: {
  testId: string
  title: string
  description: string
  tags: string[]
  onClick: () => void
  disabled?: boolean
}) {
  const { testId, title, description, tags, onClick, disabled } = props
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        background: 'var(--panel)',
        cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.7 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{title}</div>
        <div
          style={{
            minWidth: 0,
            fontSize: 12,
            color: 'var(--text-dim)',
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {description}
        </div>
      </div>
      <PickModeTags tags={tags} />
    </button>
  )
}

export function CommandFormModal(props: CommandFormModalProps) {
  const {
    form,
    config,
    existingCommandNames,
    onClose,
    onCreateStepChange,
    onFormChange,
    onSubmit,
    onPickMacosApp,
    onFetchWebIcon,
    onCopyError,
    importPreview,
    importDetecting,
    onBeginImportDirectory,
    onImportToggle,
    onConfirmImport,
    demoPresetInstalled,
    demoConfirming,
    onBeginDemoImport,
    onConfirmDemoImport,
    onCleanupDemoCommands
  } = props

  const activeStep = form.mode === 'edit' ? 'manual' : form.createStep
  const aiPrompt = useAiOnboardingPrompt({ existingCommandNames, onCopyError })

  const showBackToPick =
    form.mode === 'create' &&
    (activeStep === 'manual' || activeStep === 'ai' || activeStep === 'import' || activeStep === 'demo')
  const title = form.mode === 'create' ? '添加命令' : '编辑命令'

  const pickModeOptions = [
    {
      step: 'manual' as const,
      testId: 'command-create-pick-manual',
      title: '手动添加',
      description: '古法添加 shell 命令',
      tags: ['古法爱好者'],
      onClick: () => onCreateStepChange('manual')
    },
    {
      step: 'ai' as const,
      testId: 'command-create-pick-ai',
      title: 'AI 添加',
      description: '把提示词复制到你的AI工具（cursor/codex/claude code）',
      tags: ['VibeCoding', '新手推荐'],
      onClick: () => onCreateStepChange('ai')
    },
    {
      step: 'import' as const,
      testId: 'command-create-pick-import',
      title: '导入目录',
      description: '一次性导入多个命令',
      tags: ['批量'],
      onClick: () => onBeginImportDirectory('pick'),
      disabled: importDetecting
    },
    {
      step: 'demo' as const,
      testId: 'command-create-pick-demo',
      title: '导入演示命令',
      description: '初始命令，用于了解软件的基本使用',
      tags: ['DEMO'],
      onClick: () => onBeginDemoImport('pick'),
      disabled: importDetecting
    }
  ]

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.56)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2200
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="command-form-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: modalWidthForStep(activeStep),
          maxWidth: '96vw',
          maxHeight: '90vh',
          background: 'var(--panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-hover)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          transition: 'width 0.2s ease'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {activeStep === 'pick' ? (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
                选择添加方式 — 单条、AI、批量导入或演示
              </div>
            ) : null}
            {activeStep === 'import' ? (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>导入目录识别结果</div>
            ) : null}
            {activeStep === 'demo' ? (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
                {demoPresetInstalled ? '演示命令已导入' : '导入演示命令'}
              </div>
            ) : null}
            {activeStep === 'ai' ? (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
                复制提示词，审阅差异并明确确认后由 AI 写入配置
              </div>
            ) : null}
          </div>
          <button type="button" style={buttonStyle('muted')} onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={{ overflow: 'auto', flex: 1, display: 'grid', gap: 12, alignContent: 'start' }}>
          {activeStep === 'pick' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {importDetecting ? (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 0' }}>正在识别目录中的项目…</div>
              ) : null}
              {pickModeOptions.map((option) => (
                <PickModeCard
                  key={option.step}
                  testId={option.testId}
                  title={option.title}
                  description={option.description}
                  tags={option.tags}
                  onClick={option.onClick}
                  disabled={option.disabled}
                />
              ))}
            </div>
          ) : null}

          {activeStep === 'manual' ? (
            <>
              {showBackToPick ? (
                <button
                  type="button"
                  data-testid="command-create-back-to-pick"
                  onClick={() => onCreateStepChange('pick')}
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  ← 返回选择
                </button>
              ) : null}
              <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                命令名称
                <input
                  data-testid="command-form-name"
                  value={form.draft.name}
                  onChange={(event) =>
                    onFormChange((prev) => ({ ...prev, draft: { ...prev.draft, name: event.target.value } }))
                  }
                  placeholder="例如：web"
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12
                  }}
                />
              </div>
              <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span>启动命令</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {form.draft.mode === 'terminal' ? (
                      <button
                        type="button"
                        data-testid="command-form-add-segment"
                        title="增加下一条交互命令"
                        style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 13, lineHeight: 1.2 }}
                        onClick={() =>
                          onFormChange((prev) => {
                            const segments = prev.draft.commandSegments || splitInteractiveCommands(prev.draft.command)
                            const nextSegments = [...segments, '']
                            return {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                command: joinInteractiveCommands(nextSegments),
                                commandSegments: nextSegments,
                                allowTrailingEmptySegment: true
                              }
                            }
                          })
                        }
                      >
                        +
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid="command-form-pick-macos-app"
                      style={{ ...buttonStyle('muted'), padding: '4px 8px', fontSize: 11 }}
                      onClick={() => void onPickMacosApp()}
                    >
                      从 Applications 选择 App
                    </button>
                  </div>
                </div>
                {form.draft.mode === 'terminal' ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {resolveRenderableSegments(form.draft).map((segment, index, list) => (
                      <div key={`segment-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <input
                          data-testid={index === 0 ? 'command-form-command' : `command-form-command-${index}`}
                          value={segment}
                          onChange={(event) =>
                            onFormChange((prev) => {
                              const nextSegments = [
                                ...(prev.draft.commandSegments || splitInteractiveCommands(prev.draft.command))
                              ]
                              if (index >= nextSegments.length) return prev
                              nextSegments[index] = event.target.value
                              return {
                                ...prev,
                                draft: {
                                  ...prev.draft,
                                  command: joinInteractiveCommands(nextSegments),
                                  commandSegments: nextSegments,
                                  allowTrailingEmptySegment: false
                                }
                              }
                            })
                          }
                          placeholder={index === 0 ? '例如：ssh user@host' : '例如：tail -f /path/to/log'}
                          style={{
                            padding: '8px 10px',
                            border: '1px solid var(--border-default)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 12
                          }}
                        />
                        {list.length > 1 ? (
                          <button
                            type="button"
                            data-testid={`command-form-remove-segment-${index}`}
                            title="删除该命令"
                            style={{ ...buttonStyle('muted'), padding: '0 10px', fontSize: 14, lineHeight: 1 }}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              onFormChange((prev) => {
                                const nextSegments = [
                                  ...(prev.draft.commandSegments || splitInteractiveCommands(prev.draft.command))
                                ]
                                if (index >= nextSegments.length) return prev
                                if (nextSegments.length <= 1) return prev
                                nextSegments.splice(index, 1)
                                const compacted = compactInteractiveSegments(nextSegments)
                                return {
                                  ...prev,
                                  draft: {
                                    ...prev.draft,
                                    command: joinInteractiveCommands(compacted),
                                    commandSegments: compacted,
                                    allowTrailingEmptySegment: false
                                  }
                                }
                              })
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <input
                    data-testid="command-form-command"
                    value={form.draft.command}
                    onChange={(event) =>
                      onFormChange((prev) => ({ ...prev, draft: { ...prev.draft, command: event.target.value } }))
                    }
                    placeholder="例如：npm run dev"
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12
                    }}
                  />
                )}
              </div>
              {/^\s*ssh(\s|$)/i.test(form.draft.command) && (
                <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                  SSH 密钥
                  <select
                    data-testid="command-form-ssh-key"
                    value={form.draft.sshKeyId || ''}
                    onChange={(event) =>
                      onFormChange((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, sshKeyId: event.target.value || undefined }
                      }))
                    }
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12
                    }}
                  >
                    <option value="">不绑定密钥</option>
                    {(config.settings.sshKeys || []).map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.label} ({key.id})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                标签（逗号分隔）
                <input
                  data-testid="command-form-tags"
                  value={form.draft.tags}
                  onChange={(event) =>
                    onFormChange((prev) => ({ ...prev, draft: { ...prev.draft, tags: event.target.value } }))
                  }
                  placeholder="例如：web, 前端"
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12
                  }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                  模式
                  <select
                    data-testid="command-form-mode"
                    value={form.draft.mode}
                    onChange={(event) =>
                      onFormChange((prev) => ({
                        ...prev,
                        draft: {
                          ...prev.draft,
                          mode: event.target.value === 'terminal' ? 'terminal' : 'service',
                          commandSegments:
                            event.target.value === 'terminal'
                              ? prev.draft.commandSegments || splitInteractiveCommands(prev.draft.command)
                              : undefined,
                          allowTrailingEmptySegment: false
                        }
                      }))
                    }
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12
                    }}
                  >
                    <option value="service">后台服务（service）</option>
                    <option value="terminal">交互终端（terminal）</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span>Web 地址（可选）</span>
                    <button
                      type="button"
                      data-testid="command-form-fetch-web-icon"
                      style={{ ...buttonStyle('muted'), padding: '4px 8px', fontSize: 11 }}
                      onClick={() => void onFetchWebIcon()}
                    >
                      读取网站图标
                    </button>
                  </div>
                  <input
                    data-testid="command-form-web-url"
                    value={form.draft.webUrl}
                    onChange={(event) =>
                      onFormChange((prev) => ({ ...prev, draft: { ...prev.draft, webUrl: event.target.value } }))
                    }
                    placeholder="例如：http://localhost:3000"
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12
                    }}
                  />
                </label>
              </div>
              <label
                style={{
                  display: 'grid',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  padding: '8px 10px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                  <input
                    data-testid="command-form-auto-restart"
                    type="checkbox"
                    checked={form.draft.autoRestart}
                    onChange={(event) =>
                      onFormChange((prev) => ({
                        ...prev,
                        draft: { ...prev.draft, autoRestart: event.target.checked }
                      }))
                    }
                  />
                  异常退出时自动重连
                </span>
              </label>
            </>
          ) : null}

          {activeStep === 'ai' ? (
            <>
              {showBackToPick ? (
                <button
                  type="button"
                  data-testid="command-create-back-to-pick"
                  onClick={() => onCreateStepChange('pick')}
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  ← 返回选择
                </button>
              ) : null}
              <AiOnboardingPromptPanel
                configPath={aiPrompt.configPath}
                loadingPath={aiPrompt.loadingPath}
                prompt={aiPrompt.prompt}
                skillCommandCopied={aiPrompt.skillCommandCopied}
                onCopySkillCommand={() => void aiPrompt.copySkillCommand()}
              />
            </>
          ) : null}

          {activeStep === 'import' && importPreview ? (
            <>
              {showBackToPick ? (
                <button
                  type="button"
                  data-testid="command-create-back-to-pick"
                  onClick={() => onCreateStepChange('pick')}
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  ← 返回选择
                </button>
              ) : null}
              <ImportProjectsPanel
                rootPath={importPreview.rootPath}
                projects={importPreview.projects}
                selectedKeys={importPreview.selectedKeys}
                onToggle={onImportToggle}
              />
            </>
          ) : null}

          {activeStep === 'demo' ? (
            <>
              {showBackToPick ? (
                <button
                  type="button"
                  data-testid="command-create-back-to-pick"
                  onClick={() => onCreateStepChange('pick')}
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  ← 返回选择
                </button>
              ) : null}
              <DemoCommandsPanel installed={demoPresetInstalled} />
            </>
          ) : null}
        </div>

        {activeStep === 'manual' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button type="button" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            <button type="button" data-testid="command-form-save" style={buttonStyle('primary')} onClick={() => void onSubmit()}>
              保存
            </button>
          </div>
        ) : null}

        {activeStep === 'ai' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              data-testid="ai-prompt-copy"
              style={buttonStyle('primary')}
              disabled={!aiPrompt.canCopy}
              onClick={() => void aiPrompt.copyPrompt()}
            >
              {aiPrompt.copied ? '已复制' : '复制提示词'}
            </button>
          </div>
        ) : null}

        {activeStep === 'import' && importPreview ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button type="button" data-testid="import-projects-cancel" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-testid="import-projects-confirm"
              style={buttonStyle('primary')}
              onClick={onConfirmImport}
              disabled={importPreview.confirming}
            >
              {importPreview.confirming ? '导入中...' : '确认导入'}
            </button>
          </div>
        ) : null}

        {activeStep === 'demo' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button type="button" data-testid="demo-commands-cancel" style={buttonStyle('muted')} onClick={onClose}>
              取消
            </button>
            {demoPresetInstalled ? (
              <button
                type="button"
                data-testid="demo-commands-cleanup"
                style={buttonStyle('primary')}
                onClick={onCleanupDemoCommands}
                disabled={demoConfirming}
              >
                {demoConfirming ? '清理中...' : '清理演示命令'}
              </button>
            ) : (
              <button
                type="button"
                data-testid="demo-commands-confirm"
                style={buttonStyle('primary')}
                onClick={onConfirmDemoImport}
                disabled={demoConfirming}
              >
                {demoConfirming ? '导入中...' : '确认导入'}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { splitInteractiveCommands, joinInteractiveCommands, compactInteractiveSegments, resolveRenderableSegments }
