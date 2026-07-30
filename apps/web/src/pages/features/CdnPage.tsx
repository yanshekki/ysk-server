/**
 * CDN — PR-C1 nodes + PR-C2 sites/render（未 fan-out / multi-A）
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import type {
  CdnNodeDto,
  CdnNodeRole,
  CdnSiteDto,
  CdnSiteMode,
} from '@ysk/shared';

const TABS = ['nodes', 'sites', 'about'] as const;
const ROLE_OPTS: CdnNodeRole[] = ['control', 'origin', 'edge', 'dns'];
const MODE_OPTS: CdnSiteMode[] = [
  'origin_pull',
  'reverse_proxy',
  'static_edge',
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

  const refresh = useCallback(async () => {
    const [n, s] = await Promise.all([
      api.requestRaw<{ items: CdnNodeDto[] }>('/api/v1/cdn/nodes'),
      api.requestRaw<{ items: CdnSiteDto[] }>('/api/v1/cdn/sites'),
    ]);
    setNodes(n.items ?? []);
    setSites(s.items ?? []);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setMsg(e.message));
  }, [refresh]);

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
          cache: {
            enabled: cacheEnabled,
            maxAge: maxAge.trim() || '10m',
            zoneSize: '10m',
            bypassCookies: true,
            bypassAuth: true,
          },
          dns: {
            strategy: 'multi_a',
            ttlHealthy: 60,
            ttlUnhealthy: 30,
            minHealthyEdges: 1,
          },
          ssl: { mode: 'off' },
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
    action: 'render' | 'apply' | 'purge',
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
        ],
      }}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
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
                  description="請先新增 edge 節點，再建立站點。"
                  action={
                    <Button variant="primary" size="md" onClick={openCreateNode}>
                      + 新增節點
                    </Button>
                  }
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
              description="域名 + origin + edges + cache。渲染寫入控制面 conf；fan-out 見 PR-C3。"
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
                      ? '建立站點並渲染 edge nginx 模板'
                      : '請先在「節點」分頁登記 edge'
                  }
                  action={
                    nodes.length ? (
                      <Button variant="primary" size="md" onClick={openCreateSite}>
                        + 新增站點
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setTab('nodes')}
                      >
                        前往節點
                      </Button>
                    )
                  }
                />
              }
            />
          </div>
        ) : null}

        {tab === 'about' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="自建 CDN 路線（誠實）">
                <ul className="list-plain list-spaced">
                  <li>
                    <strong>PR-C1</strong>：節點 registry、探活、drain ✓
                  </li>
                  <li>
                    <strong>PR-C2</strong>：site 政策 + Nginx edge 渲染 ✓
                  </li>
                  <li>
                    <strong>PR-C3（套用 edges / purge）</strong>：SSH/local
                    fan-out + cache purge ✓
                  </li>
                  <li>
                    <strong>PR-C4 MVP</strong>：multi-A / failover DNS
                  </li>
                </ul>
                <FormHint>
                  partial = 部分 edge 失敗。draining 節點預設略過。詳見{' '}
                  <code className="inline">docs/product/dns-cdn-design.md</code>
                </FormHint>
              </CardSection>
            </Card>
          </div>
        ) : null}
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
          </FormLayout>
          <FormHint>
            儲存後按「寫入 conf」產生 edge nginx 模板（控制面 written）。遠端套用屬
            PR-C3。
          </FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
