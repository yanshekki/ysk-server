/**
 * CDN — CDN 節點、站點、套用、DNS 與 SSL 管理
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  ConfirmDialog,
  PageGuide,
  PageTabs,
  ServerListFilters,
  buttonClassName } from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useServerList } from '../../shared/hooks/useServerList';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import { toast } from '../../shared/stores/toast-store';
import { formatDateTime } from '../../shared/lib/datetime';
import {
  bindSet,
  bindInput,
  bindCheck,
  bindVoid,
  bindCall1,
  bindSelect,
  bindVoidCall2,
  bindVoidCall3,
  bindCloseIfIdle,
  bindToggleInList,
  bindCloseReset,
  bindRefreshDual,
  bindFormSubmit } from '../bind-handlers';
import type {
  CdnDnsStrategy,
  CdnNodeDto,
  CdnNodeRole,
  CdnSiteDto,
  CdnSiteMode } from 'ysk-server-shared';

const TABS = ['nodes', 'sites', 'dashboard', 'about'] as const;

type CdnDashboardDto = {
  at: string;
  nodes: {
    total: number;
    online: number;
    offline: number;
    draining: number;
    unknown: number;
    byRegion: Record<string, number>;
  };
  sites: {
    total: number;
    byApplyStatus: Record<string, number>;
    rows: Array<{
      id: string;
      name: string;
      domains: string[];
      mode: string;
      strategy: string;
      apply_status: string;
      edgeCount: number;
      edgesApplied: number;
      onlineEdges: number;
      managedDnsRecords: number;
    }>;
  };
  cache: Array<{
    siteId: string;
    siteName: string;
    method: string;
    hitRatePct?: number;
    hits?: number;
    misses?: number;
    cacheBytes?: number;
    notes: string[];
  }>;
  overallHitRatePct?: number;
  notes: string[];
};
const ROLE_OPTS: CdnNodeRole[] = ['control', 'origin', 'edge', 'dns'];
const MODE_OPTS: CdnSiteMode[] = [
  'origin_pull',
  'reverse_proxy',
  'static_edge',
];
const DNS_STRATEGIES: CdnDnsStrategy[] = [
  'multi_a',
  'failover',
  'single',
  'weighted',
  'geo',
];

export function statusTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (s === 'online' || s === 'applied' || s === 'written') return 'ok';
  if (s === 'draining' || s === 'planned' || s === 'partial') return 'warn';
  if (s === 'offline' || s === 'failed') return 'danger';
  return 'neutral';
}

/** Toggle membership of `item` in a list (roles, edge ids, …). */
export function toggleMembership<T>(prev: T[], item: T): T[] {
  return prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item];
}

/** Parse free-text geo map JSON; empty / invalid → null. */
export function parseGeoMapText(raw: string): Record<string, unknown> | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** Whether a CDN site row is deletable in UI. */
export function canDeleteCdnSite(s: { apply_status?: string } | null | undefined): boolean {
  if (!s) return false;
  return s.apply_status !== 'applying';
}

/** Split comma / whitespace separated free text into trimmed tokens. */
export function parseCsvList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse node weight; non-finite / 0 → fallback. */
export function parseNodeWeight(raw: unknown, fallback = 100): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Empty-after-trim → undefined (API optional fields). */
export function emptyToUndefined(raw: string | null | undefined): string | undefined {
  const s = (raw ?? '').trim();
  return s || undefined;
}

/** Roles list with edge default when empty. */
export function normalizeNodeRoles(roles: CdnNodeRole[] | null | undefined): CdnNodeRole[] {
  return roles?.length ? roles : ['edge'];
}

/** Join string list for form fields (IPs, domains). */
export function joinCsv(list: string[] | null | undefined, sep = ', '): string {
  return (list ?? []).join(sep);
}

/** Display IP for a node row: first IPv4 list or first IPv6 or em dash. */
export function formatNodeIp(n: {
  publicIpv4?: string[] | null;
  publicIpv6?: string[] | null;
}): string {
  const v4 = (n.publicIpv4 ?? []).join(', ');
  if (v4) return v4;
  return (n.publicIpv6 ?? [])[0] || '—';
}

/** Default edge selection when creating a site (first edge node). */
export function defaultEdgeIds(
  nodes: Array<{ id: string; roles?: CdnNodeRole[] | null }>,
): string[] {
  return nodes
    .filter((n) => (n.roles ?? []).includes('edge'))
    .map((n) => n.id)
    .slice(0, 1);
}

/** Nodes usable as edge or origin for site form. */
export function filterEdgeOriginNodes<
  T extends { roles?: CdnNodeRole[] | null },
>(nodes: T[]): T[] {
  return nodes.filter(
    (n) =>
      (n.roles ?? []).includes('edge') || (n.roles ?? []).includes('origin'),
  );
}

/** Count nodes with online status. */
export function countOnlineNodes(
  nodes: Array<{ status?: string | null }>,
): number {
  return nodes.filter((n) => n.status === 'online').length;
}

/** Format `{k: n}` record as `k=n · k=n`. */
export function formatCountMap(
  map: Record<string, number> | null | undefined,
): string {
  if (!map) return '';
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
}

/** Flatten site-op response notes (top-level + per-edge). */
export function collectSiteOpNotes(r: {
  notes?: string[] | null;
  edges?: Array<{ name?: string; notes?: string[] | null }> | null;
}): string[] {
  return [
    ...(r.notes ?? []),
    ...(r.edges ?? []).flatMap((e) =>
      (e.notes ?? []).map((n) => `${e.name ?? '?'}: ${n}`),
    ),
  ];
}

export type CdnSiteOpAction =
  | 'render'
  | 'apply'
  | 'purge'
  | 'dns-sync'
  | 'health-loop'
  | 'ssl/distribute'
  | 'ssl/issue'
  | 'ssl/prepare-acme';

/** i18n key for a successful site op (caller passes t). */
export function siteOpSuccessI18nKey(action: CdnSiteOpAction): string {
  if (action === 'apply') return 'cdn.fanoutDone';
  if (action === 'purge') return 'cdn.purgeDone';
  if (action === 'dns-sync' || action === 'health-loop') return 'cdn.dnsSyncDone';
  if (action.startsWith('ssl/')) return 'cdn.sslDone';
  return 'cdn.confWritten';
}

/** Alert variant: treat offline / 失敗 / 不健康 as error. */
export function cdnMsgIsError(msg: string): boolean {
  return /失敗|不健康|offline/i.test(msg);
}

/** Compact hit-rate label for status strip. */
export function formatHitRatePct(pct: number | null | undefined): string {
  return pct != null ? `${pct}%` : '—';
}

/** Status pill label: `Nn / Ss`. */
export function formatCdnPillLabel(nodeCount: number, siteCount: number): string {
  return `${nodeCount}n / ${siteCount}s`;
}

/** Serialize geo map for the site form textarea. */
export function stringifyGeoMap(
  geoMap: unknown,
): string {
  if (!geoMap || typeof geoMap !== 'object') return '';
  try {
    return JSON.stringify(geoMap, null, 0);
  } catch {
    return '';
  }
}

/** Whether string is a known CDN node role. */
export function isCdnNodeRole(v: string): v is CdnNodeRole {
  return (ROLE_OPTS as readonly string[]).includes(v);
}

/** Whether string is a known CDN site mode. */
export function isCdnSiteMode(v: string): v is CdnSiteMode {
  return (MODE_OPTS as readonly string[]).includes(v);
}

/** Whether string is a known DNS strategy. */
export function isCdnDnsStrategy(v: string): v is CdnDnsStrategy {
  return (DNS_STRATEGIES as readonly string[]).includes(v);
}

/** Build POST body fields for node create/update. */
export function buildCdnNodeBody(input: {
  id?: string;
  name: string;
  region: string;
  roles: CdnNodeRole[];
  ipv4: string;
  ipv6: string;
  healthUrl: string;
  baseUrl: string;
  weight: string;
  sshIdentityId: string;
  sshHost: string;
  sshUsername: string;
  fleetAgentId: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name.trim(),
    region: input.region.trim() || 'default',
    roles: normalizeNodeRoles(input.roles),
    publicIpv4: parseCsvList(input.ipv4),
    publicIpv6: parseCsvList(input.ipv6),
    healthUrl: emptyToUndefined(input.healthUrl),
    baseUrl: emptyToUndefined(input.baseUrl),
    weight: parseNodeWeight(input.weight),
    sshIdentityId: emptyToUndefined(input.sshIdentityId),
    sshHost: emptyToUndefined(input.sshHost),
    sshUsername: emptyToUndefined(input.sshUsername),
    fleetAgentId: emptyToUndefined(input.fleetAgentId) };
}

/** Build POST body fields for site create/update (ssl mode + geo already resolved). */
export function buildCdnSiteBody(input: {
  id?: string;
  name: string;
  domains: string;
  mode: CdnSiteMode;
  originUrl: string;
  edgeNodeIds: string[];
  shieldId: string;
  cacheEnabled: boolean;
  maxAge: string;
  dnsStrategy: CdnDnsStrategy;
  dnsZoneId: string;
  geoMap?: Record<string, string[]>;
  geoSubdomains: boolean;
  sslMode: 'off' | 'upload' | 'le_http01' | 'le_dns01';
}): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name.trim(),
    domains: parseCsvList(input.domains),
    mode: input.mode,
    origin: { kind: 'url', url: input.originUrl.trim() },
    edgeNodeIds: input.edgeNodeIds,
    originShieldNodeId: input.shieldId.trim() || null,
    cache: {
      enabled: input.cacheEnabled,
      maxAge: input.maxAge.trim() || '10m',
      zoneSize: '10m',
      bypassCookies: true,
      bypassAuth: true },
    dns: {
      strategy: input.dnsStrategy,
      zoneId: emptyToUndefined(input.dnsZoneId),
      ttlHealthy: 60,
      ttlUnhealthy: 30,
      minHealthyEdges: 1,
      geoMap: input.geoMap,
      geoSubdomains: input.geoSubdomains },
    ssl: { mode: input.sslMode } };
}

export function CdnPage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'nodes');
  const nodeList = useServerList<CdnNodeDto>({
    path: '/api/v1/cdn/nodes',
    debounceMs: 300 });
  const siteList = useServerList<CdnSiteDto>({
    path: '/api/v1/cdn/sites',
    debounceMs: 300 });
  const nodes = nodeList.items;
  const sites = siteList.items;
  const [busy, setBusy] = useState(false);
  const [delNode, setDelNode] = useState<{ id: string; name: string } | null>(null);
  const [drainTarget, setDrainTarget] = useState<{
    id: string;
    name: string;
    draining: boolean;
    last: boolean;
  } | null>(null);
  const [delSite, setDelSite] = useState<{ id: string; name: string } | null>(null);
  const [siteOp, setSiteOp] = useState<{
    id: string;
    name: string;
    action: CdnSiteOpAction;
    body?: Record<string, unknown>;
  } | null>(null);
  /** Toast-backed feedback (errors must not use ok toast). */
  const setMsg = useCallback((text: string | null) => {
    if (!text) return;
    if (cdnMsgIsError(text)) toast.error(text);
    else toast.ok(text);
  }, []);
  const [notes, setNotes] = useState<string[]>([]);
  const [confPreview, setConfPreview] = useState<string | null>(null);

  // node form
  const [nodeOpen, setNodeOpen] = useState(false);
  const [editNode, setEditNode] = useState<CdnNodeDto | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('default');
  const [roles, setRoles] = useState<CdnNodeRole[]>(['edge']);
  const [ipv4, setIpv4] = useState('');
  const [ipv6, setIpv6] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [weight, setWeight] = useState('100');
  const [sshIdentityId, setSshIdentityId] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshUsername, setSshUsername] = useState('');
  /** Fleet session id — queues conf to agent; not sync nginx apply */
  const [fleetAgentId, setFleetAgentId] = useState('');

  // site form
  const [siteOpen, setSiteOpen] = useState(false);
  const [editSite, setEditSite] = useState<CdnSiteDto | null>(null);
  const [siteName, setSiteName] = useState('');
  const [domains, setDomains] = useState('');
  const [mode, setMode] = useState<CdnSiteMode>('origin_pull');
  const [originUrl, setOriginUrl] = useState('');
  const [edgeIds, setEdgeIds] = useState<string[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [maxAge, setMaxAge] = useState('10m');
  const [dnsStrategy, setDnsStrategy] = useState<CdnDnsStrategy>('multi_a');
  const [dnsZoneId, setDnsZoneId] = useState('');
  const [dnsZones, setDnsZones] = useState<
    Array<{ id: string; zone?: string }>
  >([]);
  const [dashboard, setDashboard] = useState<CdnDashboardDto | null>(null);
  const [sslMode, setSslMode] = useState<
    'off' | 'upload' | 'le_http01' | 'le_dns01'
  >('off');
  const [sslEmail, setSslEmail] = useState('');
  const [shieldId, setShieldId] = useState('');
  const [geoMapText, setGeoMapText] = useState('');
  const [geoSubdomains, setGeoSubdomains] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const refreshNodes = nodeList.refresh;
  const refreshSites = siteList.refresh;
  const refresh = useCallback(async () => {
    const z = await api
      .requestRaw<{ items: Array<{ id: string; zone?: string }> }>(
        '/api/v1/resources/dns/zones',
      )
      .catch(() => ({ items: [] as Array<{ id: string; zone?: string }> }));
    await Promise.all([refreshNodes(), refreshSites()]);
    setDnsZones(z.items ?? []);
  }, [refreshNodes, refreshSites]);

  const refreshDashboard = useCallback(async () => {
    const d = await api.requestRaw<CdnDashboardDto>('/api/v1/cdn/dashboard');
    setDashboard(d);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setMsg(e.message));
  }, [refresh]);

  useEffect(() => {
    if (tab === 'dashboard') {
      void refreshDashboard().catch((e: Error) => setMsg(e.message));
    }
  }, [tab, refreshDashboard]);

  // Project one-click: /cdn?fromProject=ID
  useEffect(() => {
    const pid = searchParams.get('fromProject');
    if (!pid) return;
    void (async () => {
      setBusy(true);
      setNotes([]);
      try {
        const r = await api.requestRaw<{
          ok: boolean;
          created?: boolean;
          notes?: string[];
          site?: CdnSiteDto;
        }>('/api/v1/cdn/from-project', {
          method: 'POST',
          body: JSON.stringify({ projectId: pid }) });
        setNotes(r.notes ?? []);
        setMsg(
          r.created
            ? t('cdn.fromProjectOk')
            : t('cdn.fromProjectUpdatedAlt'),
        );
        setTab('sites');
        await refresh();
        if (r.site) openEditSite(r.site);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : t('cdn.fromProjectFailed'));
      } finally {
        setBusy(false);
        searchParams.delete('fromProject');
        setSearchParams(searchParams, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('fromProject')]);

  function resetNodeForm() {
    setEditNode(null);
    setName('');
    setRegion('default');
    setRoles(['edge']);
    setIpv4('');
    setIpv6('');
    setHealthUrl('');
    setBaseUrl('');
    setWeight('100');
    setSshIdentityId('');
    setSshHost('');
    setSshUsername('root');
    setFleetAgentId('');
  }

  function resetSiteForm() {
    setEditSite(null);
    setSiteName('');
    setDomains('');
    setMode('origin_pull');
    setOriginUrl('');
    setEdgeIds(defaultEdgeIds(nodes));
    setCacheEnabled(true);
    setMaxAge('10m');
    setDnsStrategy('multi_a');
    setDnsZoneId('');
    setSslMode('off');
    setSslEmail('');
    setShieldId('');
    setGeoMapText('');
    setGeoSubdomains(false);
  }

  function openCreateNode() {
    resetNodeForm();
    setNodeOpen(true);
  }

  function openEditNode(n: CdnNodeDto) {
    setEditNode(n);
    setName(n.name);
    setRegion(n.region || 'default');
    setRoles(normalizeNodeRoles(n.roles));
    setIpv4(joinCsv(n.publicIpv4));
    setIpv6(joinCsv(n.publicIpv6));
    setHealthUrl(n.healthUrl ?? '');
    setBaseUrl(n.baseUrl ?? '');
    setWeight(String(n.weight ?? 100));
    setSshIdentityId(n.sshIdentityId ?? '');
    setSshHost(n.sshHost ?? '');
    setSshUsername(n.sshUsername ?? '');
    setFleetAgentId(n.fleetAgentId ?? '');
    setNodeOpen(true);
  }

  function openCreateSite() {
    resetSiteForm();
    setSiteOpen(true);
  }

  function openEditSite(s: CdnSiteDto) {
    setEditSite(s);
    setSiteName(s.name);
    setDomains(joinCsv(s.domains));
    setMode(s.mode);
    setOriginUrl(s.origin.url ?? '');
    setEdgeIds(s.edgeNodeIds ?? []);
    setCacheEnabled(s.cache?.enabled !== false);
    setMaxAge(s.cache?.maxAge ?? '10m');
    setDnsStrategy(s.dns?.strategy ?? 'multi_a');
    setDnsZoneId(s.dns?.zoneId ?? '');
    setSslMode(s.ssl?.mode ?? 'off');
    setShieldId(s.originShieldNodeId ?? '');
    setGeoMapText(stringifyGeoMap(s.dns?.geoMap));
    setGeoSubdomains(Boolean(s.dns?.geoSubdomains));
    setSiteOpen(true);
  }


  async function onSaveNode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.requestRaw('/api/v1/cdn/nodes', {
        method: 'POST',
        body: JSON.stringify(
          buildCdnNodeBody({
            id: editNode?.id,
            name,
            region,
            roles,
            ipv4,
            ipv6,
            healthUrl,
            baseUrl,
            weight,
            sshIdentityId,
            sshHost,
            sshUsername,
            fleetAgentId }),
        ) });
      setNodeOpen(false);
      resetNodeForm();
      setMsg(editNode ? t('cdn.nodeUpdated') : t('cdn.nodeCreated'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      let geoMap: Record<string, string[]> | undefined;
      if (geoMapText.trim()) {
        const parsed = parseGeoMapText(geoMapText);
        if (!parsed) {
          setMsg(t('cdn.geoMapInvalid'));
          setBusy(false);
          return;
        }
        geoMap = parsed as Record<string, string[]>;
      }
      await api.requestRaw('/api/v1/cdn/sites', {
        method: 'POST',
        body: JSON.stringify(
          buildCdnSiteBody({
            id: editSite?.id,
            name: siteName,
            domains,
            mode,
            originUrl,
            edgeNodeIds: edgeIds,
            shieldId,
            cacheEnabled,
            maxAge,
            dnsStrategy,
            dnsZoneId,
            geoMap,
            geoSubdomains,
            sslMode }),
        ) });
      setSiteOpen(false);
      resetSiteForm();
      setMsg(editSite ? t('cdn.siteUpdated') : t('cdn.siteCreated'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onProbe(id: string) {
    setBusy(true);
    setNotes([]);
    try {
      const token = authStore.getToken();
      const res = await fetch(
        `/api/v1/cdn/nodes/${encodeURIComponent(id)}/probe`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: '{}' },
      );
      const r = (await res.json()) as { ok?: boolean; notes?: string[] };
      setNotes(r.notes ?? []);
      setMsg(r.ok ? t('cdn.probeOnline') : t('cdn.probeOffline'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.probeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onProbeAll() {
    setBusy(true);
    setNotes([]);
    try {
      const token = authStore.getToken();
      const res = await fetch('/api/v1/cdn/nodes/probe-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: '{}' });
      const r = (await res.json()) as { ok?: boolean; notes?: string[] };
      setNotes(r.notes ?? []);
      setMsg(r.ok ? t('cdn.batchProbeOk') : t('cdn.batchProbePartial'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.batchProbeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDrain(id: string, draining: boolean) {
    setBusy(true);
    try {
      await api.requestRaw(
        `/api/v1/cdn/nodes/${encodeURIComponent(id)}/drain`,
        {
          method: 'POST',
          body: JSON.stringify({ draining }) },
      );
      setMsg(draining ? t('cdn.drainingSet') : t('cdn.drainCleared'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteNode(id: string) {
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/nodes/${encodeURIComponent(id)}`, {
        method: 'DELETE' });
      setMsg(t('cdn.nodeDeleted'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSite(id: string) {
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/sites/${encodeURIComponent(id)}`, {
        method: 'DELETE' });
      setMsg(t('cdn.siteDeleted'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function postSiteOp(
    id: string,
    action: CdnSiteOpAction,
    body: Record<string, unknown> = {},
  ) {
    if (action === 'apply') {
      const site = sites.find((s) => s.id === id);
      const origin = String(site?.origin?.url ?? '');
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(origin)) {
        setMsg(t('cdn.loopbackOriginBlocked', { url: origin }));
        setNotes([t('cdn.loopbackOriginBlocked', { url: origin })]);
        return;
      }
    }
    setBusy(true);
    setNotes([]);
    if (action === 'render') setConfPreview(null);
    try {
      const token = authStore.getToken();
      const res = await fetch(
        `/api/v1/cdn/sites/${encodeURIComponent(id)}/${action}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body) },
      );
      const r = (await res.json()) as {
        ok?: boolean;
        apply_status?: string;
        notes?: string[];
        conf?: string;
        contentHash?: string;
        edges?: Array<{ name?: string; apply_status?: string; notes?: string[] }>;
        blocked?: boolean;
      };
      setNotes(collectSiteOpNotes(r));
      if (r.conf) setConfPreview(r.conf);
      if (r.blocked) {
        setMsg(t('cdn.blocked'));
      } else if (action === 'render' && body.dryRun) {
        setMsg(
          t('cdn.previewRender', { status: r.apply_status ?? 'planned', hash: r.contentHash ?? '—' }),
        );
      } else if (r.ok) {
        setMsg(
          t(siteOpSuccessI18nKey(action), { status: r.apply_status }),
        );
      } else {
        setMsg(
          t('cdn.partialFail', { status: r.apply_status ?? res.status }),
        );
      }
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  const online = countOnlineNodes(nodes);
  const edgeNodes = filterEdgeOriginNodes(nodes);

  return (
    <FeaturePageLayout
      title={t('nav.cdn')}
      showCapability={false}
      status={{
        pill: {
          label: t('cdn.statOnlineOf', {
            n: online,
            total: nodes.length,
          }),
          tone: online > 0 ? 'ok' : nodes.length ? 'warn' : 'neutral' },
        items: [
          { label: t('cdn.statNodes'), value: nodes.length },
          { label: t('cdn.statOnline'), value: online },
          { label: t('cdn.statSites'), value: sites.length },
          {
            label: t('cdn.statHit'),
            value:
              dashboard?.overallHitRatePct == null
                ? t('cdn.hitUnknown')
                : formatHitRatePct(dashboard.overallHitRatePct),
            hint:
              dashboard?.overallHitRatePct == null
                ? t('cdn.hitNoStats')
                : undefined,
          },
        ] }}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={bindRefreshDual(refresh, refreshDashboard, tab === 'dashboard')}
          >
            {t('cdn.refresh')}
          </Button>
          <Link
            to="/dns"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            DNS
          </Link>
        </>
      }
    >
      {notes.length ? (
        <Card>
          <CardSection title={t('cdn.recentNotes')}>
            <ul className="notes-list">
              {notes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          </CardSection>
        </Card>
      ) : null}
      {confPreview ? (
        <Card>
          <CardSection title={t('cdn.edgeConfPreview')}>
            <pre
              className="u-text-sm u-pre-wrap u-scroll-lg"
            >
              {confPreview}
            </pre>
            <FormActions>
              <Button
                variant="ghost"
                size="sm"
                onClick={bindSet(setConfPreview, null)}
              >
                {t('cdn.closePreview')}
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'nodes', label: t('cdn.statNodes'), badge: nodes.length || undefined },
          { id: 'sites', label: t('cdn.statSites'), badge: sites.length || undefined },
          { id: 'dashboard', label: t('cdn.tabs.dashboard') },
          { id: 'about', label: t('cdn.tabs.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'nodes' ? (
          <div className="tab-panel">
            <DataTable<CdnNodeDto>
              rowKey={(r) => r.id}
              title={t('cdn.nodesTitle', {
                count: nodeList.meta?.total ?? nodes.length })}
              description={t('cdn.nodesDesc')}
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreateNode}>
                    {t('cdn.addNodeBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!nodes.length}
                    onClick={onProbeAll}
                  >
                    {t('cdn.probeAll')}
                  </Button>
                </ActionBar>
              }
              filters={
                <ServerListFilters
                  q={nodeList.q}
                  setQ={nodeList.setQ}
                  searching={nodeList.searching}
                  loading={nodeList.loading}
                  total={nodeList.meta?.total ?? nodes.length}
                  shown={nodes.length}
                  activeFilterCount={nodeList.activeFilterCount}
                  clear={nodeList.clear}
                />
              }
              columns={[
                {
                  key: 'name',
                  header: t('cdn.colName'),
                  render: (n) => (
                    <button
                      type="button"
                      className="linkish"
                      onClick={bindCall1(openEditNode, n)}
                    >
                      {n.name}
                    </button>
                  ) },
                {
                  key: 'region',
                  header: t('cdn.colRegion'),
                  render: (n) => n.region },
                {
                  key: 'roles',
                  header: t('cdn.colRole'),
                  render: (n) =>
                    (n.roles ?? []).map((role) => (
                      <Badge key={role} className="u-mr-1">
                        {role}
                      </Badge>
                    )) },
                {
                  key: 'ip',
                  header: 'IP',
                  render: (n) => (
                    <code className="inline u-text-sm">
                      {formatNodeIp(n)}
                    </code>
                  ) },
                {
                  key: 'status',
                  header: t('cdn.colStatus'),
                  render: (n) => (
                    <span title={
                      n.lastHealth?.at
                        ? t('cdn.lastHealthHint', {
                            at: n.lastHealth.at,
                            ok: n.lastHealth.ok ? t('common.ok') : t('common.failed'),
                          })
                        : t('cdn.lastHealthNever')
                    }>
                      <Badge tone={statusTone(n.status)}>
                        {t(`cdn.nodeStatus.${n.status}`, { defaultValue: n.status })}
                      </Badge>
                      {n.lastHealth?.at ? (
                        <span className="muted u-text-sm">
                          {' '}
                          {n.lastHealth.ok ? '' : t('cdn.lastHealthFail')}
                        </span>
                      ) : null}
                    </span>
                  ) },
                {
                  key: 'actions',
                  header: '',
                  mobile: 'actions',
                  render: (n) => (
                    <ActionBar>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={bindCall1(onProbe, n.id)}
                      >
                        {t('cdn.probe')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={
                          n.status === 'draining'
                            ? t('cdn.clearDrainTitle')
                            : nodes.length <= 1
                              ? t('cdn.drainLastTitle')
                              : t('cdn.drainTitle')
                        }
                        onClick={() =>
                          setDrainTarget({
                            id: n.id,
                            name: String(n.name || n.id),
                            draining: n.status !== 'draining',
                            last: nodes.length <= 1,
                          })
                        }
                      >
                        {n.status === 'draining' ? t('cdn.clearDrain') : t('cdn.drain')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        title={
                          nodes.length <= 1
                            ? t('cdn.deleteLastNodeTitle')
                            : t('cdn.deleteNodeTitle')
                        }
                        onClick={() =>
                          setDelNode({ id: n.id, name: String(n.name || n.id) })
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  ) },
              ]}
              rows={nodes}
              empty={
                <EmptyState
                  title={t('cdn.emptyNodesTitle')}
                  description={t('cdn.emptyNodesDesc')}
                />
              }
            />
          </div>
        ) : null}

        {tab === 'sites' ? (
          <div className="tab-panel">
            <DataTable<CdnSiteDto>
              rowKey={(r) => r.id}
              title={t('cdn.sitesTitle', {
                count: siteList.meta?.total ?? sites.length })}
              description={t('cdn.sitesDesc')}
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openCreateSite}
                    disabled={!nodes.length}
                  >
                    {t('cdn.addSiteBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!sites.length}
                    title={
                      !sites.length
                        ? t('cdn.healthLoopNeedSites')
                        : t('cdn.healthLoopAll')
                    }
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        try {
                          const token = authStore.getToken();
                          const res = await fetch('/api/v1/cdn/health-loop', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(token
                                ? { Authorization: `Bearer ${token}` }
                                : {}) },
                            body: '{}' });
                          const r = (await res.json()) as {
                            ok?: boolean;
                            notes?: string[];
                          };
                          setNotes(r.notes ?? []);
                          setMsg(
                            r.ok
                              ? t('cdn.healthLoopOk')
                              : t('cdn.healthLoopPartial'),
                          );
                          await refresh();
                        } catch (e) {
                          setMsg(
                            e instanceof Error ? e.message : t('cdn.healthLoopFailed'),
                          );
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {t('cdn.healthLoopAll')}
                  </Button>
                </ActionBar>
              }
              filters={
                <ServerListFilters
                  q={siteList.q}
                  setQ={siteList.setQ}
                  searching={siteList.searching}
                  loading={siteList.loading}
                  total={siteList.meta?.total ?? sites.length}
                  shown={sites.length}
                  activeFilterCount={siteList.activeFilterCount}
                  clear={siteList.clear}
                />
              }
              columns={[
                {
                  key: 'name',
                  header: t('cdn.colName'),
                  render: (s) => (
                    <button
                      type="button"
                      className="linkish"
                      onClick={bindCall1(openEditSite, s)}
                    >
                      {s.name}
                    </button>
                  ) },
                {
                  key: 'domains',
                  header: t('cdn.colDomain'),
                  render: (s) => (
                    <code className="inline u-text-sm">
                      {(s.domains ?? []).join(', ')}
                    </code>
                  ) },
                {
                  key: 'mode',
                  header: t('cdn.colMode'),
                  render: (s) => s.mode },
                {
                  key: 'origin',
                  header: 'Origin',
                  render: (s) => {
                    const url = s.origin?.kind === 'url' ? String(s.origin.url ?? '') : '';
                    const loopback = /127\.0\.0\.1|localhost|\[::1\]/i.test(url);
                    return (
                      <span className="u-text-sm muted">
                        {url || (s.origin?.projectId ? `project:${s.origin.projectId}` : '—')}
                        {loopback ? (
                          <>
                            {' '}
                            <Badge tone="warn">{t('cdn.localTest')}</Badge>
                          </>
                        ) : null}
                      </span>
                    );
                  } },
                {
                  key: 'edges',
                  header: 'Edges',
                  render: (s) => s.edgeNodeIds?.length ?? 0 },
                {
                  key: 'status',
                  header: 'apply',
                  render: (s) => (
                    <Badge
                      tone={statusTone(s.apply_status)}
                      title={
                        s.apply_status === 'failed'
                          ? t('cdn.applyFailedHint')
                          : t(`cdn.applyStatus.${s.apply_status}`, {
                              defaultValue: s.apply_status,
                            })
                      }
                    >
                      {t(`cdn.applyStatus.${s.apply_status}`, {
                        defaultValue: s.apply_status,
                      })}
                    </Badge>
                  ) },
                {
                  key: 'actions',
                  header: '',
                  mobile: 'actions',
                  render: (s) => (
                    <ActionBar className="cdn-site-ops" wrap={false}>
                      <details className="table-more">
                        <summary>{t('common.more', { defaultValue: 'More' })}</summary>
                        <div className="table-more__menu">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.previewTitle')}
                        onClick={bindVoidCall3(postSiteOp, s.id, 'render', { dryRun: true })}
                      >
                        {t('cdn.preview')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.writeConfTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'render',
                            body: { dryRun: false },
                          })
                        }
                      >
                        {t('cdn.writeConf')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.applyEdgesTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'apply',
                          })
                        }
                      >
                        {t('cdn.applyEdges')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.purgeTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'purge',
                          })
                        }
                      >
                        {t('cdn.purge')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.dnsSyncTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'dns-sync',
                            body: { probeFirst: false },
                          })
                        }
                      >
                        {t('cdn.dnsSync')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.probeDnsTitle')}
                        onClick={bindVoidCall3(postSiteOp, s.id, 'health-loop', {})}
                      >
                        {t('cdn.probeDns')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.distSslTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'ssl/distribute',
                          })
                        }
                      >
                        {t('cdn.distSsl')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        title={t('cdn.leIssueTitle')}
                        onClick={() =>
                          setSiteOp({
                            id: s.id,
                            name: String(s.name || s.id),
                            action: 'ssl/issue',
                            body: {
                              email: sslEmail.trim(),
                              run: true,
                              distribute: true,
                            },
                          })
                        }
                      >
                        {t('cdn.leIssue')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        title={t('cdn.deleteSiteTitle')}
                        onClick={() =>
                          setDelSite({ id: s.id, name: String(s.name || s.id) })
                        }
                      >
                        {t('common.delete')}
                      </Button>
                        </div>
                      </details>
                    </ActionBar>
                  ) },
              ]}
              rows={sites}
              empty={
                <EmptyState
                  title={t('cdn.emptySitesTitle')}
                  description={
                    nodes.length
                      ? t('cdn.emptySitesDesc')
                      : t('cdn.emptySitesNoEdge')
                  }
                />
              }
            />
          </div>
        ) : null}

        {tab === 'dashboard' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('cdn.dashboardTitle')}
                description={
                  dashboard
                    ? t('cdn.updatedAt', { at: formatDateTime(dashboard.at, { locale: i18n.language }) })
                    : t('common.loading')
                }
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindVoid(refreshDashboard)}
                  >
                    {t('cdn.reaggregate')}
                  </Button>
                </FormActions>
                {dashboard ? (
                  <>
                    <div className="u-flex u-flex-wrap gap-3 u-mt-2">
                      <Badge tone="ok">
                        {t('cdn.statOnlineOf', {
                          n: dashboard.nodes.online,
                          total: dashboard.nodes.total,
                        })}
                      </Badge>
                      <Badge tone="danger">
                        {t('cdn.statOffline', { n: dashboard.nodes.offline })}
                      </Badge>
                      <Badge tone="warn">
                        {t('cdn.statDraining', { n: dashboard.nodes.draining })}
                      </Badge>
                      <Badge tone="neutral">
                        {t('cdn.statSites', { n: dashboard.sites.total })}
                      </Badge>
                      <Badge
                        tone={
                          dashboard.overallHitRatePct != null ? 'ok' : 'warn'
                        }
                      >
                        {t('cdn.statHitRate', {
                          v:
                            dashboard.overallHitRatePct != null
                              ? `${dashboard.overallHitRatePct}%`
                              : t('common.unknown'),
                        })}
                      </Badge>
                    </div>
                    {Object.keys(dashboard.nodes.byRegion).length ? (
                      <p className="muted u-text-sm u-mt-2">
                        Region：{formatCountMap(dashboard.nodes.byRegion)}
                      </p>
                    ) : null}
                    {Object.keys(dashboard.sites.byApplyStatus).length ? (
                      <p className="muted u-text-sm">
                        apply_status：
                        {formatCountMap(dashboard.sites.byApplyStatus)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <EmptyState title={t('cdn.dashboardEmpty')} />
                )}
              </CardSection>
            </Card>

            {dashboard?.sites.rows.length ? (
              <DataTable
                rowKey={(r) => String((r as { id: string }).id)}
                title={t('cdn.siteStatus')}
                columns={[
                  {
                    key: 'name',
                    header: t('cdn.statSites'),
                    render: (r) => String((r as { name: string }).name) },
                  {
                    key: 'strategy',
                    header: 'DNS',
                    render: (r) =>
                      String((r as { strategy: string }).strategy) },
                  {
                    key: 'apply',
                    header: 'apply',
                    render: (r) => (
                      <Badge
                        tone={statusTone(
                          String((r as { apply_status: string }).apply_status),
                        )}
                      >
                        {String((r as { apply_status: string }).apply_status)}
                      </Badge>
                    ) },
                  {
                    key: 'edges',
                    header: 'edges online/applied',
                    render: (r) => {
                      const row = r as {
                        onlineEdges: number;
                        edgesApplied: number;
                        edgeCount: number;
                      };
                      return `${row.onlineEdges}/${row.edgeCount} · applied ${row.edgesApplied}`;
                    } },
                  {
                    key: 'dns',
                    header: 'CDN DNS RR',
                    render: (r) =>
                      String(
                        (r as { managedDnsRecords: number }).managedDnsRecords,
                      ) },
                ]}
                rows={dashboard.sites.rows}
              />
            ) : null}

            {dashboard?.cache.length ? (
              <Card>
                <CardSection title={t('cdn.cacheHitEstimate')}>
                  <ul className="list-plain list-spaced">
                    {dashboard.cache.map((c) => (
                      <li key={c.siteId}>
                        <strong>{c.siteName}</strong>{' '}
                        <Badge tone={c.hitRatePct != null ? 'ok' : 'warn'}>
                          {c.hitRatePct != null
                            ? `${c.hitRatePct}%`
                            : c.method}
                        </Badge>
                        {c.hits != null ? (
                          <span className="muted u-text-sm">
                            {' '}
                            HIT {c.hits} / MISS {c.misses ?? 0}
                          </span>
                        ) : null}
                        {c.cacheBytes != null ? (
                          <span className="muted u-text-sm">
                            {' '}
                            cache ≈ {c.cacheBytes} B
                          </span>
                        ) : null}
                        {c.notes[0] ? (
                          <p className="muted u-text-sm u-mb-0">{c.notes[0]}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}

            {dashboard?.notes.length ? (
              <Card>
                <CardSection title={t('cdn.dashboardNotes')}>
                  <ul className="notes-list">
                    {dashboard.notes.map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="cdn" /> : null}
      </PageTabs>

      {/* Node modal */}
      <Modal
        open={nodeOpen}
        onClose={bindCloseReset(setNodeOpen, resetNodeForm)}
        title={editNode ? t('cdn.editNode') : t('cdn.addNode')}
        description={t('cdn.nodeAddrHint')}
        footer={
          <>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
              onClick={bindCloseReset(setNodeOpen, resetNodeForm)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="cdn-node-form"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={busy}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <form id="cdn-node-form" onSubmit={bindFormSubmit(onSaveNode)}>
          <FormLayout columns={2}>
            <Field label={t('cdn.colName')} htmlFor="cdn-name" flush required>
              <input
                id="cdn-name"
                value={name}
                onChange={bindInput(setName)}
                required
                placeholder="edge-hkg-1"
              />
            </Field>
            <Field label="Region" htmlFor="cdn-region" flush>
              <input
                id="cdn-region"
                value={region}
                onChange={bindInput(setRegion)}
                placeholder="hkg"
              />
            </Field>
            <Field label={t('cdn.colRole')} htmlFor="cdn-roles" fullWidth flush>
              <div className="u-flex u-flex-wrap gap-2">
                {ROLE_OPTS.map((r) => (
                  <label key={r} className="u-text-sm">
                    <input
                      type="checkbox"
                      checked={roles.includes(r)}
                      onChange={bindToggleInList(setRoles, r)}
                    />{' '}
                    {r}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Public IPv4" htmlFor="cdn-v4" flush>
              <input
                id="cdn-v4"
                value={ipv4}
                onChange={bindInput(setIpv4)}
                placeholder="203.0.113.10"
                spellCheck={false}
              />
            </Field>
            <Field label="Public IPv6" htmlFor="cdn-v6" flush>
              <input
                id="cdn-v6"
                value={ipv6}
                onChange={bindInput(setIpv6)}
                spellCheck={false}
              />
            </Field>
            <Field label="Health URL" htmlFor="cdn-health" flush>
              <input
                id="cdn-health"
                value={healthUrl}
                onChange={bindInput(setHealthUrl)}
                placeholder="https://edge.example.com/health"
                spellCheck={false}
              />
            </Field>
            <Field label="Base URL" htmlFor="cdn-base" flush>
              <input
                id="cdn-base"
                value={baseUrl}
                onChange={bindInput(setBaseUrl)}
                spellCheck={false}
              />
            </Field>
            <Field label="Weight" htmlFor="cdn-w" flush>
              <input
                id="cdn-w"
                value={weight}
                onChange={bindInput(setWeight)}
                inputMode="numeric"
              />
            </Field>
            <Field
              label="SSH host"
              htmlFor="cdn-ssh-host"
              flush
              hint={t('cdn.sshHostHint')}
            >
              <input
                id="cdn-ssh-host"
                value={sshHost}
                onChange={bindInput(setSshHost)}
                placeholder={t('cdn.sshHostPlaceholder')}
                spellCheck={false}
              />
            </Field>
            <Field label={t('cdn.sshUser')} htmlFor="cdn-ssh-user" flush>
              <input
                id="cdn-ssh-user"
                value={sshUsername}
                onChange={bindInput(setSshUsername)}
                placeholder="root"
              />
            </Field>
            <Field label="SSH identity id" htmlFor="cdn-ssh" flush>
              <input
                id="cdn-ssh"
                value={sshIdentityId}
                onChange={bindInput(setSshIdentityId)}
                spellCheck={false}
              />
            </Field>
            <Field
              label="Fleet agent session id"
              htmlFor="cdn-fleet"
              flush
              hint={t('cdn.fleetHint')}
            >
              <input
                id="cdn-fleet"
                value={fleetAgentId}
                onChange={bindInput(setFleetAgentId)}
                placeholder={t('cdn.fleetPlaceholder')}
                spellCheck={false}
              />
            </Field>
          </FormLayout>
        </form>
      </Modal>

      {/* Site modal */}
      <Modal
        open={siteOpen}
        onClose={bindCloseReset(setSiteOpen, resetSiteForm)}
        title={editSite ? t('cdn.editSite') : t('cdn.addSite')}
        description={t('cdn.originHint')}
        footer={
          <>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
              onClick={bindCloseReset(setSiteOpen, resetSiteForm)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="cdn-site-form"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={busy}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <form id="cdn-site-form" onSubmit={bindFormSubmit(onSaveSite)}>
          <FormLayout columns={2}>
            <Field label={t('cdn.colName')} htmlFor="site-name" flush required>
              <input
                id="site-name"
                value={siteName}
                onChange={bindInput(setSiteName)}
                required
                placeholder="my-app-cdn"
              />
            </Field>
            <Field label={t('cdn.colMode')} htmlFor="site-mode" flush>
              <select
                id="site-mode"
                value={mode}
                onChange={bindSelect(setMode as (v: string) => void)}
              >
                {MODE_OPTS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t('cdn.colDomain')}
              htmlFor="site-domains"
              fullWidth
              flush
              required
              hint={t('cdn.commaSeparated')}
            >
              <input
                id="site-domains"
                value={domains}
                onChange={bindInput(setDomains)}
                required
                placeholder="cdn.example.com, www.example.com"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Origin URL"
              htmlFor="site-origin"
              fullWidth
              flush
              required
              hint={t('cdn.originUrl')}
            >
              <input
                id="site-origin"
                value={originUrl}
                onChange={bindInput(setOriginUrl)}
                required
                placeholder="https://origin.example.com"
                spellCheck={false}
              />
            </Field>
            <Field label={t('cdn.edgeNodes')} htmlFor="site-edges" fullWidth flush>
              {edgeNodes.length === 0 ? (
                <p className="muted u-text-sm">{t('cdn.createEdgeFirst')}</p>
              ) : (
                <div className="u-flex u-flex-wrap gap-2">
                  {edgeNodes.map((n) => (
                    <label key={n.id} className="u-text-sm">
                      <input
                        type="checkbox"
                        checked={edgeIds.includes(n.id)}
                        onChange={bindToggleInList(setEdgeIds, n.id)}
                      />{' '}
                      {n.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <Field label={t('cdn.cache')} htmlFor="site-cache" flush>
              <label className="u-text-sm">
                <input
                  type="checkbox"
                  checked={cacheEnabled}
                  onChange={bindCheck(setCacheEnabled)}
                />{' '}
                {t('cdn.enableProxyCache')}
              </label>
            </Field>
            <Field label="maxAge" htmlFor="site-maxage" flush>
              <input
                id="site-maxage"
                value={maxAge}
                onChange={bindInput(setMaxAge)}
                placeholder="10m"
              />
            </Field>
            <Field
              label={t('cdn.dnsPolicy')}
              htmlFor="site-dns-strategy"
              flush
              hint={t('cdn.dnsPolicyHint')}
            >
              <select
                id="site-dns-strategy"
                value={dnsStrategy}
                onChange={bindSelect(setDnsStrategy as (v: string) => void)}
              >
                {DNS_STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="DNS Zone"
              htmlFor="site-zone"
              flush
              hint={t('cdn.zoneOptional')}
            >
              <select
                id="site-zone"
                value={dnsZoneId}
                onChange={bindInput(setDnsZoneId)}
              >
                <option value="">{t('cdn.autoMatch')}</option>
                {dnsZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.zone ?? z.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t('cdn.sslMode')}
              htmlFor="site-ssl"
              flush
              hint={t('cdn.sslModeHint')}
            >
              <select
                id="site-ssl"
                value={sslMode}
                onChange={bindSelect(setSslMode as (v: string) => void)}
              >
                <option value="off">off</option>
                <option value="upload">upload</option>
                <option value="le_http01">le_http01</option>
                <option value="le_dns01">le_dns01</option>
              </select>
            </Field>
            <Field
              label={t('cdn.leEmailOptional')}
              htmlFor="site-ssl-email"
              flush
              hint={t('cdn.leEmailHint')}
            >
              <input
                id="site-ssl-email"
                value={sslEmail}
                onChange={bindInput(setSslEmail)}
                placeholder="admin@example.com"
              />
            </Field>
            <Field
              label="Origin shield"
              htmlFor="site-shield"
              flush
              hint={t('cdn.shieldHint')}
            >
              <select
                id="site-shield"
                value={shieldId}
                onChange={bindInput(setShieldId)}
              >
                <option value="">{t('cdn.none')}</option>
                {edgeNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="geoMap JSON"
              htmlFor="site-geo"
              fullWidth
              flush
              hint={t('cdn.geoMapHint')}
            >
              <textarea
                id="site-geo"
                value={geoMapText}
                onChange={bindInput(setGeoMapText)}
                rows={2}
                placeholder='{"hkg":["edge-id"]}'
                spellCheck={false}
              />
            </Field>
            <Field label={t('cdn.geoSubdomain')} htmlFor="site-geo-sub" flush>
              <label className="u-text-sm">
                <input
                  type="checkbox"
                  checked={geoSubdomains}
                  onChange={bindCheck(setGeoSubdomains)}
                />{' '}
                {t('cdn.writeRegionDns')}
              </label>
            </Field>
          </FormLayout>
          <FormHint>
            {t('cdn.workflowHint')}</FormHint>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(drainTarget)}
        onClose={() => {
          if (!busy) setDrainTarget(null);
        }}
        onConfirm={() => {
          if (!drainTarget) return;
          const { id, draining } = drainTarget;
          setDrainTarget(null);
          void onDrain(id, draining);
        }}
        title={
          drainTarget?.draining
            ? drainTarget.last
              ? t('cdn.drainLastTitle')
              : t('cdn.drainTitle')
            : t('cdn.clearDrainTitle')
        }
        description={
          drainTarget?.draining
            ? drainTarget.last
              ? t('cdn.drainLastDesc', { name: drainTarget.name })
              : t('cdn.drainDesc', { name: drainTarget.name })
            : t('cdn.clearDrainDesc', { name: drainTarget?.name ?? '' })
        }
        confirmLabel={drainTarget?.draining ? t('cdn.drain') : t('cdn.clearDrain')}
        severity="standard"
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delNode)}
        onClose={() => {
          if (!busy) setDelNode(null);
        }}
        onConfirm={() => {
          if (!delNode) return;
          const id = delNode.id;
          setDelNode(null);
          void onDeleteNode(id);
        }}
        title={t('cdn.confirmDeleteNode')}
        description={t('cdn.deleteNodeDesc', { name: delNode?.name ?? '' })}
        confirmLabel={t('common.delete')}
        severity="standard"
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(siteOp)}
        onClose={() => {
          if (!busy) setSiteOp(null);
        }}
        onConfirm={() => {
          if (!siteOp) return;
          const next = siteOp;
          setSiteOp(null);
          void postSiteOp(next.id, next.action, next.body ?? {});
        }}
        title={t(`cdn.siteOpConfirm.${siteOp?.action === 'ssl/issue' ? 'issue' : siteOp?.action === 'ssl/distribute' ? 'dist' : siteOp?.action ?? 'apply'}`, {
          defaultValue: t('cdn.siteOpConfirmGeneric', { name: siteOp?.name ?? '' }),
        })}
        description={t('cdn.siteOpConfirmDesc', {
          name: siteOp?.name ?? '',
          action: siteOp?.action ?? '',
        })}
        confirmLabel={t('common.confirm')}
        severity="standard"
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delSite)}
        onClose={() => {
          if (!busy) setDelSite(null);
        }}
        onConfirm={() => {
          if (!delSite) return;
          const id = delSite.id;
          setDelSite(null);
          void onDeleteSite(id);
        }}
        title={t('cdn.confirmDeleteSite')}
        description={t('cdn.deleteSiteDesc', { name: delSite?.name ?? '' })}
        consequences={[
          t('cdn.deleteSiteC1'),
          t('cdn.deleteSiteC2'),
        ]}
        confirmLabel={t('common.delete')}
        severity="destructive"
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
