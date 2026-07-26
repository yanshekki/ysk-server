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

      <div className="grid">
        <Card>
          <CardSection title="自身更新" description="由管理面板檢查並套用">
            {selfUpdate ? (
              <>
                <DescriptionList
                  columns={2}
                  items={Object.entries(selfUpdate as Record<string, unknown>)
                    .filter(([, v]) => v == null || typeof v !== 'object')
                    .filter(([k]) => !/YSK_EXECUTE|command|shasum|registryUrl/i.test(k))
                    .slice(0, 12)
                    .map(([k, v]) => ({
                      label: SELF_LABELS[k] ?? k,
                      value: Array.isArray(v) ? v.join(', ') : String(v),
                    }))}
                />
                <div className="lifecycle-toolbar u-mt-3">
                  <Button variant="primary" size="md" loading={busy} onClick={() => void applySelf()}>
                    套用更新
                  </Button>
                </div>
              </>
            ) : (
              <LoadingBlock label="載入中…" />
            )}
          </CardSection>
        </Card>
        <Card>
          <CardSection title="排程">
            {jobs.length === 0 ? (
              <p className="muted">尚無排程（或未啟用）</p>
            ) : (
              <ul className="list-plain list-spaced">
                {jobs.map((j) => (
                  <li key={String(j.id)}>
                    <strong>{String(j.id)}</strong>{' '}
                    <span className="muted">
                      每 {String(j.intervalMs)}ms · 上次 {String(j.lastRunAt ?? '—')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {lastAt ? <p className="muted meta-block--top">清點時間：{lastAt}</p> : null}
          </CardSection>
        </Card>
      </div>

      <div className="u-mt-4">
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
      </div>
    </FeaturePageLayout>
  );
}
