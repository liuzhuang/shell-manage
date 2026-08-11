import { useEffect, useRef } from 'react'
import type {
  CommandConfig,
  CommandPublicAccessProvider,
  CommandPublicAccessStatusPayload
} from '../../shared/types'
import { buildPublicAccessSetupPrompt } from '../lib/ai-onboarding-prompt'
import { buttonStyle } from '../lib/uiStyles'
import type { ContextMenuAnchor } from './ContextMenu'

type ToastTone = 'success' | 'warn' | 'error' | 'info'
type TunnelProvider = Exclude<CommandPublicAccessProvider, 'vercel'>

const PROVIDERS: Array<{
  provider: CommandPublicAccessProvider
  title: string
  detail: string
}> = [
  { provider: 'vercel', title: 'Vercel（云端长期发布）', detail: '发布后电脑关机仍可访问' },
  { provider: 'cloudflare', title: 'Cloudflare（海外临时链接）', detail: '依赖本机；中国大陆可能无法访问' },
  { provider: 'cpolar', title: 'cpolar（国内临时链接）', detail: '依赖本机；适合国内访问' }
]

export function CommandPublicAccessMenu({
  command,
  commandRunning,
  statuses,
  openRequest,
  onClose,
  onNotify,
  onTrackAction
}: {
  command: CommandConfig
  commandRunning: boolean
  statuses: Partial<Record<CommandPublicAccessProvider, CommandPublicAccessStatusPayload>>
  openRequest: ContextMenuAnchor | null
  onClose: () => void
  onNotify: (text: string, tone?: ToastTone) => void
  onTrackAction: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef(false)
  const canStartTunnel = (command.mode || 'service') === 'service' && commandRunning

  useEffect(() => {
    if (!openRequest) return
    const rememberEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restoreFocusRef.current = true
    }
    document.addEventListener('keydown', rememberEscape)
    return () => document.removeEventListener('keydown', rememberEscape)
  }, [openRequest])

  const placePopover = () => {
    const popover = popoverRef.current
    if (!openRequest || !popover) return
    const margin = 12
    const gap = 6
    const width = popover.offsetWidth
    const height = popover.offsetHeight
    const fitsRight = openRequest.right + gap + width <= window.innerWidth - margin
    const left = fitsRight
      ? openRequest.right + gap
      : Math.max(margin, openRequest.left - width - gap)
    const top = Math.max(margin, Math.min(openRequest.top, window.innerHeight - height - margin))
    popover.style.left = `${left}px`
    popover.style.top = `${Math.max(margin, top)}px`
  }

  useEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    if (!openRequest) {
      if (popover.matches(':popover-open')) popover.hidePopover()
      return
    }
    if (!popover.matches(':popover-open')) popover.showPopover()
    window.requestAnimationFrame(() => {
      placePopover()
      popover.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    })
  }, [openRequest])

  const copyPrompt = async (provider: CommandPublicAccessProvider) => {
    try {
      const configPath = await window.api.configGetPath()
      const prompt = buildPublicAccessSetupPrompt({
        configPath,
        commandName: command.name,
        command: command.command,
        webUrl: command.webUrl,
        provider
      })
      await navigator.clipboard.writeText(prompt)
      onTrackAction(`home.command.publish.${provider}`, 'copy_prompt', 'success')
      onNotify(`${providerLabel(provider)}配置提示词已复制`, 'success')
    } catch (error) {
      onTrackAction(`home.command.publish.${provider}`, 'copy_prompt', 'fail')
      onNotify(`复制失败：${errorMessage(error)}`, 'error')
    }
  }

  const copyUrl = async (provider: CommandPublicAccessProvider, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      onTrackAction(`home.command.publish.${provider}`, 'copy_link', 'success')
      onNotify(`${providerLabel(provider)}链接已复制`, 'success')
    } catch (error) {
      onTrackAction(`home.command.publish.${provider}`, 'copy_link', 'fail')
      onNotify(`复制失败：${errorMessage(error)}`, 'error')
    }
  }

  const start = async (provider: CommandPublicAccessProvider) => {
    if (
      provider === 'vercel' &&
      !window.confirm('确认发布到 Vercel 生产环境吗？发布后电脑关闭仍可访问，停止本地命令不会撤回云端版本。')
    ) return
    try {
      const result = await window.api.commandPublicAccessStart(command.name, provider)
      if (result.url) {
        try {
          await navigator.clipboard.writeText(result.url)
        } catch {
          onNotify('操作已成功，但链接自动复制失败', 'warn')
          return
        }
      }
      onTrackAction(`home.command.publish.${provider}`, provider === 'vercel' ? 'deploy' : 'start', 'success')
      onNotify(
        provider === 'vercel'
          ? 'Vercel 生产版本已发布，链接已复制'
          : `${providerLabel(provider)}临时链接已启动并复制`,
        'success'
      )
    } catch (error) {
      onTrackAction(`home.command.publish.${provider}`, provider === 'vercel' ? 'deploy' : 'start', 'fail')
      onNotify(errorMessage(error), 'error')
    }
  }

  const stop = async (provider: TunnelProvider) => {
    try {
      await window.api.commandPublicAccessStop(command.name, provider)
      onTrackAction(`home.command.publish.${provider}`, 'stop', 'success')
      onNotify(`${providerLabel(provider)}临时链接已停止`, 'success')
    } catch (error) {
      onTrackAction(`home.command.publish.${provider}`, 'stop', 'fail')
      onNotify(errorMessage(error), 'error')
    }
  }

  return (
      <div
        ref={popoverRef}
        popover="auto"
        role="dialog"
        aria-label={`${command.name} 发布方式`}
        data-testid={`command-publish-menu-${command.name}`}
        className="ui-popover"
        onClick={(event) => event.stopPropagation()}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.matches(':popover-open')
          if (!nextOpen && restoreFocusRef.current) {
            restoreFocusRef.current = false
            window.requestAnimationFrame(() => {
              const publishItem = document.querySelector<HTMLButtonElement>('[data-testid="command-context-item-publish"]')
              const moreButton = document.querySelector<HTMLButtonElement>(`[data-testid="command-more-${CSS.escape(command.name)}"]`)
              ;(publishItem || moreButton)?.focus()
            })
          }
          if (!nextOpen) onClose()
        }}
        style={{
          position: 'fixed',
          inset: 'auto',
          top: 12,
          left: 12,
          margin: 0,
          width: 'min(420px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 24px)',
          overflow: 'auto',
          padding: 6,
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          background: 'color-mix(in srgb, var(--panel) 97%, transparent)',
          color: 'var(--text)',
          boxShadow: 'var(--shadow-hover)'
        }}
      >
        {PROVIDERS.map(({ provider, title, detail }, index) => {
          const status = statuses[provider]
          const busy = status?.phase === 'starting' || status?.phase === 'stopping'
          const tunnelRunning = provider !== 'vercel' && status?.phase === 'running'
          const statusText = provider !== 'vercel' && !canStartTunnel && !tunnelRunning
            ? '请先启动本地服务'
            : status?.message || detail
          return (
            <div
              key={provider}
              data-testid={`public-access-row-${provider}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 12,
                minHeight: 58,
                padding: '7px 8px',
                borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650 }}>{title}</div>
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    marginTop: 3,
                    color: status?.phase === 'error' ? 'var(--err)' : 'var(--text-dim)',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {statusText}
                </div>
                {status?.url ? (
                  <button
                    type="button"
                    data-testid={`public-access-copy-url-${provider}`}
                    aria-label={`复制 ${providerLabel(provider)} 公网链接：${status.url}`}
                    title={`点击复制：${status.url}`}
                    onClick={() => void copyUrl(provider, status.url!)}
                    style={{
                      display: 'block',
                      marginTop: 3,
                      maxWidth: 300,
                      padding: 0,
                      border: 0,
                      background: 'transparent',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text)',
                      textAlign: 'left'
                    }}
                  >
                    <code style={{ fontSize: 10 }}>{status.url}</code>
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  data-testid={`public-access-copy-prompt-${provider}`}
                  aria-label={`复制 ${providerLabel(provider)} 配置提示词`}
                  style={smallButtonStyle}
                  onClick={() => void copyPrompt(provider)}
                >
                  复制提示词
                </button>
                {provider === 'vercel' ? (
                  <button
                    type="button"
                    data-testid="public-access-start-vercel"
                    aria-label={busy ? 'Vercel 正在发布' : status?.phase === 'succeeded' ? '重新发布到 Vercel' : '发布到 Vercel'}
                    disabled={busy}
                    style={{ ...smallButtonStyle, opacity: busy ? 0.6 : 1 }}
                    onClick={() => void start('vercel')}
                  >
                    {busy ? '发布中…' : status?.phase === 'succeeded' ? '重新发布' : '发布'}
                  </button>
                ) : tunnelRunning ? (
                  <button
                    type="button"
                    data-testid={`public-access-stop-${provider}`}
                    aria-label={`停止 ${providerLabel(provider)} 临时链接`}
                    style={{ ...smallButtonStyle, color: 'var(--err)' }}
                    onClick={() => void stop(provider)}
                  >
                    停止
                  </button>
                ) : busy ? (
                  <button
                    type="button"
                    aria-label={`${providerLabel(provider)} ${status?.phase === 'stopping' ? '正在停止' : '正在启动'}`}
                    disabled
                    style={{ ...smallButtonStyle, opacity: 0.6 }}
                  >
                    {status?.phase === 'stopping' ? '停止中…' : '启动中…'}
                  </button>
                ) : canStartTunnel ? (
                  <button
                    type="button"
                    data-testid={`public-access-start-${provider}`}
                    aria-label={`启动 ${providerLabel(provider)} 临时链接`}
                    style={smallButtonStyle}
                    onClick={() => void start(provider)}
                  >
                    启动
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
  )
}

function providerLabel(provider: CommandPublicAccessProvider): string {
  if (provider === 'vercel') return 'Vercel'
  return provider === 'cloudflare' ? 'Cloudflare' : 'cpolar'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle('muted'),
  padding: '4px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-xs)',
  background: 'var(--panel-soft)',
  color: 'var(--text)',
  boxShadow: 'none',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap'
}
