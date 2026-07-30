/**
 * CDN 節點登記（PR-C1）— 尚未派發 nginx / multi-A（C2+）
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
import type { CdnNodeDto, CdnNodeRole } from '@ysk/shared';

const TABS = ['nodes', 'about'] as const;
const ROLE_OPTS: CdnNodeRole[] = ['control', 'origin', 'edge', 'dns'];

function statusTone(
  s: string,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (s === 'online') return 'ok';
  if (s === 'draining') return 'warn';
  if (s === 'offline') return 'danger';
  return 'neutral';
}

export function CdnPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'nodes');
  const [nodes, setNodes] = useState<CdnNodeDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<CdnNodeDto | null>(null);

  const [name, setName] = useState('');
  const [region, setRegion] = useState('default');
  const [roles, setRoles] = useState<CdnNodeRole[]>(['edge']);
  const [ipv4, setIpv4] = useState('');
  const [ipv6, setIpv6] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [weight, setWeight] = useState('100');
  const [sshIdentityId, setSshIdentityId] = useState('');

  const refresh = useCallback(async () => {
    const r = await api.requestRaw<{ items: CdnNodeDto[] }>('/api/v1/cdn/nodes');
    setNodes(r.items ?? []);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setMsg(e.message));
  }, [refresh]);

  function resetForm() {
    setEdit(null);
    setName('');
    setRegion('default');
    setRoles(['edge']);
    setIpv4('');
    setIpv6('');
    setHealthUrl('');
    setBaseUrl('');
    setWeight('100');
    setSshIdentityId('');
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(n: CdnNodeDto) {
    setEdit(n);
    setName(n.name);
    setRegion(n.region || 'default');
    setRoles(n.roles?.length ? n.roles : ['edge']);
    setIpv4((n.publicIpv4 ?? []).join(', '));
    setIpv6((n.publicIpv6 ?? []).join(', '));
    setHealthUrl(n.healthUrl ?? '');
    setBaseUrl(n.baseUrl ?? '');
    setWeight(String(n.weight ?? 100));
    setSshIdentityId(n.sshIdentityId ?? '');
    setOpen(true);
  }

  function toggleRole(r: CdnNodeRole) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.requestRaw('/api/v1/cdn/nodes', {
        method: 'POST',
        body: JSON.stringify({
          id: edit?.id,
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
        }),
      });
      setOpen(false);
      resetForm();
      setMsg(edit ? '節點已更新' : '節點已建立');
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
      const r = await api.requestRaw<{
        ok: boolean;
        notes?: string[];
        node?: CdnNodeDto;
      }>(`/api/v1/cdn/nodes/${encodeURIComponent(id)}/probe`, {
        method: 'POST',
        body: '{}',
      }).catch(async (e) => {
        // 422 still has body — try refresh
        await refresh();
        throw e;
      });
      setNotes(r.notes ?? []);
      setMsg(r.ok ? '探活成功（online）' : '探活失敗（offline）');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '探活失敗');
      await refresh().catch(() => undefined);
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
      const r = (await res.json()) as {
        ok?: boolean;
        notes?: string[];
      };
      setNotes(r.notes ?? []);
      setMsg(
        r.ok
          ? '全部節點探活完成'
          : '部分／全部節點不健康 — 見 notes',
      );
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

  async function onDelete(id: string) {
    if (!window.confirm('確定刪除此 CDN 節點？')) return;
    setBusy(true);
    try {
      await api.requestRaw(`/api/v1/cdn/nodes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setMsg('已刪除');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '刪除失敗');
    } finally {
      setBusy(false);
    }
  }

  const online = nodes.filter((n) => n.status === 'online').length;
  const edgeCount = nodes.filter((n) => n.roles.includes('edge')).length;

  return (
    <FeaturePageLayout
      title={t('nav.cdn', { defaultValue: 'CDN' })}
      showCapability={false}
      status={{
        pill: {
          label: `${nodes.length} nodes`,
          tone: nodes.length ? 'ok' : 'warn',
        },
        items: [
          { label: '節點', value: nodes.length },
          { label: 'Online', value: online },
          { label: 'Edge', value: edgeCount },
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

      <PageTabs
        tabs={[
          { id: 'nodes', label: '節點', badge: nodes.length || undefined },
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
              description="登記 control / origin / edge / dns。探活更新 status；nginx 派發見後續 PR-C2。"
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreate}>
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
                      onClick={() => openEdit(n)}
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
                  key: 'health',
                  header: '上次探活',
                  render: (n) => {
                    if (!n.lastHealth) return '—';
                    return (
                      <span className="muted u-text-sm">
                        {n.lastHealth.ok ? 'ok' : 'fail'}
                        {n.lastHealth.latencyMs != null
                          ? ` ${n.lastHealth.latencyMs}ms`
                          : ''}
                      </span>
                    );
                  },
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
                      {n.status === 'draining' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() => void onDrain(n.id, false)}
                        >
                          解除 drain
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() => void onDrain(n.id, true)}
                        >
                          Drain
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void onDelete(n.id)}
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
                  description="新增至少兩個 edge 與一個 origin，供後續 multi-A。"
                  action={
                    <Button variant="primary" size="md" onClick={openCreate}>
                      + 新增節點
                    </Button>
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
                    <strong>PR-C1（本頁）</strong>：節點 registry、HTTP/TCP 探活、drain
                  </li>
                  <li>
                    <strong>PR-C2</strong>：CDN site + Nginx edge proxy_cache 渲染
                  </li>
                  <li>
                    <strong>PR-C3</strong>：fleet/SSH fan-out apply + purge
                  </li>
                  <li>
                    <strong>PR-C4 MVP</strong>：multi-A / failover DNS + 健康摘除
                  </li>
                </ul>
                <FormHint>
                  這不是 Anycast 商業 CDN。詳見{' '}
                  <code className="inline">docs/product/dns-cdn-design.md</code>
                </FormHint>
                <FormActions>
                  <Link
                    to="/dns?tab=tools"
                    className={buttonClassName({
                      variant: 'secondary',
                      size: 'md',
                    })}
                  >
                    DNS 工具（dig）
                  </Link>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}
      </PageTabs>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
        title={edit ? '編輯 CDN 節點' : '新增 CDN 節點'}
        description="至少填 IPv4 / IPv6 / healthUrl / baseUrl 其中一項"
        footer={
          <>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
              onClick={() => {
                setOpen(false);
                resetForm();
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
        <form id="cdn-node-form" onSubmit={(e) => void onSave(e)}>
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
            <Field
              label="Public IPv4"
              htmlFor="cdn-v4"
              flush
              hint="逗號分隔；探活可 TCP 443/80"
            >
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
                placeholder="2001:db8::1"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Health URL"
              htmlFor="cdn-health"
              flush
              hint="優先用 HTTP GET；建議 2xx"
            >
              <input
                id="cdn-health"
                value={healthUrl}
                onChange={(e) => setHealthUrl(e.target.value)}
                placeholder="https://edge.example.com/health"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Base URL"
              htmlFor="cdn-base"
              flush
              hint="無 healthUrl 時試 base/.ysk-cdn-health"
            >
              <input
                id="cdn-base"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://edge.example.com"
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
              label="SSH identity id（可選）"
              htmlFor="cdn-ssh"
              flush
              hint="C3 fan-out 用；本輪可不填"
            >
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
    </FeaturePageLayout>
  );
}
