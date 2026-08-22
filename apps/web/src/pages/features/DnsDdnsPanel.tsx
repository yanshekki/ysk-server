import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { DdnsHistoryRow, DdnsProviderId, DdnsRecordDto, DdnsStatusDto } from 'ysk-server-shared';
import { isDdnsErrorCode } from 'ysk-server-shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  PresetChips,
} from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { resourcesApi } from '../../features/resources/api';
import { toast } from '../../shared/stores/toast-store';
import { formatDateTime } from '../../shared/lib/datetime';
import { bindArg1, bindAsync, bindFormSubmit, bindInput, bindSet } from '../bind-handlers';

function ddnsMsg(
  t: (key: string) => string,
  code?: string | null,
): string {
  if (!code) return '—';
  if (isDdnsErrorCode(code)) return t(`dns.ddns.err.${code}`);
  return t('dns.ddns.err.provider');
}

export function DnsDdnsPanel() {
  const { t } = useTranslation();
  const [st, setSt] = useState<DdnsStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [fqdn, setFqdn] = useState('');
  const [zone, setZone] = useState('');
  const [provider, setProvider] = useState<DdnsProviderId>('cloudflare');
  const [rtype, setRtype] = useState<'A' | 'AAAA'>('A');
  const [ttl, setTtl] = useState('300');
  const [proxied, setProxied] = useState(false);
  const [token, setToken] = useState('');
  const [interval, setInterval] = useState('300');
  const [updateIdentity, setUpdateIdentity] = useState(true);
  const [schedulerOn, setSchedulerOn] = useState(true);
  const [primaryFqdn, setPrimaryFqdn] = useState('');
  const [rfcServer, setRfcServer] = useState('');
  const [rfcKeyFile, setRfcKeyFile] = useState('');
  const [localZones, setLocalZones] = useState<string[]>([]);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [proxiedOpen, setProxiedOpen] = useState(false);
  const [delRec, setDelRec] = useState<DdnsRecordDto | null>(null);

  const refresh = useCallback(async () => {
    const r = await api.requestRaw<DdnsStatusDto & { ok?: boolean }>('/api/v1/dns/ddns');
    setSt(r);
    setInterval(String(r.settings.intervalSeconds));
    setUpdateIdentity(r.settings.updateIdentity !== false);
    setSchedulerOn(r.settings.enabled !== false);
    setPrimaryFqdn(r.settings.primaryFqdn ?? '');
    setRfcServer(r.rfc2136Server ?? '');
    try {
      const z = await resourcesApi.list('dns/zones');
      setLocalZones(
        (z.items ?? [])
          .map((row) => String(row.zone ?? '').trim().toLowerCase())
          .filter(Boolean),
      );
    } catch {
      /* zone list is optional for Cloudflare / RFC 2136 */
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.requestRaw('/api/v1/dns/ddns/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          intervalSeconds: Number(interval),
          updateIdentity,
          enabled: schedulerOn,
          primaryFqdn: primaryFqdn.trim() || undefined,
          cloudflareToken: token.trim() || undefined,
          rfc2136:
            rfcServer.trim() || rfcKeyFile.trim()
              ? {
                  server: rfcServer.trim() || undefined,
                  keyFile: rfcKeyFile.trim() || undefined,
                }
              : undefined,
        }),
      });
      setToken('');
      setRfcKeyFile('');
      toast.ok(t('dns.ddns.saved'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.ddns.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function doAdd() {
    setBusy(true);
    try {
      const r = await api.requestRaw<{ ok: boolean; notes?: string[] }>('/api/v1/dns/ddns/records', {
        method: 'POST',
        body: JSON.stringify({
          fqdn,
          type: rtype,
          provider,
          zone: zone.trim() || undefined,
          ttl: Number(ttl) || 300,
          proxied: provider === 'cloudflare' ? proxied : false,
        }),
      });
      if (!r.ok) {
        const note = r.notes?.[0];
        toast.error(note ? ddnsMsg(t, note) : t('dns.ddns.saveFailed'));
        return;
      }
      setFqdn('');
      toast.ok(t('dns.ddns.saved'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.ddns.saveFailed'));
    } finally {
      setBusy(false);
      setProxiedOpen(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (provider === 'cloudflare' && proxied) {
      setProxiedOpen(true);
      return;
    }
    await doAdd();
  }

  async function onProbe() {
    setBusy(true);
    try {
      const r = await api.requestRaw<DdnsStatusDto>('/api/v1/dns/ddns?probe=1');
      setSt(r);
      setInterval(String(r.settings.intervalSeconds));
      toast.ok(t('dns.ddns.probed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.ddns.probeFailedUi'));
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateNow() {
    setBusy(true);
    try {
      await api.requestRaw('/api/v1/dns/ddns/update', {
        method: 'POST',
        body: JSON.stringify({ execute: true, force: true }),
      });
      toast.ok(t('dns.ddns.updated'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.ddns.updateFailed'));
    } finally {
      setBusy(false);
      setUpdateOpen(false);
    }
  }

  async function onToggle(r: DdnsRecordDto) {
    setBusy(true);
    try {
      await api.requestRaw('/api/v1/dns/ddns/records', {
        method: 'POST',
        body: JSON.stringify({
          id: r.id,
          fqdn: r.fqdn,
          type: r.type,
          provider: r.provider,
          zone: r.zone,
          ttl: r.ttl,
          proxied: r.proxied,
          enabled: !r.enabled,
        }),
      });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.ddns.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!delRec) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/dns/ddns/records/${encodeURIComponent(delRec.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: delRec.fqdn }),
      });
      toast.ok(t('dns.ddns.deleted'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dns.failed'));
    } finally {
      setBusy(false);
      setDelRec(null);
    }
  }

  const rows = st?.records ?? [];
  const history = st?.history ?? [];
  const intervalOpts = useMemo(
    () => [
      { value: '60', label: t('dns.min1') },
      { value: '300', label: t('dns.min5') },
      { value: '600', label: t('dns.min10') },
      { value: '3600', label: t('dns.hour1') },
      { value: '86400', label: t('dns.day1') },
    ],
    [t],
  );

  return (
    <div className="tab-panel stack">
      {st?.detected.error ? (
        <Alert variant="error">{ddnsMsg(t, st.detected.error)}</Alert>
      ) : null}
      {st?.requiresExecute ? <Alert variant="warn">{t('dns.ddns.needExecute')}</Alert> : null}
      {st && st.settings.enabled === false ? (
        <Alert variant="warn">{t('dns.ddns.pausedHint')}</Alert>
      ) : null}
      <FormHint>{t('dns.ddns.honesty')}</FormHint>

      <Card>
        <CardSection title={t('dns.ddns.statusCard')} description={t('dns.ddns.forceHint')}>
          <dl className="page-status__chips">
            <div className="page-status__chip">
              <dt className="page-status__chip-lab">IPv4</dt>
              <dd className="page-status__chip-val">{st?.detected.ipv4 || '—'}</dd>
            </div>
            <div className="page-status__chip">
              <dt className="page-status__chip-lab">IPv6</dt>
              <dd className="page-status__chip-val">{st?.detected.ipv6 || '—'}</dd>
            </div>
            <div className="page-status__chip">
              <dt className="page-status__chip-lab">{t('dns.ddns.wanRemembered')}</dt>
              <dd className="page-status__chip-val">{st?.lastWanIpv4 || '—'}</dd>
            </div>
            <div className="page-status__chip">
              <dt className="page-status__chip-lab">{t('dns.ddns.lastRun')}</dt>
              <dd className="page-status__chip-val">
                {st?.lastRunAt ? formatDateTime(st.lastRunAt) : '—'}
              </dd>
            </div>
            <div className="page-status__chip">
              <dt className="page-status__chip-lab">{t('dns.ddns.nextRun')}</dt>
              <dd className="page-status__chip-val">
                {st?.settings.enabled === false
                  ? t('dns.ddns.paused')
                  : st?.nextRunAt
                    ? formatDateTime(st.nextRunAt)
                    : '—'}
              </dd>
            </div>
          </dl>
          <FormActions>
            <Button type="button" variant="secondary" disabled={busy} onClick={bindAsync(onProbe)}>
              {t('dns.ddns.probe')}
            </Button>
            <Button
              type="button"
              variant="primary"
              data-confirm
              disabled={busy}
              onClick={bindSet(setUpdateOpen, true)}
            >
              {t('dns.ddns.updateNow')}
            </Button>
            <Link to="/vpn" className="muted u-text-sm">
              {t('dns.ddns.vpnHint')}
            </Link>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('dns.ddns.recordsCard')}>
          <DataTable
            columns={[
              { key: 'fqdn', header: t('dns.ddns.colFqdn'), render: (r: DdnsRecordDto) => r.fqdn },
              { key: 'type', header: t('dns.colType'), render: (r: DdnsRecordDto) => r.type },
              {
                key: 'provider',
                header: t('dns.ddns.colProvider'),
                render: (r: DdnsRecordDto) => r.provider,
              },
              {
                key: 'enabled',
                header: t('dns.ddns.colEnabled'),
                render: (r: DdnsRecordDto) => (
                  <Badge tone={r.enabled ? 'ok' : 'neutral'}>
                    {r.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                ),
              },
              {
                key: 'published',
                header: t('dns.ddns.colPublished'),
                render: (r: DdnsRecordDto) => r.lastPublished || '—',
              },
              {
                key: 'err',
                header: t('dns.failed'),
                render: (r: DdnsRecordDto) => ddnsMsg(t, r.lastError),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title={t('dns.ddns.emptyTitle')} description={t('dns.ddns.emptyDesc')} />}
            rowActions={(r) => (
              <>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={bindArg1(onToggle, r)}>
                  {r.enabled ? t('dns.ddns.pauseRecord') : t('dns.ddns.resumeRecord')}
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={bindArg1(setDelRec, r)}>
                  {t('common.delete')}
                </Button>
              </>
            )}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('dns.ddns.addCard')}>
          <form onSubmit={bindFormSubmit(onAdd)}>
            <FormLayout columns={2}>
              <Field label={t('dns.ddns.colFqdn')} htmlFor="ddns-fqdn" required>
                <input id="ddns-fqdn" value={fqdn} onChange={bindInput(setFqdn)} required spellCheck={false} />
              </Field>
              <Field label={t('dns.ddns.zone')} htmlFor="ddns-zone" hint={t('dns.ddns.zoneHint')}>
                <input
                  id="ddns-zone"
                  value={zone}
                  onChange={bindInput(setZone)}
                  spellCheck={false}
                  list="ddns-zone-list"
                />
                <datalist id="ddns-zone-list">
                  {localZones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('dns.colType')} htmlFor="ddns-type">
                <select
                  id="ddns-type"
                  value={rtype}
                  onChange={(e) => setRtype(e.target.value === 'AAAA' ? 'AAAA' : 'A')}
                >
                  <option value="A">A</option>
                  <option value="AAAA">AAAA</option>
                </select>
              </Field>
              <Field label={t('dns.ddns.colProvider')} htmlFor="ddns-prov">
                <select
                  id="ddns-prov"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as DdnsProviderId)}
                >
                  <option value="cloudflare">Cloudflare</option>
                  <option value="rfc2136">RFC 2136</option>
                  <option value="local">{t('dns.ddns.providerLocal')}</option>
                </select>
              </Field>
              <Field label="TTL" htmlFor="ddns-ttl">
                <input id="ddns-ttl" value={ttl} onChange={bindInput(setTtl)} />
              </Field>
              {provider === 'cloudflare' ? (
                <Field label={t('dns.ddns.proxied')} htmlFor="ddns-proxied">
                  <CheckboxField
                    id="ddns-proxied"
                    label={t('dns.ddns.proxiedHint')}
                    checked={proxied}
                    onChange={setProxied}
                  />
                </Field>
              ) : null}
            </FormLayout>
            {provider === 'local' && localZones.length === 0 ? (
              <FormHint>
                {t('dns.ddns.noLocalZones')}{' '}
                <Link to="/dns?tab=zones">{t('dns.tabs.zones')}</Link>
              </FormHint>
            ) : (
              <FormHint>{t('dns.ddns.zoneSelectHint')}</FormHint>
            )}
            <FormActions>
              <Button type="submit" disabled={busy}>
                {t('dns.ddns.addRecord')}
              </Button>
            </FormActions>
          </form>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('dns.ddns.settingsCard')}>
          <form onSubmit={bindFormSubmit(onSaveSettings)}>
            <FormLayout columns={2}>
              <Field label={t('dns.ddns.interval')} htmlFor="ddns-int" hint={t('dns.ddns.intervalHint')} fullWidth>
                <PresetChips
                  options={intervalOpts}
                  value={interval}
                  onChange={setInterval}
                  allowCustom
                  disabled={busy}
                />
              </Field>
              <CheckboxField
                id="ddns-sched"
                label={t('dns.ddns.schedulerOn')}
                description={t('dns.ddns.schedulerOnHint')}
                checked={schedulerOn}
                onChange={setSchedulerOn}
              />
              <Field label={t('dns.ddns.primaryFqdn')} htmlFor="ddns-primary" hint={t('dns.ddns.primaryFqdnHint')}>
                <select id="ddns-primary" value={primaryFqdn} onChange={bindInput(setPrimaryFqdn)}>
                  <option value="">—</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.fqdn}>
                      {r.fqdn}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('dns.ddns.cfToken')}
                htmlFor="ddns-tok"
                hint={st?.hasCloudflareToken ? t('dns.ddns.tokenConfigured') : t('dns.ddns.tokenMissing')}
              >
                <input
                  id="ddns-tok"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={bindInput(setToken)}
                />
              </Field>
              <Field label={t('dns.ddns.rfcServer')} htmlFor="ddns-rfc-server" hint={t('dns.ddns.rfcServerHint')}>
                <input
                  id="ddns-rfc-server"
                  value={rfcServer}
                  onChange={bindInput(setRfcServer)}
                  spellCheck={false}
                  placeholder="127.0.0.1"
                />
              </Field>
              <Field
                label={t('dns.ddns.rfcKeyFile')}
                htmlFor="ddns-rfc-key"
                hint={st?.hasRfc2136Key ? t('dns.ddns.rfcKeyConfigured') : t('dns.ddns.rfcKeyFileHint')}
              >
                <input
                  id="ddns-rfc-key"
                  value={rfcKeyFile}
                  onChange={bindInput(setRfcKeyFile)}
                  spellCheck={false}
                />
              </Field>
              <Field label={t('dns.ddns.updateIdentity')} htmlFor="ddns-ident">
                <CheckboxField
                  id="ddns-ident"
                  label={t('dns.ddns.updateIdentityHint')}
                  checked={updateIdentity}
                  onChange={setUpdateIdentity}
                />
              </Field>
            </FormLayout>
            <FormActions>
              <Button type="submit" variant="secondary" disabled={busy}>
                {t('common.save')}
              </Button>
            </FormActions>
          </form>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('dns.ddns.historyTitle')}>
          <DataTable
            columns={[
              {
                key: 'at',
                header: t('dns.ddns.colWhen'),
                render: (r: DdnsHistoryRow) => formatDateTime(r.at),
              },
              { key: 'fqdn', header: t('dns.ddns.colFqdn'), render: (r: DdnsHistoryRow) => r.fqdn },
              { key: 'type', header: t('dns.colType'), render: (r: DdnsHistoryRow) => r.type },
              { key: 'from', header: t('dns.ddns.colFrom'), render: (r: DdnsHistoryRow) => r.from || '—' },
              { key: 'to', header: t('dns.ddns.colTo'), render: (r: DdnsHistoryRow) => r.to || '—' },
              {
                key: 'ok',
                header: t('common.status'),
                render: (r: DdnsHistoryRow) => (
                  <Badge tone={r.ok ? 'ok' : 'danger'}>{r.ok ? t('common.ok') : t('common.failed')}</Badge>
                ),
              },
              {
                key: 'note',
                header: t('dns.ddns.colNote'),
                render: (r: DdnsHistoryRow) => ddnsMsg(t, r.note),
              },
            ]}
            rows={history}
            rowKey={(r, i) => `${r.at}-${r.fqdn}-${i}`}
            empty={<EmptyState title={t('dns.ddns.historyEmpty')} />}
          />
        </CardSection>
      </Card>

      <FormHint>{t('dns.ddns.sslHint')}</FormHint>

      <ConfirmDialog
        open={updateOpen}
        onClose={bindSet(setUpdateOpen, false)}
        onConfirm={() => void onUpdateNow()}
        title={t('dns.ddns.updateTitle')}
        description={t('dns.ddns.updateDesc')}
        confirmLabel={t('dns.ddns.updateNow')}
        cancelLabel={t('common.cancel')}
        dataConfirm="UPDATE"
        confirmText="UPDATE"
        busy={busy}
      />
      <ConfirmDialog
        open={proxiedOpen}
        onClose={bindSet(setProxiedOpen, false)}
        onConfirm={() => void doAdd()}
        title={t('dns.ddns.proxiedWarnTitle')}
        description={t('dns.ddns.proxiedWarnDesc')}
        confirmLabel={t('dns.ddns.addRecord')}
        cancelLabel={t('common.cancel')}
        dataConfirm="PROXY"
        confirmText="PROXY"
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delRec)}
        onClose={bindSet(setDelRec, null)}
        onConfirm={() => void onDelete()}
        title={t('dns.ddns.deleteTitle')}
        description={t('dns.ddns.deleteDesc', { fqdn: delRec?.fqdn ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        dataConfirm={delRec?.fqdn}
        confirmText={delRec?.fqdn}
        danger
        busy={busy}
      />
    </div>
  );
}
