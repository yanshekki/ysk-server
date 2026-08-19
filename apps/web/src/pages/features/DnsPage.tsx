import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../../shared/lib/datetime';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  DataTable,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  PageTabs,
  FormActions,
  FormHint,
  PresetChips,
  SegRadio,
  ServerListFilters,
  buttonClassName } from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';

const DNS_TABS = ['zones', 'records', 'cluster', 'dnssec', 'tools', 'stack', 'about'] as const;
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { api } from '../../shared/services/api';
import { emailApi } from '../../features/email/api';
import { authStore } from '../../shared/stores/auth-store';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { ServiceLifecycleBar } from '../../features/system/ServiceLifecycleBar';
import { pickDnsStartFailureNotes } from './dns-start-notes';
import { toast } from '../../shared/stores/toast-store';
import { bindCall1, bindCloseIfIdle, bindConfirmThen, bindFormSubmit, bindInput, bindRemoveIf, bindSelect, bindSet, bindSet2, bindSet3, bindValueSet, bindVoid, bindVoidCall2 } from '../bind-handlers';

type DnsHealth = {
  ok: boolean;
  unit: string;
  unitActive: boolean;
  listenUdp53: boolean;
  listenTcp53: boolean;
  zoneFiles: number;
  pdnsZoneCount?: number;
  pdnsZones?: string[];
  latestZoneWriteAt?: string;
  latestZone?: string;
  answeringLocal?: boolean;
  digAnswers?: string[];
  digNotes?: string[];
  answeringLocalA?: boolean;
  digAName?: string;
  digAAnswers?: string[];
  publicNs?: string[];
  publicNsPointsHere?: boolean;
  states: {
    service: string;
    listen: string;
    written: string;
    loaded?: string;
    answering: string;
    publicNs?: string;
  };
  notes: string[];
};

function toneBadge(tone: string | undefined): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (tone === 'ok') return 'ok';
  if (tone === 'warn') return 'warn';
  if (tone === 'danger') return 'danger';
  return 'neutral';
}

const ZONE_TEMPLATE_IDS = ['minimal', 'web', 'mail', 'full', 'cdn'] as const;

export type ZoneTemplateId = (typeof ZONE_TEMPLATE_IDS)[number];

export function parseDnsTtl(
  v: string | number | undefined | null,
  fallback = 300,
): number {
  return Number(v) || fallback;
}

export function isZoneTemplateId(id: string): id is ZoneTemplateId {
  return (ZONE_TEMPLATE_IDS as readonly string[]).includes(id);
}

export function mapRecordsForValidate(
  items: Array<Record<string, unknown>>,
): Array<{ type: string; name: string; value: string; ttl: number }> {
  return items.map((r) => ({
    type: String(r.type ?? ''),
    name: String(r.name ?? '@'),
    value: String(r.value ?? ''),
    ttl: parseDnsTtl(r.ttl as string | number | undefined) }));
}

/** Build human message from DNS validate API issues/notes. */
export function missingMailDomains<T extends { domain: string }>(
  mailDomains: T[],
  allZones: Array<Record<string, unknown>>,
): T[] {
  const have = new Set(
    allZones.map((z) => String(z.zone ?? '').trim().toLowerCase()).filter(Boolean),
  );
  return mailDomains.filter((d) => d.domain && !have.has(d.domain.trim().toLowerCase()));
}

export function notesSayDigMissing(notes: string[] | undefined): boolean {
  return (notes ?? []).some((n) =>
    /YSK_NO_DIG|dig not installed|dig is not installed|dig 未安裝/i.test(n),
  );
}

export function formatDnsValidateMessage(
  check: {
    ok: boolean;
    issues?: Array<{ level: string; message: string }>;
    notes?: string[];
  },
  fallback: string,
): string {
  return (
    check.issues
      ?.filter((i) => i.level === 'error')
      .map((i) => i.message)
      .join('；') ||
    check.notes?.join('；') ||
    fallback
  );
}

export function DnsPage() {
  const { t } = useTranslation();
  const zones = useResourceCrud('dns/zones');
  const [selectedZone, setSelectedZone] = useState<ResourceRow | null>(null);
  const recordsQuery = useMemo(
    () => (selectedZone ? { zoneId: selectedZone.id } : undefined),
    [selectedZone],
  );
  const records = useResourceCrud('dns/records', recordsQuery);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [editRec, setEditRec] = useState<ResourceRow | null>(null);
  const [delZone, setDelZone] = useState<{ id: string; name: string } | null>(null);
  const [delRec, setDelRec] = useState<string | null>(null);
  const [zone, setZone] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [serverIpv6, setServerIpv6] = useState('');
  const [template, setTemplate] = useState<ZoneTemplateId>('full');
  const [rtype, setRtype] = useState('A');
  const [rname, setRname] = useState('@');
  const [rvalue, setRvalue] = useState('');
  const [rttl, setRttl] = useState('300');
  const [dnssecBusy, setDnssecBusy] = useState(false);
  const [dnssecMsg, setDnssecMsg] = useState<string | null>(null);
  const [dnssecNotes, setDnssecNotes] = useState<string[]>([]);
  const [dnssecDs, setDnssecDs] = useState<string | null>(null);
  const [peerHost, setPeerHost] = useState('');
  const [peerUser, setPeerUser] = useState('ysk');
  const [peerLabel, setPeerLabel] = useState('');
  const [peers, setPeers] = useState<Array<Record<string, unknown>>>([]);
  const [clusterBusy, setClusterBusy] = useState(false);
  const [clusterMsg, setClusterMsg] = useState<string | null>(null);
  const [clusterNotes, setClusterNotes] = useState<string[]>([]);
  const [clusterApplyStatus, setClusterApplyStatus] = useState<string | null>(
    null,
  );
  const [clusterPeerResults, setClusterPeerResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [soaNs, setSoaNs] = useState('');
  const [soaTtl, setSoaTtl] = useState('300');
  /** Edit SOA for selected zone (persist + re-write zone file) */
  const [editSoaNs, setEditSoaNs] = useState('');
  const [editSoaNs2, setEditSoaNs2] = useState('');
  const [editSoaHostmaster, setEditSoaHostmaster] = useState('');
  const [editSoaTtl, setEditSoaTtl] = useState('300');
  const [editSoaRefresh, setEditSoaRefresh] = useState('7200');
  const [editSoaRetry, setEditSoaRetry] = useState('3600');
  const [editSoaExpire, setEditSoaExpire] = useState('1209600');
  const [editSoaMinimum, setEditSoaMinimum] = useState('300');
  const [soaBusy, setSoaBusy] = useState(false);
  const [soaMsg, setSoaMsg] = useState<string | null>(null);
  /** Tools tab: dig/lookup */
  const [lookupName, setLookupName] = useState('');
  const [lookupType, setLookupType] = useState('A');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNameError, setLookupNameError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{
    ok: boolean;
    answers: string[];
    notes: string[];
    method?: string;
    latencyMs?: number;
  } | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [mailDomains, setMailDomains] = useState<Array<{ domain: string; server_ip?: string }>>(
    [],
  );

  useEffect(() => {
    void emailApi
      .list()
      .then((r) =>
        setMailDomains(
          (r.items ?? []).map((d) => ({ domain: d.domain, server_ip: d.server_ip })),
        ),
      )
      .catch(() => setMailDomains([]));
  }, []);

  const missingMailZones = useMemo(
    () => missingMailDomains(mailDomains, zones.allItems),
    [mailDomains, zones.allItems],
  );

  // Keep selected zone row in sync after apply/refresh
  const selectedLive = useMemo(() => {
    if (!selectedZone) return null;
    return zones.items.find((z) => z.id === selectedZone.id) ?? selectedZone;
  }, [zones.items, selectedZone]);

  const dnsTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string; badge?: number | string }> = [
      { id: 'zones', label: t('dns.tabs.zones'), badge: zones.allTotal || undefined },
    ];
    if (selectedLive) {
      tabs.push(
        {
          id: 'records',
          label: t('dns.tabs.records'),
          badge: records.allTotal || undefined,
        },
        { id: 'cluster', label: t('dns.tabs.cluster'), badge: peers.length || undefined },
        { id: 'dnssec', label: t('dns.tabs.dnssec') },
      );
    }
    tabs.push(
      { id: 'tools', label: t('dns.tabs.tools') },
      { id: 'stack', label: t('tabs.stack') },
      { id: 'about', label: t('dns.tabs.about') },
    );
    return tabs;
  }, [t, zones.allTotal, selectedLive, records.allTotal, peers.length]);

  // Prefill SOA fields when selection changes
  useEffect(() => {
    if (!selectedLive) return;
    setEditSoaNs(String(selectedLive.nsName ?? ''));
    setEditSoaNs2(String(selectedLive.ns2Name ?? ''));
    setEditSoaHostmaster(String(selectedLive.hostmaster ?? ''));
    setEditSoaTtl(String(selectedLive.ttl ?? 300));
    setEditSoaRefresh(String(selectedLive.soaRefresh ?? 7200));
    setEditSoaRetry(String(selectedLive.soaRetry ?? 3600));
    setEditSoaExpire(String(selectedLive.soaExpire ?? 1209600));
    setEditSoaMinimum(String(selectedLive.soaMinimum ?? selectedLive.ttl ?? 300));
    setSoaMsg(null);
  }, [
    selectedLive?.id,
    selectedLive?.nsName,
    selectedLive?.ns2Name,
    selectedLive?.hostmaster,
    selectedLive?.ttl,
    selectedLive?.soaRefresh,
    selectedLive?.soaRetry,
    selectedLive?.soaExpire,
    selectedLive?.soaMinimum,
  ]);

  function buildSoaPatch() {
    return {
      nsName: editSoaNs.trim() || undefined,
      ns2Name: editSoaNs2.trim() || null,
      hostmaster: editSoaHostmaster.trim() || undefined,
      ttl: parseDnsTtl(editSoaTtl),
      soaRefresh: parseDnsTtl(editSoaRefresh),
      soaRetry: parseDnsTtl(editSoaRetry),
      soaExpire: parseDnsTtl(editSoaExpire),
      soaMinimum: parseDnsTtl(editSoaMinimum) };
  }

  async function onDnssec(zoneName: string) {
    setDnssecBusy(true);
    setDnssecMsg(null);
    setDnssecDs(null);
    setDnssecNotes([]);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        notes?: string[];
        dsRecord?: string;
        publicKey?: string;
        files?: string[];
      }>(`/api/v1/dns/zones/${encodeURIComponent(zoneName)}/dnssec`, {
        method: 'POST',
        body: '{}' });
      setDnssecNotes(r.notes ?? []);
      setDnssecDs(r.dsRecord ?? null);
      setDnssecMsg(
        r.ok
          ? t('dns.dnssecOk')
          : t('dns.dnssecNotOk'),
      );
      const listed = await api.requestRaw<{ files?: string[]; notes?: string[] }>(
        `/api/v1/dns/zones/${encodeURIComponent(zoneName)}/dnssec`,
      );
      if (listed.notes?.length) setDnssecNotes((n) => [...n, ...listed.notes!]);
    } catch (e) {
      setDnssecMsg(e instanceof Error ? e.message : t('dns.dnssecFailed'));
    } finally {
      setDnssecBusy(false);
    }
  }

  async function onCreateZone(e: FormEvent) {
    e.preventDefault();
    const z = zone.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(z) || z.includes('..')) {
      toast.error(t('dns.invalidZone', { defaultValue: t('common.failed') }));
      return;
    }
    const ip = serverIp.trim();
    if (!/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(ip)) {
      toast.error(t('dns.invalidIpv4', { defaultValue: t('common.failed') }));
      return;
    }
    const item = await zones.create({
      zone,
      serverIp,
      ...(serverIpv6.trim() ? { serverIpv6: serverIpv6.trim() } : {}),
      backend: 'bind',
      template,
      nsName: soaNs.trim() || undefined,
      ttl: parseDnsTtl(soaTtl) });
    setZoneOpen(false);
    setSelectedZone(item);
    setZone('');
    setServerIpv6('');
    setTemplate('full');
  }

  async function refreshPeers() {
    const r = await api.requestRaw<{ items: Array<Record<string, unknown>> }>(
      '/api/v1/dns/cluster/peers',
    );
    setPeers(r.items ?? []);
  }

  async function runClusterOp(
    path: string,
    body: Record<string, unknown> = {},
  ) {
    setClusterBusy(true);
    setClusterMsg(null);
    setClusterNotes([]);
    setClusterPeerResults([]);
    setClusterApplyStatus(null);
    try {
      // Use raw fetch so HTTP 422 partial still returns peers[] (api.request throws).
      const bearer = authStore.getToken();
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body) });
      const r = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        apply_status?: string;
        notes?: string[];
        peers?: Array<Record<string, unknown>>;
        blocked?: boolean;
        message?: string;
      };
      setClusterApplyStatus(r.apply_status ?? null);
      setClusterNotes(r.notes ?? []);
      setClusterPeerResults(r.peers ?? []);
      if (r.blocked || r.apply_status === 'blocked') {
        setClusterMsg(t('dns.blocked'));
      } else if (r.ok) {
        setClusterMsg(t('dns.clusterDone', { status: r.apply_status ?? 'ok' }));
      } else {
        setClusterMsg(
          t('dns.clusterPartial', { status: r.apply_status ?? res.status }),
        );
      }
      await refreshPeers();
    } catch (e) {
      setClusterMsg(e instanceof Error ? e.message : t('dns.clusterFailed'));
    } finally {
      setClusterBusy(false);
    }
  }

  async function onSaveRec(e: FormEvent) {
    e.preventDefault();
    if (!selectedZone) return;
    const val = rvalue.trim();
    const body = {
      zoneId: selectedZone.id,
      type: rtype,
      name: rname,
      value: val,
      ttl: parseDnsTtl(rttl) };
    // Server-side validation (honest); also check set conflicts with existing
    try {
      const existing = mapRecordsForValidate(records.items);
      const withoutEdit = editRec
        ? existing.filter((r, i) => records.items[i]?.id !== editRec.id)
        : existing;
      const check = await api.requestRaw<{
        ok: boolean;
        issues?: Array<{ level: string; message: string }>;
        notes?: string[];
      }>('/api/v1/dns/validate', {
        method: 'POST',
        body: JSON.stringify({
          records: [...withoutEdit, body] }) });
      if (!check.ok) {
        setValidateMsg(formatDnsValidateMessage(check, t('dns.validateFailed')));
        return;
      }
      setValidateMsg(null);
    } catch (err) {
      setValidateMsg(err instanceof Error ? err.message : t('dns.validateRequestFailed'));
      return;
    }
    if (editRec) await records.update(editRec.id, body);
    else await records.create(body);
    setRecOpen(false);
    setEditRec(null);
    setRvalue('');
  }

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    if (!lookupName.trim()) {
      setLookupNameError(t('common.pleaseFill'));
      return;
    }
    setLookupNameError(null);
    setLookupBusy(true);
    setLookupResult(null);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        answers: string[];
        notes: string[];
        method?: string;
        latencyMs?: number;
      }>('/api/v1/dns/lookup', {
        method: 'POST',
        body: JSON.stringify({
          name: lookupName.trim(),
          type: lookupType,
          server: lookupServer.trim() || undefined }) });
      setLookupResult(r);
    } catch (err) {
      setLookupResult({
        ok: false,
        answers: [],
        notes: [err instanceof Error ? err.message : t('dns.lookupFailed')] });
    } finally {
      setLookupBusy(false);
    }
  }

  const [tab, setTab] = usePageTab(DNS_TABS, 'zones');
  const [health, setHealth] = useState<DnsHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [pdnsHealBusy, setPdnsHealBusy] = useState(false);
  const [lookupServer, setLookupServer] = useState('127.0.0.1');

  const refreshHealth = useCallback(async (): Promise<DnsHealth | null> => {
    setHealthBusy(true);
    try {
      const digName =
        selectedZone && typeof selectedZone.zone === 'string'
          ? selectedZone.zone
          : undefined;
      const q = digName ? `?name=${encodeURIComponent(digName)}` : '';
      const r = await api.requestRaw<DnsHealth>(`/api/v1/dns/health${q}`);
      setHealth(r);
      return r;
    } catch {
      setHealth(null);
      return null;
    } finally {
      setHealthBusy(false);
    }
  }, [selectedZone]);

  const healPdns = useCallback(() => {
    setPdnsHealBusy(true);
    void api
      .requestRawAllowStatus<{
        ok?: boolean;
        notes?: string[];
        localAddress?: string;
        blocked?: boolean;
        blockMessage?: string;
      }>('/api/v1/hosting/dns/powerdns/heal', {
        method: 'POST',
        body: '{}',
        allowStatuses: [403, 422],
      })
      .then((r) => {
        if (r.blocked) {
          toast.warn(
            r.blockMessage ?? r.notes?.[0] ?? t('dns.healthHealPdnsFailed'),
          );
        } else if (r.ok === false) {
          toast.error(r.notes?.[0] ?? t('dns.healthHealPdnsFailed'));
        } else {
          toast.ok(t('dns.healthHealPdnsOk', { ip: r.localAddress ?? '—' }));
        }
        return refreshHealth();
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setPdnsHealBusy(false));
  }, [refreshHealth, t]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // Zone-scoped tabs require a selected zone
  useEffect(() => {
    if (!selectedLive && (tab === 'records' || tab === 'cluster' || tab === 'dnssec')) {
      setTab('zones');
    }
  }, [selectedLive, tab, setTab]);

  // Load cluster peers when opening cluster tab
  useEffect(() => {
    if (tab === 'cluster') void refreshPeers().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on tab only
  }, [tab]);

  return (
    <FeaturePageLayout
      title={t('nav.dns')}
      showCapability={false}
      status={{
        pill: {
          label: health
            ? health.ok
              ? t('dns.healthPillOk')
              : t('dns.healthPillBad')
            : t('dns.zonesTitle', { count: zones.allTotal }),
          tone: health ? (health.ok ? 'ok' : 'danger') : zones.allTotal ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('dns.healthService'),
            value:
              health == null
                ? '—'
                : health.unitActive
                  ? health.unit
                  : t('dns.healthServiceDown'),
            tone: health == null ? undefined : health.unitActive ? 'ok' : 'danger',
          },
          {
            label: t('dns.healthListen'),
            value: health
              ? `UDP${health.listenUdp53 ? '✓' : '×'} TCP${health.listenTcp53 ? '✓' : '×'}`
              : '—',
            tone:
              health == null
                ? undefined
                : health.listenUdp53 || health.listenTcp53
                  ? 'ok'
                  : 'danger',
          },
          {
            label: t('dns.tabs.zones'),
            value: zones.allTotal,
          },
          ...(selectedLive
            ? [
                {
                  label: t('dns.colZoneName'),
                  value: String(selectedLive.zone),
                  tone: 'ok' as const,
                },
              ]
            : []),
        ],
      }}
      actions={
        <ActionBar size="sm">
          <Button
            variant="secondary"
            size="sm"
            loading={healthBusy}
            onClick={() => void refreshHealth()}
          >
            {t('dns.healthRefresh')}
          </Button>
        </ActionBar>
      }
    >
      {zones.error || records.error ? (
        <Alert variant="error">{zones.error ?? records.error}</Alert>
      ) : null}
      {dnssecMsg ? (
        <Alert
          variant={
            /失敗|未完成|未產生|唔假成功|Failed|not generated|false success|失败|未生成/.test(dnssecMsg) ? 'error' : 'ok'
          }
        >
          {dnssecMsg}
          {dnssecDs ? (
            <p className="u-mt-2">
              {t('dns.dsForRegistrar')}
              <code className="inline u-break-all">{dnssecDs}</code>
            </p>
          ) : null}
          {dnssecNotes.length ? (
            <ul className="list-plain u-mt-2">
              {dnssecNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {validateMsg ? (
        <Alert variant="error">
          {validateMsg}{' '}
          <button
            type="button"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            onClick={bindSet(setValidateMsg, null)}
          >
            {t('common.close')}
          </button>
        </Alert>
      ) : null}
      <PageTabs
        tabs={dnsTabs}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'zones' ? (
          <div className="tab-panel">
            {missingMailZones.length ? (
              <Alert variant="warn">
                {t('dns.mailZonesMissing', {
                  domains: missingMailZones.map((d) => d.domain).join(', '),
                })}
                {missingMailZones.slice(0, 3).map((d) => (
                  <Button
                    key={d.domain}
                    variant="secondary"
                    size="sm"
                    className="u-ml-2"
                    loading={zones.busy}
                    onClick={() => {
                      void (async () => {
                        let ip = String(d.server_ip ?? '').trim();
                        if (
                          !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                            ip,
                          )
                        ) {
                          ip = String(zones.items[0]?.serverIp ?? serverIp).trim();
                        }
                        if (
                          !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                            ip,
                          )
                        ) {
                          try {
                            const r = await api.requestRaw<{ items?: string[] }>(
                              '/api/v1/system/ips',
                            );
                            ip =
                              (r.items ?? [])
                                .map((s) => s.replace(/\/\d+$/, '').trim())
                                .find((s) =>
                                  /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                                    s,
                                  ),
                                ) ?? '';
                          } catch {
                            ip = '';
                          }
                        }
                        if (
                          !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                            ip,
                          )
                        ) {
                          setZone(d.domain);
                          if (d.server_ip) setServerIp(d.server_ip);
                          setTemplate('mail');
                          setZoneOpen(true);
                          return;
                        }
                        try {
                          const item = await zones.create({
                            zone: d.domain,
                            serverIp: ip,
                            backend: 'bind',
                            template: 'mail',
                          });
                          setSelectedZone(item);
                          toast.ok(t('dns.createMailZoneNow', { domain: d.domain }));
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t('common.opFailed'));
                          setZone(d.domain);
                          setServerIp(ip);
                          setTemplate('mail');
                          setZoneOpen(true);
                        }
                      })();
                    }}
                  >
                    {t('dns.createMailZone')} · {d.domain}
                  </Button>
                ))}
              </Alert>
            ) : null}
            <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                  title={t('dns.zonesTitle', { count: zones.allTotal })}
                  toolbar={
                    <ActionBar>
                      <Button variant="primary" size="sm" onClick={bindSet(setZoneOpen, true)}>
                        {t('dns.createZone')}
                      </Button>
                    </ActionBar>
                  }
                  filters={
                    <ServerListFilters
                      q={zones.q}
                      setQ={zones.setQ}
                      searching={zones.searching}
                      loading={zones.listLoading}
                      total={zones.allTotal}
                      shown={zones.items.length}
                      activeFilterCount={zones.activeFilterCount}
                      clear={zones.clearSearch}
                    />
                  }
                  columns={[
                    {
                      key: 'zone',
                      header: t('dns.colZoneName'),
                      render: (r) => (
                        <button
                          type="button"
                          className={buttonClassName({ variant: 'link', size: 'md' })}
                          onClick={bindSet2(setSelectedZone, r, setTab, 'records')}
                        >
                          <strong>{String(r.zone)}</strong>
                        </button>
                      ) },
                    { key: 'ip', header: t('dns.colServerIp'), render: (r) => String(r.serverIp ?? '—') },
                    {
                      key: 'tpl',
                      header: t('dns.colTemplate'),
                      render: (r) => String(r.template ?? 'full') },
                    {
                      key: 'status',
                      header: t('dns.colStatus'),
                      render: (r) => <ResourceStatusBadge status={String(r.apply_status)} /> },
                  ]}
                  rows={zones.items}
                  filterActive={zones.activeFilterCount > 0}
                  empty={
                    <EmptyState title={t('dns.emptyZonesTitle')} />
                  }
                  rowActions={(r) => (
                    <ActionBar>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                        disabled={zones.busy || health?.unitActive === false}
                        onClick={bindCall1(zones.apply, r.id)}
                        title={
                          health?.unitActive === false
                            ? t('dns.applyNeedService')
                            : t('dns.applyZoneTitle')
                        }
                      >
                        {t('dns.applyZone')}
                      </button>
                      {health?.unitActive === false ? (
                        <Link
                          to="/dns?tab=tools"
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          {t('dns.goStartService')}
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                        onClick={bindSet2(setSelectedZone, r, setTab, 'records')}
                      >
                        {t('dns.tabs.records')}
                      </button>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'danger', size: 'sm' })}
                        disabled={zones.busy}
                        title={t('dns.deleteZoneNeedName')}
                        data-confirm={String(r.zone || r.name || r.id)}
                        onClick={() =>
                          setDelZone({
                            id: r.id,
                            name: String(r.zone || r.name || r.id),
                          })
                        }
                      >
                        {t('common.delete')}
                      </button>
                    </ActionBar>
                  )}
                />
          </div>
        ) : null}

        {tab === 'records' ? (
          <div className="tab-panel">
            {selectedLive ? (
              <div className="dns-zone">
                {/* Zone hero — primary actions never float mid-page */}
                <header className="dns-zone__hero">
                  <div className="dns-zone__hero-main">
                    <div className="dns-zone__hero-title-row">
                      <h2 className="dns-zone__zone-name">{String(selectedLive.zone)}</h2>
                      <ResourceStatusBadge status={String(selectedLive.apply_status)} />
                    </div>
                    <div className="dns-zone__meta">
                      <span>
                        {t('dns.statRecords')}: {records.total}
                      </span>
                      {selectedLive.zonePath ? (
                        <>
                          <span aria-hidden>·</span>
                          <code className="inline" title={String(selectedLive.zonePath)}>
                            {String(selectedLive.zonePath)}
                          </code>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="dns-zone__hero-actions">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        setEditRec(null);
                        setRtype('A');
                        setRname('@');
                        setRvalue(String(selectedLive.serverIp ?? ''));
                        setRttl(String(selectedLive.ttl ?? 300));
                        setRecOpen(true);
                      }}
                    >
                      {t('dns.addRecord')}
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      loading={zones.busy}
                      onClick={bindCall1(zones.apply, selectedLive.id)}
                    >
                      {t('dns.writeZoneFile')}
                    </Button>
                    <Link
                      to={`/ssl?domain=${encodeURIComponent(String(selectedLive.zone))}&action=le`}
                      className={buttonClassName({ variant: 'ghost', size: 'md' })}
                      title={t('dns.requestLeTitle', { zone: String(selectedLive.zone) })}
                    >
                      {t('dns.requestZoneSsl')}
                    </Link>
                  </div>
                </header>

                {/* SOA card */}
                <section className="dns-zone__card" aria-labelledby="dns-soa-title">
                  <div className="dns-zone__card-head">
                    <div className="dns-zone__card-head-text">
                      <h3 id="dns-soa-title" className="dns-zone__card-title">
                        {t('dns.soaTitle')}
                      </h3>
                      <p className="dns-zone__card-desc">{t('dns.soaDesc')}</p>
                    </div>
                  </div>
                  {soaMsg ? (
                    <div className="dns-zone__flash">
                      <Alert
                        variant={/失敗|Failed|失败/.test(soaMsg) ? 'error' : 'ok'}
                      >
                        {soaMsg}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="u-ml-2"
                          onClick={() => setSoaMsg(null)}
                        >
                          {t('common.close')}
                        </Button>
                      </Alert>
                    </div>
                  ) : null}
                  <div className="dns-zone__card-body">
                    <div className="dns-zone__soa-grid">
                      <div className="dns-zone__soa-block">
                        <p className="dns-zone__soa-block-title">{t('dns.soaBlockNs')}</p>
                        <div className="dns-zone__soa-fields">
                          <Field
                            label={t('dns.soaNsLabel')}
                            htmlFor="edit-soa-ns"
                            flush
                            hint={t('dns.soaNsHint')}
                          >
                            <input
                              id="edit-soa-ns"
                              value={editSoaNs}
                              onChange={bindInput(setEditSoaNs)}
                              placeholder={`ns1.${String(selectedLive.zone)}.`}
                              spellCheck={false}
                              disabled={soaBusy || zones.busy}
                              autoComplete="off"
                            />
                          </Field>
                          <Field
                            label={t('dns.soaNs2Label')}
                            htmlFor="edit-soa-ns2"
                            flush
                            hint={t('dns.soaNs2Hint')}
                          >
                            <input
                              id="edit-soa-ns2"
                              value={editSoaNs2}
                              onChange={bindInput(setEditSoaNs2)}
                              placeholder={`ns2.${String(selectedLive.zone)}.`}
                              spellCheck={false}
                              disabled={soaBusy || zones.busy}
                              autoComplete="off"
                            />
                          </Field>
                          <Field
                            label={t('dns.soaHostmaster')}
                            htmlFor="edit-soa-hm"
                            flush
                            hint={t('dns.soaHostmasterHint')}
                          >
                            <input
                              id="edit-soa-hm"
                              value={editSoaHostmaster}
                              onChange={bindInput(setEditSoaHostmaster)}
                              placeholder={`hostmaster.${String(selectedLive.zone)}.`}
                              spellCheck={false}
                              disabled={soaBusy || zones.busy}
                              autoComplete="off"
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="dns-zone__soa-block">
                        <p className="dns-zone__soa-block-title">{t('dns.soaBlockTiming')}</p>
                        <div className="dns-zone__soa-fields">
                          <Field label={t('dns.defaultTtl')} htmlFor="edit-soa-ttl" flush>
                            <PresetChips
                              options={[
                                { value: '60', label: t('dns.min1') },
                                { value: '300', label: t('dns.min5') },
                                { value: '600', label: t('dns.min10') },
                                { value: '3600', label: t('dns.hour1') },
                                { value: '86400', label: t('dns.day1') },
                              ]}
                              value={editSoaTtl}
                              onChange={setEditSoaTtl}
                              allowCustom
                              customPlaceholder={t('dns.customSeconds')}
                              disabled={soaBusy || zones.busy}
                            />
                          </Field>
                          <div className="dns-zone__soa-timing-row">
                            <Field
                              label={t('dns.soaRefresh')}
                              htmlFor="edit-soa-ref"
                              flush
                              hint={t('dns.soaTimingHint')}
                            >
                              <input
                                id="edit-soa-ref"
                                value={editSoaRefresh}
                                onChange={bindInput(setEditSoaRefresh)}
                                inputMode="numeric"
                                disabled={soaBusy || zones.busy}
                                autoComplete="off"
                              />
                            </Field>
                            <Field label={t('dns.soaRetry')} htmlFor="edit-soa-ret" flush>
                              <input
                                id="edit-soa-ret"
                                value={editSoaRetry}
                                onChange={bindInput(setEditSoaRetry)}
                                inputMode="numeric"
                                disabled={soaBusy || zones.busy}
                                autoComplete="off"
                              />
                            </Field>
                          </div>
                          <div className="dns-zone__soa-timing-row">
                            <Field label={t('dns.soaExpire')} htmlFor="edit-soa-exp" flush>
                              <input
                                id="edit-soa-exp"
                                value={editSoaExpire}
                                onChange={bindInput(setEditSoaExpire)}
                                inputMode="numeric"
                                disabled={soaBusy || zones.busy}
                                autoComplete="off"
                              />
                            </Field>
                            <Field label={t('dns.soaMinimum')} htmlFor="edit-soa-min" flush>
                              <input
                                id="edit-soa-min"
                                value={editSoaMinimum}
                                onChange={bindInput(setEditSoaMinimum)}
                                inputMode="numeric"
                                disabled={soaBusy || zones.busy}
                                autoComplete="off"
                              />
                            </Field>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <footer className="dns-zone__card-footer">
                    <Button
                      variant="secondary"
                      size="md"
                      loading={soaBusy}
                      disabled={zones.busy}
                      onClick={() => {
                        void (async () => {
                          setSoaBusy(true);
                          setSoaMsg(null);
                          try {
                            await zones.update(selectedLive.id, buildSoaPatch());
                            setSoaMsg(t('dns.soaSaved'));
                          } catch (e) {
                            setSoaMsg(
                              e instanceof Error ? e.message : t('dns.soaSaveFailed'),
                            );
                          } finally {
                            setSoaBusy(false);
                          }
                        })();
                      }}
                    >
                      {t('dns.saveSoaSettings')}
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      loading={soaBusy || zones.busy}
                      onClick={() => {
                        void (async () => {
                          setSoaBusy(true);
                          setSoaMsg(null);
                          try {
                            await zones.update(selectedLive.id, buildSoaPatch());
                            await zones.apply(selectedLive.id);
                            setSoaMsg(t('dns.soaSavedAndWritten'));
                          } catch (e) {
                            setSoaMsg(
                              e instanceof Error ? e.message : t('dns.soaWriteFailed'),
                            );
                          } finally {
                            setSoaBusy(false);
                          }
                        })();
                      }}
                    >
                      {t('dns.saveSoaAndWriteBtn')}
                    </Button>
                  </footer>
                </section>

                {/* Records card */}
                <section className="dns-zone__card" aria-labelledby="dns-rec-title">
                  <div className="dns-zone__card-head">
                    <div className="dns-zone__card-head-text">
                      <h3 id="dns-rec-title" className="dns-zone__card-title">
                        {t('dns.recordsListTitle', { count: records.total })}
                      </h3>
                      <p className="dns-zone__card-desc">{t('dns.recordsListDesc')}</p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setEditRec(null);
                        setRtype('A');
                        setRname('@');
                        setRvalue(String(selectedLive.serverIp ?? ''));
                        setRttl(String(selectedLive.ttl ?? 300));
                        setRecOpen(true);
                      }}
                    >
                      {t('dns.addRecord')}
                    </Button>
                  </div>
                  <div className="dns-zone__card-body">
                    <div className="dns-zone__records-toolbar">
                      <ServerListFilters
                        q={records.q}
                        setQ={records.setQ}
                        searching={records.searching}
                        loading={records.listLoading}
                        total={records.allTotal}
                        shown={records.items.length}
                        activeFilterCount={records.activeFilterCount}
                        clear={records.clearSearch}
                      />
                    </div>
                    <DataTable
                      columns={[
                        {
                          key: 'type',
                          header: t('dns.colType'),
                          nowrap: true,
                          render: (r) => {
                            const ty = String(r.type ?? 'A').toUpperCase();
                            const mod =
                              ty === 'MX'
                                ? 'dns-zone__type-badge--mx'
                                : ty === 'TXT'
                                  ? 'dns-zone__type-badge--txt'
                                  : ty === 'CNAME' || ty === 'NS'
                                    ? 'dns-zone__type-badge--cname'
                                    : ty === 'AAAA'
                                      ? 'dns-zone__type-badge--aaaa'
                                      : '';
                            return (
                              <span className={`dns-zone__type-badge ${mod}`.trim()}>
                                {ty}
                              </span>
                            );
                          } },
                        {
                          key: 'name',
                          header: t('dns.colName'),
                          render: (r) => (
                            <span className="dns-zone__rec-name">{String(r.name)}</span>
                          ) },
                        {
                          key: 'value',
                          header: t('dns.colValue'),
                          render: (r) => (
                            <span className="dns-zone__rec-value">{String(r.value)}</span>
                          ) },
                        {
                          key: 'ttl',
                          header: 'TTL',
                          nowrap: true,
                          render: (r) => (
                            <span className="dns-zone__rec-ttl">{String(r.ttl ?? 300)}</span>
                          ) },
                      ]}
                      rows={records.items}
                      rowKey={(r) => String((r as { id?: string }).id ?? '')}
                      filterActive={records.activeFilterCount > 0}
                      empty={<EmptyState title={t('dns.emptyRecords')} />}
                      rowActions={(r) => (
                        <div className="dns-zone__row-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditRec(r);
                              setRtype(String(r.type ?? 'A'));
                              setRname(String(r.name ?? '@'));
                              setRvalue(String(r.value ?? ''));
                              setRttl(String(r.ttl ?? 300));
                              setRecOpen(true);
                            }}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={bindSet(setDelRec, r.id)}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      )}
                    />
                  </div>
                </section>
              </div>
            ) : (
              <div className="dns-zone__empty-select">
                <EmptyState
                  title={t('dns.noZoneSelectedTitle')}
                  description={t('dns.noZoneSelectedDesc')}
                />
              </div>
            )}
          </div>
        ) : null}

        {tab === 'cluster' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('dns.clusterTitle')}
                description={t('dns.clusterDesc')}
              >
                <FormLayout columns={2}>
                  <Field
                    label={t('dns.peerHost')}
                    htmlFor="peer-h"
                    flush
                    required
                    hint={t('dns.peerHostHint')}
                  >
                    <input
                      id="peer-h"
                      value={peerHost}
                      onChange={bindInput(setPeerHost)}
                      placeholder="ns2.example.com"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label={t('dns.sshUser')}
                    htmlFor="peer-u"
                    flush
                    hint={t('dns.sshUserHint')}
                  >
                    <input
                      id="peer-u"
                      value={peerUser}
                      onChange={bindInput(setPeerUser)}
                      placeholder="root"
                    />
                  </Field>
                  <Field
                    label={t('dns.labelOptional')}
                    htmlFor="peer-label"
                    flush
                    hint={t('dns.labelPlaceholder')}
                  >
                    <input
                      id="peer-label"
                      value={peerLabel}
                      onChange={bindInput(setPeerLabel)}
                      placeholder="ns2"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={bindVoid(refreshPeers)}
                    disabled={clusterBusy}
                  >
                    {t('dns.refresh')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peerHost.trim()}
                    onClick={() =>
                      void api
                        .requestRaw('/api/v1/dns/cluster/peers', {
                          method: 'POST',
                          body: JSON.stringify({
                            host: peerHost.trim(),
                            username: peerUser.trim() || 'root',
                            path: '/var/lib/ysk/dns/zones',
                            label: peerLabel.trim() || undefined }) })
                        .then(() => {
                          setPeerHost('');
                          setPeerLabel('');
                          return refreshPeers();
                        })
                        .catch((e: Error) => setClusterMsg(e.message))
                    }
                  >
                    {t('dns.addPeer')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/push', { reload: true })}
                  >
                    {t('dns.pushReload')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/push', { reload: false })}
                  >
                    {t('dns.pushOnly')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/reload', {})}
                  >
                    {t('dns.reloadOnly')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/probe', {})}
                  >
                    {t('dns.probePeers')}
                  </Button>
                </FormActions>
                <FormHint>
                  {t('dns.clusterDefaultHint')}</FormHint>
              </CardSection>
            </Card>

            {clusterMsg ? (
              <Alert
                variant={
                  /封鎖|失敗|未全部|partial|failed/i.test(clusterMsg)
                    ? 'error'
                    : 'ok'
                }
              >
                {clusterMsg}
                {clusterApplyStatus ? (
                  <p className="u-mt-1 muted u-text-sm">
                    apply_status：<code className="inline">{clusterApplyStatus}</code>
                  </p>
                ) : null}
                {clusterNotes.length ? (
                  <ul className="list-plain u-mt-2">
                    {clusterNotes.map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Alert>
            ) : null}

            {clusterPeerResults.length > 0 ? (
              <Card>
                <CardSection title={t('dns.opPerPeer')}>
                  <ul className="list-plain list-spaced">
                    {clusterPeerResults.map((pr) => (
                      <li key={String(pr.peerId)}>
                        <strong>
                          {String(pr.label || pr.host)} ·{' '}
                          <code className="inline">
                            {String(pr.apply_status ?? '—')}
                          </code>
                        </strong>
                        {pr.reloaded === true ? (
                          <span className="muted u-text-sm">
                            {' '}
                            reload={String(pr.reloadMethod ?? 'ok')}
                          </span>
                        ) : null}
                        {Array.isArray(pr.notes) ? (
                          <ul className="list-plain u-mt-1">
                            {(pr.notes as string[]).map((n) => (
                              <li key={n} className="muted u-text-sm">
                                {n}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}

            <Card>
              <CardSection
                title={t('dns.registeredPeers', { count: peers.length })}
                description={t('dns.lastProbeHint')}
              >
                {peers.length === 0 ? (
                  <EmptyState title={t('dns.noPeers')} />
                ) : (
                  <ul className="list-plain list-spaced">
                    {peers.map((p) => {
                      const lp = p.lastProbe as
                        | {
                            ok?: boolean;
                            service?: string;
                            zoneDirOk?: boolean;
                            at?: string;
                            notes?: string[];
                          }
                        | undefined;
                      return (
                        <li key={String(p.id)} className="u-flex u-flex-col gap-1">
                          <div>
                            <code className="inline">
                              {p.label ? `${String(p.label)} · ` : ''}
                              {String(p.username)}@{String(p.host)}:
                              {String(p.path)}
                            </code>
                          </div>
                          {lp ? (
                            <p className="muted u-text-sm">
                              {t('dns.probeHealthy', { status: lp.ok ? 'healthy' : 'unhealthy' })}
                              {lp.service ? ` · ${lp.service}` : ''}
                              {lp.zoneDirOk === false
                                ? t('dns.zoneDirMissing')
                                : ''}
                              {lp.at
                                ? ` · ${formatDateTime(lp.at)}`
                                : ''}
                            </p>
                          ) : (
                            <p className="muted u-text-sm">{t('dns.notProbed')}</p>
                          )}
                          <FormActions>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/push', { peerId: String(p.id), reload: true })}
                            >
                              {t('dns.pushReloadShort')}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/reload', { peerId: String(p.id) })}
                            >
                              reload
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={bindVoidCall2(runClusterOp, '/api/v1/dns/cluster/probe', { peerId: String(p.id) })}
                            >
                              {t('dns.probe')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={clusterBusy}
                              onClick={() =>
                                void api
                                  .requestRaw(
                                    `/api/v1/dns/cluster/peers/${encodeURIComponent(String(p.id))}`,
                                    { method: 'DELETE' },
                                  )
                                  .then(() => refreshPeers())
                                  .catch((e: Error) =>
                                    setClusterMsg(e.message),
                                  )
                              }
                            >
                              {t('common.delete')}
                            </Button>
                          </FormActions>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'dnssec' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="DNSSEC"
                description={t('dns.generateKeys')}
              >
                {selectedLive ? (
                  <>
                    <p className="muted u-text-sm">
                      {t('dns.currentZone')}<strong>{String(selectedLive.zone)}</strong>
                    </p>
                    <FormHint>
                      {t('dns.dnssecCardDesc')}</FormHint>
                    <FormActions>
                      <Button
                        variant="primary"
                        size="md"
                        loading={dnssecBusy}
                        onClick={bindCall1(onDnssec, String(selectedLive.zone))}
                      >
                        {t('dns.generateAndSign')}
                      </Button>
                    </FormActions>
                  </>
                ) : (
                  <EmptyState title={t('dns.selectZoneFirst')} />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="tab-panel stack">
            {health ? (
              <Card>
                <CardSection title={t('dns.healthTitle')}>
                  <div className="u-flex u-flex-wrap u-gap-2 u-mb-3">
                    <Badge tone={toneBadge(health.states?.service)}>
                      {t('dns.stateService')}:{' '}
                      {health.unitActive ? health.unit : t('dns.healthServiceDown')}
                    </Badge>
                    <Badge tone={toneBadge(health.states?.listen)}>
                      {t('dns.stateListen')}:{' '}
                      {health.listenUdp53 || health.listenTcp53
                        ? `53 ${health.listenUdp53 ? 'UDP' : ''}${
                            health.listenUdp53 && health.listenTcp53 ? '+' : ''
                          }${health.listenTcp53 ? 'TCP' : ''}`
                        : t('dns.healthPortClosed')}
                    </Badge>
                    <Badge tone={toneBadge(health.states?.answering)}>
                      {t('dns.stateAnswering')}:{' '}
                      {notesSayDigMissing(health.digNotes ?? health.notes)
                        ? t('dns.digNotInstalled')
                        : health.answeringLocalA === true
                          ? `A ${health.digAAnswers?.[0] ?? 'OK'}`
                          : health.answeringLocal === true
                            ? 'OK'
                            : health.answeringLocal === false
                              ? t('dns.healthAnsweringNo')
                              : '—'}
                    </Badge>
                  </div>
                  {health.notes?.length ? (
                    <ul className="notes-list u-mb-3">
                      {health.notes.slice(0, 3).map((n) => (
                        <li key={n} className="muted u-text-sm">
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <FormActions>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={healthBusy}
                      onClick={() => void refreshHealth()}
                    >
                      {t('dns.healthProbeLocal')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={pdnsHealBusy}
                      title={t('dns.healthHealPdns')}
                      onClick={healPdns}
                    >
                      {t('dns.healthHealPdns')}
                    </Button>
                  </FormActions>
                  <div className="u-mt-3">
                    <div className="u-mt-3">
                      <div className="muted u-text-sm">
                        <strong>{t('dns.toolsFirewallTitle')}</strong>
                        {' — '}
                        {t('dns.toolsFirewallHint')}
                      </div>
                      <ServiceAccessStrip
                        serviceId="pdns"
                        ports={[
                          { role: 'dns-udp', port: '53', proto: 'udp' },
                          { role: 'dns-tcp', port: '53', proto: 'tcp' },
                        ]}
                        compact
                        onUpdated={() => void refreshHealth()}
                      />
                    </div>
                    <div className="u-mt-3">
                      <div className="muted u-text-sm">
                        <strong>{t('dns.toolsUnitTitle')}</strong>
                        {' — '}
                        {t('dns.toolsUnitHint')}
                      </div>
                      <ServiceLifecycleBar
                        unit="pdns"
                        label="PowerDNS"
                        running={health?.unitActive}
                        actions={['start', 'stop', 'restart', 'reload']}
                        size="sm"
                        className="u-mt-2"
                        showResult
                        extraAfterResult={
                          health && !health.unitActive ? (
                            <Button
                              variant="primary"
                              size="sm"
                              className="u-mt-2"
                              loading={pdnsHealBusy}
                              title={t('dns.healthHealPdns')}
                              onClick={healPdns}
                            >
                              {t('dns.healthHealPdns')}
                            </Button>
                          ) : null
                        }
                        onDone={async () => {
                          await refreshHealth();
                        }}
                        verifyAfter={async (action) => {
                          if (action !== 'start' && action !== 'restart') return;
                          const h = await refreshHealth();
                          if (!h) {
                            return { ok: false, notes: [t('dns.startProbeFailed')] };
                          }
                          if (h.unitActive && (h.listenUdp53 || h.listenTcp53)) {
                            return { ok: true };
                          }
                          return {
                            ok: false,
                            ...pickDnsStartFailureNotes(
                              h.notes,
                              t('dns.startBindHint'),
                              t('dns.startNotListening'),
                            ),
                          };
                        }}
                      />
                    </div>
                  </div>
                </CardSection>
              </Card>
            ) : (
              <Card>
                <CardSection title={t('dns.healthTitle')}>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={healthBusy}
                    onClick={() => void refreshHealth()}
                  >
                    {t('dns.healthProbeLocal')}
                  </Button>
                </CardSection>
              </Card>
            )}

            {notesSayDigMissing(health?.notes ?? health?.digNotes) ? (
              <Alert variant="warn">{t('dns.digNotInstalledHint')}</Alert>
            ) : null}
            <Card>
              <CardSection title={t('dns.lookupTitle')}>
                <form noValidate onSubmit={bindFormSubmit(onLookup)}>
                  <FormLayout columns={2}>
                    <Field
                      label={t('dns.lookupName')}
                      htmlFor="lookup-name"
                      flush
                      required
                      error={lookupNameError ?? undefined}
                    >
                      <input
                        id="lookup-name"
                        value={lookupName}
                        onChange={(e) => {
                          setLookupName(e.target.value);
                          if (lookupNameError) setLookupNameError(null);
                        }}
                        placeholder={
                          selectedLive
                            ? String(selectedLive.zone ?? 'example.com')
                            : 'example.com'
                        }
                        spellCheck={false}
                      />
                    </Field>
                    <Field label={t('dns.colType')} htmlFor="lookup-type" flush>
                      <SegRadio
                        name="lookup-type"
                        aria-label={t('dns.lookupType')}
                        value={lookupType}
                        onChange={setLookupType}
                        options={['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'].map(
                          (ty) => ({ value: ty, label: ty }),
                        )}
                      />
                    </Field>
                    <Field
                      label={t('dns.lookupServer')}
                      htmlFor="lookup-server"
                      flush
                    >
                      <input
                        id="lookup-server"
                        value={lookupServer}
                        onChange={bindInput(setLookupServer)}
                        placeholder="127.0.0.1"
                        spellCheck={false}
                      />
                    </Field>
                  </FormLayout>
                  <FormActions>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      loading={lookupBusy}
                    >
                      {t('dns.lookup')}
                    </Button>
                    {selectedLive ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setLookupName(String(selectedLive.zone ?? ''));
                          setLookupType('A');
                          setLookupServer('127.0.0.1');
                        }}
                      >
                        {t('dns.fillCurrentZone')}
                      </Button>
                    ) : null}
                  </FormActions>
                </form>
              </CardSection>
            </Card>
            {lookupResult ? (
              <Card>
                <CardSection
                  title={
                    notesSayDigMissing(lookupResult.notes)
                      ? t('dns.digNotInstalled')
                      : lookupResult.ok
                      ? t('dns.lookupResults', { count: lookupResult.answers.length })
                      : t('dns.lookupNoAnswerFail')
                  }
                  description={
                    [
                      lookupResult.method
                        ? t('dns.method', { method: lookupResult.method })
                        : null,
                      lookupResult.latencyMs != null
                        ? `${lookupResult.latencyMs} ms`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                >
                  {lookupResult.answers.length ? (
                    <ul className="notes-list">
                      {lookupResult.answers.map((a) => (
                        <li key={a}>
                          <code className="inline">{a}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      title={
                        notesSayDigMissing(lookupResult.notes)
                          ? t('dns.digNotInstalled')
                          : t('dns.noAnswers')
                      }
                      description={
                        notesSayDigMissing(lookupResult.notes)
                          ? t('dns.digNotInstalledHint')
                          : t('dns.noAnswersDesc')
                      }
                    />
                  )}
                  {lookupResult.notes.length ? (
                    <ul className="list-plain u-mt-2">
                      {lookupResult.notes.map((n) => (
                        <li key={n} className="muted u-text-sm">
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}
      
        {tab === 'stack' ? (
          <div className="tab-panel stack">
            {notesSayDigMissing(health?.notes) ? (
              <Alert variant="warn">{t('dns.digNotInstalledHint')}</Alert>
            ) : null}
            <SoftwareInstallBanner
              feature="dns"
              title={t('dns.notInstalled')}
              showReadyActions={false}
              installConfirm={{
                title: t('dns.installConfirmTitle'),
                description:
                  health?.listenUdp53 || health?.listenTcp53
                    ? t('dns.installPort53Busy')
                    : t('dns.installConfirmDesc'),
                consequences:
                  health?.listenUdp53 || health?.listenTcp53
                    ? [t('dns.installPort53BusyConsequence')]
                    : [t('dns.installConfirmConsequence')],
              }}
            />
            <SoftwareVersionBar softwareId="pdns-server" />
          </div>
        ) : null}

        {tab === 'about' ? (
          <div className="tab-panel stack">
            <section className="dns-about" aria-labelledby="dns-about-policy">
              <header className="dns-about__head">
                <h3 id="dns-about-policy" className="dns-about__title">
                  {t('dns.aboutTitle')}
                </h3>
                <p className="dns-about__sub">{t('dns.aboutSub')}</p>
              </header>
              <ol className="dns-about__list">
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    1
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('dns.validateTitle')}</div>
                    <p className="dns-about__text">{t('dns.validateDesc')}</p>
                    <p className="dns-about__text">{t('dns.validateExtra')}</p>
                  </div>
                </li>
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    2
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('dns.aboutZonesTitle')}</div>
                    <p className="dns-about__text">{t('dns.aboutZonesBody')}</p>
                  </div>
                </li>
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    3
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('dns.aboutHealthTitle')}</div>
                    <p className="dns-about__text">{t('dns.aboutHealthBody')}</p>
                  </div>
                </li>
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    4
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('dns.aboutStackTitle')}</div>
                    <p className="dns-about__text">{t('dns.aboutStackBody')}</p>
                  </div>
                </li>
              </ol>
            </section>
            <section className="dns-about dns-about--guide" aria-labelledby="dns-about-guide">
              <header className="dns-about__head">
                <h3 id="dns-about-guide" className="dns-about__title">
                  {t('common.about')}
                </h3>
              </header>
              <PageGuide guideId="dns" />
            </section>
          </div>
        ) : null}
      </PageTabs>

      <Modal
        open={zoneOpen}
        onClose={bindSet(setZoneOpen, false)}
        title={t('dns.createZoneTitle')}
        description={t('dns.createZoneDesc')}
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={bindSet(setZoneOpen, false)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="dz"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={
                zones.busy ||
                !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(zone.trim()) ||
                zone.includes('..') ||
                !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                  serverIp.trim(),
                )
              }
              title={
                zones.busy
                  ? t('common.processing')
                  : t('dns.createZoneNeedValid')
              }
            >
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="dz" onSubmit={bindFormSubmit(onCreateZone)}>
          <FormLayout columns={2}>
            <Field
              label={t('dns.colZoneName')}
              htmlFor="z"
              flush
              required
              hint={t('dns.zoneNameHint')}
              error={
                zone.trim() &&
                (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(zone.trim()) ||
                  zone.includes('..'))
                  ? t('dns.invalidZone')
                  : undefined
              }
            >
              <input
                id="z"
                value={zone}
                onChange={bindInput(setZone)}
                required
                placeholder="example.com"
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('dns.serverIpv4')}
              htmlFor="sip"
              flush
              required
              hint={t('dns.serverIpv4Hint')}
              error={
                serverIp.trim() &&
                !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
                  serverIp.trim(),
                )
                  ? t('dns.invalidIpv4')
                  : undefined
              }
            >
              <input
                id="sip"
                value={serverIp}
                onChange={bindInput(setServerIp)}
                required
                placeholder={t('dns.thisHostIpv4')}
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('dns.serverIpv6Optional')}
              htmlFor="sip6"
              flush
              hint={t('dns.serverIpv6Hint')}
            >
              <input
                id="sip6"
                value={serverIpv6}
                onChange={bindInput(setServerIpv6)}
                placeholder={t('dns.thisHostIpv6')}
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('dns.soaNsLabel')}
              htmlFor="soa-ns"
              flush
              hint={t('dns.soaNsCreateHint')}
            >
              <input
                id="soa-ns"
                value={soaNs}
                onChange={bindInput(setSoaNs)}
                placeholder="ns1.example.com."
                spellCheck={false}
              />
            </Field>
            <Field label={t('dns.defaultTtlLabel')} htmlFor="soa-ttl" flush hint={t('dns.defaultTtlHint')}>
              <PresetChips
                options={[
                  { value: '60', label: t('dns.min1') },
                  { value: '300', label: t('dns.min5') },
                  { value: '600', label: t('dns.min10') },
                  { value: '3600', label: t('dns.hour1') },
                  { value: '86400', label: t('dns.day1') },
                ]}
                value={soaTtl}
                onChange={setSoaTtl}
                allowCustom
                customPlaceholder={t('dns.customSeconds')}
              />
            </Field>
            <Field label={t('dns.recordTemplate')} htmlFor="ztpl" fullWidth flush>
              <SegRadio
                name="ztpl"
                aria-label={t('dns.recordTemplate')}
                value={template}
                onChange={bindValueSet(setTemplate as (v: string) => void)}
                options={ZONE_TEMPLATE_IDS.map((id) => ({
                  value: id,
                  label: t(`dns.templates.${id}`) }))}
              />
            </Field>
          </FormLayout>
          <FormHint>{t('dns.createAfterHint')}</FormHint>
        </form>
      </Modal>

      <Modal
        open={recOpen}
        onClose={bindSet(setRecOpen, false)}
        title={editRec ? t('dns.editRecord') : t('dns.addRecordTitle')}
        description={
          selectedLive ? t('dns.recordModalDesc', { zone: String(selectedLive.zone) }) : undefined
        }
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={bindSet(setRecOpen, false)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="dr"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={records.busy}
              title={records.busy ? t('common.processing') : t('common.save')}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <form id="dr" onSubmit={bindFormSubmit(onSaveRec)}>
          <FormLayout columns={2}>
            <Field label={t('dns.colType')} htmlFor="rt" flush required>
              <SegRadio
                name="rt"
                aria-label={t('dns.recordType')}
                value={rtype}
                onChange={setRtype}
                options={['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].map((t) => ({
                  value: t,
                  label: t }))}
              />
            </Field>
            <Field
              label={t('dns.lookupName')}
              htmlFor="rn"
              flush
              required
              hint={t('dns.nameHint')}
            >
              <input
                id="rn"
                value={rname}
                onChange={bindInput(setRname)}
                required
                placeholder="@"
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('dns.valueLabel')}
              htmlFor="rv"
              fullWidth
              flush
              required
              hint={
                rtype === 'MX'
                  ? t('dns.mxPlaceholder')
                  : rtype === 'TXT'
                    ? t('dns.spfPlaceholder')
                    : rtype === 'AAAA'
                      ? t('dns.needIpv6')
                      : rtype === 'A'
                        ? t('dns.needIpv4')
                        : t('dns.valueHint')
              }
            >
              <input
                id="rv"
                value={rvalue}
                onChange={bindInput(setRvalue)}
                required
                placeholder={
                  rtype === 'AAAA'
                    ? t('dns.ipv6Address')
                    : rtype === 'A'
                      ? t('dns.ipv4Address')
                      : undefined
                }
                spellCheck={false}
              />
            </Field>
            <Field label="TTL" htmlFor="ttl" flush hint={t('dns.ttlHint')}>
              <PresetChips
                options={[
                  { value: '60', label: t('dns.min1') },
                  { value: '300', label: t('dns.min5') },
                  { value: '600', label: t('dns.min10') },
                  { value: '3600', label: t('dns.hour1') },
                  { value: '86400', label: t('dns.day1') },
                ]}
                value={rttl}
                onChange={setRttl}
                allowCustom
                customPlaceholder={t('dns.customSeconds')}
              />
            </Field>
          </FormLayout>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delZone)}
        onClose={bindSet(setDelZone, null)}
        onConfirm={() => {
          if (delZone)
            void zones.remove(delZone.id).then(() => {
              if (selectedZone?.id === delZone.id) setSelectedZone(null);
              setDelZone(null);
            });
        }}
        title={t('dns.deleteZoneTitle')}
        description={t('dns.deleteZoneDesc')}
        dataConfirm={delZone?.name}
        confirmText={delZone?.name}
        severity="destructive"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={zones.busy}
      />
      <ConfirmDialog
        open={Boolean(delRec)}
        onClose={bindSet(setDelRec, null)}
        onConfirm={bindRemoveIf(delRec, records.remove, setDelRec)}
        title={t('dns.deleteRecordTitle')}
        description={t('dns.deleteRecordDesc')}
        severity="standard"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={records.busy}
      />
    </FeaturePageLayout>
  );
}
