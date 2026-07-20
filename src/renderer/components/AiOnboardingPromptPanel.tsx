import { useEffect, useState } from 'react'
import {
  AI_ONBOARDING_STEPS,
  ASSISTANT_SKILL_INSTALL_COMMAND,
  buildAiOnboardingPrompt
} from '../lib/ai-onboarding-prompt'

export function useAiOnboardingPrompt(params: {
  existingCommandNames: string[]
  onCopyError: (message: string) => void
}) {
  const { existingCommandNames, onCopyError } = params
  const [configPath, setConfigPath] = useState<string>('')
  const [loadingPath, setLoadingPath] = useState(true)
  const [copied, setCopied] = useState(false)
  const [skillCommandCopied, setSkillCommandCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingPath(true)
    void window.api
      .configGetPath()
      .then((path) => {
        if (!cancelled) setConfigPath(path)
      })
      .catch((error) => {
        if (!cancelled) onCopyError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingPath(false)
      })
    return () => {
      cancelled = true
    }
  }, [onCopyError])

  const prompt =
    configPath.length > 0 ? buildAiOnboardingPrompt({ configPath, existingCommandNames }) : ''

  const copyPrompt = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      onCopyError(error instanceof Error ? error.message : String(error))
    }
  }

  const copySkillCommand = async () => {
    try {
      await navigator.clipboard.writeText(ASSISTANT_SKILL_INSTALL_COMMAND)
      setSkillCommandCopied(true)
      window.setTimeout(() => setSkillCommandCopied(false), 2000)
    } catch (error) {
      onCopyError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    configPath,
    loadingPath,
    prompt,
    copied,
    skillCommandCopied,
    canCopy: Boolean(prompt) && !loadingPath,
    copyPrompt,
    copySkillCommand
  }
}

export function AiOnboardingPromptPanel(props: {
  configPath: string
  loadingPath: boolean
  prompt: string
  skillCommandCopied: boolean
  onCopySkillCommand: () => void
}) {
  const { configPath, loadingPath, prompt, skillCommandCopied, onCopySkillCommand } = props

  return (
    <>
      <section
        data-testid="assistant-skill-card"
        style={{
          display: 'grid',
          gap: 10,
          padding: 12,
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'color-mix(in srgb, var(--panel-soft) 70%, transparent)'
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Assistant Skill</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
            安装后，AI 可以直接调用 ShellManage 的命令接入规则。
          </div>
        </div>
        <code
          data-testid="assistant-skill-install-command"
          style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text)', wordBreak: 'break-all' }}
        >
          {ASSISTANT_SKILL_INSTALL_COMMAND}
        </code>
        <button
          type="button"
          data-testid="assistant-skill-copy"
          onClick={onCopySkillCommand}
          style={{
            justifySelf: 'start',
            minHeight: 30,
            padding: '6px 10px',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--panel)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12
          }}
        >
          {skillCommandCopied ? '已复制，请在终端运行' : '复制 Assistant Skill 安装命令'}
        </button>
      </section>

      <ol style={{ margin: '0 0 12px 18px', padding: 0, display: 'grid', gap: 6 }}>
        {AI_ONBOARDING_STEPS.map((step, index) => (
          <li key={step} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 600, marginRight: 6 }}>{index + 1}.</span>
            {step}
          </li>
        ))}
      </ol>

      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
        配置文件路径：
        <code
          data-testid="ai-prompt-config-path"
          style={{ marginLeft: 6, fontSize: 12, color: 'var(--text)' }}
        >
          {loadingPath ? '加载中…' : configPath || '未知'}
        </code>
      </div>

      <pre
        data-testid="ai-prompt-preview"
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--panel-soft) 70%, transparent)',
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 'min(360px, 42vh)',
          overflow: 'auto',
          color: 'var(--text-dim)'
        }}
      >
        {loadingPath ? '正在加载提示词…' : prompt || '无法生成提示词，请稍后重试。'}
      </pre>
    </>
  )
}
