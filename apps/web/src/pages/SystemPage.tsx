import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  CardSection,
  FeatureIconGrid,
  FeaturePageLayout,
  Field,
  FormLayout,
  Tabs,
  FormActions,
} from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';
import { systemApi } from '../features/system';
import { api } from '../shared/services/api';
import { usePageTab } from '../shared/hooks/usePageTab';

const SYS_TABS = ['host', 'export', 'tools'] as const;

/**
 * System index — host identity + feature launcher.
 */
export function SystemPage() {
  const { t } = useTranslation();
  const tiles = allFeatureTiles()
    .filter((i) => i.to !== '/system')
    .map((i) => ({
      ...i,
      title: t(`nav.${i.key}`, { defaultValue: i.key }),
      description: t(`features.desc.${i.key}`, { defaultValue: '' }),
    }));

  const [hostname, setHostname] = useState('');
  const [timezone, setTimezone] = useState('');
  const [ips, setIps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [r, ipRes] = await Promise.all([
      systemApi.hostIdentity(),
      api.requestRaw<{ items: string[] }>('/api/v1/system/ips').catch(() => ({ items: [] as string[] })),
    ]);
    setHostname(r.hostname ?? '');
    setTimezone(r.timezone ?? '');
    setIps(ipRes.items ?? []);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const [tab, setTab] = usePageTab(SYS_TABS, 'host');

  return (
    <FeaturePageLayout
      title={t('system.indexTitle', { defaultValue: '系統工具' })}
      subtitle={t('system.indexSubtitle', {
        defaultValue: '主機身份與功能入口',
      })}
      showCapability={false}
    >
      {err ? <Alert variant="error">{err}</Alert> : null}
      {msg ? <Alert variant="ok">{msg}</Alert> : null}

      <Tabs
        tabs={[
          { id: 'host', label: '主機' },
          { id: 'export', label: '匯出／Rebuild' },
          { id: 'tools', label: '工具入口' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'host' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="主機名稱 / 時區" description="需系統變更權限 + 管理員">
                <FormLayout columns={2}>
                  <Field label="主機名稱" htmlFor="sys-hn" hint="hostname" flush>
                    <input
                      id="sys-hn"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                    />
                  </Field>
                  <Field label="時區" htmlFor="sys-tz" hint="例如 Asia/Hong_Kong" flush>
                    <input
                      id="sys-tz"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Asia/Hong_Kong"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      setErr(null);
                      setMsg(null);
                      void systemApi
                        .setHostIdentity({
                          hostname: hostname || undefined,
                          timezone: timezone || undefined,
                        })
                        .then((r) => {
                          const notes = (r as { notes?: string[] }).notes;
                          setMsg(notes?.join('；') ?? '已更新');
                          return refresh();
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    套用
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => void refresh()}
                  >
                    重新整理
                  </Button>
                  {hostname ? (
                    <Link
                      to={`/ssl?domain=${encodeURIComponent(hostname)}&action=le`}
                      className="btn btn--ghost btn--md"
                      title="為面板 hostname 申請 Let’s Encrypt"
                    >
                      面板 hostname SSL
                    </Link>
                  ) : null}
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection title="主機 IP" description="hostname -I / 本機 IPv4（唯讀）">
                {ips.length === 0 ? (
                  <p className="muted">無法讀取或尚未有 IP</p>
                ) : (
                  <ul className="list-plain list-spaced">
                    {ips.map((ip) => (
                      <li key={ip}>
                        <code className="inline">{ip}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'export' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="匯出 / Rebuild"
                description="控制面摘要 JSON + 可選重載 managed nginx（fail-closed）"
              >
                <div className="btn-row">
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      setErr(null);
                      void api
                        .requestRaw('/api/v1/system/export')
                        .then((r) => {
                          setMsg(
                            `已匯出摘要 · projects=${(r as { counts?: { projects?: number } }).counts?.projects ?? '—'}`,
                          );
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    匯出摘要
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      setErr(null);
                      void api
                        .requestRaw<{ ok?: boolean; notes?: string[]; blockMessage?: string }>(
                          '/api/v1/system/rebuild',
                          {
                            method: 'POST',
                            body: JSON.stringify({ writeExport: true, syncNginx: false }),
                          },
                        )
                        .then((r) => {
                          setMsg(
                            r.notes?.join('；') ?? (r.ok ? 'rebuild 完成' : 'rebuild 未完成'),
                          );
                          if (r.blockMessage) setErr(r.blockMessage);
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    匯出 + 列 managed conf
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      if (!confirm('將嘗試 sync nginx 到系統（需 root + EXECUTE）？')) return;
                      setBusy(true);
                      setErr(null);
                      void api
                        .requestRaw<{ ok?: boolean; notes?: string[]; blockMessage?: string }>(
                          '/api/v1/system/rebuild',
                          {
                            method: 'POST',
                            body: JSON.stringify({ writeExport: true, syncNginx: true }),
                          },
                        )
                        .then((r) => {
                          setMsg(r.notes?.join('；') ?? 'done');
                          if (r.blockMessage) setErr(r.blockMessage);
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Rebuild nginx（系統）
                  </Button>
                </div>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="tab-panel">
            <div>
              <h2 className="section-title">功能入口</h2>
              <p className="muted meta-block--tight">系統與主機相關功能快捷入口</p>
            </div>
            <FeatureIconGrid items={tiles} />
          </div>
        ) : null}
      </Tabs>
    </FeaturePageLayout>
  );
}
