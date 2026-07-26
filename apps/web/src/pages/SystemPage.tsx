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
  FormGrid,
} from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';
import { systemApi } from '../features/system';
import { api } from '../shared/services/api';

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

      <Card>
        <CardSection title="主機名稱 / 時區" description="需系統變更權限 + 管理員">
          <FormGrid>
            <Field label="Hostname" htmlFor="sys-hn" flush>
              <input id="sys-hn" value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </Field>
            <Field label="Timezone" htmlFor="sys-tz" flush>
              <input
                id="sys-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Hong_Kong"
              />
            </Field>
          </FormGrid>
          <div className="btn-row u-mt-3">
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
            <Button variant="secondary" size="md" loading={busy} onClick={() => void refresh()}>
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
          </div>
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

      <h2 className="section-title u-mt-4">功能入口</h2>
      <FeatureIconGrid items={tiles} />
    </FeaturePageLayout>
  );
}
