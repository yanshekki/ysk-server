/**
 * Real host service matrix — systemctl probes + deep links (not protection-only).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  OpsResultPanel,
  SummaryStrip,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

type MatrixItem = {
  id: string;
  label: string;
  unit: string;
  href?: string;
  category: string;
  installed: boolean;
  active: string;
  enabled: string;
  activeLabel: string;
};

function toneFor(active: string, installed: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
  if (!installed || active === 'not-found') return 'danger';
  if (active === 'failed') return 'danger';
  if (active === 'inactive') return 'warn';
  return 'neutral';
}

export function ServicesPage() {
  const [items, setItems] = useState<MatrixItem[]>([]);
  const [meta, setMeta] = useState<{ executeEnabled?: boolean; isRoot?: boolean; probedAt?: string }>(
    {},
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState('matrix');
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await systemApi.servicesMatrix();
      setItems(r.items ?? []);
      setMeta({
        executeEnabled: r.executeEnabled,
        isRoot: r.isRoot,
        probedAt: r.probedAt,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function lifecycle(unit: string, action: 'start' | 'stop' | 'restart' | 'reload') {
    await run(async () => {
      try {
        const r = await systemApi.serviceLifecycle({ unit, action });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '操作失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, `已 ${action}`);
  }

  const running = items.filter((i) => i.active === 'active').length;
  const missing = items.filter((i) => !i.installed).length;

  return (
    <FeaturePageLayout
      title="服務狀態"
      subtitle="主機 systemd 服務矩陣（真實探測）"
      actions={
        <div className="btn-row">
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refresh();
            }}
          >
            重新整理
          </Button>
        </div>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
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
          { label: '運行中', value: String(running), tone: running ? 'ok' : 'warn' },
          { label: '未安裝', value: String(missing), tone: missing ? 'warn' : 'default' },
          {
            label: '系統變更',
            value: meta.executeEnabled ? '已開啟' : '未開啟',
            tone: meta.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: '管理員',
            value: meta.isRoot ? '是' : '否',
            tone: meta.isRoot ? 'ok' : 'warn',
          },
        ]}
      />

      <Tabs
        tabs={[
          { id: 'matrix', label: '服務矩陣' },
          { id: 'protection', label: '保護探測' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'matrix' ? (
          <Card>
            <CardSection
              title="已知服務"
              description="由 systemctl 探測；啟動／停止需要系統變更權限與管理員"
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>服務</th>
                      <th>分類</th>
                      <th>unit</th>
                      <th>狀態</th>
                      <th>開機自啟</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.label}</strong>
                          {row.href ? (
                            <div>
                              <Link to={row.href} className="btn btn--link">
                                開啟控制頁
                              </Link>
                            </div>
                          ) : null}
                        </td>
                        <td>{row.category}</td>
                        <td>
                          <code className="inline">{row.unit}</code>
                        </td>
                        <td>
                          <Badge tone={toneFor(row.active, row.installed)}>{row.activeLabel}</Badge>
                        </td>
                        <td className="muted u-text-sm">{row.enabled}</td>
                        <td>
                          <div className="btn-row">
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              disabled={!row.installed && row.active !== 'active'}
                              onClick={() => void lifecycle(row.unit, 'start')}
                            >
                              啟動
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy}
                              onClick={() => void lifecycle(row.unit, 'restart')}
                            >
                              重啟
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={busy}
                              onClick={() => void lifecycle(row.unit, 'stop')}
                            >
                              停止
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {meta.probedAt ? (
                <p className="muted u-text-sm u-mt-3" style={{ marginBottom: 0 }}>
                  探測時間：{new Date(meta.probedAt).toLocaleString()}
                </p>
              ) : null}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'protection' ? (
          <Card>
            <CardSection title="保護探測" description="額外安全／保護狀態（與服務矩陣分開）">
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    const r = (await systemApi.protectionProbe()) as Record<string, unknown>;
                    setProbe(r);
                    return { ok: true, notes: ['保護探測完成'], ...r } as unknown as OpsResultLike;
                  }, '探測完成')
                }
              >
                執行保護探測
              </Button>
              {probe ? (
                <div className="u-mt-4">
                  <DescriptionList
                    columns={2}
                    items={Object.entries(probe)
                      .filter(([, v]) => v == null || typeof v !== 'object')
                      .slice(0, 24)
                      .map(([k, v]) => ({ label: k, value: String(v) }))}
                  />
                </div>
              ) : null}
            </CardSection>
          </Card>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
