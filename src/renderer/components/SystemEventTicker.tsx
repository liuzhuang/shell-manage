import { useEffect, useMemo, useState } from 'react'

interface SystemEventTickerProps {
  events: string[]
  /** 窄侧栏：显示图标按钮 */
  compact?: boolean
}

type EventLevel = 'success' | 'error' | 'info'
type EventFilter = 'all' | 'success' | 'error'

interface EventItem {
  id: string
  text: string
  level: EventLevel
}

function getEventLevel(text: string): EventLevel {
  const value = text.toLowerCase()
  if (value.includes('失败') || value.includes('异常') || value.includes('退出码') || value.includes('error')) {
    return 'error'
  }
  if (value.includes('成功') || value.includes('完成') || value.includes('已停止')) {
    return 'success'
  }
  return 'info'
}

export function SystemEventTicker({ events, compact }: SystemEventTickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<EventFilter>('all')
  const [query, setQuery] = useState('')
  const latestEvent = events[events.length - 1] || '暂无执行记录'
  const eventItems = useMemo<EventItem[]>(
    () =>
      [...events]
        .reverse()
        .map((text, index) => ({ id: `${events.length - index}-${text}`, text, level: getEventLevel(text) })),
    [events]
  )
  const filteredItems = useMemo(
    () =>
      eventItems.filter((item) => {
        const hitFilter = filter === 'all' || item.level === filter
        const hitQuery = !query.trim() || item.text.toLowerCase().includes(query.trim().toLowerCase())
        return hitFilter && hitQuery
      }),
    [eventItems, filter, query]
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      {compact ? (
        <button
          type="button"
          data-testid="sidebar-system-ticker"
          aria-label="查看执行记录"
          title={latestEvent}
          onClick={() => setOpen(true)}
          style={{
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--panel-soft)',
            color: 'var(--muted)',
            padding: '7px 0',
            cursor: 'pointer'
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          data-testid="sidebar-system-ticker"
          aria-label="查看执行记录"
          title={latestEvent}
          onClick={() => setOpen(true)}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--panel-soft)',
            color: 'var(--text)',
            padding: '8px 10px',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, letterSpacing: '0.05em' }}>最近执行</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: latestEvent === '暂无执行记录' ? 'var(--muted)' : 'var(--accent)',
                flexShrink: 0
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {latestEvent}
            </span>
          </div>
        </button>
      )}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="执行记录"
          data-testid="sidebar-history-modal"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 1200
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(720px, 100%)',
              maxHeight: 'min(72vh, 680px)',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              background: 'var(--panel)',
              boxShadow: 'var(--shadow-soft)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 10px' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>执行记录</span>
              <span
                data-testid="sidebar-history-count"
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 999,
                  padding: '1px 8px'
                }}
              >
                {filteredItems.length}
              </span>
              <button
                type="button"
                data-testid="sidebar-history-close"
                onClick={() => setOpen(false)}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 22,
                  lineHeight: 1
                }}
                aria-label="关闭执行记录"
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 16px 12px' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'success', 'error'] as EventFilter[]).map((value) => {
                  const labels: Record<EventFilter, string> = {
                    all: '全部',
                    success: '成功',
                    error: '失败'
                  }
                  const active = filter === value
                  return (
                    <button
                      key={value}
                      type="button"
                      data-testid={`sidebar-history-tab-${value}`}
                      onClick={() => setFilter(value)}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        background: active ? 'var(--panel-soft)' : 'transparent',
                        color: active ? 'var(--text)' : 'var(--muted)',
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      {labels[value]}
                    </button>
                  )
                })}
              </div>
              <input
                data-testid="sidebar-history-search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索命令…"
                style={{
                  marginLeft: 'auto',
                  width: 'min(320px, 100%)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  padding: '6px 10px',
                  fontSize: 12
                }}
              />
            </div>
            <div
              data-testid="sidebar-history-list"
              style={{
                overflow: 'auto',
                borderTop: '1px solid var(--border-subtle)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              {filteredItems.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 6px' }}>暂无匹配记录</div>
              ) : (
                filteredItems.map((item) => {
                  const dotColor =
                    item.level === 'error' ? 'var(--danger, #db3b3b)' : item.level === 'success' ? 'var(--accent)' : 'var(--muted)'
                  return (
                    <div
                      key={item.id}
                      data-testid="sidebar-history-item"
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                        fontSize: 12,
                        color: 'var(--text)',
                        background: 'var(--panel-soft)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        padding: '8px 10px'
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: dotColor,
                          marginTop: 5,
                          flexShrink: 0
                        }}
                      />
                      <span style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>{item.text}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
