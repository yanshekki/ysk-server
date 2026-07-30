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
            ? '已從專案建立 CDN 站點 — 請套用 edges / DNS'
            : '已更新專案綁定嘅 CDN 站點',
        );
        setTab('sites');
        await refresh();
        if (r.site) openEditSite(r.site);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'from-project 失敗');
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
        }),
      });
      setNodeOpen(false);
      resetNodeForm();
      setMsg(editNode ? '節點已更新' : '節點已建立');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '儲存失敗');
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
          setMsg('geoMap JSON 無效，例：{"hkg":["node-id"]}');
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
      setMsg(editSite ? '站點已更新' : '站點已建立');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '儲存失敗');
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
      setMsg(r.ok ? '探活成功（online）' : '探活失敗（offline）');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '探活失敗');
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
      setMsg(r.ok ? '全部節點探活完成' : '部分／全部節點不健康');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '批次探活失敗');
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
      setMsg(draining ? '已設為 draining' : '已解除 drain');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteNode(id: string) {
    if (!window.confirm('確定刪除此 CDN 節點？')) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/nodes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setMsg('已刪除節點');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '刪除失敗');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSite(id: string) {
    if (!window.confirm('確定刪除此 CDN 站點？')) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/sites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setMsg('已刪除站點');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '刪除失敗');
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
        setMsg('已封鎖（需系統變更權限）');
      } else if (action === 'render' && body.dryRun) {
        setMsg(
          `預覽渲染（${r.apply_status ?? 'planned'}）hash=${r.contentHash ?? '—'}`,
        );
      } else if (r.ok) {
        setMsg(
          action === 'apply'
            ? `Fan-out 完成（${r.apply_status}）`
            : action === 'purge'
              ? `Purge 完成（${r.apply_status}）`
              : action === 'dns-sync' || action === 'health-loop'
                ? `DNS 同步完成（${r.apply_status}）`
                : action.startsWith('ssl/')
                  ? `SSL 操作完成（${r.apply_status}）`
                  : `已寫入 conf（${r.apply_status}）`,
        );
      } else {
        setMsg(
          `未全部成功（${r.apply_status ?? res.status}）— 見 notes`,
        );
      }
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '操作失敗');
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
      title={t('nav.cdn', { defaultValue: 'CDN' })}
      showCapability={false}
      status={{
        pill: {
          label: `${nodes.length}n / ${sites.length}s`,
          tone: nodes.length ? 'ok' : 'warn',
        },
        items: [
          { label: '節點', value: nodes.length },
          { label: 'Online', value: online },
          { label: '站點', value: sites.length },
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
            重新整理
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
            關閉
          </button>
        </Alert>
      ) : null}
      {notes.length ? (
        <Card>
          <CardSection title="最近 notes">
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
          <CardSection title="Nginx edge conf 預覽">
            <pre
              className="u-text-sm"
              style={{
                maxHeight: 320,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {confPreview}
            </pre>
            <FormActions>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfPreview(null)}
              >
                關閉預覽
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'nodes', label: '節點', badge: nodes.length || undefined },
          { id: 'sites', label: '站點', badge: sites.length || undefined },
          { id: 'dashboard', label: '儀表' },
          { id: 'about', label: '說明' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'nodes' ? (
          <div className="tab-panel">
            <DataTable<CdnNodeDto>
              rowKey={(r) => r.id}
              title={`CDN 節點（${nodes.length}）`}
              description="登記 control / origin / edge / dns。探活更新 status。"
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreateNode}>
                    + 新增節點
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!nodes.length}
                    onClick={() => void onProbeAll()}
                  >
                    全部探活
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: '名稱',
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
                  header: '角色',
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
                  header: '狀態',
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
                        探活
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void onDrain(n.id, n.status !== 'draining')
                        }
                      >
                        {n.status === 'draining' ? '解除 drain' : 'Drain'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void onDeleteNode(n.id)}
                      >
                        刪除
                      </Button>
                    </ActionBar>
                  ),
                },
              ]}
              rows={nodes}
              empty={
                <EmptyState
                  title="尚未登記 CDN 節點"
                  description="請使用右上角「+ 新增節點」登記 edge，再建立站點。"
                />
              }
            />
          </div>
        ) : null}

        {tab === 'sites' ? (
          <div className="tab-panel">
            <DataTable<CdnSiteDto>
              rowKey={(r) => r.id}
              title={`CDN 站點（${sites.length}）`}
              description="域名 + origin + edges + cache + multi-A DNS。套用 edges / DNS 同步 / purge。"
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openCreateSite}
                    disabled={!nodes.length}
                  >
                    + 新增站點
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
                              ? '全部站點健康迴圈完成'
                              : '健康迴圈部分失敗',
                          );
                          await refresh();
                        } catch (e) {
                          setMsg(
                            e instanceof Error ? e.message : 'health-loop 失敗',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    全站健康迴圈
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: '名稱',
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
                  header: '域名',
                  render: (s) => (
                    <code className="inline u-text-sm">
                      {s.domains.join(', ')}
                    </code>
                  ),
                },
                {
                  key: 'mode',
                  header: '模式',
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
                        預覽
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'render', { dryRun: false })
                        }
                      >
                        寫入 conf
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => void postSiteOp(s.id, 'apply', {})}
                      >
                        套用 edges
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
                        DNS 同步
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'health-loop', {})
                        }
                      >
                        探活+DNS
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void postSiteOp(s.id, 'ssl/distribute', {})
                        }
                      >
                        分發 SSL
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
                        LE 簽發
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void onDeleteSite(s.id)}
                      >
                        刪除
                      </Button>
                    </ActionBar>
                  ),
                },
              ]}
              rows={sites}
              empty={
                <EmptyState
                  title="尚未有 CDN 站點"
                  description={
                    nodes.length
                      ? '請用表格右上角「+ 新增站點」建立站點。'
                      : '尚無 edge：先到「節點」分頁，用表格右上角「+ 新增節點」登記，再回來建立站點。'
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
                title="CDN 儀表"
                description={
                  dashboard
                    ? `更新於 ${new Date(dashboard.at).toLocaleString()}`
                    : '載入中…'
                }
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void refreshDashboard()}
                  >
                    重新彙總
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
                          : '未知'}
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
                  <EmptyState title="尚未載入儀表" />
                )}
              </CardSection>
            </Card>

            {dashboard?.sites.rows.length ? (
              <DataTable
                rowKey={(r) => String((r as { id: string }).id)}
                title="站點狀態"
                columns={[
                  {
                    key: 'name',
                    header: '站點',
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
                <CardSection title="快取命中率粗估">
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
                <CardSection title="儀表 notes">
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
        title={editNode ? '編輯 CDN 節點' : '新增 CDN 節點'}
        description="至少填 IPv4 / IPv6 / healthUrl / baseUrl 其中一項"
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
              取消
            </button>
            <button
              type="submit"
              form="cdn-node-form"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={busy}
            >
              儲存
            </button>
          </>
        }
      >
        <form id="cdn-node-form" onSubmit={(e) => void onSaveNode(e)}>
          <FormLayout columns={2}>
            <Field label="名稱" htmlFor="cdn-name" flush required>
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
            <Field label="角色" htmlFor="cdn-roles" fullWidth flush>
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
              hint="可空＝用 IPv4；127.0.0.1＝本機 local apply"
            >
              <input
                id="cdn-ssh-host"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="留空用 public IPv4"
                spellCheck={false}
              />
            </Field>
            <Field label="SSH 用戶" htmlFor="cdn-ssh-user" flush>
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
        title={editSite ? '編輯 CDN 站點' : '新增 CDN 站點'}
        description="origin 先支援 URL；project 綁定後續強化"
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
              取消
            </button>
            <button
              type="submit"
              form="cdn-site-form"
              className={buttonClassName({ variant: 'primary', size: 'md' })}
              disabled={busy}
            >
              儲存
            </button>
          </>
        }
      >
        <form id="cdn-site-form" onSubmit={(e) => void onSaveSite(e)}>
          <FormLayout columns={2}>
            <Field label="名稱" htmlFor="site-name" flush required>
              <input
                id="site-name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                required
                placeholder="my-app-cdn"
              />
            </Field>
            <Field label="模式" htmlFor="site-mode" flush>
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
              label="域名"
              htmlFor="site-domains"
              fullWidth
              flush
              required
              hint="逗號分隔"
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
              hint="edge 回源地址"
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
            <Field label="Edge 節點" htmlFor="site-edges" fullWidth flush>
              {edgeNodes.length === 0 ? (
                <p className="muted u-text-sm">請先建立 edge 節點</p>
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
            <Field label="快取" htmlFor="site-cache" flush>
              <label className="u-text-sm">
                <input
                  type="checkbox"
                  checked={cacheEnabled}
                  onChange={(e) => setCacheEnabled(e.target.checked)}
                />{' '}
                啟用 proxy_cache
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
              label="DNS 策略"
              htmlFor="site-dns-strategy"
              flush
              hint="multi_a=多 IP；failover=只寫最健康一顆"
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
              hint="可空＝依域名自動匹配 zone"
            >
              <select
                id="site-zone"
                value={dnsZoneId}
                onChange={(e) => setDnsZoneId(e.target.value)}
              >
                <option value="">（自動匹配）</option>
                {dnsZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.zone ?? z.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="SSL 模式"
              htmlFor="site-ssl"
              flush
              hint="upload＝SSL 頁已有憑證；le_http01＝edge ACME"
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
              label="LE email（可選）"
              htmlFor="site-ssl-email"
              flush
              hint="簽發時預填"
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
              hint="非 shield edge 經此節點回源"
            >
              <select
                id="site-shield"
                value={shieldId}
                onChange={(e) => setShieldId(e.target.value)}
              >
                <option value="">（無）</option>
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
              hint='strategy=geo 時用，例 {"hkg":["id1"],"nrt":["id2"]}'
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
            <Field label="geo 子域名" htmlFor="site-geo-sub" flush>
              <label className="u-text-sm">
                <input
                  type="checkbox"
                  checked={geoSubdomains}
                  onChange={(e) => setGeoSubdomains(e.target.checked)}
                />{' '}
                寫入 region 子域名 A/AAAA（如 hkg）
              </label>
            </Field>
          </FormLayout>
          <FormHint>
            流程：寫入 conf → 套用 edges → 探活+DNS → SSL。專案一鍵：
            /cdn?fromProject=專案ID
          </FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
