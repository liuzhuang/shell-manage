import { useState } from 'react'
import type { SshKeyConfig } from '../../shared/types'
import { buttonStyle, inputStyle } from '../lib/uiStyles'

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--panel)',
  marginBottom: 8
}

const pageStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 1180,
  margin: '0 auto',
  padding: '28px 32px 40px',
  boxSizing: 'border-box',
  display: 'grid',
  gap: 32
}

const pageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap'
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.2,
  fontWeight: 650,
  letterSpacing: '-0.025em'
}

const mutedTextStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--muted)'
}

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.3,
  fontWeight: 600,
  letterSpacing: '-0.01em'
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  gap: 16,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-subtle)'
}

const countStyle: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--text-dim)',
  fontVariantNumeric: 'tabular-nums'
}

const listStyle: React.CSSProperties = {
  display: 'grid',
  borderBottom: '1px solid var(--border-subtle)'
}

const keyRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  minHeight: 68,
  padding: '12px 2px'
}

const keyNameStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.4
}

const keyMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
  fontSize: 12,
  color: 'var(--muted)',
  fontFamily: 'var(--font-mono)'
}

const emptyStateStyle: React.CSSProperties = {
  margin: 0,
  padding: '32px 2px',
  fontSize: 13,
  color: 'var(--muted)',
  textAlign: 'left'
}

const addSectionStyle: React.CSSProperties = {
  padding: 24,
  borderRadius: 'var(--radius-lg)',
  background: 'var(--text)',
  color: 'var(--panel)',
  boxShadow: 'var(--shadow-card)'
}

const addSectionHeaderStyle: React.CSSProperties = {
  marginBottom: 20
}

const addMutedTextStyle: React.CSSProperties = {
  ...mutedTextStyle,
  color: 'color-mix(in srgb, var(--panel) 68%, transparent)'
}

const formBodyStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0
}

const formInputStyle: React.CSSProperties = {
  ...inputStyle,
  border: '1px solid color-mix(in srgb, var(--panel) 26%, transparent)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  fontSize: 14,
  background: 'var(--panel)'
}

const formTextareaStyle: React.CSSProperties = {
  ...formInputStyle,
  minHeight: 160,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.6,
  resize: 'vertical'
}

const formFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 16
}

export function SshKeysPage(props: {
  sshKeys: SshKeyConfig[]
  onConfigChanged: () => Promise<void>
}) {
  const { sshKeys, onConfigChanged } = props
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyContent, setNewKeyContent] = useState('')
  const [keyImportError, setKeyImportError] = useState<string | null>(null)
  const [keyImporting, setKeyImporting] = useState(false)

  const handleImportSshKey = async () => {
    setKeyImportError(null)
    setKeyImporting(true)
    try {
      await window.api.sshKeyImport({
        label: newKeyLabel.trim(),
        content: newKeyContent
      })
      setNewKeyLabel('')
      setNewKeyContent('')
      await onConfigChanged()
    } catch (error) {
      setKeyImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setKeyImporting(false)
    }
  }

  const handleDeleteSshKey = async (id: string) => {
    setKeyImportError(null)
    try {
      await window.api.sshKeyDelete(id)
      await onConfigChanged()
    } catch (error) {
      setKeyImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div data-testid="ssh-keys-page" style={{ height: '100%', overflow: 'auto' }}>
      <main style={pageStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <h1 style={pageTitleStyle}>SSH 密钥</h1>
            <p style={mutedTextStyle}>管理本机私钥映射，配置文件只保存密钥 ID。</p>
          </div>
        </header>

        <section>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>密钥列表</h2>
              <p style={mutedTextStyle}>已导入的密钥会用于命令和协作模板中的 SSH 密钥引用。</p>
            </div>
            <span style={countStyle}>{sshKeys.length} 个密钥</span>
          </div>
          <div style={listStyle}>
            {sshKeys.length === 0 ? (
              <p style={emptyStateStyle}>尚未导入任何 SSH 密钥</p>
            ) : (
              sshKeys.map((key, index) => (
                <div
                  key={key.id}
                  style={{
                    ...keyRowStyle,
                    borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)'
                  }}
                  data-testid={`ssh-key-row-${key.id}`}
                >
                  <div>
                    <div style={keyNameStyle}>{key.label}</div>
                    <div style={keyMetaStyle}>
                      <span>ID: {key.id}</span>
                      {key.createdAt && <span>{new Date(key.createdAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{ ...buttonStyle('danger'), padding: '6px 10px', background: 'transparent', flexShrink: 0 }}
                    onClick={() => void handleDeleteSshKey(key.id)}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={addSectionStyle}>
          <div style={addSectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>新增密钥</h2>
            <p style={addMutedTextStyle}>粘贴私钥文本保存到本机，团队共享命令时无需统一密钥路径。</p>
          </div>
          <div style={formBodyStyle}>
            <div style={fieldStyle}>
              <label htmlFor="ssh-key-label" style={labelStyle}>
                密钥名称
              </label>
              <input
                id="ssh-key-label"
                style={formInputStyle}
                placeholder="例如：生产环境 root"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                data-testid="ssh-key-label-input"
              />
            </div>
            <div style={fieldStyle}>
              <label htmlFor="ssh-key-content" style={labelStyle}>
                私钥内容（粘贴 PEM 文本）
              </label>
              <textarea
                id="ssh-key-content"
                style={formTextareaStyle}
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                value={newKeyContent}
                onChange={(e) => setNewKeyContent(e.target.value)}
                data-testid="ssh-key-content-input"
              />
            </div>
            {keyImportError && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--err)' }}>{keyImportError}</p>
            )}
          </div>
          <div style={formFooterStyle}>
            <button
              type="button"
              style={{ ...buttonStyle('muted'), border: '1px solid var(--panel)', background: 'var(--panel)', color: 'var(--text)', opacity: keyImporting ? 0.7 : 1 }}
              disabled={keyImporting || !newKeyLabel.trim() || !newKeyContent.trim()}
              onClick={() => void handleImportSshKey()}
              data-testid="ssh-key-import-button"
            >
              {keyImporting ? '保存中…' : '保存密钥到本机'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
