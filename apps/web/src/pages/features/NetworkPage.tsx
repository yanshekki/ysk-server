/**
 * Host network — redesign with shared UI primitives only.
 * DataTable + ActionBar + FormLayout; no hand-rolled action rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  CheckboxField,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  LoadingBlock,
  Modal,
  OpsResultPanel,
  PageTabs,
  PresetChips } from '../../shared/components/ui';
import { formatDateTime } from '../../shared/lib/datetime';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindCall1, bindCloseIfIdle, bindInput, bindSet, bindSet2, bindSet3, bindVoid } from '../bind-handlers';
import {
  networkApi,
  type NetAddress,
  type NetApplyResult,
  type NetInterface,
  type NetRoute,
  type NetworkSnapshot,
  type RealIpStatusDto } from '../../features/network/api';

const TABS = ['ifaces', 'routes', 'dns', 'realip', 'advanced', 'about'] as const;

export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

export function operTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  const u = s.toUpperCase();
  if (u === 'UP' || u === 'LOOPBACK') return 'ok';
  if (u === 'DOWN') return 'neutral';
  return 'warn';
}

export function operLabelKey(s: string): 'up' | 'down' | 'unknown' | 'other' | 'loopback' {
  const u = String(s ?? '').toUpperCase();
  if (u === 'UP') return 'up';
  if (u === 'DOWN') return 'down';
  if (u === 'LOOPBACK' || u === 'LO') return 'loopback';
  if (u === 'UNKNOWN') return 'unknown';
  return 'other';
}

export function isLoopbackIface(iface: { name?: string; flags?: string[] }): boolean {
  const n = String(iface.name ?? '').toLowerCase();
  if (n === 'lo' || n.startsWith('lo:')) return true;
  return Boolean(iface.flags?.includes('LOOPBACK'));
}

export function isUp(iface: NetInterface): boolean {
  if (isLoopbackIface(iface)) return true;
  const oper = String(iface.operstate ?? '').trim().toUpperCase();
  if (oper === 'UP') return true;
  if (oper === 'DOWN') return false;
  return iface.flags.includes('UP');
}

export function cidrOf(a: { local: string; prefixlen: number }): string {
  return `${a.local}/${a.prefixlen}`;
}

export function joinCidrs(addrs: NetAddress[], family: 'inet' | 'inet6'): string {
  const list = addrs.filter((a) => a.family === family);
  if (!list.length) return '—';
  if (family === 'inet6' && list.length > 2) {
    return `${list
      .slice(0, 2)
      .map(cidrOf)
      .join(' · ')} · +${list.length - 2}`;
  }
  return list.map(cidrOf).join(' · ');
}

const STUB_DNS = new Set(['127.0.0.53', '127.0.0.1', '::1']);

/** Drop resolver stub addresses from DNS server lists. */
export function filterStubDns(servers: string[] | null | undefined): string[] {
  return (servers ?? []).filter((s) => !STUB_DNS.has(s.trim()));
}

/** Parse MTU draft; valid range 576–9000. */
export function parseMtu(raw: string): number | null {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 576 || n > 9000) return null;
  return Math.floor(n);
}

/** Localize CDN provider catalog label (fallback to API English). */
export function realIpProviderLabel(
  id: string,
  fallback: string,
  t: (k: string) => string,
): string {
  const key = `network.realip.providers.${id}`;
  const v = t(key);
  return v === key ? fallback : v;
}

/** Loose CIDR validation for add-address form. */
export function isValidCidr(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(s) ||
    /^[0-9a-fA-F:]+\/\d{1,3}$/.test(s)
  );
}

/** Count interfaces by UP / not-UP. */
export function ifaceCountByState(
  ifaces: Array<{ operstate: string; flags: string[] }>,
): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const i of ifaces) {
    if (isUp(i as NetInterface)) up += 1;
    else down += 1;
  }
  return { up, down };
}

/** Compact route label for tables. */
export function routeLabel(r: {
  dst?: string;
  gateway?: string;
  dev?: string;
}): string {
  const parts = [r.dst, r.gateway ? `via ${r.gateway}` : '', r.dev]
    .map((x) => (x ?? '').trim())
    .filter(Boolean);
  return parts.join(' ') || '—';
}

/** DNS search domain free-text → list. */
export function parseDnsSearch(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Prefer uplink DNS servers when present. */
export function preferUplinkDns(dns: {
  uplinkServers?: string[] | null;
  servers?: string[] | null;
}): string[] {
  const up = dns.uplinkServers?.length ? dns.uplinkServers : dns.servers;
  return filterStubDns(up ?? []);
}

/** Whether down-confirm matches interface name. */
export function matchesDownConfirm(
  ifaceName: string,
  typed: string,
): boolean {
  return ifaceName.trim() === typed.trim() && ifaceName.length > 0;
}

export function NetworkPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'ifaces');
  const [snap, setSnap] = useState<NetworkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastOps, setLastOps] = useState<NetApplyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState<NetInterface | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addIf, setAddIf] = useState('');
  const [cidr, setCidr] = useState('');
  const [addPersist, setAddPersist] = useState(true);
  const [downDlg, setDownDlg] = useState<NetInterface | null>(null);
  const [downConfirm, setDownConfirm] = useState('');
  const [mtuDraft, setMtuDraft] = useState('');

  const [routeDst, setRouteDst] = useState('default');
  const [routeGw, setRouteGw] = useState('');
  const [routeDev, setRouteDev] = useState('');
  /** Save to NetworkManager (survives reboot) */
  const [routePersist, setRoutePersist] = useState(false);
  const [delRoute, setDelRoute] = useState<NetRoute | null>(null);
  const [delRoutePersist, setDelRoutePersist] = useState(true);
  const [delRoutePhrase, setDelRoutePhrase] = useState('');

  /** DNS editor — list of servers (add / edit / remove) */
  const [dnsServers, setDnsServers] = useState<string[]>([]);
  const [dnsSearch, setDnsSearch] = useState('');
  const [dnsIgnoreAuto, setDnsIgnoreAuto] = useState(true);
  const [dnsTestName, setDnsTestName] = useState('example.com');
  const [dnsTestOut, setDnsTestOut] = useState<string[] | null>(null);
  const [dnsPreset, setDnsPreset] = useState('');

  const [realIp, setRealIp] = useState<RealIpStatusDto | null>(null);
  const [realIpProvider, setRealIpProvider] = useState('none');
  const [realIpMode, setRealIpMode] = useState<'single_provider' | 'xff_merged'>(
    'single_provider',
  );
  const [realIpCustomCidrs, setRealIpCustomCidrs] = useState('');
  const [realIpMsg, setRealIpMsg] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawAt, setRawAt] = useState<number | null>(null);

  const loadRealIp = useCallback(async () => {
    try {
      const s = await networkApi.realIpStatus();
      setRealIp(s);
      setRealIpProvider(s.config.defaultProvider || 'none');
      setRealIpMode(s.config.trustMode || 'single_provider');
      setRealIpCustomCidrs((s.config.customCidrs || []).join('\n'));
    } catch (e) {
      setRealIpMsg(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  const syncDnsForm = useCallback((s: NetworkSnapshot) => {
    const stub = new Set(['127.0.0.53', '127.0.0.1', '::1']);
    const raw =
      s.dns.uplinkServers?.length
        ? s.dns.uplinkServers
        : s.dns.nameservers;
    const list = raw.filter((ns) => ns && !stub.has(ns));
    setDnsServers(list.length ? list : ['']);
    setDnsSearch(s.dns.search.join(' '));
    setDnsIgnoreAuto(s.dns.ignoreAutoDns !== false);
    setDnsPreset('');
  }, []);

  const refresh = useCallback(
    async (raw = false) => {
      setLoading(true);
      try {
        const s = await networkApi.snapshot({ raw });
        setSnap(s);
        setRoutePersist(s.backend.networkManager === 'active');
        setError(s.ok ? null : s.notes?.[0] ?? t('network.loadFailed'));
        setDetail((prev) => {
          if (!prev) return null;
          return s.interfaces.find((i) => i.name === prev.name) ?? null;
        });
        syncDnsForm(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('network.loadNetworkFailed'));
      } finally {
        setLoading(false);
      }
    },
    [syncDnsForm],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (tab === 'realip') void loadRealIp();
  }, [tab, loadRealIp]);

  const upCount = useMemo(
    () => snap?.interfaces.filter(isUp).length ?? 0,
    [snap],
  );

  const run = async (fn: () => Promise<NetApplyResult>) => {
    setBusy(true);
    try {
      const r = await fn();
      setLastOps(r);
      await refresh(tab === 'advanced');
      return r;
    } catch (e) {
      const r: NetApplyResult = {
        ok: false,
        notes: [e instanceof Error ? e.message : t('common.opFailed')] };
      setLastOps(r);
      return r;
    } finally {
      setBusy(false);
    }
  };

  const openAdd = (iface: NetInterface) => {
    setAddIf(iface.name);
    setCidr('');
    setAddPersist(true);
    setAddOpen(true);
  };

  const openDetail = (iface: NetInterface) => {
    setDetail(iface);
    setMtuDraft(String(iface.mtu ?? 1500));
  };

  return (
    <FeaturePageLayout
      title={t('nav.network')}
      showCapability={false}
      status={
        snap
          ? {
              pill: {
                label: snap.caps.canMutate ? t('network.canMutate') : t('network.readOnlyBlocked'),
                tone: snap.caps.canMutate ? 'ok' : 'warn' },
              items: [
                { label: t('network.statIfaces'), value: snap.interfaces.length },
                { label: t('network.statUp'), value: upCount, tone: 'ok' as const },
                {
                  label: t('network.statGateway'),
                  value: snap.defaultGateway
                    ? `${snap.defaultGateway}${snap.defaultDev ? ` · ${snap.defaultDev}` : ''}`
                    : '—',
                },
              ] }
          : undefined
      }
      actions={
        <ActionBar size="sm" aria-label={t('network.pageActions')}>
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={bindCall1(refresh, tab === 'advanced')}
          >
            {t('network.refresh')}
          </Button>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !snap ? <LoadingBlock label={t('network.loadingSnap')} /> : null}

      {snap ? (
        <div className="stack">
          {!snap.caps.canMutate ? (
            <Alert variant="warn">{t('network.cannotMutate')}</Alert>
          ) : null}

          {lastOps ? (
            <OpsResultPanel
              title={t('opsResult.title')}
              result={{
                ok: lastOps.ok,
                blocked: lastOps.blocked,
                blockMessage: lastOps.blockMessage,
                notes: lastOps.notes }}
            />
          ) : null}

          <PageTabs
            tabs={[
              {
                id: 'ifaces',
                label: t('network.statIfaces'),
                badge: snap.interfaces.length || undefined },
              {
                id: 'routes',
                label: t('network.tabs.routes'),
                badge: snap.routes.length || undefined },
              {
                id: 'dns',
                label: t('network.tabs.dns'),
                badge: snap.dns.nameservers.length || undefined },
              {
                id: 'realip',
                label: t('network.tabs.realip') },
              { id: 'advanced', label: t('network.tabs.advanced') },
              { id: 'about', label: t('network.tabs.about') },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'ifaces' ? (
              <div className="tab-panel">
                <DataTable<NetInterface>
                  dense
                  rows={snap.interfaces}
                  rowKey={(r) => r.name}
                  empty={<EmptyState title={t('network.noIfaces')} />}
                  columns={[
                    {
                      key: 'name',
                      header: t('network.colName'),
                      nowrap: true,
                      render: (r) => (
                        <>
                          <code>{r.name}</code>
                          {r.isDefaultEgress ? (
                            <>
                              {' '}
                              <Badge tone="info">{t('network.defaultEgressBadge')}</Badge>
                            </>
                          ) : null}
                        </>
                      ),
                    },
                    {
                      key: 'state',
                      header: t('network.colStatus'),
                      nowrap: true,
                      render: (r) => {
                        const key = isLoopbackIface(r)
                          ? 'loopback'
                          : isUp(r)
                            ? 'up'
                            : operLabelKey(r.operstate);
                        return (
                        <Badge
                          tone={
                            isLoopbackIface(r) || isUp(r)
                              ? 'ok'
                              : operTone(r.operstate)
                          }
                          title={
                            isLoopbackIface(r)
                              ? t('network.oper.loopbackHint')
                              : String(r.operstate).toUpperCase() === 'UNKNOWN'
                                ? t('network.operUnknownHint')
                                : r.operstate
                          }
                        >
                          <span title={r.operstate}>
                            {t(`network.oper.${key}`)}
                          </span>
                        </Badge>
                        );
                      },
                    },
                    {
                      key: 'v4',
                      header: 'IPv4',
                      render: (r) => (
                        <code className="u-text-sm">{joinCidrs(r.addrs, 'inet')}</code>
                      ),
                    },
                    {
                      key: 'v6',
                      header: 'IPv6',
                      render: (r) => (
                        <code className="u-text-sm muted">
                          {joinCidrs(r.addrs, 'inet6')}
                        </code>
                      ),
                    },
                  ]}
                  rowActions={(r) => (
                    <ActionBar
                      size="sm"
                      wrap={false}
                      aria-label={t('network.opsAria', { name: r.name })}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={bindCall1(openDetail, r)}
                      >
                        {t('network.details')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || r.isLoopback || r.name === 'lo'}
                        title={
                          r.isLoopback || r.name === 'lo'
                            ? t('network.loopbackImmutable')
                            : t('network.addIp')
                        }
                        onClick={bindCall1(openAdd, r)}
                      >
                        {t('network.addIp')}
                      </Button>
                      {isUp(r) ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy || r.isLoopback || r.name === 'lo'}
                          title={
                            r.isLoopback || r.name === 'lo'
                              ? t('network.loopbackImmutable')
                              : r.isDefaultEgress
                                ? t('network.defaultRouteDownNeedName')
                                : t('network.linkDownNeedConfirm', {
                                    defaultValue: t('network.confirmDown'),
                                  })
                          }
                          onClick={bindSet2(setDownConfirm, '', setDownDlg, r)}
                        >
                          {r.isDefaultEgress
                            ? t('network.linkDownDefault')
                            : t('network.linkDown')}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy || r.isLoopback || r.name === 'lo'}
                          title={
                            r.isLoopback || r.name === 'lo'
                              ? t('network.loopbackImmutable')
                              : t('network.linkUp')
                          }
                          onClick={() =>
                            void run(() =>
                              networkApi.setLink(r.name, { action: 'up' }),
                            )
                          }
                        >
                          {t('network.linkUp')}
                        </Button>
                      )}
                    </ActionBar>
                  )}
                />
              </div>
            ) : null}

            {tab === 'routes' ? (
              <div className="tab-panel stack">
                <DataTable<NetRoute>
                  dense
                  rows={snap.routes}
                  rowKey={(r, i) =>
                    `${r.dst}-${r.gateway ?? ''}-${r.dev ?? ''}-${i}`
                  }
                  empty={<EmptyState title={t('network.noRoutes')} />}
                  columns={[
                    {
                      key: 'dst',
                      header: t('network.colDest'),
                      render: (r) => (
                        <>
                          <code>{r.dst}</code>{' '}
                          {r.dst === 'default' || r.dst === '0.0.0.0/0' ? (
                            <Badge tone="info">default</Badge>
                          ) : null}
                        </>
                      ) },
                    {
                      key: 'gw',
                      header: 'Gateway',
                      render: (r) => r.gateway ?? '—' },
                    {
                      key: 'dev',
                      header: 'Dev',
                      nowrap: true,
                      render: (r) =>
                        r.dev ? <code>{r.dev}</code> : '—' },
                    {
                      key: 'proto',
                      header: 'Proto',
                      render: (r) => (
                        <span className="muted">{r.protocol ?? '—'}</span>
                      ) },
                    {
                      key: 'metric',
                      header: 'Metric',
                      nowrap: true,
                      render: (r) => r.metric ?? '—' },
                  ]}
                  rowActions={(r) => (
                    <ActionBar size="sm" wrap={false}>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        title={
                          r.dst === 'default' || r.dst === '0.0.0.0/0'
                            ? t('network.deleteDefaultNeedConfirm')
                            : t('network.deleteRouteNeedConfirm')
                        }
                        aria-label={
                          r.dst === 'default' || r.dst === '0.0.0.0/0'
                            ? t('network.deleteDefaultNeedConfirm')
                            : t('network.deleteRouteNeedConfirm')
                        }
                        onClick={() => {
                          setDelRoutePhrase('');
                          setDelRoute(r);
                        }}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  )}
                />

                <Card>
                  <CardHeader
                    title={t('network.addRoute')}
                    description={
                      routePersist
                        ? t('network.persistNm')
                        : t('network.ephemeralRoute')
                    }
                  />
                  <FormLayout columns={2}>
                    <Field label={t('network.colDest')} htmlFor="net-route-dst">
                      <input
                        id="net-route-dst"
                        value={routeDst}
                        onChange={bindInput(setRouteDst)}
                        placeholder={t('network.destPlaceholder')}
                      />
                    </Field>
                    <Field label={t('network.gateway')} htmlFor="net-route-gw">
                      <input
                        id="net-route-gw"
                        value={routeGw}
                        onChange={bindInput(setRouteGw)}
                        placeholder={
                          snap.defaultGateway || '192.168.1.1'
                        }
                      />
                    </Field>
                    <Field
                      label={t('network.devOptional')}
                      htmlFor="net-route-dev"
                      hint={
                        snap.defaultDev
                          ? t('network.defaultDev', { dev: snap.defaultDev })
                          : undefined
                      }
                      fullWidth
                    >
                      <input
                        id="net-route-dev"
                        value={routeDev}
                        onChange={bindInput(setRouteDev)}
                        placeholder={snap.defaultDev || 'eth0'}
                      />
                    </Field>
                    <CheckboxField
                      id="net-route-persist"
                      label={t('network.saveNm')}
                      description={
                        snap.backend.networkManager === 'active'
                          ? t('network.ephemeralHint')
                          : t('network.nmUnavailable')
                      }
                      checked={routePersist}
                      onChange={setRoutePersist}
                      disabled={busy || snap.backend.networkManager !== 'active'}
                    />
                  </FormLayout>
                  <FormActions align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRouteDst('default');
                        setRouteGw(snap.defaultGateway || '');
                        setRouteDev(snap.defaultDev || '');
                        setRoutePersist(snap.backend.networkManager === 'active');
                      }}
                    >
                      {t('network.reset')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate}
                      onClick={() => {
                        const isDef =
                          routeDst.trim() === 'default' ||
                          routeDst.trim() === '0.0.0.0/0';
                        void run(() =>
                          networkApi.addRoute({
                            dst: routeDst.trim() || 'default',
                            gateway: routeGw.trim() || undefined,
                            dev:
                              routeDev.trim() ||
                              snap.defaultDev ||
                              undefined,
                            confirmDefault: isDef,
                            persistent: false }),
                        );
                      }}
                    >
                      {t('network.ephemeralOnly')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate}
                      onClick={() => {
                        const isDef =
                          routeDst.trim() === 'default' ||
                          routeDst.trim() === '0.0.0.0/0';
                        void run(() =>
                          networkApi.addRoute({
                            dst: routeDst.trim() || 'default',
                            gateway: routeGw.trim() || undefined,
                            dev:
                              routeDev.trim() ||
                              snap.defaultDev ||
                              undefined,
                            confirmDefault: isDef,
                            persistent: routePersist }),
                        );
                      }}
                    >
                      {routePersist ? t('network.saveRoute') : t('network.addRoute')}
                    </Button>
                  </FormActions>
                  <FormHint>
                    {t('network.saveRouteHint')}
                  </FormHint>
                </Card>
              </div>
            ) : null}

            {tab === 'dns' ? (
              <div className="tab-panel stack">
                <Card>
                  <CardHeader
                    title={t('network.dnsSettings')}
                    description={
                      snap.dns.canApply
                        ? t('network.dnsNmHint', { conn: snap.dns.connection })
                        : t('network.dnsCannotApply')
                    }
                  />
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: t('network.mode'),
                        value: snap.dns.mode ?? '—' },
                      {
                        label: t('network.connection'),
                        value: snap.dns.connection
                          ? `${snap.dns.connection}${snap.dns.device ? ` · ${snap.dns.device}` : ''}`
                          : '—' },
                      {
                        label: t('network.source'),
                        value: snap.dns.source },
                      {
                        label: t('network.ignoreAutoDns'),
                        value:
                          snap.dns.ignoreAutoDns == null
                            ? '—'
                            : snap.dns.ignoreAutoDns
                              ? t('network.ignoreYes')
                              : t('network.ignoreNo') },
                    ]}
                  />
                </Card>

                <Card>
                  <CardHeader
                    title={t('network.nameservers')}
                    description={t('network.nameserverEditHint')}
                  />
                  <div className="u-mb-3">
                    <PresetChips
                      options={[
                        {
                          value: '1.1.1.1,1.0.0.1',
                          label: 'Cloudflare' },
                        {
                          value: '8.8.8.8,8.8.4.4',
                          label: 'Google' },
                        {
                          value: '9.9.9.9,149.112.112.112',
                          label: 'Quad9' },
                        ...(snap.dns.gatewayDns
                          ? [
                              {
                                value: snap.dns.gatewayDns,
                                label: t('network.routerDns', { dns: snap.dns.gatewayDns }) },
                            ]
                          : []),
                        {
                          value: (
                            snap.dns.uplinkServers?.length
                              ? snap.dns.uplinkServers
                              : snap.dns.nameservers
                          )
                            .filter(
                              (ns) =>
                                ns &&
                                ns !== '127.0.0.53' &&
                                ns !== '127.0.0.1',
                            )
                            .join(','),
                          label: t('network.current') },
                      ]}
                      value={dnsPreset}
                      onChange={(v) => {
                        setDnsPreset(v);
                        if (v) {
                          const list = v
                            .split(/[,\n\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setDnsServers(list.length ? list : ['']);
                          setDnsIgnoreAuto(true);
                        }
                      }}
                      disabled={busy}
                    />
                  </div>

                  <DataTable<{ id: string; value: string; index: number }>
                    title={t('network.serverList')}
                    dense
                    rows={dnsServers.map((value, index) => ({
                      id: `dns-${index}`,
                      value,
                      index }))}
                    rowKey={(r) => r.id}
                    empty={
                      <EmptyState
                        title={t('network.emptyDnsTitle')}
                        description={t('network.emptyDnsDesc')}
                      />
                    }
                    toolbar={
                      <ActionBar size="sm" wrap={false}>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy || dnsServers.length >= 8}
                          onClick={() => {
                            setDnsServers((prev) =>
                              prev.length >= 8 ? prev : [...prev, ''],
                            );
                            setDnsPreset('');
                          }}
                        >
                          {t('network.addServer')}
                        </Button>
                      </ActionBar>
                    }
                    columns={[
                      {
                        key: 'idx',
                        header: '#',
                        nowrap: true,
                        render: (r) => (
                          <span className="muted">{r.index + 1}</span>
                        ) },
                      {
                        key: 'ip',
                        header: 'IP',
                        render: (r) => (
                          <input
                            className="toolbar-field-input"
                            aria-label={`DNS ${r.index + 1}`}
                            value={r.value}
                            placeholder="1.1.1.1"
                            disabled={busy}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDnsServers((prev) =>
                                prev.map((x, i) =>
                                  i === r.index ? v : x,
                                ),
                              );
                              setDnsPreset('');
                            }}
                          />
                        ) },
                    ]}
                    rowActions={(r) => (
                      <ActionBar size="sm" wrap={false}>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy || dnsServers.length <= 1}
                          title={
                            dnsServers.length <= 1
                              ? t('network.keepOneRow')
                              : t('network.removeServer')
                          }
                          onClick={() => {
                            setDnsServers((prev) => {
                              if (prev.length <= 1) return [''];
                              return prev.filter((_, i) => i !== r.index);
                            });
                            setDnsPreset('');
                          }}
                        >
                          {t('network.deleteShort')}
                        </Button>
                      </ActionBar>
                    )}
                  />

                  <FormLayout>
                    <Field
                      label={t('network.searchDomains')}
                      htmlFor="net-dns-search"
                      hint={t('network.searchDomainsPlaceholder')}
                      fullWidth
                    >
                      <input
                        id="net-dns-search"
                        value={dnsSearch}
                        onChange={bindInput(setDnsSearch)}
                        placeholder="lan local"
                        disabled={busy}
                      />
                    </Field>
                    <CheckboxField
                      id="net-dns-ignore-auto"
                      label={t('network.ignoreDhcpDns')}
                      description={t('network.restoreDhcpHint')}
                      checked={dnsIgnoreAuto}
                      onChange={setDnsIgnoreAuto}
                      disabled={busy}
                    />
                  </FormLayout>
                  <FormActions align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={bindCall1(syncDnsForm, snap)}
                    >
                      {t('network.resetForm')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate || !snap.dns.canApply}
                      title={
                        !snap.dns.canApply ? t('network.noNmConnection') : undefined
                      }
                      onClick={() =>
                        void run(() =>
                          networkApi.setDns({
                            mode: 'dhcp',
                            connection: snap.dns.connection,
                            device: snap.dns.device }),
                        )
                      }
                    >
                      {t('network.restoreDhcpDns')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate || !snap.dns.canApply}
                      title={
                        !snap.dns.canApply ? t('network.noNmConnection') : undefined
                      }
                      onClick={() => {
                        const nameservers = dnsServers
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .filter(
                            (s) =>
                              s !== '127.0.0.53' &&
                              s !== '127.0.0.1' &&
                              s !== '::1',
                          );
                        void run(() =>
                          networkApi.setDns({
                            mode: 'static',
                            nameservers,
                            search: dnsSearch
                              .split(/[\s,]+/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                            connection: snap.dns.connection,
                            device: snap.dns.device }),
                        );
                      }}
                    >
                      {t('network.applyDns')}
                    </Button>
                  </FormActions>
                  {!snap.caps.canMutate || !snap.dns.canApply ? (
                    <FormHint>
                      {!snap.dns.canApply
                        ? t('network.noNmConnection')
                        : t('network.needExecuteRoot')}
                    </FormHint>
                  ) : (
                    <FormHint>
                      {t('network.applyDnsNotes')}
                    </FormHint>
                  )}
                </Card>

                <Card>
                  <CardHeader
                    title={t('network.resolveTest')}
                    description={t('network.resolveTestDesc')}
                  />
                  <FormLayout columns={2}>
                    <Field label={t('network.hostname')} htmlFor="net-dns-test">
                      <input
                        id="net-dns-test"
                        value={dnsTestName}
                        onChange={bindInput(setDnsTestName)}
                        placeholder="example.com"
                      />
                    </Field>
                  </FormLayout>
                  <FormActions align="end">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true);
                          try {
                            const r = await networkApi.testDns({
                              name: dnsTestName.trim() || 'example.com' });
                            setLastOps(r);
                            setDnsTestOut(
                              (r as NetApplyResult & { answers?: string[] })
                                .answers ?? r.notes,
                            );
                          } catch (e) {
                            setLastOps({
                              ok: false,
                              notes: [
                                e instanceof Error ? e.message : t('network.testFailed'),
                              ] });
                            setDnsTestOut(null);
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      {t('network.testResolve')}
                    </Button>
                  </FormActions>
                  {dnsTestOut?.length ? (
                    <CodeBlock spaced>{dnsTestOut.join('\n')}</CodeBlock>
                  ) : null}
                </Card>

                {snap.dns.notes?.length ? (
                  <FormHint>{snap.dns.notes.join(' · ')}</FormHint>
                ) : null}
              </div>
            ) : null}

            {tab === 'advanced' ? (
              <div className="tab-panel stack">
                <Card>
                  <CardHeader
                    title={t('network.backend')}
                    description={t('network.stackDetect')}
                    actions={
                      <ActionBar size="sm">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={loading}
                          onClick={() => {
                            if (rawOpen) {
                              setRawOpen(false);
                              return;
                            }
                            void refresh(true).then(() => {
                              setRawOpen(true);
                              setRawAt(Date.now());
                            });
                          }}
                        >
                          {rawOpen ? t('network.hideRaw') : t('network.loadRaw')}
                        </Button>
                      </ActionBar>
                    }
                  />
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: 'iproute2',
                        value: snap.backend.hasIp ? t('network.available') : t('network.unavailable') },
                      {
                        label: 'NetworkManager',
                        value:
                          snap.backend.networkManager === 'active'
                            ? t('common.running')
                            : snap.backend.networkManager === 'inactive'
                              ? t('common.stopped')
                              : snap.backend.networkManager },
                      {
                        label: 'systemd-networkd',
                        value:
                          snap.backend.networkd === 'active'
                            ? t('common.running')
                            : snap.backend.networkd === 'inactive'
                              ? t('common.stopped')
                              : snap.backend.networkd },
                      {
                        label: t('network.persistNmCap'),
                        value: snap.backend.canPersist ? t('common.yes') : t('common.no') },
                    ]}
                  />
                  <FormHint>{t('network.persistNmHint')}</FormHint>
                  {snap.notes?.length ? (
                    <FormHint>{snap.notes.join(' · ')}</FormHint>
                  ) : null}
                </Card>
                {rawOpen && snap.raw?.addr ? (
                  <Card>
                    <CardHeader
                      title="ip addr"
                      description={
                        rawAt
                          ? t('network.rawLoadedAt', {
                              time: formatDateTime(rawAt),
                            })
                          : undefined
                      }
                    />
                    <CodeBlock>{snap.raw.addr}</CodeBlock>
                  </Card>
                ) : null}
                {rawOpen && snap.raw?.route ? (
                  <Card>
                    <CardHeader title="ip route" />
                    <CodeBlock>{snap.raw.route}</CodeBlock>
                  </Card>
                ) : null}
              </div>
            ) : null}

            {tab === 'realip' ? (
              <div className="tab-panel">
                <Card>
                  <CardHeader
                    title={t('network.realip.title')}
                    description={t('network.realip.desc')}
                  />
                  <Alert variant="warn">{t('network.realip.spoofWarn')}</Alert>
                  {realIpMsg ? <Alert variant="info">{realIpMsg}</Alert> : null}
                  <FormLayout>
                    <Field
                      label={t('network.realip.provider')}
                      htmlFor="rip-prov"
                      hint={t('network.realip.providerHint')}
                      flush
                    >
                      <select
                        id="rip-prov"
                        className="input"
                        value={realIpProvider}
                        onChange={(e) => setRealIpProvider(e.target.value)}
                      >
                        {(realIp?.catalog ?? [
                          { id: 'none', label: 'None', clientIpHeader: '' },
                          {
                            id: 'cloudflare',
                            label: 'Cloudflare',
                            clientIpHeader: 'CF-Connecting-IP',
                          },
                        ]).map((p) => (
                          <option key={p.id} value={p.id}>
                            {realIpProviderLabel(p.id, p.label, t)}
                            {p.clientIpHeader ? ` (${p.clientIpHeader})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label={t('network.realip.mode')}
                      htmlFor="rip-mode"
                      flush
                    >
                      <select
                        id="rip-mode"
                        className="input"
                        value={realIpMode}
                        onChange={(e) =>
                          setRealIpMode(e.target.value as 'single_provider' | 'xff_merged')
                        }
                      >
                        <option value="single_provider">
                          {t('network.realip.modeSingle')}
                        </option>
                        <option value="xff_merged">
                          {t('network.realip.modeXff')}
                        </option>
                      </select>
                    </Field>
                    <Field
                      label={t('network.realip.customCidrs')}
                      htmlFor="rip-cidr"
                      hint={t('network.realip.customCidrsHint')}
                      flush
                    >
                      <textarea
                        id="rip-cidr"
                        className="input"
                        rows={4}
                        value={realIpCustomCidrs}
                        onChange={(e) => setRealIpCustomCidrs(e.target.value)}
                        placeholder="203.0.113.0/24"
                      />
                    </Field>
                  </FormLayout>
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: t('network.realip.lastRefresh'),
                        value: realIp?.config?.lastRefreshAt || '—',
                      },
                      {
                        label: t('network.realip.active'),
                        value: realIp?.config?.defaultProvider
                          ? realIpProviderLabel(
                              realIp?.config?.defaultProvider,
                              realIp?.config?.defaultProvider,
                              t,
                            )
                          : '—',
                      },
                    ]}
                  />
                  <FormActions>
                    <Button
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true);
                          setRealIpMsg(null);
                          try {
                            const r = await networkApi.patchRealIp({
                              defaultProvider: realIpProvider,
                              trustMode: realIpMode,
                              customCidrs: realIpCustomCidrs
                                .split(/[\n,]+/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                              enableApacheRemoteIp: true,
                            });
                            setRealIpMsg(r.notes?.join('；') || t('common.savedOk'));
                            await loadRealIp();
                          } catch (e) {
                            setRealIpMsg(
                              e instanceof Error ? e.message : t('common.saveFailed'),
                            );
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      {t('common.save')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      loading={busy}
                      disabled={!realIpProvider || realIpProvider === 'none'}
                      title={
                        !realIpProvider || realIpProvider === 'none'
                          ? t('network.realip.needProvider')
                          : undefined
                      }
                      onClick={() => {
                        void (async () => {
                          setBusy(true);
                          setRealIpMsg(null);
                          try {
                            const r = await networkApi.refreshRealIp();
                            setRealIpMsg(
                              r.notes?.join('；') || t('network.realip.refreshOk'),
                            );
                            await loadRealIp();
                          } catch (e) {
                            setRealIpMsg(
                              e instanceof Error ? e.message : t('common.applyFailed'),
                            );
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      {t('network.realip.refresh')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => void loadRealIp()}
                    >
                      {t('common.refresh')}
                    </Button>
                  </FormActions>
                </Card>
              </div>
            ) : null}

{tab === 'about' ? <PageGuide guideId="network" /> : null}
          </PageTabs>
        </div>
      ) : null}

      {/* Detail */}
      <Modal
        open={detail != null}
        onClose={bindSet(setDetail, null)}
        title={detail ? t('network.ifaceDetail', { name: detail.name }) : t('network.statIfaces')}
        size="lg"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              onClick={bindSet(setDetail, null)}
            >
              {t('common.close')}
            </Button>
          </ActionBar>
        }
      >
        {detail ? (
          <div className="stack">
            <DescriptionList
              columns={2}
              items={[
                {
                  label: t('network.colStatus'),
                  value: t(`network.oper.${operLabelKey(detail.operstate)}`),
                },
                { label: 'ifindex', value: detail.ifindex },
                { label: 'MAC', value: detail.mac ?? '—' },
                { label: 'MTU', value: detail.mtu ?? '—' },
                { label: t('network.type'), value: detail.linkType ?? '—' },
                {
                  label: 'Flags',
                  value: detail.flags.join(', ') || '—' },
                ...(detail.stats
                  ? [
                      {
                        label: 'RX',
                        value: `${formatBytes(detail.stats.rxBytes)} · ${detail.stats.rxPackets} pkt` },
                      {
                        label: 'TX',
                        value: `${formatBytes(detail.stats.txBytes)} · ${detail.stats.txPackets} pkt` },
                    ]
                  : []),
              ]}
            />

            <DataTable<NetAddress>
              title={t('network.addresses')}
              dense
              rows={detail.addrs}
              rowKey={(a) => cidrOf(a)}
              empty={<EmptyState title={t('network.noAddresses')} />}
              toolbar={
                detail.isLoopback ? undefined : (
                  <ActionBar
                    size="sm"
                    wrap={false}
                    aria-label={t('network.ifaceAdjust')}
                  >
                    <label className="toolbar-field" htmlFor="net-mtu-input">
                      <span>MTU</span>
                      <input
                        id="net-mtu-input"
                        type="number"
                        min={68}
                        max={65535}
                        value={mtuDraft}
                        onChange={bindInput(setMtuDraft)}
                        disabled={busy}
                      />
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => {
                        const mtu = Number(mtuDraft);
                        void run(() =>
                          networkApi.setLink(detail.name, { mtu }),
                        );
                      }}
                    >
                      {t('common.apply')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={bindCall1(openAdd, detail)}
                    >
                      {t('network.addIp')}
                    </Button>
                  </ActionBar>
                )
              }
              columns={[
                {
                  key: 'cidr',
                  header: 'CIDR',
                  render: (a) => <code>{cidrOf(a)}</code> },
                {
                  key: 'family',
                  header: 'Family',
                  render: (a) => a.family },
                {
                  key: 'scope',
                  header: 'Scope',
                  render: (a) => (
                    <span className="muted">{a.scope ?? '—'}</span>
                  ) },
              ]}
              rowActions={(a) => (
                <ActionBar size="sm" wrap={false}>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={
                      busy ||
                      detail.isLoopback ||
                      a.local === '127.0.0.1' ||
                      a.local === '::1'
                    }
                    onClick={() =>
                      void run(() =>
                        networkApi.delAddr(detail.name, {
                          cidr: cidrOf(a),
                          persistent: true }),
                      )
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
          </div>
        ) : null}
      </Modal>

      {/* Add IP */}
      <Modal
        open={addOpen}
        onClose={bindCloseIfIdle(busy, bindSet(setAddOpen, false))}
        title={t('network.addIpTitle', { name: addIf })}
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setAddOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(() =>
                  networkApi.addAddr(addIf, {
                    cidr: cidr.trim(),
                    persistent: false }),
                ).then((r) => {
                  if (r.ok) setAddOpen(false);
                });
              }}
            >
              {t('network.ephemeralOnly')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(() =>
                  networkApi.addAddr(addIf, {
                    cidr: cidr.trim(),
                    persistent: addPersist }),
                ).then((r) => {
                  if (r.ok) setAddOpen(false);
                });
              }}
            >
              {addPersist ? t('network.saveIp') : t('network.add')}
            </Button>
          </ActionBar>
        }
      >
        <FormLayout>
          <Field
            label={t('network.cidr')}
            htmlFor="net-add-cidr"
            hint={t('network.cidrPlaceholder')}
          >
            <input
              id="net-add-cidr"
              value={cidr}
              onChange={bindInput(setCidr)}
              placeholder="192.168.1.50/24"
              autoFocus
            />
          </Field>
          <CheckboxField
            id="net-add-persist"
            label={t('network.saveNm')}
            description={t('network.saveIpHint')}
            checked={addPersist}
            onChange={setAddPersist}
            disabled={busy}
          />
        </FormLayout>
      </Modal>

      {/* Down — typed confirm */}
      <Modal
        open={downDlg != null}
        onClose={bindCloseIfIdle(busy, bindSet(setDownDlg, null))}
        title={
          downDlg
            ? t('network.linkDownTitle', {
                name: downDlg.name,
                defaultValue: t('network.linkDown'),
              })
            : t('network.linkDown')
        }
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setDownDlg, null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              disabled={!downDlg || downConfirm !== downDlg.name}
              onClick={() => {
                if (!downDlg) return;
                void run(() =>
                  networkApi.setLink(downDlg.name, {
                    action: 'down',
                    confirmName: downConfirm }),
                ).then((r) => {
                  if (r.ok) setDownDlg(null);
                });
              }}
            >
              {t('network.confirmDown')}
            </Button>
          </ActionBar>
        }
      >
        {downDlg?.isDefaultEgress ? (
          <Alert variant="error">
            {t('network.defaultRouteDownWarn')}
          </Alert>
        ) : null}
        <FormLayout>
          <Field
            label={t('network.confirmIfaceName', { name: downDlg?.name ?? '' })}
            htmlFor="net-down-confirm"
          >
            <input
              id="net-down-confirm"
              value={downConfirm}
              onChange={bindInput(setDownConfirm)}
              placeholder={downDlg?.name}
              autoFocus
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Delete route — optional also remove from NM profile */}
      <Modal
        open={delRoute != null}
        onClose={bindCloseIfIdle(busy, bindSet(setDelRoute, null))}
        title={t('network.deleteRouteTitle')}
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setDelRoute, null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              disabled={
                Boolean(delRoute) &&
                (delRoute!.dst === 'default' || delRoute!.dst === '0.0.0.0/0') &&
                delRoutePhrase.trim() !== 'DEFAULT'
              }
              onClick={() => {
                if (!delRoute) return;
                const isDef =
                  delRoute.dst === 'default' ||
                  delRoute.dst === '0.0.0.0/0';
                if (isDef && delRoutePhrase.trim() !== 'DEFAULT') return;
                void run(() =>
                  networkApi.delRoute({
                    dst: delRoute.dst,
                    gateway: delRoute.gateway,
                    dev: delRoute.dev,
                    confirmDefault: isDef,
                    persistent: delRoutePersist }),
                ).then((r) => {
                  if (r.ok) setDelRoute(null);
                });
              }}
            >
              {t('common.delete')}
            </Button>
          </ActionBar>
        }
      >
        {delRoute ? (
          <div className="stack">
            <p className="u-text-sm">
              <code>{delRoute.dst}</code>
              {delRoute.gateway ? ` via ${delRoute.gateway}` : ''}
              {delRoute.dev ? ` dev ${delRoute.dev}` : ''}
            </p>
            {delRoute.dst === 'default' || delRoute.dst === '0.0.0.0/0' ? (
              <>
                <Alert variant="error">{t('network.deleteDefaultPanelWarn')}</Alert>
                <Field
                  label={t('network.typeDefaultToConfirm')}
                  htmlFor="net-del-default-phrase"
                >
                  <input
                    id="net-del-default-phrase"
                    value={delRoutePhrase}
                    onChange={bindInput(setDelRoutePhrase)}
                    placeholder="DEFAULT"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </>
            ) : (
              <p className="u-text-sm">{t('network.deleteDefaultMayDrop')}</p>
            )}
            <CheckboxField
              id="net-del-route-persist"
              label={t('network.alsoRemoveNm')}
              checked={delRoutePersist}
              onChange={setDelRoutePersist}
              disabled={busy}
            />
          </div>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}
