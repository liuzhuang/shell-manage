import { buttonStyle } from '../../lib/uiStyles'
import type { CommandReviewItem } from '../../../shared/types'
import type { DashboardWidgetSpec } from '../../lib/dashboard-types'

interface DashboardAuditPanelProps {
  selectedWidget: DashboardWidgetSpec | null
  commandReviewMap: Record<string, CommandReviewItem>
  approvedTokenMap: Record<string, { tokenAuth: string; expiresAt: number }>
  approvingStepId?: string
  onApprove: (widgetId: string, stepId: string, command: string) => void
}

const riskStyle: Record<string, { color: string; bg: string; border: string }> = {
  safe: { color: 'var(--ok)', bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(34, 197, 94, 0.35)' },
  review: { color: 'var(--warn)', bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.35)' },
  blocked: { color: 'var(--err)', bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.35)' }
}

export function DashboardAuditPanel(props: DashboardAuditPanelProps) {
  const { selectedWidget, commandReviewMap, approvedTokenMap, approvingStepId, onApprove } = props
  const steps = selectedWidget?.probe.steps || []
  const risk = steps.reduce<'safe' | 'review' | 'blocked'>((highest, step) => {
    const rank = { safe: 0, review: 1, blocked: 2 }
    const reportedRisk = selectedWidget ? commandReviewMap[`${selectedWidget.id}:${step.stepId}`]?.riskLevel : undefined
    const effectiveRisk = reportedRisk || step.riskLevel
    return rank[effectiveRisk] > rank[highest] ? effectiveRisk : highest
  }, 'safe')
  const riskToken = riskStyle[risk] || riskStyle.safe

  return (
    <aside
      data-testid="dashboard-audit-panel"
      style={{
        width: 360,
        minWidth: 360,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div style={{ borderBottom: '1px solid var(--border-subtle)', padding: '14px 16px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        指令审计与详情
      </div>
      {!selectedWidget ? (
        <div data-testid="dashboard-audit-empty" style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>点击中间任意卡片可查看其命令、风险和解析规则。</div>
      ) : (
        <div data-testid="dashboard-audit-content" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{selectedWidget.title}</div>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>风险审计状态</div>
            <div
              data-testid="dashboard-audit-risk-badge"
              style={{
                display: 'inline-flex',
                width: 'fit-content',
                padding: '4px 9px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: riskToken.color,
                background: riskToken.bg,
                border: `1px solid ${riskToken.border}`,
                textTransform: 'uppercase'
              }}
            >
              {risk}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              共 {steps.length} 个探针步骤；每一步独立校验与授权。
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>底层取数指令</div>
            <div
              data-testid="dashboard-audit-command"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: 12,
                lineHeight: 1.6,
                wordBreak: 'break-word'
              }}
            >
              {steps.length === 0 ? '暂无命令' : steps.map((step, index) => {
                const reviewKey = `${selectedWidget.id}:${step.stepId}`
                const reviewItem = commandReviewMap[reviewKey]
                const hasApproval = Boolean(approvedTokenMap[reviewKey])
                const effectiveRisk = reviewItem?.riskLevel || step.riskLevel
                const stepRiskToken = riskStyle[effectiveRisk] || riskStyle.safe
                return (
                  <div
                    key={step.stepId}
                    data-testid={`dashboard-audit-step-${step.stepId}`}
                    style={{ paddingTop: index === 0 ? 0 : 12, marginTop: index === 0 ? 0 : 12, borderTop: index === 0 ? undefined : '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: 'var(--text)', fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{step.stepId}</span>
                      <span style={{ color: stepRiskToken.color, fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{effectiveRisk}</span>
                    </div>
                    <div>{step.command}</div>
                    {step.dependsOn?.length ? (
                      <div style={{ marginTop: 5, color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: 11 }}>
                        依赖：{step.dependsOn.join(', ')}
                      </div>
                    ) : null}
                    {reviewItem?.riskReason ? (
                      <div style={{ marginTop: 5, color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: 11 }}>
                        {reviewItem.riskReason}
                      </div>
                    ) : null}
                    {effectiveRisk === 'review' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <button
                          data-testid="dashboard-audit-approve"
                          data-step-id={step.stepId}
                          type="button"
                          disabled={Boolean(approvingStepId) || hasApproval}
                          onClick={() => onApprove(selectedWidget.id, step.stepId, step.command)}
                          style={buttonStyle('warn')}
                        >
                          {hasApproval ? '已授权' : approvingStepId === step.stepId ? '授权中...' : '允许授权执行'}
                        </button>
                        {hasApproval ? <span style={{ fontSize: 11, color: 'var(--ok)', fontFamily: 'var(--font-ui)' }}>有效期内已放通</span> : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>解析规则</div>
            <div style={{ fontSize: 12, color: 'var(--text)' }}>
              {selectedWidget.parserRule.type}
              {selectedWidget.parserRule.pattern ? ` / ${selectedWidget.parserRule.pattern}` : ''}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>说明与逻辑</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>{selectedWidget.description || '暂无说明'}</div>
          </section>

        </div>
      )}
    </aside>
  )
}
