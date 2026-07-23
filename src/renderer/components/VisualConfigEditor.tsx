import { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import { AppConfig, CommandConfig, CommandMode } from '../../shared/types'
import { buttonStyle, inputStyle } from '../lib/uiStyles'

export type VisualConfigTab = 'commands' | 'ai' | 'settings'
type VisualTab = VisualConfigTab

const TABS: { id: VisualTab; label: string }[] = [
  { id: 'commands', label: '命令' },
  { id: 'ai', label: 'AI' },
  { id: 'settings', label: '全局设置' }
]

interface VisualConfigEditorProps {
  value: string
  onChange: (value: string) => void
}

const MODES: { value: CommandMode, label: string }[] = [
  { value: 'service', label: '作为后台守护服务运行 (Service)' },
  { value: 'terminal', label: '作为交互型终端打开 (Terminal)' }
]

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

export function VisualConfigEditor({ value, onChange }: VisualConfigEditorProps) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<VisualTab>('commands')

  // Initialize config from yaml value
  useEffect(() => {
    try {
      const parsed = yaml.load(value) as AppConfig
      // Basic validation to ensure it's an object with expected arrays
      if (parsed && typeof parsed === 'object') {
        if (!Array.isArray(parsed.commands)) parsed.commands = []
        if (!Array.isArray(parsed.presets)) parsed.presets = []
        if (!parsed.settings) parsed.settings = { llm: { endpoint: '', apiKey: '', model: '' }, themePreset: 'coder', launchAtLogin: false, logBufferLines: 5000 }
        if (!parsed.settings.langsmith) parsed.settings.langsmith = { tracing: true, endpoint: '', apiKey: '', project: '' }
        else if (parsed.settings.langsmith.tracing === undefined) parsed.settings.langsmith.tracing = true
        if (!parsed.settings.themePreset) parsed.settings.themePreset = 'coder'
        if (parsed.settings.launchAtLogin !== true) parsed.settings.launchAtLogin = false
        if (!Array.isArray(parsed.settings.sshKeys)) parsed.settings.sshKeys = []
        setConfig(parsed)
        setError(null)
      }
    } catch (e) {
      setError('无法解析 YAML 配置文件，请检查格式是否正确。')
    }
  }, [value])

  // Sync config back to yaml
  const updateConfig = (newConfig: AppConfig) => {
    // Remove individual 'color' from existing commands just in case
    newConfig.commands = newConfig.commands.map(cmd => {
      const { color, ...rest } = cmd as any
      return rest as CommandConfig
    })

    setConfig(newConfig)
    try {
      const yamlStr = yaml.dump(newConfig, {
        indent: 2,
        lineWidth: -1, // Disable line wrapping
        noRefs: true
      })
      onChange(yamlStr)
    } catch (e) {
      console.error('Failed to dump yaml', e)
    }
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: 'var(--err)', textAlign: 'center' }}>
        {error}
      </div>
    )
  }

  if (!config) return null

  const handleCommandChange = (index: number, field: keyof CommandConfig, val: any) => {
    const newCommands = [...config.commands]
    const currentCmd = newCommands[index]
    const updatedCmd = { ...currentCmd, [field]: val }

    // 智能推断：如果修改的是 command，尝试自动推断 mode
    if (field === 'command' && typeof val === 'string') {
      const isTerminal = /(^|\s)(ssh|mysql|redis-cli|top|vim|htop|telnet)(\s|$)/.test(val)
      const isService = /(^|\s)(npm run|yarn|node|nodemon|pnpm|go run|python|flask)(\s|$)/.test(val)
      
      // 如果推断出明确的类型，则自动切换，减轻用户决策
      if (isTerminal) updatedCmd.mode = 'terminal'
      else if (isService) updatedCmd.mode = 'service'
    }

    newCommands[index] = updatedCmd
    updateConfig({ ...config, commands: newCommands })
  }

  const addCommand = () => {
    const newCommand: CommandConfig = {
      name: '新命令',
      command: 'echo "hello"',
      tags: [],
      mode: 'service',
      autoRestart: false
    }
    // 向前插入，保证最新添加的命令在最上方
    updateConfig({ ...config, commands: [newCommand, ...config.commands] })
  }

  const removeCommand = (index: number) => {
    const newCommands = config.commands.filter((_, i) => i !== index)
    updateConfig({ ...config, commands: newCommands })
  }

  const sshKeys = config?.settings.sshKeys || []

  const renderSshKeySelector = (cmd: CommandConfig, idx: number) => {
    const isSsh = /^\s*ssh(\s|$)/i.test(cmd.command)
    if (!isSsh) return null
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={secondaryLabelStyle}>SSH 密钥</label>
        <select
          style={compactSelectStyle}
          value={cmd.sshKeyId || ''}
          onChange={(e) => handleCommandChange(idx, 'sshKeyId', e.target.value || undefined)}
        >
          <option value="">不绑定密钥</option>
          {sshKeys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.label} ({key.id})
            </option>
          ))}
        </select>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          团队共享时命令写 <code style={{ fontSize: 11 }}>ssh user@host</code>，每人本地导入同名密钥后自动注入 <code style={{ fontSize: 11 }}>-i</code>。
        </p>
      </div>
    )
  }

  const handleSettingsChange = (path: string, val: any) => {
    const newConfig = { ...config }
    if (path === 'logBufferLines') {
      newConfig.settings.logBufferLines = Number(val)
    } else if (path === 'launchAtLogin') {
      newConfig.settings.launchAtLogin = Boolean(val)
    } else if (path.startsWith('llm.')) {
      const field = path.split('.')[1] as keyof typeof config.settings.llm
      newConfig.settings.llm = { ...newConfig.settings.llm, [field]: val }
    } else if (path.startsWith('langsmith.')) {
      const field = path.split('.')[1] as keyof NonNullable<typeof config.settings.langsmith>
      newConfig.settings.langsmith = { ...newConfig.settings.langsmith, [field]: val }
    }
    updateConfig(newConfig)
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: 0,
        display: 'grid',
        gap: 16
      }}
    >
      <div
        role="tablist"
        aria-label="配置分区"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          flexShrink: 0,
          borderBottom: '1px solid var(--border-subtle)',
          paddingTop: 2
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`visual-tab-${tab.id}`}
            style={{
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: activeTab === tab.id ? 'var(--text)' : 'var(--muted)',
              background: 'transparent',
              cursor: 'pointer',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--text)' : 'transparent'}`,
              fontFamily: 'var(--font-ui)'
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        style={{
          minHeight: 0,
          overflowY: 'auto',
          paddingBottom: 4
        }}
      >
        {activeTab === 'commands' && (
      <section style={configSectionStyle}>
        <div style={configSectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>命令</h2>
            <p style={sectionDescriptionStyle}>维护侧边栏中的快捷命令和运行方式。</p>
          </div>
          <button type="button" style={sectionActionButtonStyle} onClick={addCommand}>
            新增命令
          </button>
        </div>

        <div style={itemListStyle}>
          {config.commands.map((cmd, idx) => (
            <div key={idx} style={configCardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 0.65fr)', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={nameLabelStyle}>名称</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={indexBadgeStyle}>
                      {idx + 1}
                    </div>
                    <input
                      style={{ ...compactInputStyle, flex: 1, fontWeight: 600 }}
                      value={cmd.name}
                      onChange={e => handleCommandChange(idx, 'name', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={secondaryLabelStyle}>运行模式</label>
                  <select
                    style={compactSelectStyle}
                    value={cmd.mode || 'service'}
                    onChange={e => handleCommandChange(idx, 'mode', e.target.value)}
                  >
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              {cmd.mode === 'service' || cmd.mode === 'terminal' ? (
                <label
                  style={toggleLabelStyle}
                >
                  <input
                    data-testid={`visual-command-auto-restart-${idx}`}
                    type="checkbox"
                    checked={Boolean(cmd.autoRestart)}
                    onChange={(event) => handleCommandChange(idx, 'autoRestart', event.target.checked)}
                  />
                  异常退出时自动重连（最多 3 次）
                </label>
              ) : null}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <label style={{ ...secondaryLabelStyle, marginBottom: 0 }}>
                    {cmd.mode === 'terminal' ? '执行命令' : '执行命令'}
                  </label>
                  {cmd.mode === 'terminal' ? (
                    <button
                      type="button"
                      data-testid={`visual-command-plus-${idx}`}
                      style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 13, lineHeight: 1.2 }}
                      onClick={() => {
                        const segments = splitInteractiveCommands(cmd.command)
                        handleCommandChange(idx, 'command', joinInteractiveCommands([...segments, '']))
                      }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
                {cmd.mode === 'terminal' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {splitInteractiveCommands(cmd.command).map((segment, segmentIndex, list) => (
                      <div key={`${idx}-segment-${segmentIndex}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <input
                          data-testid={`visual-command-segment-input-${idx}-${segmentIndex}`}
                          style={compactInputStyle}
                          value={segment}
                          onChange={(event) => {
                            const nextSegments = [...list]
                            nextSegments[segmentIndex] = event.target.value
                            handleCommandChange(idx, 'command', joinInteractiveCommands(nextSegments))
                          }}
                          placeholder={segmentIndex === 0 ? '例如：ssh user@host' : '例如：tail -f /path/to/log'}
                        />
                        <button
                          type="button"
                          data-testid={`visual-command-segment-remove-${idx}-${segmentIndex}`}
                          disabled={list.length <= 1}
                          style={{ ...buttonStyle('muted'), padding: '0 10px', fontSize: 14, lineHeight: 1 }}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={() => {
                            if (list.length <= 1) return
                            const nextSegments = [...list]
                            nextSegments.splice(segmentIndex, 1)
                            handleCommandChange(idx, 'command', joinInteractiveCommands(compactInteractiveSegments(nextSegments)))
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <input
                    style={compactInputStyle}
                    value={cmd.command}
                    onChange={e => handleCommandChange(idx, 'command', e.target.value)}
                  />
                )}
              </div>
              {renderSshKeySelector(cmd, idx)}
              <div>
                <label style={secondaryLabelStyle}>
                  标签 (Tags) 
                  <span style={{color: 'var(--muted)', fontWeight: 'normal', textTransform: 'none', marginLeft: 4}}>
                    (选填)
                  </span>
                </label>
                <input
                  style={compactInputStyle}
                  value={cmd.tags?.join(', ') || ''}
                  placeholder="输入标签词用于分类和搜索（例如: 前端, 后端, util）"
                  onChange={e => handleCommandChange(idx, 'tags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} 
                />
              </div>
              <button 
                onClick={() => removeCommand(idx)}
                style={floatingDeleteButtonStyle}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </section>
        )}

        {activeTab === 'ai' && (
        <div style={configSectionStyle}>
          <div style={configSectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>AI 配置</h2>
              <p style={sectionDescriptionStyle}>用于看板、诊断和自动化生成能力。</p>
            </div>
          </div>
          <div style={settingsBodyStyle}>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>AI 模型</label>
                <p style={settingsFieldHintStyle}>模型名称，例如 gpt-4.1 或兼容服务模型 ID。</p>
              </div>
              <input
                style={compactInputStyle}
                value={config.settings.llm.model}
                onChange={e => handleSettingsChange('llm.model', e.target.value)}
              />
            </div>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>AI API Key</label>
                <p style={settingsFieldHintStyle}>本机配置中的服务访问密钥。</p>
              </div>
              <input
                type="password"
                style={compactInputStyle}
                value={config.settings.llm.apiKey}
                onChange={e => handleSettingsChange('llm.apiKey', e.target.value)}
              />
            </div>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>API 终端节点</label>
                <p style={settingsFieldHintStyle}>兼容 OpenAI 接口的 endpoint。</p>
              </div>
              <input
                style={compactInputStyle}
                value={config.settings.llm.endpoint}
                onChange={e => handleSettingsChange('llm.endpoint', e.target.value)}
              />
            </div>
            <label style={{ ...settingsToggleStyle, borderTop: '1px solid var(--border-subtle)' }}>
              <span>
                <span style={settingsFieldTitleStyle}>LANGSMITH_TRACING</span>
                <span style={settingsFieldHintStyle}>启用 LangSmith 追踪；仍需填写有效的 API Key。</span>
              </span>
              <input
                data-testid="visual-langsmith-tracing"
                type="checkbox"
                checked={config.settings.langsmith?.tracing !== false}
                onChange={(event) => handleSettingsChange('langsmith.tracing', event.target.checked)}
              />
            </label>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>LANGSMITH_ENDPOINT</label>
                <p style={settingsFieldHintStyle}>LangSmith API 终端节点。</p>
              </div>
              <input
                data-testid="visual-langsmith-endpoint"
                style={compactInputStyle}
                value={config.settings.langsmith?.endpoint || ''}
                onChange={e => handleSettingsChange('langsmith.endpoint', e.target.value)}
              />
            </div>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>LANGSMITH_API_KEY</label>
                <p style={settingsFieldHintStyle}>保存在本机配置文件中的 LangSmith 密钥。</p>
              </div>
              <input
                data-testid="visual-langsmith-api-key"
                type="password"
                style={compactInputStyle}
                value={config.settings.langsmith?.apiKey || ''}
                onChange={e => handleSettingsChange('langsmith.apiKey', e.target.value)}
              />
            </div>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>LANGSMITH_PROJECT</label>
                <p style={settingsFieldHintStyle}>Trace 写入的 LangSmith 项目名称。</p>
              </div>
              <input
                data-testid="visual-langsmith-project"
                style={compactInputStyle}
                value={config.settings.langsmith?.project || ''}
                onChange={e => handleSettingsChange('langsmith.project', e.target.value)}
              />
            </div>
          </div>
        </div>
        )}

        {activeTab === 'settings' && (
        <div style={configSectionStyle}>
          <div style={configSectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>基础设置</h2>
              <p style={sectionDescriptionStyle}>控制应用启动行为和日志保留规模。</p>
            </div>
          </div>
          <div style={settingsBodyStyle}>
            <label style={settingsToggleStyle}>
              <span>
                <span style={settingsFieldTitleStyle}>开机自动启动</span>
                <span style={settingsFieldHintStyle}>保存配置后生效；登录 macOS 时应用在后台运行，不弹出主窗口。</span>
              </span>
              <input
                data-testid="visual-settings-launch-at-login"
                type="checkbox"
                checked={Boolean(config.settings.launchAtLogin)}
                onChange={(event) => handleSettingsChange('launchAtLogin', event.target.checked)}
              />
            </label>
            <div style={settingsFieldStyle}>
              <div>
                <label style={settingsFieldTitleStyle}>日志缓冲行数</label>
                <p style={settingsFieldHintStyle}>单个任务保留的最大日志行数。</p>
              </div>
              <input
                type="number"
                style={{ ...compactInputStyle, maxWidth: 180 }}
                value={config.settings.logBufferLines}
                onChange={e => handleSettingsChange('logBufferLines', e.target.value)}
              />
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text)',
  marginBottom: 8,
  letterSpacing: 0
}

const secondaryLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--muted)'
}

const nameLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--text)',
  fontWeight: 600
}

const compactInputStyle: React.CSSProperties = {
  ...inputStyle,
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 13,
  background: 'var(--panel)',
  color: 'var(--text)'
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px'
}

const compactSelectStyle: React.CSSProperties = {
  ...selectStyle,
  borderRadius: 6,
  padding: '10px 32px 10px 12px',
  fontSize: 13,
  backgroundColor: 'var(--panel)',
  color: 'var(--text)'
}

const configSectionStyle: React.CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--panel-soft)',
  overflow: 'hidden'
}

const configSectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  borderBottom: '1px solid var(--border-subtle)'
}

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.4,
  fontWeight: 600,
  letterSpacing: 0
}

const sectionDescriptionStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--muted)',
  fontSize: 12,
  lineHeight: 1.5
}

const sectionActionButtonStyle: React.CSSProperties = {
  ...buttonStyle('muted'),
  borderRadius: 6,
  flexShrink: 0
}

const itemListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  background: 'var(--panel-soft)'
}

const configCardStyle: React.CSSProperties = {
  padding: '14px 78px 14px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--panel)',
  border: '1px solid var(--border-subtle)',
  position: 'relative'
}

const indexBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'var(--panel-soft)',
  color: 'var(--muted)',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  flexShrink: 0
}

const toggleLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  fontSize: 13,
  color: 'var(--text)'
}

const floatingDeleteButtonStyle: React.CSSProperties = {
  ...buttonStyle('danger'),
  position: 'absolute',
  top: 12,
  right: 12,
  padding: '5px 9px',
  borderRadius: 6,
  background: 'transparent'
}

const settingsBodyStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0
}

const settingsFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(260px, 1fr)',
  gap: 16,
  alignItems: 'center',
  padding: '12px 14px',
  borderTop: '1px solid var(--border-subtle)'
}

const settingsToggleStyle: React.CSSProperties = {
  ...settingsFieldStyle,
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  borderTop: 'none',
  cursor: 'pointer'
}

const settingsFieldTitleStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text)',
  lineHeight: 1.4
}

const settingsFieldHintStyle: React.CSSProperties = {
  display: 'block',
  margin: '4px 0 0',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--muted)'
}
