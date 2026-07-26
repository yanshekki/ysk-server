/**
 * Agents — fleet + runtime probe/install with honest unit status.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgents } from '../features/agents';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  SummaryStrip,
} from '../shared/components/ui';

function statusTone(status?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (status === 'running') return 'ok';
  if (status === 'not_installed') return 'warn';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'unknown') return 'neutral';
  return 'info';
}

function statusLabel(status?: string): string {
  if (status === 'running') return '運行中';
  if (status === 'not_installed') return '未安裝';
  if (status === 'failed' || status === 'error') return '失敗';
  if (status === 'unknown') return '未探測';
  return status ?? '未知';
}

export function AgentsPage() {
  const { t } = useTranslation();
  const {
    agents,
    runtimes,
    error,
    busy,
    msg,
    setMsg,
    detailNotes,
    detailFacts,
    refresh,
    register,
    probeKind,
    writeUnit,
    installKind,
  } = useAgents();
  const [agentId, setAgentId] = useState('edge-1');

  const runtimeList = runtimes;
  const running = runtimeList.filter((r) => r.status === 'running').length;
  const unitActive = runtimeList.filter((r) => r.unitActive === 'active').length;

  return (
    <FeaturePageLayout
      title={t('agents.title')}
      subtitle={t('agents.body')}
      actions={
        <Button variant="secondary" size="md" loading={busy} onClick={() => void refresh()}>
          重新整理
        </Button>
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
          { label: '運行時', value: runtimeList.length },
          {
            label: '運行中',
            value: running,
            tone: running > 0 ? 'ok' : 'default',
          },
          {
            label: 'systemd active',
            value: unitActive,
            tone: unitActive > 0 ? 'ok' : 'default',
          },
          { label: 'Fleet', value: agents.length },
        ]}
      />

      <Card>
        <CardSection
          title="AI 運行時"
          description="探測路徑與 unit；安裝會嘗試 enable systemd（需系統變更與 root）"
        >
          {runtimeList.length === 0 ? (
            <EmptyState
              title="尚未有探測結果"
              description="按重新整理載入運行時清單，或逐個探測"
              action={
                <Button variant="primary" size="md" loading={busy} onClick={() => void refresh()}>
                  重新整理
                </Button>
              }
            />
          ) : (
            <div className="grid">
              {runtimeList.map((rt) => (
                <div className="card" key={rt.kind}>
                  <div className="card__header">
                    <h2 className="card__title">{rt.name ?? rt.kind}</h2>
                    <Badge tone={statusTone(rt.status)}>{statusLabel(rt.status)}</Badge>
                  </div>
                  <DescriptionList
                    columns={1}
                    items={[
                      {
                        label: '路徑',
                        value: rt.installPath
                          ? `${rt.pathExists ? '已存在' : '尚未安裝'} · ${rt.installPath}`
                          : '—',
                      },
                      {
                        label: 'systemd',
                        value: rt.unitActive
                          ? `${rt.unitName ?? 'unit'} · ${rt.unitActive}`
                          : rt.unitName
                            ? `${rt.unitName} · 未知`
                            : '—',
                      },
                    ]}
                  />
                  <div className="btn-row u-mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => void probeKind(rt.kind)}
                    >
                      探測
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => void writeUnit(rt.kind)}
                    >
                      寫入 unit 範本
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      onClick={() => void installKind(rt.kind)}
                    >
                      安裝並啟用
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      {detailNotes.length > 0 || detailFacts.length > 0 ? (
        <Card>
          <CardSection title="最近操作">
            {detailFacts.length > 0 ? (
              <DescriptionList columns={2} items={detailFacts} />
            ) : null}
            {detailNotes.length > 0 ? (
              <ul className="list-plain list-spaced u-mt-3">
                {detailNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </CardSection>
        </Card>
      ) : null}

      <div className="u-mt-4 grid">
        <Card>
          <CardSection title="登記 Agent" description="Fleet 登記（控制面）">
            <Field label="Agent ID" techKey="agent_id" htmlFor="aid">
              <input id="aid" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
            </Field>
            <div className="form-actions">
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() => void register(agentId)}
              >
                登記
              </Button>
            </div>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={`Fleet (${agents.length})`}>
            {agents.length === 0 ? (
              <EmptyState title="尚未登記 agent" description="先登記一個 ID" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>狀態</th>
                      <th>群組</th>
                      <th>最後見</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.id}>
                        <td>{a.agent_id}</td>
                        <td>
                          <Badge tone={a.status === 'online' ? 'ok' : 'neutral'}>{a.status}</Badge>
                        </td>
                        <td>{a.group ?? '—'}</td>
                        <td className="muted u-nowrap">{a.last_seen_at?.slice(0, 19)}</td>
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
