/**
 * System tools — host console + control-plane export/rebuild (professional ops UX).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  Modal,
  ConfirmDialog,
  OpsResultPanel,
  PageTabs,
  JsonViewer,
  LogViewer,
  LoadingBlock,
  buttonClassName } from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { systemApi } from '../features/system';
import type { HostOverviewDto } from '../features/system/api';
import { api } from '../shared/services/api';
import { usePageTab } from '../shared/hooks/usePageTab';
import { toast } from '../shared/stores/toast-store';
import { formatDateTime } from '../shared/lib/datetime';
import { hostTimeZoneOpts, setHostTimeZone } from '../shared/lib/host-timezone';
import { formatDateTimeLocale } from '../shared/lib/format-date';
import { bindSet, bindInput, bindVoid } from './bind-handlers';
import { ServiceAccessStrip } from '../features/network/service-exposure';

const SYS_TABS = ['host', 'export', 'about'] as const;

type ExportSnapshot = {
  exportedAt: string;
  counts: Record<string, number>;
  projects: Array<{ id: string; name: string; domain?: string; runtime: string; status: string }>;
  emailDomains: Array<{ id: string; domain: string }>;
  packages: number;
  users: number;
};

type ManagedConf = {
  name: string;
  path: string;
  bytes: number;
  mtime?: string;
  role?: 'managed' | 'leftover' | 'unused';
};
type ExportFile = { name: string; path: string; bytes: number; mtime: string };

type RebuildResult = OpsResultLike & {
  written?: string[];
  exportPath?: string;
  nginxConfs?: string[];
  nginxConfDetails?: ManagedConf[];
  dryRun?: boolean;
  mode?: string;
  executeEnabled?: boolean;
  isRoot?: boolean;
};

type PowerDialog = {
  action: 'reboot' | 'poweroff';
  confirmNeed: string;
  delaySec: number;
};

export function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUptime(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function memTone(ratio?: number): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (ratio == null) return 'neutral';
  if (ratio > 0.9) return 'danger';
  if (ratio > 0.75) return 'warn';
  return 'ok';
}

/** timedatectl "NTP service: active|inactive|n/a" → locale */
export function formatNtpServiceLabel(
  source: string | null | undefined,
  t: (key: string) => string,
): string {
  if (source == null || !String(source).trim()) return '—';
  const s = String(source).trim().toLowerCase();
  if (s === 'active') return t('system.ntpServiceActive');
  if (s === 'inactive') return t('system.ntpServiceInactive');
  if (s === 'n/a' || s === 'na' || s === 'not available') return t('system.ntpServiceNa');
  return String(source).trim();
}

/** Export-tab nginx: leftover public-files-* / unused 000-default. Keep in sync. */
export function classifyManagedNginxName(
  name: string,
  keepPublicFiles?: string | null,
): 'managed' | 'leftover' | 'unused' {
  const base = String(name || '').replace(/^ysk-/i, '');
  if (/^000-default\.conf$/i.test(base)) return 'unused';
  if (/^public-files-/i.test(base)) {
    const keep = String(keepPublicFiles || '').replace(/^ysk-/i, '');
    if (keep && base === keep) return 'managed';
    return 'leftover';
  }
  return 'managed';
}

export function formatNtpSyncedLabel(
  synced: boolean | null | undefined,
  t: (key: string) => string,
): string {
  if (synced === true) return t('system.ntpSyncedYes');
  if (synced === false) return t('system.ntpSyncedNo');
  return t('system.ntpSyncedUnknown');
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function timeZonesDiffer(a?: string | null, b?: string | null): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x || !y) return false;
  return x !== y;
}

export function formatExportDnsCerts(
  counts: { dns_zones?: number; certificates?: number } | null | undefined,
  t: (key: string) => string,
): string {
  if (!counts || (counts.dns_zones == null && counts.certificates == null)) {
    return t('system.notExported');
  }
  return `${counts.dns_zones ?? 0}/${counts.certificates ?? 0}`;
}

export function isFirewallNote(n: string): boolean {
  return /firewall|ufw|防火牆|防火墙|9287\/tcp|allow the panel port|面板埠/i.test(n);
}

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const [tzQuery, setTzQuery] = useState('');

  const [hostname, setHostname] = useState('');
  const [panelDomain, setPanelDomain] = useState('');
  const [prettyHostname, setPrettyHostname] = useState('');
  const [timezone, setTimezone] = useState('');
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [host, setHost] = useState<HostOverviewDto | null>(null);
  const [hostLoading, setHostLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Toast-backed feedback (replaces page-top Alert). */
  const setMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);
  const setErr = useCallback((text: string | null) => {
    if (text) toast.error(text);
  }, []);
  const [powerDlg, setPowerDlg] = useState<PowerDialog | null>(null);
  const [powerConfirm, setPowerConfirm] = useState('');
  const [powerUnlocked, setPowerUnlocked] = useState(false);
  const [rebuildSyncConfirm, setRebuildSyncConfirm] = useState(false);

  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [managed, setManaged] = useState<ManagedConf[]>([]);
  /** Managed Nginx list: 5 files per page (popup preview). */
  const [managedPage, setManagedPage] = useState(0);
  const [archives, setArchives] = useState<ExportFile[]>([]);
  const [confPreview, setConfPreview] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [confPreviewLoading, setConfPreviewLoading] = useState(false);
  const [leftoverDelName, setLeftoverDelName] = useState<string | null>(null);
  const [opsResult, setOpsResult] = useState<RebuildResult | null>(null);
  const [caps, setCaps] = useState<{ executeEnabled?: boolean; isRoot?: boolean }>({});
  const [panelTls, setPanelTls] = useState<Awaited<
    ReturnType<typeof systemApi.panelTlsStatus>
  > | null>(null);
  const [panelEmail, setPanelEmail] = useState('');
  const [tlsBusy, setTlsBusy] = useState(false);
  /** Apply TLS config without killing this session unless user opts in */
  const [tlsRestart, setTlsRestart] = useState(false);
  const [disableTlsOpen, setDisableTlsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [o, tz, tls] = await Promise.all([
      systemApi.hostOverview(),
      systemApi.timezones().catch(() => null),
      systemApi.panelTlsStatus().catch(() => null),
    ]);
    setHost(o);
    setHostname(o.identity.hostname ?? '');
    setPrettyHostname(o.identity.prettyHostname ?? '');
    const current = o.identity.timezone ?? '';
    setTimezone(current);
    setHostTimeZone(current);
    if (tz?.timezones?.length) {
      const opts = [...tz.timezones];
      if (current && !opts.includes(current)) opts.unshift(current);
      setTimezoneOptions(opts);
    } else if (current) {
      setTimezoneOptions((prev) => (prev.includes(current) ? prev : [current, ...prev]));
    }
    setCaps({
      executeEnabled: o.caps.executeEnabled,
      isRoot: o.caps.isRoot });
    if (tls) {
      setPanelTls(tls);
      const fqdn =
        (tls.panelDomain && tls.panelDomain.includes('.') ? tls.panelDomain : '') ||
        (typeof window !== 'undefined' && window.location.hostname.includes('.')
          ? window.location.hostname
          : '');
      setPanelDomain(fqdn);
    }
  }, []);

  const refreshExportMeta = useCallback(async () => {
    try {
      const [ex, confs, hist] = await Promise.all([
        api.requestRaw<ExportSnapshot>('/api/v1/system/export'),
        api.requestRaw<{ items: ManagedConf[] }>('/api/v1/system/managed-nginx'),
        api.requestRaw<{ items: ExportFile[] }>('/api/v1/system/exports'),
      ]);
      setSnapshot(ex);
      const items = confs.items ?? [];
      setManaged(items);
      setManagedPage(0);
      setArchives(hist.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('system.exportLoadFailed'));
    }
  }, []);

  useEffect(() => {
    setHostLoading(true);
    void refresh()
      .catch((e: Error) => setErr(e.message))
      .finally(() => setHostLoading(false));
  }, [refresh]);

  const [tab, setTab] = usePageTab(SYS_TABS, 'host');

  useEffect(() => {
    if (tab !== 'host') return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tab]);

  const hostTz = timezone || host?.identity?.timezone || '';
  const browserTz = browserTimeZone();

  const MANAGED_PAGE_SIZE = 5;
  const managedPageCount = Math.max(1, Math.ceil(managed.length / MANAGED_PAGE_SIZE));
  const managedPageSafe = Math.min(managedPage, managedPageCount - 1);
  const managedPageItems = useMemo(() => {
    const start = managedPageSafe * MANAGED_PAGE_SIZE;
    return managed.slice(start, start + MANAGED_PAGE_SIZE);
  }, [managed, managedPageSafe]);

  const openManagedPreview = useCallback(
    (c: ManagedConf) => {
      setConfPreviewLoading(true);
      setBusy(true);
      void api
        .requestRaw<{
          ok: boolean;
          content?: string;
          notes?: string[];
        }>(`/api/v1/system/managed-nginx/${encodeURIComponent(c.name)}`)
        .then((r) => {
          if (r.ok && r.content != null) {
            setConfPreview({ name: c.name, content: r.content });
          } else {
            setErr(r.notes?.join('；') ?? t('system.readFailed'));
          }
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => {
          setBusy(false);
          setConfPreviewLoading(false);
        });
    },
    [setErr, t],
  );

  useEffect(() => {
    if (tab === 'export') void refreshExportMeta();
  }, [tab, refreshExportMeta]);

  function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runRebuild(opts: {
    writeExport?: boolean;
    syncNginx?: boolean;
    dryRun?: boolean;
  }) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.requestRaw<RebuildResult>('/api/v1/system/rebuild', {
        method: 'POST',
        body: JSON.stringify({
          writeExport: opts.writeExport !== false,
          syncNginx: Boolean(opts.syncNginx),
          dryRun: Boolean(opts.dryRun) }) });
      setOpsResult(r);
      setCaps({ executeEnabled: r.executeEnabled, isRoot: r.isRoot });
      if (r.ok) {
        setMsg(
          r.dryRun
            ? t('system.dryRunDone')
            : r.mode === 'sync'
              ? t('system.rebuildDone')
              : t('system.exportWritten'),
        );
      } else if (r.blockMessage) {
        setErr(r.blockMessage);
      }
      await refreshExportMeta();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('system.rebuildFailed'));
      setOpsResult({
        ok: false,
        notes: [e instanceof Error ? e.message : t('common.failed')] });
    } finally {
      setBusy(false);
    }
  }

  const counts = snapshot?.counts;
  const memPct =
    host?.runtime?.memory?.usedRatio != null
      ? Math.round(host.runtime.memory.usedRatio * 100)
      : null;
  const load1 = host?.runtime?.loadavg?.[0];
  const heroTone = host?.caps?.canPower
    ? 'ok'
    : host
      ? 'warn'
      : 'neutral';

  const worstDisk = useMemo(() => {
    if (!host?.disks?.length) return null;
    return [...host.disks].sort((a, b) => (b.usePct ?? 0) - (a.usePct ?? 0))[0];
  }, [host]);

  return (
    <FeaturePageLayout
      title={t('nav.systemIndex')}
      showCapability={false}
      status={
        tab === 'host'
          ? {
              pill: {
                label: host?.identity.hostname || hostname || t('system.hostFallback'),
                tone: heroTone === 'neutral' ? 'ok' : heroTone },
              items: [
                {
                  label: t('system.uptime'),
                  value: formatUptime(host?.runtime.uptimeSec) },
                {
                  label: t('system.load1m'),
                  value: load1 != null ? load1.toFixed(2) : '—' },
                {
                  label: t('common.memory'),
                  value: memPct != null ? `${memPct}%` : '—',
                  tone: memTone(host?.runtime.memory.usedRatio) },
                {
                  label: t('system.diskPeak'),
                  value:
                    worstDisk?.usePct != null
                      ? `${worstDisk.mount} ${worstDisk.usePct}%`
                      : '—',
                  tone:
                    worstDisk?.usePct != null
                      ? worstDisk.usePct >= 90
                        ? 'danger'
                        : worstDisk.usePct >= 75
                          ? 'warn'
                          : 'ok'
                      : undefined },
                {
                  label: t('system.executeLabel'),
                  value:
                    host == null
                      ? '—'
                      : host.caps.executeEnabled
                        ? t('common.on')
                        : t('common.off'),
                  tone:
                    host == null ? undefined : host.caps.executeEnabled ? 'ok' : 'warn' },
                {
                  label: t('system.rootLabel'),
                  value:
                    host == null ? '—' : host.caps.isRoot ? t('common.yes') : t('common.no'),
                  tone: host == null ? undefined : host.caps.isRoot ? 'ok' : 'warn' },
              ] }
          : {
              pill: { label: t('system.exportRebuild'), tone: 'ok' },
              items: [
                { label: t('common.project'), value: counts?.projects ?? t('common.noneSelectedShort') },
                { label: t('common.mail'), value: counts?.email_domains ?? t('common.noneSelectedShort') },
                {
                  label: t('system.dnsCerts'),
                  value: formatExportDnsCerts(counts, t) },
                { label: t('system.managedCount'), value: managed.length },
                {
                  label: t('system.executeLabel'),
                  value:
                    caps.executeEnabled === undefined
                      ? '—'
                      : caps.executeEnabled
                        ? t('common.on')
                        : t('common.off'),
                  tone:
                    caps.executeEnabled === false
                      ? 'warn'
                      : caps.executeEnabled
                        ? 'ok'
                        : 'neutral' },
                {
                  label: t('system.exportsCount'),
                  value: archives.length },
              ] }
      }
      actions={<ActionBar>
          {tab === 'host' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                loading={busy || hostLoading}
                onClick={() => {
                  setBusy(true);
                  void refresh()
                    .catch((e: Error) => setErr(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                {t('common.refresh')}
              </Button>
              <a href="#sys-identity" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                {t('system.editIdentity')}
              </a>
              <a href="#sys-power" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                {t('system.power')}
              </a>
              <Link to="/metrics" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                {t('system.metrics')}
              </Link>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void runRebuild({
                    writeExport: true,
                    syncNginx: false,
                    dryRun: false })
                }
              >
                {t('system.writeExports')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void runRebuild({
                    writeExport: false,
                    syncNginx: false,
                    dryRun: true })
                }
              >
                {t('system.dryRunSync')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={bindVoid(refreshExportMeta)}
              >
                {t('common.refresh')}
              </Button>
            </>
          )}
          <Link to="/system/readiness" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('nav.readiness')}
          </Link>
        </ActionBar>
      }
    >
      <PageTabs
        tabs={[
          { id: 'host', label: t('system.hostConsole') },
          { id: 'export', label: t('system.exportRebuild') },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {/* ═══════════ HOST ═══════════ */}
        {tab === 'host' ? (
          <div className="tab-panel sys">
            {hostLoading && !host ? (
              <LoadingBlock label={t('system.loadingHost')} />
            ) : (
              <>
                <div className="sys-grid">
                  {/* Identity + time */}
                  <div className="sys-col">
                    <section className="sys-panel" id="sys-identity">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">{t('system.identity')}</h3>
                          <p className="sys-panel__sub">
                            {host?.caps.canIdentity
                              ? t('system.identityTools')
                              : t('system.identityReadonly')}
                          </p>
                        </div>
                        <Badge tone={host?.caps.canIdentity ? 'ok' : 'warn'}>
                          {host?.caps.canIdentity ? t('system.writable') : t('system.locked')}
                        </Badge>
                      </header>
                      <FormLayout columns={1}>
                        <Field
                          label={t('system.hostname')}
                          htmlFor="sys-hn"
                          hint={t('system.hostnameHint')}
                          flush
                        >
                          <input
                            id="sys-hn"
                            value={hostname}
                            onChange={bindInput(setHostname)}
                            disabled={!host?.caps.canIdentity && host != null}
                          />
                        </Field>
                        <Field
                          label={t('system.prettyName')}
                          htmlFor="sys-pretty"
                          hint={t('system.optional')}
                          flush
                        >
                          <input
                            id="sys-pretty"
                            value={prettyHostname}
                            onChange={bindInput(setPrettyHostname)}
                            placeholder={t('system.prettyPh')}
                            disabled={!host?.caps.canIdentity && host != null}
                          />
                        </Field>
                        <Field
                          label={t('system.timezone')}
                          htmlFor="sys-tz"
                          hint={t('system.timezoneHint')}
                          flush
                        >
                          <input
                            id="sys-tz-q"
                            value={tzQuery}
                            onChange={bindInput(setTzQuery)}
                            placeholder={t('system.timezoneSearch')}
                            disabled={!host?.caps.canIdentity && host != null}
                          />
                          <select
                            id="sys-tz"
                            value={timezone}
                            onChange={bindInput(setTimezone)}
                            disabled={!host?.caps.canIdentity && host != null}
                            aria-label={t('system.timezone')}
                          >
                            {!timezone ? (
                              <option value="">{t('system.timezoneSelect')}</option>
                            ) : null}
                            {timezone && !timezoneOptions.includes(timezone) ? (
                              <option value={timezone}>{timezone}</option>
                            ) : null}
                            {timezoneOptions
                              .filter((z) =>
                                !tzQuery.trim()
                                  ? true
                                  : z.toLowerCase().includes(tzQuery.trim().toLowerCase()),
                              )
                              .sort((a, b) => {
                                const pin = [
                                  'UTC',
                                  'Asia/Hong_Kong',
                                  'Asia/Shanghai',
                                  'Asia/Tokyo',
                                  'Europe/London',
                                  'America/New_York',
                                ];
                                return pin.indexOf(a) === -1
                                  ? pin.indexOf(b) === -1
                                    ? 0
                                    : 1
                                  : pin.indexOf(b) === -1
                                    ? -1
                                    : pin.indexOf(a) - pin.indexOf(b);
                              })
                              .map((z) => (
                              <option key={z} value={z}>
                                {z}
                              </option>
                            ))}
                          </select>
                          <p className="form-hint u-mt-1">
                            {t('system.timezoneNow', {
                              time: formatDateTime(nowTick, {
                                timeZone: hostTz || undefined,
                                withOffset: true,
                              }),
                              tz: hostTz || '—',
                            })}
                          </p>
                          {timeZonesDiffer(hostTz, browserTz) ? (
                            <Alert variant="warn" className="u-mt-2">
                              {t('system.timezoneBrowserDiff', {
                                host: hostTz,
                                browser: browserTz,
                              })}
                            </Alert>
                          ) : null}
                        </Field>
                      </FormLayout>
                      <div className="sys-panel__actions">
                        <Button
                          variant="primary"
                          size="md"
                          loading={busy}
                          disabled={!host?.caps.canIdentity && host != null}
                          onClick={() => {
                            setBusy(true);
                            setErr(null);
                            setMsg(null);
                            void systemApi
                              .setHostIdentity({
                                hostname: hostname || undefined,
                                timezone: timezone || undefined,
                                // Always send so clear is possible
                                prettyHostname: prettyHostname ?? '' })
                              .then(async (r) => {
                                const body = r as {
                                  ok?: boolean;
                                  blocked?: boolean;
                                  notes?: string[];
                                };
                                const notes = body.notes ?? [];
                                const text = notes.join('；') || t('system.updated');
                                if (body.blocked || body.ok === false) {
                                  setErr(text);
                                } else {
                                  setMsg(text);
                                }
                                await refresh();
                              })
                              .catch((e: Error) => setErr(e.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          {t('system.applyIdentity')}
                        </Button>
                      </div>
                    </section>

                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">{t('system.panelTls.title')}</h3>
                          <p className="sys-panel__sub">{t('system.panelTls.sub')}</p>
                        </div>
                        <Badge
                          tone={
                            panelTls?.servingHttps
                              ? 'ok'
                              : panelTls?.tlsEnabled
                                ? 'warn'
                                : 'neutral'
                          }
                        >
                          {panelTls?.servingHttps
                            ? t('system.panelTls.serving')
                            : panelTls?.tlsEnabled
                              ? t('system.panelTls.enabled')
                              : t('system.panelTls.disabled')}
                        </Badge>
                      </header>
                      <FormLayout columns={2}>
                        <Field
                          label={t('system.panelTls.domain')}
                          htmlFor="panel-tls-domain"
                          flush
                          hint={t('system.panelTls.domainHint', {
                            host:
                              window.location.hostname.includes('.')
                                ? window.location.hostname
                                : 'hermes.ysk.hk',
                          })}
                        >
                          <input
                            id="panel-tls-domain"
                            value={panelDomain}
                            onChange={bindInput(setPanelDomain)}
                            spellCheck={false}
                            placeholder={
                              window.location.hostname.includes('.')
                                ? window.location.hostname
                                : 'panel.example.com'
                            }
                          />
                        </Field>
                        <Field
                          label={t('system.panelTls.email')}
                          htmlFor="panel-tls-email"
                          flush
                        >
                          <input
                            id="panel-tls-email"
                            type="email"
                            value={panelEmail}
                            onChange={bindInput(setPanelEmail)}
                            placeholder={
                              hostname
                                ? `admin@${hostname.replace(/^\*\./, '')}`
                                : 'admin@example.com'
                            }
                            spellCheck={false}
                          />
                        </Field>
                      </FormLayout>
                      <dl className="sys-dl u-mt-2">
                        <div>
                          <dt>{t('system.panelTls.status')}</dt>
                          <dd>
                            {panelTls?.servingHttps
                              ? t('system.panelTls.serving')
                              : t('system.panelTls.servingHttp')}
                            {' · '}
                            <code>{window.location.origin}</code>
                          </dd>
                        </div>
                        {panelTls?.listenHost ? (
                          <div>
                            <dt>{t('system.panelTls.listenHost')}</dt>
                            <dd>
                              <code>
                                {panelTls.listenHost}:{panelTls.listenPort ?? 9287}
                              </code>
                            </dd>
                          </div>
                        ) : null}
                        {panelTls?.expiresAt ? (
                          <div>
                            <dt>{t('system.panelTls.expires')}</dt>
                            <dd>
                              <code>{panelTls.expiresAt}</code>
                            </dd>
                          </div>
                        ) : null}
                        {panelTls?.certPath ? (
                          <div>
                            <dt>{t('system.panelTls.certPath')}</dt>
                            <dd>
                              <code className="sys-dl__muted">{panelTls.certPath}</code>
                              {/bootstrap-cert\.pem$/i.test(panelTls.certPath) ? (
                                <>
                                  {' '}
                                  <Badge tone="warn">{t('system.panelTls.bootstrapCert')}</Badge>
                                </>
                              ) : null}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      {panelTls?.notes?.filter((n) => !isFirewallNote(n)).length ? (
                        <ul className="list-plain list-spaced u-mt-2 u-text-sm muted">
                          {panelTls.notes
                            .filter((n) => !isFirewallNote(n))
                            .map((n) => (
                              <li key={n.slice(0, 48)}>{n}</li>
                            ))}
                        </ul>
                      ) : null}
                      <p className="form-hint u-mt-2">{t('system.panelTls.firewallHint')}</p>
                      <div className="u-mt-2 u-mb-2">
                        <ServiceAccessStrip
                          serviceId="ysk-server"
                          ports={[{ role: 'panel', port: '9287', proto: 'tcp' }]}
                          compact
                          liveBind={panelTls?.listenHost}
                        />
                      </div>
                      <label className="checkbox-field u-mt-2">
                        <input
                          type="checkbox"
                          checked={tlsRestart}
                          onChange={(e) => setTlsRestart(e.target.checked)}
                        />
                        <span className="checkbox-field__text">
                          <span className="checkbox-field__label">
                            {t('system.panelTls.restartNow')}
                          </span>
                          <span className="checkbox-field__desc">
                            {t('system.panelTls.restartNowHint')}
                          </span>
                        </span>
                      </label>
                      <div className="sys-panel__actions">
                        <Button
                          variant="primary"
                          size="md"
                          loading={tlsBusy}
                          disabled={!panelDomain.includes('.')}
                          title={!panelDomain.includes('.') ? t('system.panelTls.needFqdn') : undefined}
                          onClick={() => {
                            if (!panelDomain.includes('.')) {
                              setErr(t('system.panelTls.needFqdn'));
                              return;
                            }
                            if (
                              tlsRestart &&
                              !window.confirm(t('system.panelTls.restartConfirm'))
                            ) {
                              return;
                            }
                            setTlsBusy(true);
                            setErr(null);
                            setMsg(null);
                            const httpsHint = `https://${panelDomain.trim()}:${panelTls?.listenPort ?? 9287}`;
                            void systemApi
                              .panelTlsIssue({
                                domain: panelDomain.trim(),
                                email:
                                  panelEmail.trim() ||
                                  `admin@${panelDomain.trim().replace(/^\*\./, '')}`,
                                restart: tlsRestart })
                              .then((r) => {
                                setOpsResult(r as RebuildResult);
                                if (r.ok) {
                                  const base =
                                    (r.notes ?? []).join('；') ||
                                    t('system.panelTls.urlHint', { url: httpsHint });
                                  setMsg(
                                    tlsRestart
                                      ? base
                                      : `${base}；${t('system.panelTls.manualRestart', { url: httpsHint })}`,
                                  );
                                } else {
                                  setErr(
                                    r.blockMessage ||
                                      (r.notes ?? []).join('；') ||
                                      t('common.opFailed'),
                                  );
                                }
                                return refresh();
                              })
                              .catch((e: Error) => {
                                // Restart may drop the connection mid-flight
                                if (tlsRestart) {
                                  setMsg(
                                    t('system.panelTls.reconnectHttps', {
                                      url: httpsHint }),
                                  );
                                } else {
                                  setErr(e.message);
                                }
                              })
                              .finally(() => setTlsBusy(false));
                          }}
                        >
                          {t('system.panelTls.issueEnable')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="md"
                          loading={tlsBusy}
                          disabled={!panelDomain.includes('.')}
                          title={!panelDomain.includes('.') ? t('system.panelTls.needFqdn') : undefined}
                          onClick={() => {
                            if (
                              tlsRestart &&
                              !window.confirm(t('system.panelTls.restartConfirm'))
                            ) {
                              return;
                            }
                            setTlsBusy(true);
                            setErr(null);
                            setMsg(null);
                            const httpsHint = `https://${panelDomain.trim()}:${panelTls?.listenPort ?? 9287}`;
                            void systemApi
                              .panelTlsEnable({
                                domain: panelDomain.trim(),
                                restart: tlsRestart })
                              .then((r) => {
                                setOpsResult(r as RebuildResult);
                                if (r.ok) {
                                  const base = (r.notes ?? []).join('；');
                                  setMsg(
                                    tlsRestart
                                      ? base
                                      : `${base}；${t('system.panelTls.manualRestart', { url: httpsHint })}`,
                                  );
                                } else {
                                  setErr((r.notes ?? []).join('；') || t('common.opFailed'));
                                }
                                return refresh();
                              })
                              .catch((e: Error) => {
                                if (tlsRestart) {
                                  setMsg(
                                    t('system.panelTls.reconnectHttps', {
                                      url: httpsHint }),
                                  );
                                } else {
                                  setErr(e.message);
                                }
                              })
                              .finally(() => setTlsBusy(false));
                          }}
                        >
                          {t('system.panelTls.enableExisting')}
                        </Button>
                        {hostname ? (
                          <Link
                            to={`/ssl?domain=${encodeURIComponent(hostname)}&action=le`}
                            className={buttonClassName({ variant: 'ghost', size: 'md' })}
                          >
                            {t('system.panelSsl')}
                          </Link>
                        ) : null}
                      </div>
                      <details className="u-mt-3">
                        <summary className="u-text-sm">{t('system.panelTls.disableNeedConfirm')}</summary>
                        <Button
                          className="u-mt-2"
                          variant="danger"
                          size="sm"
                          loading={tlsBusy}
                          disabled={!panelTls?.tlsEnabled}
                          title={t('system.panelTls.disableNeedConfirm')}
                          aria-label={t('system.panelTls.disableNeedConfirm')}
                          onClick={() => setDisableTlsOpen(true)}
                        >
                          {t('system.panelTls.disable')}
                        </Button>
                      </details>
                    </section>

                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">{t('system.timeNtp')}</h3>
                          <p className="sys-panel__sub">{t('system.clockStatus')}</p>
                        </div>
                      </header>
                      <dl className="sys-dl">
                        <div>
                          <dt>{t('system.local')}</dt>
                          <dd>
                            <code>
                              {formatDateTime(nowTick, {
                                locale: i18n.language,
                                timeZone: hostTz || undefined,
                                withOffset: true,
                              })}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('system.utc')}</dt>
                          <dd>
                            <code className="sys-dl__muted">{host?.time.utc ?? '—'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('system.ntpService')}</dt>
                          <dd>{formatNtpServiceLabel(host?.time.timeSource, t)}</dd>
                        </div>
                        <div>
                          <dt>{t('system.ntpSync')}</dt>
                          <dd>{formatNtpSyncedLabel(host?.time.ntpSynchronized, t)}</dd>
                        </div>
                      </dl>
                      <div className="sys-panel__actions">
                        <Button
                          variant="secondary"
                          size="md"
                          loading={busy}
                          disabled={!host?.caps.canIdentity && host != null}
                          onClick={() => {
                            setBusy(true);
                            setErr(null);
                            setMsg(null);
                            void systemApi
                              .hostNtpSync()
                              .then((r) => {
                                if (r.ok) {
                                  setMsg(r.notes?.join('；') ?? t('system.ntpRequested'));
                                } else {
                                  setErr(
                                    r.blockMessage || r.notes?.join('；') || t('system.ntpFailed'),
                                  );
                                }
                                return refresh();
                              })
                              .catch((e: Error) => setErr(e.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          {host?.time.ntpSynchronized
                            ? t('system.resyncNtp')
                            : t('system.enableNtp')}
                        </Button>
                      </div>
                    </section>
                  </div>

                  {/* Network + disks + shortcuts */}
                  <div className="sys-col">
                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">{t('system.network')}</h3>
                          <p className="sys-panel__sub">
                            {t('system.networkSub')}
                          </p>
                        </div>
                      </header>
                      {!host?.network.interfaces?.length &&
                      (host?.network.ips?.length ?? 0) === 0 ? (
                        <p className="sys-muted">{t('system.noIp')}</p>
                      ) : null}
                      {host?.network.interfaces?.length ? (
                        <ul className="sys-iface">
                          {host.network.interfaces.map((iface) => (
                            <li key={iface.name}>
                              <span className="sys-iface__name">{iface.name}</span>
                              <span className="sys-iface__addrs">
                                {iface.addrs.join(' · ')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {host?.network.resolvers?.length ? (
                        <div className="sys-resolvers">
                          <span className="sys-resolvers__lab">{t('system.dns')}</span>
                          {host.network.resolvers.map((r) => (
                            <code key={r} className="sys-chip-code">
                              {r}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </section>

                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">{t('system.storage')}</h3>
                          <p className="sys-panel__sub">
                            {t('system.storageSub')}{' '}
                            <Link to="/metrics?tab=storage" className="sys-inline-link">
                              {t('system.metricsDetail')}
                            </Link>
                          </p>
                        </div>
                      </header>
                      {!host?.disks?.length ? (
                        <p className="sys-muted">{t('system.noDisk')}</p>
                      ) : (
                        <div className="sys-disks">
                          {host.disks.map((d) => (
                            <div key={`${d.mount}-${d.filesystem}`} className="sys-disk">
                              <div className="sys-disk__head">
                                <code className="sys-disk__mount">{d.mount}</code>
                                <Badge
                                  tone={
                                    d.usePct != null && d.usePct >= 90
                                      ? 'danger'
                                      : d.usePct != null && d.usePct >= 75
                                        ? 'warn'
                                        : 'ok'
                                  }
                                >
                                  {d.usePct != null ? `${d.usePct}%` : '—'}
                                </Badge>
                              </div>
                              <div
                                className="sys-disk__bar"
                                aria-hidden
                              >
                                <div
                                  className={`sys-disk__fill${
                                    d.usePct != null && d.usePct >= 90
                                      ? ' sys-disk__fill--danger'
                                      : d.usePct != null && d.usePct >= 75
                                        ? ' sys-disk__fill--warn'
                                        : ''
                                  }`}
                                  style={{ ['--meter-pct' as string]: `${Math.min(100, d.usePct ?? 0)}%` }}
                                />
                              </div>
                              <div className="sys-disk__meta">
                                <span>
                                  {d.used} / {d.size}
                                </span>
                                <span className="sys-disk__avail">{t('system.avail', { v: d.avail })}</span>
                                <span className="sys-disk__fs">{d.type}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="sys-panel sys-panel--links">
                      <header className="sys-panel__head">
                        <h3 className="sys-panel__title">{t('system.shortcuts')}</h3>
                      </header>
                      <nav className="sys-shortcuts" aria-label={t('system.shortcutsAria')}>
                        <Link to="/services" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scServices')}</span>
                          <span className="sys-shortcut__d">{t('system.scServicesD')}</span>
                        </Link>
                        <Link to="/system/unit" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scUnit')}</span>
                          <span className="sys-shortcut__d">{t('system.scUnitD')}</span>
                        </Link>
                        <Link to="/system/readiness" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scReadiness')}</span>
                          <span className="sys-shortcut__d">{t('system.scReadinessD')}</span>
                        </Link>
                        <Link to="/updates" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scUpdates')}</span>
                          <span className="sys-shortcut__d">{t('system.scUpdatesD')}</span>
                        </Link>
                        <Link to="/metrics" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scMetrics')}</span>
                          <span className="sys-shortcut__d">{t('system.scMetricsD')}</span>
                        </Link>
                        <Link to="/logs" className="sys-shortcut">
                          <span className="sys-shortcut__t">{t('system.scLogs')}</span>
                          <span className="sys-shortcut__d">{t('system.scLogsD')}</span>
                        </Link>
                      </nav>
                    </section>
                  </div>
                </div>

                {/* Power danger zone */}
                <section className="sys-panel sys-panel--danger" id="sys-power">
                  <header className="sys-panel__head">
                    <div>
                      <h3 className="sys-panel__title">{t('system.powerTitle')}</h3>
                      <p className="sys-panel__sub">
                        {t('system.powerWarn')}
                      </p>
                    </div>
                    <Badge tone={host?.caps.canPower && powerUnlocked ? 'ok' : 'warn'}>
                      {host?.caps.canPower && powerUnlocked
                        ? t('system.unlocked')
                        : t('system.locked')}
                    </Badge>
                  </header>

                  {!host?.caps.canPower ? (
                    <div className="sys-callout sys-callout--info">
                      {t('system.powerCaps', { exec: host?.caps.executeEnabled ? t('common.on') : t('common.off'), root: host?.caps.isRoot ? t('common.yes') : t('common.no') })}
                    </div>
                  ) : null}
                  {host?.power.pending ? (
                    <div className="sys-callout sys-callout--danger">
                      {t('system.scheduledPower')}
                      {host.power.pending.actionHint
                        ? `（${host.power.pending.actionHint}）`
                        : ''}
                      {t('system.cancelScheduleHint')}
                    </div>
                  ) : null}

                  <div className="sys-power-actions">
                    <Button
                      variant="secondary"
                      size="md"
                      disabled={!host?.caps.canPower}
                      title={
                        host?.caps.canPower
                          ? powerUnlocked
                            ? t('system.powerLock')
                            : t('system.powerUnlock')
                          : t('system.powerCaps', {
                              exec: host?.caps.executeEnabled ? t('common.on') : t('common.off'),
                              root: host?.caps.isRoot ? t('common.yes') : t('common.no'),
                            })
                      }
                      onClick={() => setPowerUnlocked((v) => !v)}
                    >
                      {powerUnlocked ? t('system.powerLock') : t('system.powerUnlock')}
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower || !powerUnlocked}
                      onClick={() => {
                        setPowerConfirm('');
                        setPowerDlg({
                          action: 'reboot',
                          confirmNeed: 'REBOOT',
                          delaySec: 10 });
                      }}
                    >
                      {t('system.rebootHost')}
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower || !powerUnlocked}
                      onClick={() => {
                        setPowerConfirm('');
                        setPowerDlg({
                          action: 'poweroff',
                          confirmNeed: 'POWEROFF',
                          delaySec: 60 });
                      }}
                    >
                      {t('system.poweroffHost')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower || !powerUnlocked || !host.power.pending}
                      title={
                        !host?.power.pending
                          ? t('system.noScheduledPower')
                          : t('system.cancelSchedule')
                      }
                      onClick={() => {
                        setBusy(true);
                        setErr(null);
                        setMsg(null);
                        void systemApi
                          .hostPower({ action: 'cancel' })
                          .then((r) => {
                            if (r.ok) setMsg(r.notes?.join('；') ?? t('system.cancelled'));
                            else
                              setErr(
                                r.blockMessage || r.notes?.join('；') || t('system.cancelFailed'),
                              );
                            return refresh();
                          })
                          .catch((e: Error) => setErr(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t('system.cancelSchedule')}
                    </Button>
                  </div>
                  <p className="sys-footnote">
                    {t('system.confirmStrings')}
                  </p>
                </section>

                <Modal
                  open={Boolean(powerDlg)}
                  onClose={() => {
                    if (!busy) setPowerDlg(null);
                  }}
                  title={
                    powerDlg?.action === 'reboot' ? t('system.confirmReboot') : t('system.confirmPoweroff')
                  }
                  description={
                    powerDlg?.action === 'reboot'
                      ? t('system.confirmRebootDesc')
                      : t('system.confirmPoweroffDesc')
                  }
                  size="sm"
                  footer={
                    <>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={bindSet(setPowerDlg, null)}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="danger"
                        size="md"
                        loading={busy}
                        disabled={
                          !powerDlg ||
                          powerConfirm.trim() !== powerDlg.confirmNeed
                        }
                        onClick={() => {
                          if (!powerDlg) return;
                          setBusy(true);
                          setErr(null);
                          setMsg(null);
                          void systemApi
                            .hostPower({
                              action: powerDlg.action,
                              confirm: powerConfirm.trim(),
                              delaySec: powerDlg.delaySec })
                            .then((r) => {
                              if (r.ok) {
                                setMsg(
                                  r.notes?.join('；') ?? t('system.sentDisconnect'),
                                );
                                setPowerDlg(null);
                              } else {
                                setErr(
                                  r.blockMessage ||
                                    r.notes?.join('；') ||
                                    t('system.powerFailed'),
                                );
                              }
                            })
                            .catch((e: Error) => setErr(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {powerDlg?.action === 'reboot' ? t('system.confirmRebootBtn') : t('system.confirmPoweroffBtn')}
                      </Button>
                    </>
                  }
                >
                  <Field
                    label={t('system.typeToUnlock', { need: powerDlg?.confirmNeed ?? '' })}
                    htmlFor="power-confirm"
                    flush
                  >
                    <input
                      id="power-confirm"
                      autoComplete="off"
                      value={powerConfirm}
                      onChange={bindInput(setPowerConfirm)}
                      placeholder={powerDlg?.confirmNeed}
                    />
                  </Field>
                </Modal>
              </>
            )}
          </div>
        ) : null}

        {/* ═══════════ EXPORT ═══════════ */}
        {tab === 'export' ? (
          <div className="tab-panel sys sys-export">
            <Alert variant="info">
              {t('system.exportExplain')}
            </Alert>

            <div className="sys-steps">
              {/* Step 1 */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">1</span>
                    <div>
                      <h3 className="sys-panel__title">{t('system.controlSummary')}</h3>
                      <p className="sys-panel__sub">
                        {t('system.controlSummarySub')}
                      </p>
                    </div>
                  </div>
                </header>
                <div className="sys-panel__actions">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      setErr(null);
                      void api
                        .requestRaw<ExportSnapshot>('/api/v1/system/export')
                        .then((r) => {
                          setSnapshot(r);
                          setMsg(t('system.snapshotLoaded', { at: r.exportedAt }));
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('system.previewSummary')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={!snapshot}
                    onClick={() => {
                      if (!snapshot) return;
                      downloadJson(
                        snapshot,
                        `ysk-export-${snapshot.exportedAt.replace(/[:.]/g, '-')}.json`,
                      );
                      setMsg(t('system.downloadedJson'));
                    }}
                  >
                    {t('system.downloadJson')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void runRebuild({ writeExport: true, syncNginx: false })
                    }
                  >
                    {t('system.writeExports')}
                  </Button>
                </div>
                {snapshot ? (
                  <div className="sys-preview">
                    <div className="sys-preview__meta">
                      {t('system.snapshotMeta', { at: formatDateTime(snapshot.exportedAt, { locale: i18n.language, ...hostTimeZoneOpts({ withOffset: true }) }), users: snapshot.users ?? snapshot.counts?.users ?? 0, packages: snapshot.packages ?? snapshot.counts?.packages ?? 0 })}
                    </div>
                    <JsonViewer value={snapshot} maxHeight={260} />
                  </div>
                ) : (
                  <p className="sys-muted">{t('system.previewHint')}</p>
                )}
              </section>

              {/* Step 2 */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">2</span>
                    <div>
                      <h3 className="sys-panel__title">{t('system.managedNginxTitle')}</h3>
                      <p className="sys-panel__sub">
                        {t('system.managedNotEtc')}
                      </p>
                    </div>
                  </div>
                  <Badge tone="neutral">{t('system.nFiles', { count: managed.length })}</Badge>
                </header>
                {managed.length === 0 ? (
                  <EmptyState
                    title={t('system.noManaged')}
                    description={t('system.noManagedDesc')}
                  />
                ) : (
                  <>
                    <div className="sys-conf-list">
                      {managedPageItems.map((c) => {
                        const nginxRole = c.role ?? classifyManagedNginxName(c.name);
                        const canRemove = nginxRole === 'leftover';
                        const locked = !caps.executeEnabled || !caps.isRoot;
                        return (
                        <div key={c.name} className="sys-conf-row">
                          <div className="sys-conf-row__main">
                            <code className="sys-conf-row__name">{c.name}</code>
                            {nginxRole === 'leftover' ? (
                              <Badge tone="warn" title={t('system.nginxLeftoverHint')}>
                                {t('system.nginxLeftover')}
                              </Badge>
                            ) : null}
                            {nginxRole === 'unused' ? (
                              <Badge tone="neutral" title={t('system.nginxUnusedHint')}>
                                {t('system.nginxUnused')}
                              </Badge>
                            ) : null}
                            <span className="sys-conf-row__meta">
                              {formatBytes(c.bytes)}
                              {c.mtime
                                ? ` · ${formatDateTimeLocale(c.mtime, i18n.language)}`
                                : ''}
                            </span>
                          </div>
                          <div className="u-flex u-gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy && confPreviewLoading}
                            onClick={() => openManagedPreview(c)}
                          >
                            {t('system.preview')}
                          </Button>
                          {canRemove ? (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={locked || busy}
                              title={locked ? t('system.needExecuteRoot') : undefined}
                              onClick={() => setLeftoverDelName(c.name)}
                            >
                              {t('system.nginxRemoveLeftover')}
                            </Button>
                          ) : null}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    {managed.length > MANAGED_PAGE_SIZE ? (
                      <div className="sys-conf-pager" role="navigation" aria-label={t('system.managedPager')}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={managedPageSafe <= 0}
                          onClick={() => setManagedPage((p) => Math.max(0, p - 1))}
                        >
                          {t('system.prevPage')}
                        </Button>
                        <span className="sys-conf-pager__meta">
                          {t('system.pageOf', {
                            page: managedPageSafe + 1,
                            total: managedPageCount,
                            count: managed.length,
                          })}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={managedPageSafe >= managedPageCount - 1}
                          onClick={() =>
                            setManagedPage((p) => Math.min(managedPageCount - 1, p + 1))
                          }
                        >
                          {t('system.nextPage')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
                <Modal
                  open={Boolean(confPreview)}
                  onClose={() => {
                    if (!confPreviewLoading) setConfPreview(null);
                  }}
                  title={confPreview?.name ?? t('system.preview')}
                  description={t('system.previewModalDesc')}
                  size="xl"
                  footer={
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={bindSet(setConfPreview, null)}
                    >
                      {t('common.close')}
                    </Button>
                  }
                >
                  {confPreview ? (
                    <LogViewer
                      text={confPreview.content}
                      highlight={false}
                      linkIps={false}
                      maxHeight={480}
                      toolbar={false}
                    />
                  ) : null}
                </Modal>
              </section>

              {/* Step 3 */}
              <section className="sys-panel sys-panel--sync">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">3</span>
                    <div>
                      <h3 className="sys-panel__title">{t('system.syncToSystem')}</h3>
                      <p className="sys-panel__sub">
                        {t('system.syncSub')}
                      </p>
                    </div>
                  </div>
                </header>
                <div className="sys-panel__actions">
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void runRebuild({
                        writeExport: false,
                        syncNginx: false,
                        dryRun: true })
                    }
                  >
                    {t('system.dryRun')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    title={t('system.syncReloadNeedConfirm')}
                    aria-label={t('system.syncReloadNeedConfirm')}
                    onClick={bindSet(setRebuildSyncConfirm, true)}
                  >
                    {t('system.syncReload')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void runRebuild({
                        writeExport: true,
                        syncNginx: false,
                        dryRun: false })
                    }
                  >
                    {t('system.exportOnly')}
                  </Button>
                </div>
                <p className="sys-footnote">
                  {t('system.dryRunNote')}
                </p>
              </section>

              {/* Archives */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div>
                    <h3 className="sys-panel__title">{t('system.exportHistory')}</h3>
                    <p className="sys-panel__sub">
                      {t('system.exportHistorySub')}
                    </p>
                  </div>
                  <Badge tone="neutral">{archives.length}</Badge>
                </header>
                {archives.length === 0 ? (
                  <EmptyState
                    title={t('system.noExports')}
                    description={t('system.noExportsDesc')}
                  />
                ) : (
                  <div className="sys-archive-list">
                    {archives.map((a) => (
                      <div key={a.name} className="sys-archive-row">
                        <div>
                          <code className="sys-conf-row__name">{a.name}</code>
                          <div className="sys-conf-row__meta">
                            {formatBytes(a.bytes)} ·{' '}
                            {formatDateTimeLocale(a.mtime, i18n.language)}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void api
                              .downloadAuthenticated(
                                `/api/v1/system/exports/${encodeURIComponent(a.name)}`,
                                a.name,
                              )
                              .then(() => setMsg(t('system.downloaded', { name: a.name })))
                              .catch((e: Error) => setErr(e.message));
                          }}
                        >
                          {t('system.download')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <OpsResultPanel
              title={t('opsResult.title')}
              result={opsResult}
              busy={busy}
              facts={
                opsResult
                  ? [
                      ...(opsResult.exportPath
                        ? [{ label: t('system.exportPath'), value: opsResult.exportPath }]
                        : []),
                      ...(opsResult.mode
                        ? [{ label: t('system.mode'), value: String(opsResult.mode) }]
                        : []),
                      ...(opsResult.nginxConfDetails
                        ? [
                            {
                              label: t('system.managedConf'),
                              value: String(opsResult.nginxConfDetails.length) },
                          ]
                        : []),
                      ...(opsResult.dryRun
                        ? [
                            {
                              label: t('system.dryRunFlag'),
                              value: t('common.yes') },
                          ]
                        : []),
                    ]
                  : []
              }
            />
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="systemIndex" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={rebuildSyncConfirm}
        onClose={() => !busy && setRebuildSyncConfirm(false)}
        title={t('system.syncConfirmTitle')}
        description={t('system.syncConfirmDesc')}
        confirmLabel={t('system.syncReload')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => {
          setRebuildSyncConfirm(false);
          void runRebuild({
            writeExport: true,
            syncNginx: true,
            dryRun: false });
        }}
      />
      <ConfirmDialog
        open={Boolean(leftoverDelName)}
        onClose={() => !busy && setLeftoverDelName(null)}
        title={t('system.nginxRemoveLeftoverTitle')}
        description={t('system.nginxRemoveLeftoverDesc', { name: leftoverDelName ?? '' })}
        confirmLabel={t('system.nginxRemoveLeftover')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => {
          const name = leftoverDelName;
          setLeftoverDelName(null);
          if (!name) return;
          setBusy(true);
          void api
            .requestRaw<{
              ok: boolean;
              notes?: string[];
              blocked?: boolean;
            }>(`/api/v1/system/managed-nginx/${encodeURIComponent(name)}`, {
              method: 'DELETE',
            })
            .then((r) => {
              if (r.ok) {
                setMsg(t('common.completed'));
              } else {
                setErr((r.notes ?? []).join(' · ') || t('common.deleteFailed'));
              }
              return refreshExportMeta();
            })
            .catch((e: Error) => setErr(e.message))
            .finally(() => setBusy(false));
        }}
      />
      <ConfirmDialog
        open={disableTlsOpen}
        onClose={() => !tlsBusy && setDisableTlsOpen(false)}
        title={t('system.panelTls.disableConfirmTitle')}
        description={t('system.panelTls.disableConfirmDesc')}
        consequences={[
          t('system.panelTls.disablePasskeyWarn'),
          tlsRestart
            ? t('system.panelTls.restartConfirm')
            : t('system.panelTls.disabledNote'),
        ]}
        confirmText="DISABLE-HTTPS"
        severity="critical"
        confirmLabel={t('system.panelTls.disable')}
        busy={tlsBusy}
        onConfirm={() => {
          setDisableTlsOpen(false);
          setTlsBusy(true);
          setErr(null);
          setMsg(null);
          void systemApi
            .panelTlsDisable({ restart: tlsRestart })
            .then((r) => {
              setOpsResult(r as RebuildResult);
              setMsg((r.notes ?? []).join('；'));
              return refresh();
            })
            .catch((e: Error) => setErr(e.message))
            .finally(() => setTlsBusy(false));
        }}
      />
    </FeaturePageLayout>
  );
}
