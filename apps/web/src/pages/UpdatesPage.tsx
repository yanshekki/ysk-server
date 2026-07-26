/**
 * Updates inventory + self-update.
 */
import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  KpiCard,
  KpiGrid,
  LoadingBlock,
  SummaryStrip,
} from '../shared/components/ui';
import { humanizeOperatorNote } from '../shared/lib/operator-messages';

function riskTone(risk?: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warn';
  return 'info';
}

const SELF_LABELS: Record<string, string> = {
  currentVersion: '目前版本',
  latestVersion: '最新版本',
  updateAvailable: '有可用更新',
  channel: '通道',
  packageName: '套件',
  ok: '狀態',
  applied: '已套用',
};

export function UpdatesPage() {
  const { t } = useTranslation();
  const {
    inventory,
    selfUpdate,
    lastAt,
    jobs,
    error,
    busy,
    msg,
    setMsg,
    load,
    applySelf,
    applyPackage,
  } = useUpdates();

  const highRisk = inventory.filter(
    (i) => i.risk === 'critical' || i.risk === 'high',
  ).length;

  return (
    <FeaturePageLayout
      title={t('updates.title')}
      subtitle={t('updates.body')}
      actions={
        <div className="btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={() => void load(false)}>
            重新載入
          </Button>
          <Button variant="primary" size="md" loading={busy} onClick={() => void load(true, false)}>
            掃描套件
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void load(true, true)}
            title="對前 12 個套件查 OSV（需外網）"
          >
            掃描 + OSV
          </Button>
        </div>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <SummaryStrip
        items={[
          { label: '套件', value: inventory.length },
          {
            label: '高風險',
            value: highRisk,
            tone: highRisk > 0 ? 'danger' : 'ok',
          },
          { label: '排程', value: jobs.length },
        ]}
      />

      <KpiGrid cols={2}>
        <KpiCard
          label="自身更新"
          hint="管理面板"
          footer={
            <Button variant="primary" size="sm" loading={busy} onClick={() => void applySelf()}>
              套用更新
            </Button>
          }
        >
          {selfUpdate ? (
            <>
              <p className="dash-kpi__meta">由管理面板檢查並套用</p>
              <DescriptionList
                columns={2}
                items={Object.entries(selfUpdate as Record<string, unknown>)
                  .filter(([, v]) => v == null || typeof v !== 'object')
                  .filter(([k]) => !/YSK_EXECUTE|command|shasum|registryUrl/i.test(k))
                  .slice(0, 8)
                  .map(([k, v]) => ({
                    label: SELF_LABELS[k] ?? k,
                    value: Array.isArray(v) ? v.join(', ') : String(v),
                  }))}
              />
            </>
          ) : (
            <LoadingBlock label="載入中…" />
          )}
        </KpiCard>
        <KpiCard
          label="排程"
          hint={jobs.length > 0 ? `${jobs.length} 項` : '無'}
          footer={
            lastAt ? (
              <span className="dash-kpi__hint">清點：{lastAt}</span>
            ) : (
              <span className="dash-kpi__hint">—</span>
            )
          }
        >
          {jobs.length === 0 ? (
            <div className="dash-kpi__empty">
              <p className="dash-kpi__meta">尚無排程（或未啟用）</p>
            </div>
          ) : (
            <ul className="dash-kpi__list">
              {jobs.map((j) => (
                <li key={String(j.id)}>
                  <span className="dash-kpi__list-name">{String(j.id)}</span>
                  <span className="dash-kpi__hint">
                    {String(j.intervalMs)}ms
                  </span>
                </li>
              ))}
            </ul>
          )}
        </KpiCard>
      </KpiGrid>

      <Card>
          <CardSection title="套件清點">
            {inventory.length === 0 ? (
              <EmptyState
                title="尚無套件資料"
                description="按「掃描套件」由管理面板掃描主機"
                action={
                  <Button variant="primary" size="md" loading={busy} onClick={() => void load(true)}>
                    掃描套件
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>套件</th>
                      <th>版本</th>
                      <th>建議</th>
                      <th>風險</th>
                      <th>CVE</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((i) => (
                      <tr key={i.packageName + i.currentVersion}>
                        <td>
                          <strong>{i.packageName}</strong>
                        </td>
                        <td>{i.currentVersion}</td>
                        <td>
                          {humanizeOperatorNote(i.advice ?? i.summary ?? '') ??
                            i.advice ??
                            i.summary ??
                            '—'}
                        </td>
                        <td>
                          <Badge tone={riskTone(i.risk)}>{i.risk ?? '—'}</Badge>
                          {i.requiresApproval ? (
                            <Badge tone="warn">需審批</Badge>
                          ) : null}
                        </td>
                        <td className="muted u-text-sm u-break-all">
                          {i.cves?.length ? i.cves.slice(0, 3).join(', ') : '—'}
                        </td>
                        <td>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              const high =
                                i.risk === 'high' ||
                                i.risk === 'critical' ||
                                Boolean(i.requiresApproval);
                              if (
                                high &&
                                !confirm(
                                  `確認套用高風險更新 ${i.packageName}？\n${i.summary ?? ''}`,
                                )
                              ) {
                                return;
                              }
                              void applyPackage(i, high);
                            }}
                          >
                            套用
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardSection>
        </Card>
    </FeaturePageLayout>
  );
}
