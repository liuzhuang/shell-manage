import { useEffect, useMemo, useState } from 'react'
import type { AnalyticsViewerSnapshot } from '../../shared/types'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'

export function AnalyticsPage({
  onBack,
  onTrack
}: {
  onBack: () => void
  onTrack: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
}) {
  const [snapshot, setSnapshot] = useState<AnalyticsViewerSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [aggregating, setAggregating] = useState(false)
  const [error, setError] = useState('')
  const [lastOutputPath, setLastOutputPath] = useState('')

  const recentEvents = useMemo(() => snapshot?.recentEvents || [], [snapshot])

  const loadSnapshot = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.analyticsGetViewerSnapshot(200)
      setSnapshot(result.snapshot)
      onTrack('analytics.viewer.open', 'load', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      onTrack('analytics.viewer.open', 'load', 'fail')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSnapshot()
  }, [])

  return (
    <div data-testid="analytics-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>隐藏入口 · 输入 mmm 打开</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>埋点数据查看</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={buttonStyle('muted')}
              onClick={() => {
                onTrack('analytics.viewer.refresh', 'click', 'success')
                void loadSnapshot()
              }}
              disabled={loading}
            >
              {loading ? '刷新中...' : '刷新数据'}
            </button>
            <button
              type="button"
              style={buttonStyle('warn')}
              disabled={aggregating}
              onClick={async () => {
                setAggregating(true)
                setError('')
                try {
                  const result = await window.api.analyticsAggregate3d()
                  setLastOutputPath(result.outputPath)
                  onTrack('analytics.viewer.aggregate3d', 'click', 'success')
                  await loadSnapshot()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                  onTrack('analytics.viewer.aggregate3d', 'click', 'fail')
                } finally {
                  setAggregating(false)
                }
              }}
            >
              {aggregating ? '生成中...' : '生成3天汇总'}
            </button>
            <button type="button" style={buttonStyle('outline')} onClick={onBack}>
              返回首页
            </button>
          </div>
        </div>
      </Panel>

      {error ? (
        <Panel soft>
          <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>
        </Panel>
      ) : null}

      <Panel soft>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <Metric title="事件文件数" value={String(snapshot?.eventFileCount || 0)} />
          <Metric title="汇总文件数" value={String(snapshot?.summaryFileCount || 0)} />
          <Metric title="最近事件数" value={String(recentEvents.length)} />
          <Metric title="最近汇总窗口事件" value={String(snapshot?.latestSummary?.overview.totalEvents || 0)} />
        </div>
        {lastOutputPath ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>最近生成文件：{lastOutputPath}</div>
        ) : null}
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0, flex: 1 }}>
        <Panel soft style={{ minHeight: 0, overflow: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>最近 3 天汇总摘要</div>
          {snapshot?.latestSummary ? (
            <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(snapshot.latestSummary, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>暂无 summary，请先点击“生成3天汇总”。</div>
          )}
        </Panel>
        <Panel soft style={{ minHeight: 0, overflow: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>最近事件（最多 200 条）</div>
          {recentEvents.length > 0 ? (
            <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(recentEvents, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>暂无事件。</div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
