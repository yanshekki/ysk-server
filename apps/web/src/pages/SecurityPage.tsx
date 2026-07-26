/**
 * Security allowlist + host probe.
 */
import { useTranslation } from 'react-i18next';
import { useSecurity } from '../features/security';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  SummaryStrip,
} from '../shared/components/ui';

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();

  const allowed = tools.filter((tool) => tool.allowed).length;
  const needsApproval = tools.filter((tool) => tool.requiresApproval).length;

  const probeItems = (() => {
    if (!result) return [];
    try {
      const o = JSON.parse(result) as Record<string, unknown>;
      return Object.entries(o)
        .filter(([, v]) => v == null || typeof v !== 'object')
        .slice(0, 16)
        .map(([k, v]) => ({ label: k, value: String(v) }));
    } catch {
      return [{ label: 'Output', value: result.slice(0, 500) }];
    }
  })();

  return (
    <FeaturePageLayout
      title={t('security.title')}
      subtitle={t('security.allowlist')}
      showCapability={false}
      actions={
        <Button variant="primary" size="md" loading={busy} onClick={() => void runSysInfo()}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Alert variant="info">{t('security.llmUntrusted')}</Alert>

      <SummaryStrip
        items={[
          { label: '工具', value: tools.length },
          { label: '允許', value: allowed, tone: 'ok' },
          { label: '需批准', value: needsApproval, tone: 'warn' },
          {
            label: '待批',
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'default',
          },
        ]}
      />

      <div className="stack">
        <Card>
          <CardSection title="主機探測" description="讀取主機資訊（allowlist 工具）">
            {probeItems.length > 0 ? (
              <DescriptionList columns={2} items={probeItems} />
            ) : (
              <p className="muted">尚未執行 — 按右上角「{t('security.runSysInfo')}」</p>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('security.pending')}>
            {approvals.length === 0 ? (
              <EmptyState title={t('security.none')} />
            ) : (
              <div className="list-panel">
                {approvals.map((a) => (
                  <div key={String(a.id)} className="list-row list-row--static">
                    <div className="list-row__main">
                      <div className="list-row__title">
                        <code className="inline">{String(a.action)}</code>
                        <Badge tone="warn">{String(a.risk)}</Badge>
                      </div>
                      <div className="list-row__meta">
                        <span>{String(a.requestedBy ?? a.requested_by ?? '—')}</span>
                      </div>
                    </div>
                    <div className="list-row__side">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => void approve(String(a.id))}
                      >
                        批准
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection title={`Allowlist (${tools.length})`}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Allowed</th>
                    <th>Risk</th>
                    <th>Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={String(tool.tool)}>
                      <td>
                        <code className="inline">{String(tool.tool)}</code>
                      </td>
                      <td>
                        <Badge tone={tool.allowed ? 'ok' : 'danger'}>
                          {String(tool.allowed)}
                        </Badge>
                      </td>
                      <td>{String(tool.risk)}</td>
                      <td>{String(tool.requiresApproval)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardSection>
        </Card>
      </div>
    </FeaturePageLayout>
  );
}
