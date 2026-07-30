/**
 * Host network — redesign with shared UI primitives only.
 * DataTable + ActionBar + FormLayout; no hand-rolled action rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  buttonClassName,
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
  PresetChips,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  networkApi,
  type NetAddress,
  type NetApplyResult,
  type NetInterface,
  type NetRoute,
  type NetworkSnapshot,
} from '../../features/network/api';

const TABS = ['ifaces', 'routes', 'dns', 'advanced'] as const;

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

function operTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  const u = s.toUpperCase();
  if (u === 'UP') return 'ok';
  if (u === 'DOWN') return 'neutral';
  return 'warn';
}

function isUp(iface: NetInterface): boolean {
  return (
    iface.operstate.toUpperCase() === 'UP' || iface.flags.includes('UP')
  );
}

function cidrOf(a: { local: string; prefixlen: number }): string {
  return `${a.local}/${a.prefixlen}`;
}

function joinCidrs(addrs: NetAddress[], family: 'inet' | 'inet6'): string {
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
  const [routePersist, setRoutePersist] = useState(true);
  const [delRoute, setDelRoute] = useState<NetRoute | null>(null);
  const [delRoutePersist, setDelRoutePersist] = useState(true);

  /** DNS editor — list of servers (add / edit / remove) */
  const [dnsServers, setDnsServers] = useState<string[]>([]);
  const [dnsSearch, setDnsSearch] = useState('');
  const [dnsIgnoreAuto, setDnsIgnoreAuto] = useState(true);
  const [dnsTestName, setDnsTestName] = useState('example.com');
  const [dnsTestOut, setDnsTestOut] = useState<string[] | null>(null);
  const [dnsPreset, setDnsPreset] = useState('');

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
        setError(s.ok ? null : s.notes?.[0] ?? '載入失敗');
        setDetail((prev) => {
          if (!prev) return null;
          return s.interfaces.find((i) => i.name === prev.name) ?? null;
        });
        syncDnsForm(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : '載入網路失敗');
      } finally {
        setLoading(false);
      }
    },
    [syncDnsForm],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

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
        notes: [e instanceof Error ? e.message : '操作失敗'],
      };
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
      title={t('nav.network', { defaultValue: '網路介面' })}
      showCapability={false}
      status={
        snap
          ? {
              pill: {
                label: snap.caps.canMutate ? '可變更' : '唯讀／受阻',
                tone: snap.caps.canMutate ? 'ok' : 'warn',
              },
              items: [
                { label: '介面', value: snap.interfaces.length },
                { label: 'UP', value: upCount, tone: 'ok' as const },
                {
                  label: '閘道',
                  value: snap.defaultGateway
                    ? `${snap.defaultGateway}${snap.defaultDev ? ` · ${snap.defaultDev}` : ''}`
                    : '—',
                },
                {
                  label: 'EXECUTE',
                  value: snap.caps.executeEnabled ? '開' : '關',
                  tone: snap.caps.executeEnabled ? 'ok' : 'warn',
                },
                {
                  label: 'root',
                  value: snap.caps.isRoot ? '是' : '否',
                  tone: snap.caps.isRoot ? 'ok' : 'warn',
                },
              ],
            }
          : undefined
      }
      actions={
        <ActionBar size="sm" aria-label="頁面操作">
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => void refresh(tab === 'advanced')}
          >
            重新整理
          </Button>
          <Link
            to="/system"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            主機設定
          </Link>
          <Link
            to="/protection"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            防護中心
          </Link>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !snap ? <LoadingBlock label="讀取網路快照…" /> : null}

      {snap ? (
        <div className="stack">
          <Alert variant="info">
            {snap.caps.canMutate
              ? '變更預設為即時（ip addr / link / route），重開可能還原。防火牆請用防護中心。'
              : '目前無法變更網路（需 YSK_EXECUTE 與 root）。可查看；提交會誠實回報 blocked。'}
          </Alert>

          {lastOps ? (
            <OpsResultPanel
              title="操作結果"
              result={{
                ok: lastOps.ok,
                blocked: lastOps.blocked,
                blockMessage: lastOps.blockMessage,
                notes: lastOps.notes,
              }}
            />
          ) : null}

          <PageTabs
            tabs={[
              {
                id: 'ifaces',
                label: '介面',
                badge: snap.interfaces.length || undefined,
              },
              {
                id: 'routes',
                label: '路由',
                badge: snap.routes.length || undefined,
              },
              {
                id: 'dns',
                label: 'DNS',
                badge: snap.dns.nameservers.length || undefined,
              },
              { id: 'advanced', label: '進階' },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'ifaces' ? (
              <div className="tab-panel">
                <DataTable<NetInterface>
                  title="網路介面"
                  description={`${snap.interfaces.length} 個介面 · ${upCount} 個 UP`}
                  dense
                  rows={snap.interfaces}
                  rowKey={(r) => r.name}
                  empty={<EmptyState title="沒有介面" description="ip 不可用或無權讀取" />}
                  columns={[
                    {
                      key: 'name',
                      header: '名稱',
                      nowrap: true,
                      render: (r) => (
                        <>
                          <code>{r.name}</code>{' '}
                          {r.isDefaultEgress ? (
                            <Badge tone="info">預設出口</Badge>
                          ) : null}{' '}
                          {r.isLoopback ? (
                            <Badge tone="neutral">lo</Badge>
                          ) : null}
                        </>
                      ),
                    },
                    {
                      key: 'state',
                      header: '狀態',
                      nowrap: true,
                      render: (r) => (
                        <Badge tone={operTone(r.operstate)}>
                          {r.operstate}
                        </Badge>
                      ),
                    },
                    {
                      key: 'v4',
                      header: 'IPv4',
                      render: (r) => (
                        <code className="u-text-sm">
                          {joinCidrs(r.addrs, 'inet')}
                        </code>
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
                    {
                      key: 'mac',
                      header: 'MAC',
                      nowrap: true,
                      render: (r) => (
                        <span className="u-text-sm muted">
                          {r.mac ?? '—'}
                        </span>
                      ),
                    },
                    {
                      key: 'mtu',
                      header: 'MTU',
                      nowrap: true,
                      render: (r) => r.mtu ?? '—',
                    },
                  ]}
                  rowActions={(r) => (
                    <ActionBar
                      size="sm"
                      wrap={false}
                      aria-label={`${r.name} 操作`}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openDetail(r)}
                      >
                        詳情
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || r.isLoopback}
                        onClick={() => openAdd(r)}
                      >
                        加 IP
                      </Button>
                      {isUp(r) ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy || r.isLoopback}
                          onClick={() => {
                            setDownConfirm('');
                            setDownDlg(r);
                          }}
                        >
                          Down
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy || r.isLoopback}
                          onClick={() =>
                            void run(() =>
                              networkApi.setLink(r.name, { action: 'up' }),
                            )
                          }
                        >
                          Up
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
                  title="路由表"
                  description={
                    snap.defaultGateway
                      ? `預設閘道 ${snap.defaultGateway}${snap.defaultDev ? ` via ${snap.defaultDev}` : ''}`
                      : '即時 ip route'
                  }
                  dense
                  rows={snap.routes}
                  rowKey={(r, i) =>
                    `${r.dst}-${r.gateway ?? ''}-${r.dev ?? ''}-${i}`
                  }
                  empty={<EmptyState title="沒有路由" />}
                  columns={[
                    {
                      key: 'dst',
                      header: '目的地',
                      render: (r) => (
                        <>
                          <code>{r.dst}</code>{' '}
                          {r.dst === 'default' || r.dst === '0.0.0.0/0' ? (
                            <Badge tone="info">default</Badge>
                          ) : null}
                        </>
                      ),
                    },
                    {
                      key: 'gw',
                      header: 'Gateway',
                      render: (r) => r.gateway ?? '—',
                    },
                    {
                      key: 'dev',
                      header: 'Dev',
                      nowrap: true,
                      render: (r) =>
                        r.dev ? <code>{r.dev}</code> : '—',
                    },
                    {
                      key: 'proto',
                      header: 'Proto',
                      render: (r) => (
                        <span className="muted">{r.protocol ?? '—'}</span>
                      ),
                    },
                    {
                      key: 'metric',
                      header: 'Metric',
                      nowrap: true,
                      render: (r) => r.metric ?? '—',
                    },
                  ]}
                  rowActions={(r) => (
                    <ActionBar size="sm" wrap={false}>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => setDelRoute(r)}
                      >
                        刪除
                      </Button>
                    </ActionBar>
                  )}
                />

                <Card>
                  <CardHeader
                    title="新增路由"
                    description={
                      routePersist
                        ? '保存到 NetworkManager 連線（重開仍在）'
                        : '僅即時 ip route（重開可能消失）'
                    }
                  />
                  <FormLayout columns={2}>
                    <Field label="目的地" htmlFor="net-route-dst">
                      <input
                        id="net-route-dst"
                        value={routeDst}
                        onChange={(e) => setRouteDst(e.target.value)}
                        placeholder="default 或 10.0.0.0/8"
                      />
                    </Field>
                    <Field label="Gateway" htmlFor="net-route-gw">
                      <input
                        id="net-route-gw"
                        value={routeGw}
                        onChange={(e) => setRouteGw(e.target.value)}
                        placeholder={
                          snap.defaultGateway || '192.168.1.1'
                        }
                      />
                    </Field>
                    <Field
                      label="Dev（可選）"
                      htmlFor="net-route-dev"
                      hint={
                        snap.defaultDev
                          ? `預設出口：${snap.defaultDev}`
                          : undefined
                      }
                      fullWidth
                    >
                      <input
                        id="net-route-dev"
                        value={routeDev}
                        onChange={(e) => setRouteDev(e.target.value)}
                        placeholder={snap.defaultDev || 'eth0'}
                      />
                    </Field>
                    <CheckboxField
                      id="net-route-persist"
                      label="保存（NetworkManager，重開不消失）"
                      description="取消則只做即時 ip route add"
                      checked={routePersist}
                      onChange={setRoutePersist}
                      disabled={busy}
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
                        setRoutePersist(true);
                      }}
                    >
                      重設
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
                            persistent: false,
                          }),
                        );
                      }}
                    >
                      僅即時
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
                            persistent: routePersist,
                          }),
                        );
                      }}
                    >
                      {routePersist ? '保存路由' : '新增路由'}
                    </Button>
                  </FormActions>
                  <FormHint>
                    保存會寫入 NM 連線並 connection up；default 用
                    ipv4.gateway，其他用 +ipv4.routes。需 EXECUTE + root。
                  </FormHint>
                </Card>
              </div>
            ) : null}

            {tab === 'dns' ? (
              <div className="tab-panel stack">
                <Card>
                  <CardHeader
                    title="DNS 設定"
                    description={
                      snap.dns.canApply
                        ? `經 NetworkManager 寫入連線「${snap.dns.connection}」並重連（持久）`
                        : '目前無法套用：需 NetworkManager 作用中連線 + EXECUTE + root'
                    }
                  />
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: '模式',
                        value: snap.dns.mode ?? '—',
                      },
                      {
                        label: '連線',
                        value: snap.dns.connection
                          ? `${snap.dns.connection}${snap.dns.device ? ` · ${snap.dns.device}` : ''}`
                          : '—',
                      },
                      {
                        label: '來源',
                        value: snap.dns.source,
                      },
                      {
                        label: '現況 ignore-auto-dns',
                        value:
                          snap.dns.ignoreAutoDns == null
                            ? '—'
                            : snap.dns.ignoreAutoDns
                              ? 'yes（忽略 DHCP DNS）'
                              : 'no（跟 DHCP）',
                      },
                    ]}
                  />
                </Card>

                <Card>
                  <CardHeader
                    title="Nameservers"
                    description="可加減伺服器；套用寫入 NetworkManager 並重連"
                  />
                  <div className="u-mb-3">
                    <PresetChips
                      options={[
                        {
                          value: '1.1.1.1,1.0.0.1',
                          label: 'Cloudflare',
                        },
                        {
                          value: '8.8.8.8,8.8.4.4',
                          label: 'Google',
                        },
                        {
                          value: '9.9.9.9,149.112.112.112',
                          label: 'Quad9',
                        },
                        ...(snap.dns.gatewayDns
                          ? [
                              {
                                value: snap.dns.gatewayDns,
                                label: `路由器 ${snap.dns.gatewayDns}`,
                              },
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
                          label: '目前',
                        },
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
                    title="伺服器列表"
                    dense
                    rows={dnsServers.map((value, index) => ({
                      id: `dns-${index}`,
                      value,
                      index,
                    }))}
                    rowKey={(r) => r.id}
                    empty={
                      <EmptyState
                        title="尚未加入 DNS"
                        description="按「加伺服器」開始"
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
                          加伺服器
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
                        ),
                      },
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
                        ),
                      },
                    ]}
                    rowActions={(r) => (
                      <ActionBar size="sm" wrap={false}>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy || dnsServers.length <= 1}
                          title={
                            dnsServers.length <= 1
                              ? '至少保留一列（可清空後再刪）'
                              : '移除此伺服器'
                          }
                          onClick={() => {
                            setDnsServers((prev) => {
                              if (prev.length <= 1) return [''];
                              return prev.filter((_, i) => i !== r.index);
                            });
                            setDnsPreset('');
                          }}
                        >
                          刪
                        </Button>
                      </ActionBar>
                    )}
                  />

                  <FormLayout>
                    <Field
                      label="Search domains"
                      htmlFor="net-dns-search"
                      hint="可選，空白分隔"
                      fullWidth
                    >
                      <input
                        id="net-dns-search"
                        value={dnsSearch}
                        onChange={(e) => setDnsSearch(e.target.value)}
                        placeholder="lan local"
                        disabled={busy}
                      />
                    </Field>
                    <CheckboxField
                      id="net-dns-ignore-auto"
                      label="忽略 DHCP 自動 DNS（ipv4.ignore-auto-dns=yes）"
                      description="用「還原 DHCP DNS」可交回路由器分配"
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
                      onClick={() => syncDnsForm(snap)}
                    >
                      重設表單
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate}
                      onClick={() =>
                        void run(() =>
                          networkApi.setDns({
                            mode: 'dhcp',
                            connection: snap.dns.connection,
                            device: snap.dns.device,
                          }),
                        )
                      }
                    >
                      還原 DHCP DNS
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      disabled={!snap.caps.canMutate}
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
                            device: snap.dns.device,
                          }),
                        );
                      }}
                    >
                      套用 DNS
                    </Button>
                  </FormActions>
                  {!snap.caps.canMutate || !snap.dns.canApply ? (
                    <FormHint>
                      {!snap.dns.canApply
                        ? '無可用 NM 連線 — 唔會盲改 /etc/resolv.conf（避免假成功）。'
                        : '需 YSK_EXECUTE=1 與 root 才會真寫入。'}
                    </FormHint>
                  ) : (
                    <FormHint>
                      套用後會 nmcli connection modify + up；短暫斷線屬正常。stub
                      127.0.0.53 唔會寫入（本機 resolved 內部用）。
                    </FormHint>
                  )}
                </Card>

                <Card>
                  <CardHeader
                    title="解析測試"
                    description="getent ahosts（本機實際解析結果）"
                  />
                  <FormLayout columns={2}>
                    <Field label="主機名" htmlFor="net-dns-test">
                      <input
                        id="net-dns-test"
                        value={dnsTestName}
                        onChange={(e) => setDnsTestName(e.target.value)}
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
                              name: dnsTestName.trim() || 'example.com',
                            });
                            setLastOps(r);
                            setDnsTestOut(
                              (r as NetApplyResult & { answers?: string[] })
                                .answers ?? r.notes,
                            );
                          } catch (e) {
                            setLastOps({
                              ok: false,
                              notes: [
                                e instanceof Error ? e.message : '測試失敗',
                              ],
                            });
                            setDnsTestOut(null);
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      測試解析
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
                    title="Backend"
                    description="本機網路堆疊偵測"
                    actions={
                      <ActionBar size="sm">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={loading}
                          onClick={() => void refresh(true)}
                        >
                          載入 raw 輸出
                        </Button>
                      </ActionBar>
                    }
                  />
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: 'iproute2',
                        value: snap.backend.hasIp ? '可用' : '不可用',
                      },
                      {
                        label: 'NetworkManager',
                        value: snap.backend.networkManager,
                      },
                      {
                        label: 'systemd-networkd',
                        value: snap.backend.networkd,
                      },
                      {
                        label: '可持久化（NM）',
                        value: snap.backend.canPersist ? '是' : '否',
                      },
                    ]}
                  />
                  {snap.notes?.length ? (
                    <FormHint>{snap.notes.join(' · ')}</FormHint>
                  ) : null}
                </Card>
                {snap.raw?.addr ? (
                  <Card>
                    <CardHeader title="ip addr" />
                    <CodeBlock>{snap.raw.addr}</CodeBlock>
                  </Card>
                ) : null}
                {snap.raw?.route ? (
                  <Card>
                    <CardHeader title="ip route" />
                    <CodeBlock>{snap.raw.route}</CodeBlock>
                  </Card>
                ) : null}
              </div>
            ) : null}
          </PageTabs>
        </div>
      ) : null}

      {/* Detail */}
      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `介面 ${detail.name}` : '介面'}
        size="lg"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDetail(null)}
            >
              關閉
            </Button>
          </ActionBar>
        }
      >
        {detail ? (
          <div className="stack">
            <DescriptionList
              columns={2}
              items={[
                { label: '狀態', value: detail.operstate },
                { label: 'ifindex', value: detail.ifindex },
                { label: 'MAC', value: detail.mac ?? '—' },
                { label: 'MTU', value: detail.mtu ?? '—' },
                { label: '類型', value: detail.linkType ?? '—' },
                {
                  label: 'Flags',
                  value: detail.flags.join(', ') || '—',
                },
                ...(detail.stats
                  ? [
                      {
                        label: 'RX',
                        value: `${formatBytes(detail.stats.rxBytes)} · ${detail.stats.rxPackets} pkt`,
                      },
                      {
                        label: 'TX',
                        value: `${formatBytes(detail.stats.txBytes)} · ${detail.stats.txPackets} pkt`,
                      },
                    ]
                  : []),
              ]}
            />

            <DataTable<NetAddress>
              title="位址"
              dense
              rows={detail.addrs}
              rowKey={(a) => cidrOf(a)}
              empty={<EmptyState title="無地址" />}
              toolbar={
                detail.isLoopback ? undefined : (
                  <ActionBar
                    size="sm"
                    wrap={false}
                    aria-label="介面調整"
                  >
                    <label className="toolbar-field" htmlFor="net-mtu-input">
                      <span>MTU</span>
                      <input
                        id="net-mtu-input"
                        type="number"
                        min={68}
                        max={65535}
                        value={mtuDraft}
                        onChange={(e) => setMtuDraft(e.target.value)}
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
                      套用
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => openAdd(detail)}
                    >
                      加 IP
                    </Button>
                  </ActionBar>
                )
              }
              columns={[
                {
                  key: 'cidr',
                  header: 'CIDR',
                  render: (a) => <code>{cidrOf(a)}</code>,
                },
                {
                  key: 'family',
                  header: 'Family',
                  render: (a) => a.family,
                },
                {
                  key: 'scope',
                  header: 'Scope',
                  render: (a) => (
                    <span className="muted">{a.scope ?? '—'}</span>
                  ),
                },
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
                          persistent: true,
                        }),
                      )
                    }
                  >
                    刪除
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
        onClose={() => !busy && setAddOpen(false)}
        title={`加 IP · ${addIf}`}
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setAddOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(() =>
                  networkApi.addAddr(addIf, {
                    cidr: cidr.trim(),
                    persistent: false,
                  }),
                ).then((r) => {
                  if (r.ok) setAddOpen(false);
                });
              }}
            >
              僅即時
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(() =>
                  networkApi.addAddr(addIf, {
                    cidr: cidr.trim(),
                    persistent: addPersist,
                  }),
                ).then((r) => {
                  if (r.ok) setAddOpen(false);
                });
              }}
            >
              {addPersist ? '保存 IP' : '新增'}
            </Button>
          </ActionBar>
        }
      >
        <FormLayout>
          <Field
            label="CIDR"
            htmlFor="net-add-cidr"
            hint="例：10.0.0.5/24 或 2001:db8::5/64"
          >
            <input
              id="net-add-cidr"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="192.168.1.50/24"
              autoFocus
            />
          </Field>
          <CheckboxField
            id="net-add-persist"
            label="保存（NetworkManager，重開不消失）"
            description="寫入連線 +ipv4/ipv6.addresses 並 connection up"
            checked={addPersist}
            onChange={setAddPersist}
            disabled={busy}
          />
        </FormLayout>
      </Modal>

      {/* Down — typed confirm */}
      <Modal
        open={downDlg != null}
        onClose={() => !busy && setDownDlg(null)}
        title={downDlg ? `Down ${downDlg.name}` : 'Down'}
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setDownDlg(null)}
            >
              取消
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
                    confirmName: downConfirm,
                  }),
                ).then((r) => {
                  if (r.ok) setDownDlg(null);
                });
              }}
            >
              確認 Down
            </Button>
          </ActionBar>
        }
      >
        {downDlg?.isDefaultEgress ? (
          <Alert variant="error">
            此介面是預設路由出口，down 後可能無法連上管理面板。
          </Alert>
        ) : null}
        <FormLayout>
          <Field
            label={`輸入介面名「${downDlg?.name ?? ''}」確認`}
            htmlFor="net-down-confirm"
          >
            <input
              id="net-down-confirm"
              value={downConfirm}
              onChange={(e) => setDownConfirm(e.target.value)}
              placeholder={downDlg?.name}
              autoFocus
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Delete route — optional also remove from NM profile */}
      <Modal
        open={delRoute != null}
        onClose={() => !busy && setDelRoute(null)}
        title="刪除路由？"
        size="sm"
        footer={
          <ActionBar size="sm" align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setDelRoute(null)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => {
                if (!delRoute) return;
                const isDef =
                  delRoute.dst === 'default' ||
                  delRoute.dst === '0.0.0.0/0';
                void run(() =>
                  networkApi.delRoute({
                    dst: delRoute.dst,
                    gateway: delRoute.gateway,
                    dev: delRoute.dev,
                    confirmDefault: isDef,
                    persistent: delRoutePersist,
                  }),
                ).then((r) => {
                  if (r.ok) setDelRoute(null);
                });
              }}
            >
              刪除
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
              {delRoute.dst === 'default' || delRoute.dst === '0.0.0.0/0'
                ? ' — 刪除 default 可能斷線。'
                : ''}
            </p>
            <CheckboxField
              id="net-del-route-persist"
              label="同時從 NetworkManager 連線移除（重開唔再出現）"
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
