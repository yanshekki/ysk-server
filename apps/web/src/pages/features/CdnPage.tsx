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
  PageGuide,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import type {
  CdnDnsStrategy,
  CdnNodeDto,
  CdnNodeRole,
  CdnSiteDto,
  CdnSiteMode,
} from '@ysk/shared';

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

function statusTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (s === 'online' || s === 'applied' || s === 'written') return 'ok';
  if (s === 'draining' || s === 'planned' || s === 'partial') return 'warn';
  if (s === 'offline' || s === 'failed') return 'danger';
  return 'neutral';
}

export function CdnPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'nodes');
  const [nodes, setNodes] = useState<CdnNodeDto[]>([]);
  const [sites, setSites] = useState<CdnSiteDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
  const [sshUsername, setSshUsername] = useState('root');
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

  const refresh = useCallback(async () => {
    const [n, s, z] = await Promise.all([
      api.requestRaw<{ items: CdnNodeDto[] }>('/api/v1/cdn/nodes'),
      api.requestRaw<{ items: CdnSiteDto[] }>('/api/v1/cdn/sites'),
      api
        .requestRaw<{ items: Array<{ id: string; zone?: string }> }>(
          '/api/v1/resources/dns/zones',
        )
        .catch(() => ({ items: [] as Array<{ id: string; zone?: string }> })),
    ]);
    setNodes(n.items ?? []);
    setSites(s.items ?? []);
    setDnsZones(z.items ?? []);
  }, []);

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
          body: JSON.stringify({ projectId: pid }),
        });
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
    setEdgeIds(
      nodes.filter((n) => n.roles.includes('edge')).map((n) => n.id).slice(0, 1),
    );
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
    setRoles(n.roles?.length ? n.roles : ['edge']);
    setIpv4((n.publicIpv4 ?? []).join(', '));
    setIpv6((n.publicIpv6 ?? []).join(', '));
    setHealthUrl(n.healthUrl ?? '');
    setBaseUrl(n.baseUrl ?? '');
    setWeight(String(n.weight ?? 100));
    setSshIdentityId(n.sshIdentityId ?? '');
    setSshHost(n.sshHost ?? '');
    setSshUsername(n.sshUsername ?? 'root');
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
    setDomains(s.domains.join(', '));
    setMode(s.mode);
    setOriginUrl(s.origin.url ?? '');
    setEdgeIds(s.edgeNodeIds ?? []);
    setCacheEnabled(s.cache?.enabled !== false);
    setMaxAge(s.cache?.maxAge ?? '10m');
    setDnsStrategy(s.dns?.strategy ?? 'multi_a');
    setDnsZoneId(s.dns?.zoneId ?? '');
    setSslMode(s.ssl?.mode ?? 'off');
    setShieldId(s.originShieldNodeId ?? '');
    setGeoMapText(
      s.dns?.geoMap ? JSON.stringify(s.dns.geoMap, null, 0) : '',
    );
    setGeoSubdomains(Boolean(s.dns?.geoSubdomains));
    setSiteOpen(true);
  }

  function toggleRole(r: CdnNodeRole) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  function toggleEdge(id: string) {
    setEdgeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSaveNode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.requestRaw('/api/v1/cdn/nodes', {
        method: 'POST',
        body: JSON.stringify({
          id: editNode?.id,
          name: name.trim(),
          region: region.trim() || 'default',
          roles: roles.length ? roles : ['edge'],
          publicIpv4: ipv4
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          publicIpv6: ipv6
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          healthUrl: healthUrl.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          weight: Number(weight) || 100,
          sshIdentityId: sshIdentityId.trim() || undefined,
          sshHost: sshHost.trim() || undefined,
          sshUsername: sshUsername.trim() || undefined,
          fleetAgentId: fleetAgentId.trim() || undefined,
        }),
      });
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
        try {
          geoMap = JSON.parse(geoMapText) as Record<string, string[]>;
        } catch {
          setMsg(t('cdn.geoMapInvalid'));
          setBusy(false);
          return;
        }
      }
      await api.requestRaw('/api/v1/cdn/sites', {
        method: 'POST',
        body: JSON.stringify({
          id: editSite?.id,
          name: siteName.trim(),
          domains: domains
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          mode,
          origin: { kind: 'url', url: originUrl.trim() },
          edgeNodeIds: edgeIds,
          originShieldNodeId: shieldId.trim() || null,
          cache: {
            enabled: cacheEnabled,
            maxAge: maxAge.trim() || '10m',
            zoneSize: '10m',
            bypassCookies: true,
            bypassAuth: true,
          },
          dns: {
            strategy: dnsStrategy,
            zoneId: dnsZoneId.trim() || undefined,
            ttlHealthy: 60,
            ttlUnhealthy: 30,
            minHealthyEdges: 1,
            geoMap,
            geoSubdomains,
          },
          ssl: { mode: sslMode },
        }),
      });
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
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: '{}',
        },
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      });
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
          body: JSON.stringify({ draining }),
        },
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
    if (!window.confirm(t('cdn.confirmDeleteNode'))) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/nodes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setMsg(t('cdn.nodeDeleted'));
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('cdn.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSite(id: string) {
    if (!window.confirm(t('cdn.confirmDeleteSite'))) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/sites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
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
    action:
      | 'render'
      | 'apply'
      | 'purge'
      | 'dns-sync'
      | 'health-loop'
      | 'ssl/distribute'
      | 'ssl/issue'
      | 'ssl/prepare-acme',
    body: Record<string, unknown> = {},
  ) {
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
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        },
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
      setNotes([
        ...(r.notes ?? []),
        ...(r.edges ?? []).flatMap((e) =>
          (e.notes ?? []).map((n) => `${e.name ?? '?'}: ${n}`),
        ),
      ]);
      if (r.conf) setConfPreview(r.conf);
      if (r.blocked) {
        setMsg(t('cdn.blocked'));
      } else if (action === 'render' && body.dryRun) {
        setMsg(
          t('cdn.previewRender', { status: r.apply_status ?? 'planned', hash: r.contentHash ?? '—' }),
        );
      } else if (r.ok) {
        setMsg(
          action === 'apply'
            ? t('cdn.fanoutDone', { status: r.apply_status })
            : action === 'purge'
              ? t('cdn.purgeDone', { status: r.apply_status })
              : action === 'dns-sync' || action === 'health-loop'
                ? t('cdn.dnsSyncDone', { status: r.apply_status })
                : action.startsWith('ssl/')
                  ? t('cdn.sslDone', { status: r.apply_status })
                  : t('cdn.confWritten', { status: r.apply_status }),
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

  const online = nodes.filter((n) => n.status === 'online').length;
  const edgeNodes = nodes.filter(
    (n) => n.roles.includes('edge') || n.roles.includes('origin'),
  );

  return (
    <FeaturePageLayout
      title={t('nav.cdn')}
      showCapability={false}
      status={{
        pill: {
          label: `${nodes.length}n / ${sites.length}s`,
          tone: nodes.length ? 'ok' : 'warn',
        },
        items: [
          { label: t('cdn.statNodes'), value: nodes.length },
          { label: 'Online', value: online },
          { label: t('cdn.statSites'), value: sites.length },
          {
            label: 'Hit%',
            value:
              dashboard?.overallHitRatePct != null
                ? `${dashboard.overallHitRatePct}%`
                : '—',
          },
        ],
      }}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void refresh();
              if (tab === 'dashboard') void refreshDashboard();
            }}
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
      {msg ? (
        <Alert variant={/失敗|不健康|offline/i.test(msg) ? 'error' : 'ok'}>
          {msg}{' '}
          <button
            type="button"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            onClick={() => setMsg(null)}
          >
            {t('common.close')}
          </button>
        </Alert>
      ) : null}
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
                onClick={() => setConfPreview(null)}
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
              title={t('cdn.nodesTitle', { count: nodes.length })}
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
                    onClick={() => void onProbeAll()}
                  >
                    {t('cdn.probeAll')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: t('cdn.colName'),
                  render: (n) => (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openEditNode(n)}
                    >
                      {n.name}
                    </button>
                  ),
                },
                {
                  key: 'region',
                  header: 'Region',
                  render: (n) => n.region,
                },
                {
                  key: 'roles',
                  header: t('cdn.colRole'),
                  render: (n) =>
                    n.roles.map((role) => (
                      <Badge key={role} className="u-mr-1">
                        {role}
                      </Badge>
                    )),
                },
                {
                  key: 'ip',
                  header: 'IP',
                  render: (n) => (
                    <code className="inline u-text-sm">
                      {(n.publicIpv4 ?? []).join(', ') ||
                        (n.publicIpv6 ?? [])[0] ||
                        '—'}
                    </code>
                  ),
                },
                {
                  key: 'status',
                  header: t('cdn.colStatus'),
                  render: (n) => (
                    <Badge tone={statusTone(n.status)}>{n.status}</Badge>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (n) => (
                    <ActionBar>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void onProbe(n.id)}
                      >
                        {t('cdn.probe')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void onDrain(n.id, n.status !== 'draining')
                        }
                      >
                        {n.status === 'draining' ? t('cdn.clearDrain') : 'Drain'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void onDeleteNode(n.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  ),
                },
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
              title={t('cdn.sitesTitle', { count: sites.length })}
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
                                : {}),
                            },
                            body: '{}',
                          });
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
              columns={[
                {
                  key: 'name',
                  header: t('cdn.colName'),
                  render: (s) => (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openEditSite(s)}
                    >
                      {s.name}
                    </button>
                  ),
                },
                {
                  key: 'domains',
                  header: t('cdn.colDomain'),
                  render: (s) => (
                    <code className="inline u-text-sm">
                      {s.domains.join(', ')}
                    </code>
                  ),
                },
                {
                  key: 'mode',
                  header: t('cdn.colMode'),
                  render: (s) => s.mode,
                },
                {
                  key: 'origin',
                  header: 'Origin',
                  render: (s) => (
                    <span className="u-text-sm muted">
                      {s.origin.kind === 'url'
                        ? s.origin.url
                        : `project:${s.origin.projectId}`}
                    </span>
                  ),
                },
                {
                  key: 'edges',
                  header: 'Edges',
                  render: (s) => s.edgeNodeIds.length,
                },
                {
                  key: 'status',
                  header: 'apply',
                  render: (s) => (
                    <Badge tone={statusTone(s.apply_status)}>
                      {s.apply_status}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (s) => (
                    <ActionBar>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'render', { dryRun: true })
                        }
                      >
                        {t('cdn.preview')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'render', { dryRun: false })
                        }
                      >
                        {t('cdn.writeConf')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => void postSiteOp(s.id, 'apply', {})}
                      >
                        {t('cdn.applyEdges')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void postSiteOp(s.id, 'purge', {})}
                      >
                        Purge
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'dns-sync', {
                            probeFirst: false,
                          })
                        }
                      >
                        {t('cdn.dnsSync')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'health-loop', {})
                        }
                      >
                        {t('cdn.probeDns')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'ssl/distribute', {})
                        }
                      >
                        {t('cdn.distSsl')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const email =
                            sslEmail.trim() ||
                            window.prompt('Let’s Encrypt email') ||
                            '';
                          if (!email) return;
                          void postSiteOp(s.id, 'ssl/issue', {
                            email,
                            run: true,
                            distribute: true,
                          });
                        }}
                      >
                        {t('cdn.leIssue')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void onDeleteSite(s.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  ),
                },
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
                    ? t('cdn.updatedAt', { at: new Date(dashboard.at).toLocaleString() })
                    : t('common.loading')
                }
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void refreshDashboard()}
                  >
                    {t('cdn.reaggregate')}
                  </Button>
                </FormActions>
                {dashboard ? (
                  <>
                    <div className="u-flex u-flex-wrap gap-3 u-mt-2">
                      <Badge tone="ok">
                        online {dashboard.nodes.online}/{dashboard.nodes.total}
                      </Badge>
                      <Badge tone="danger">
                        offline {dashboard.nodes.offline}
                      </Badge>
                      <Badge tone="warn">
                        draining {dashboard.nodes.draining}
                      </Badge>
                      <Badge tone="neutral">
                        sites {dashboard.sites.total}
                      </Badge>
                      <Badge
                        tone={
                          dashboard.overallHitRatePct != null ? 'ok' : 'warn'
                        }
                      >
                        hit-rate{' '}
                        {dashboard.overallHitRatePct != null
                          ? `${dashboard.overallHitRatePct}%`
                          : t('common.unknown')}
                      </Badge>
                    </div>
                    {Object.keys(dashboard.nodes.byRegion).length ? (
                      <p className="muted u-text-sm u-mt-2">
                        Region：{' '}
                        {Object.entries(dashboard.nodes.byRegion)
                          .map(([r, c]) => `${r}=${c}`)
                          .join(' · ')}
                      </p>
                    ) : null}
                    {Object.keys(dashboard.sites.byApplyStatus).length ? (
                      <p className="muted u-text-sm">
                        apply_status：{' '}
                        {Object.entries(dashboard.sites.byApplyStatus)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(' · ')}
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
                    render: (r) => String((r as { name: string }).name),
                  },
                  {
                    key: 'strategy',
                    header: 'DNS',
                    render: (r) =>
                      String((r as { strategy: string }).strategy),
                  },
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
                    ),
                  },
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
                    },
                  },
                  {
                    key: 'dns',
                    header: 'CDN DNS RR',
                    render: (r) =>
                      String(
                        (r as { managedDnsRecords: number }).managedDnsRecords,
                      ),
                  },
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
        onClose={() => {
          setNodeOpen(false);
          resetNodeForm();
        }}
        title={editNode ? t('cdn.editNode') : t('cdn.addNode')}
        description={t('cdn.nodeAddrHint')}
        footer={
          <>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
              onClick={() => {
                setNodeOpen(false);
                resetNodeForm();
              }}
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
        <form id="cdn-node-form" onSubmit={(e) => void onSaveNode(e)}>
          <FormLayout columns={2}>
            <Field label={t('cdn.colName')} htmlFor="cdn-name" flush required>
              <input
                id="cdn-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="edge-hkg-1"
              />
            </Field>
            <Field label="Region" htmlFor="cdn-region" flush>
              <input
                id="cdn-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
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
                      onChange={() => toggleRole(r)}
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
                onChange={(e) => setIpv4(e.target.value)}
                placeholder="203.0.113.10"
                spellCheck={false}
              />
            </Field>
            <Field label="Public IPv6" htmlFor="cdn-v6" flush>
              <input
                id="cdn-v6"
                value={ipv6}
                onChange={(e) => setIpv6(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label="Health URL" htmlFor="cdn-health" flush>
              <input
                id="cdn-health"
                value={healthUrl}
                onChange={(e) => setHealthUrl(e.target.value)}
                placeholder="https://edge.example.com/health"
                spellCheck={false}
              />
            </Field>
            <Field label="Base URL" htmlFor="cdn-base" flush>
              <input
                id="cdn-base"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label="Weight" htmlFor="cdn-w" flush>
              <input
                id="cdn-w"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
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
                onChange={(e) => setSshHost(e.target.value)}
                placeholder={t('cdn.sshHostPlaceholder')}
                spellCheck={false}
              />
            </Field>
            <Field label={t('cdn.sshUser')} htmlFor="cdn-ssh-user" flush>
              <input
                id="cdn-ssh-user"
                value={sshUsername}
                onChange={(e) => setSshUsername(e.target.value)}
                placeholder="root"
              />
            </Field>
            <Field label="SSH identity id" htmlFor="cdn-ssh" flush>
              <input
                id="cdn-ssh"
                value={sshIdentityId}
                onChange={(e) => setSshIdentityId(e.target.value)}
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
                onChange={(e) => setFleetAgentId(e.target.value)}
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
        onClose={() => {
          setSiteOpen(false);
          resetSiteForm();
        }}
        title={editSite ? t('cdn.editSite') : t('cdn.addSite')}
        description={t('cdn.originHint')}
        footer={
          <>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
              onClick={() => {
                setSiteOpen(false);
                resetSiteForm();
              }}
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
        <form id="cdn-site-form" onSubmit={(e) => void onSaveSite(e)}>
          <FormLayout columns={2}>
            <Field label={t('cdn.colName')} htmlFor="site-name" flush required>
              <input
                id="site-name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                required
                placeholder="my-app-cdn"
              />
            </Field>
            <Field label={t('cdn.colMode')} htmlFor="site-mode" flush>
              <select
                id="site-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as CdnSiteMode)}
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
                onChange={(e) => setDomains(e.target.value)}
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
                onChange={(e) => setOriginUrl(e.target.value)}
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
                        onChange={() => toggleEdge(n.id)}
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
                  onChange={(e) => setCacheEnabled(e.target.checked)}
                />{' '}
                {t('cdn.enableProxyCache')}
              </label>
            </Field>
            <Field label="maxAge" htmlFor="site-maxage" flush>
              <input
                id="site-maxage"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
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
                onChange={(e) =>
                  setDnsStrategy(e.target.value as CdnDnsStrategy)
                }
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
                onChange={(e) => setDnsZoneId(e.target.value)}
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
                onChange={(e) =>
                  setSslMode(
                    e.target.value as
                      | 'off'
                      | 'upload'
                      | 'le_http01'
                      | 'le_dns01',
                  )
                }
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
                onChange={(e) => setSslEmail(e.target.value)}
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
                onChange={(e) => setShieldId(e.target.value)}
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
                onChange={(e) => setGeoMapText(e.target.value)}
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
                  onChange={(e) => setGeoSubdomains(e.target.checked)}
                />{' '}
                {t('cdn.writeRegionDns')}
              </label>
            </Field>
          </FormLayout>
          <FormHint>
            {t('cdn.workflowHint')}</FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
