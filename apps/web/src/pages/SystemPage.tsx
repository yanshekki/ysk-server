/**
 * System tools — host console + control-plane export/rebuild (professional ops UX).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ActionBar,
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
  LogViewer,
  LoadingBlock,
  buttonClassName,
} from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { systemApi } from '../features/system';
import type { HostOverviewDto } from '../features/system/api';
import { api } from '../shared/services/api';
import { usePageTab } from '../shared/hooks/usePageTab';

const SYS_TABS = ['host', 'export'] as const;

type ExportSnapshot = {
  exportedAt: string;
  counts: Record<string, number>;
  projects: Array<{ id: string; name: string; domain?: string; runtime: string; status: string }>;
  emailDomains: Array<{ id: string; domain: string }>;
  packages: number;
  users: number;
};

type ManagedConf = { name: string; path: string; bytes: number; mtime?: string };
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

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function memTone(ratio?: number): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (ratio == null) return 'neutral';
  if (ratio > 0.9) return 'danger';
  if (ratio > 0.75) return 'warn';
  return 'ok';
}

export function SystemPage() {
  const { t } = useTranslation();

  const [hostname, setHostname] = useState('');
  const [prettyHostname, setPrettyHostname] = useState('');
  const [timezone, setTimezone] = useState('');
  const [host, setHost] = useState<HostOverviewDto | null>(null);
  const [hostLoading, setHostLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [powerDlg, setPowerDlg] = useState<PowerDialog | null>(null);
  const [powerConfirm, setPowerConfirm] = useState('');
  const [rebuildSyncConfirm, setRebuildSyncConfirm] = useState(false);

  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [managed, setManaged] = useState<ManagedConf[]>([]);
  const [archives, setArchives] = useState<ExportFile[]>([]);
  const [confPreview, setConfPreview] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [opsResult, setOpsResult] = useState<RebuildResult | null>(null);
  const [caps, setCaps] = useState<{ executeEnabled?: boolean; isRoot?: boolean }>({});

  const refresh = useCallback(async () => {
    const o = await systemApi.hostOverview();
    setHost(o);
    setHostname(o.identity.hostname ?? '');
    setPrettyHostname(o.identity.prettyHostname ?? '');
    setTimezone(o.identity.timezone ?? '');
    setCaps({
      executeEnabled: o.caps.executeEnabled,
      isRoot: o.caps.isRoot,
    });
  }, []);

  const refreshExportMeta = useCallback(async () => {
    try {
      const [ex, confs, hist] = await Promise.all([
        api.requestRaw<ExportSnapshot>('/api/v1/system/export'),
        api.requestRaw<{ items: ManagedConf[] }>('/api/v1/system/managed-nginx'),
        api.requestRaw<{ items: ExportFile[] }>('/api/v1/system/exports'),
      ]);
      setSnapshot(ex);
      setManaged(confs.items ?? []);
      setArchives(hist.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '載入匯出資料失敗');
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
    if (tab === 'export') void refreshExportMeta();
  }, [tab, refreshExportMeta]);

  function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json; charset=utf-8',
    });
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
          dryRun: Boolean(opts.dryRun),
        }),
      });
      setOpsResult(r);
      setCaps({ executeEnabled: r.executeEnabled, isRoot: r.isRoot });
      if (r.ok) {
        setMsg(
          r.dryRun
            ? '模擬完成（未改系統）'
            : r.mode === 'sync'
              ? '重建請求已完成 — 見操作結果'
              : '已寫入匯出／列出 managed conf',
        );
      } else if (r.blockMessage) {
        setErr(r.blockMessage);
      }
      await refreshExportMeta();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'rebuild 失敗');
      setOpsResult({
        ok: false,
        notes: [e instanceof Error ? e.message : '失敗'],
      });
    } finally {
      setBusy(false);
    }
  }

  const counts = snapshot?.counts;
  const memPct =
    host?.runtime.memory.usedRatio != null
      ? Math.round(host.runtime.memory.usedRatio * 100)
      : null;
  const load1 = host?.runtime.loadavg?.[0];
  const heroTone = host?.caps.canPower
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
      title={t('nav.systemIndex', { defaultValue: '系統工具' })}
      showCapability={false}
      status={
        tab === 'host'
          ? {
              pill: {
                label: host?.identity.hostname || hostname || '主機',
                tone: heroTone === 'neutral' ? 'ok' : heroTone,
              },
              items: [
                {
                  label: 'Uptime',
                  value: formatUptime(host?.runtime.uptimeSec),
                },
                {
                  label: 'Load 1m',
                  value: load1 != null ? load1.toFixed(2) : '—',
                },
                {
                  label: '記憶體',
                  value: memPct != null ? `${memPct}%` : '—',
                  tone: memTone(host?.runtime.memory.usedRatio),
                },
                {
                  label: '磁碟峰值',
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
                      : undefined,
                },
                {
                  label: 'EXECUTE',
                  value: host?.caps.executeEnabled ? '開' : '關',
                  tone: host?.caps.executeEnabled ? 'ok' : 'warn',
                },
                {
                  label: 'Root',
                  value: host?.caps.isRoot ? '是' : '否',
                  tone: host?.caps.isRoot ? 'ok' : 'warn',
                },
              ],
            }
          : {
              pill: { label: '匯出 / Rebuild', tone: 'ok' },
              items: [
                { label: '專案', value: counts?.projects ?? '—' },
                { label: '郵件', value: counts?.email_domains ?? '—' },
                {
                  label: 'DNS / 憑證',
                  value: `${counts?.dns_zones ?? '—'}/${counts?.certificates ?? '—'}`,
                },
                { label: 'Managed', value: managed.length },
                {
                  label: 'EXECUTE',
                  value:
                    caps.executeEnabled === undefined
                      ? '?'
                      : caps.executeEnabled
                        ? '開'
                        : '關',
                  tone:
                    caps.executeEnabled === false
                      ? 'warn'
                      : caps.executeEnabled
                        ? 'ok'
                        : 'neutral',
                },
                {
                  label: 'Exports',
                  value: archives.length,
                },
              ],
            }
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
                重新整理
              </Button>
              <a href="#sys-identity" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                編輯身份
              </a>
              <a href="#sys-power" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                電源
              </a>
              <Link to="/metrics" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                指標
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
                    dryRun: false,
                  })
                }
              >
                寫入 exports/
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void runRebuild({
                    writeExport: false,
                    syncNginx: false,
                    dryRun: true,
                  })
                }
              >
                Dry-run 同步
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={() => void refreshExportMeta()}
              >
                重新整理
              </Button>
            </>
          )}
          <Link to="/system/readiness" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            就緒探測
          </Link>
        </ActionBar>
      }
    >
      {err ? (
        <Alert variant="error">
          {err}{' '}
          <Button variant="ghost" size="sm" onClick={() => setErr(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'host', label: '主機控制台' },
          { id: 'export', label: '匯出 / Rebuild' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {/* ═══════════ HOST ═══════════ */}
        {tab === 'host' ? (
          <div className="tab-panel sys">
            {hostLoading && !host ? (
              <LoadingBlock label="載入主機概況…" />
            ) : (
              <>
                <div className="sys-grid">
                  {/* Identity + time */}
                  <div className="sys-col">
                    <section className="sys-panel" id="sys-identity">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">身份</h3>
                          <p className="sys-panel__sub">
                            {host?.caps.canIdentity
                              ? 'hostnamectl / timedatectl'
                              : '唯讀 — 需 YSK_EXECUTE + root 才能套用'}
                          </p>
                        </div>
                        <Badge tone={host?.caps.canIdentity ? 'ok' : 'warn'}>
                          {host?.caps.canIdentity ? '可寫入' : '鎖定'}
                        </Badge>
                      </header>
                      <FormLayout columns={1}>
                        <Field label="主機名稱" htmlFor="sys-hn" hint="hostname" flush>
                          <input
                            id="sys-hn"
                            value={hostname}
                            onChange={(e) => setHostname(e.target.value)}
                            disabled={!host?.caps.canIdentity && host != null}
                          />
                        </Field>
                        <Field
                          label="顯示名稱（pretty）"
                          htmlFor="sys-pretty"
                          hint="可選"
                          flush
                        >
                          <input
                            id="sys-pretty"
                            value={prettyHostname}
                            onChange={(e) => setPrettyHostname(e.target.value)}
                            placeholder="友善顯示名稱"
                            disabled={!host?.caps.canIdentity && host != null}
                          />
                        </Field>
                        <Field
                          label="時區"
                          htmlFor="sys-tz"
                          hint="例如 Asia/Hong_Kong"
                          flush
                        >
                          <input
                            id="sys-tz"
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            placeholder="Asia/Hong_Kong"
                            disabled={!host?.caps.canIdentity && host != null}
                          />
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
                                prettyHostname,
                              })
                              .then((r) => {
                                const notes = (r as { notes?: string[] }).notes;
                                setMsg(notes?.join('；') ?? '已更新');
                                return refresh();
                              })
                              .catch((e: Error) => setErr(e.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          套用身份
                        </Button>
                        {hostname ? (
                          <Link
                            to={`/ssl?domain=${encodeURIComponent(hostname)}&action=le`}
                            className={buttonClassName({ variant: 'ghost', size: 'md' })}
                          >
                            面板 SSL
                          </Link>
                        ) : null}
                      </div>
                    </section>

                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">時間與 NTP</h3>
                          <p className="sys-panel__sub">系統時鐘狀態</p>
                        </div>
                      </header>
                      <dl className="sys-dl">
                        <div>
                          <dt>本機</dt>
                          <dd>
                            <code>{host?.time.local ?? '—'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>UTC</dt>
                          <dd>
                            <code className="sys-dl__muted">{host?.time.utc ?? '—'}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>來源</dt>
                          <dd>{host?.time.timeSource ?? '—'}</dd>
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
                                  setMsg(r.notes?.join('；') ?? 'NTP 已請求啟用');
                                } else {
                                  setErr(
                                    r.blockMessage || r.notes?.join('；') || 'NTP 失敗',
                                  );
                                }
                                return refresh();
                              })
                              .catch((e: Error) => setErr(e.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          啟用 NTP 同步
                        </Button>
                      </div>
                    </section>
                  </div>

                  {/* Network + disks + shortcuts */}
                  <div className="sys-col">
                    <section className="sys-panel">
                      <header className="sys-panel__head">
                        <div>
                          <h3 className="sys-panel__title">網絡</h3>
                          <p className="sys-panel__sub">
                            唯讀 · 完整 netplan 不在此頁
                          </p>
                        </div>
                      </header>
                      {(host?.network.ips?.length ?? 0) === 0 ? (
                        <p className="sys-muted">無法讀取 IP</p>
                      ) : (
                        <div className="sys-chips">
                          {host!.network.ips.map((ip) => (
                            <code key={ip} className="sys-chip-code">
                              {ip}
                            </code>
                          ))}
                        </div>
                      )}
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
                          <span className="sys-resolvers__lab">DNS</span>
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
                          <h3 className="sys-panel__title">儲存</h3>
                          <p className="sys-panel__sub">
                            df -hT ·{' '}
                            <Link to="/metrics" className="sys-inline-link">
                              指標詳情
                            </Link>
                          </p>
                        </div>
                      </header>
                      {!host?.disks?.length ? (
                        <p className="sys-muted">無法讀取磁碟</p>
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
                                  style={{
                                    width: `${Math.min(100, d.usePct ?? 0)}%`,
                                  }}
                                />
                              </div>
                              <div className="sys-disk__meta">
                                <span>
                                  {d.used} / {d.size}
                                </span>
                                <span className="sys-disk__avail">可用 {d.avail}</span>
                                <span className="sys-disk__fs">{d.type}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="sys-panel sys-panel--links">
                      <header className="sys-panel__head">
                        <h3 className="sys-panel__title">運維捷徑</h3>
                      </header>
                      <nav className="sys-shortcuts" aria-label="運維捷徑">
                        <Link to="/services" className="sys-shortcut">
                          <span className="sys-shortcut__t">服務矩陣</span>
                          <span className="sys-shortcut__d">unit 生命週期</span>
                        </Link>
                        <Link to="/system/unit" className="sys-shortcut">
                          <span className="sys-shortcut__t">控制面 unit</span>
                          <span className="sys-shortcut__d">ysk-server systemd</span>
                        </Link>
                        <Link to="/system/readiness" className="sys-shortcut">
                          <span className="sys-shortcut__t">就緒探測</span>
                          <span className="sys-shortcut__d">生產閘門</span>
                        </Link>
                        <Link to="/updates" className="sys-shortcut">
                          <span className="sys-shortcut__t">系統更新</span>
                          <span className="sys-shortcut__d">套件 / CVE</span>
                        </Link>
                        <Link to="/metrics" className="sys-shortcut">
                          <span className="sys-shortcut__t">主機指標</span>
                          <span className="sys-shortcut__d">負載告警</span>
                        </Link>
                        <Link to="/logs" className="sys-shortcut">
                          <span className="sys-shortcut__t">日誌中心</span>
                          <span className="sys-shortcut__d">journal / 檔案</span>
                        </Link>
                      </nav>
                    </section>
                  </div>
                </div>

                {/* Power danger zone */}
                <section className="sys-panel sys-panel--danger" id="sys-power">
                  <header className="sys-panel__head">
                    <div>
                      <h3 className="sys-panel__title">電源（危險區）</h3>
                      <p className="sys-panel__sub">
                        重啟／關機會中斷所有服務與面板。面板<strong>無法開機</strong>
                        — 需實體或 hypervisor。
                      </p>
                    </div>
                    <Badge tone={host?.caps.canPower ? 'ok' : 'warn'}>
                      {host?.caps.canPower ? '已解鎖' : '已鎖定'}
                    </Badge>
                  </header>

                  {!host?.caps.canPower ? (
                    <div className="sys-callout sys-callout--info">
                      需 <code>YSK_EXECUTE=1</code> 與 root。目前 EXECUTE=
                      {host?.caps.executeEnabled ? '開' : '關'}，root=
                      {host?.caps.isRoot ? '是' : '否'}。
                    </div>
                  ) : null}
                  {host?.power.pending ? (
                    <div className="sys-callout sys-callout--danger">
                      偵測到排程關機／重啟
                      {host.power.pending.actionHint
                        ? `（${host.power.pending.actionHint}）`
                        : ''}
                      。請用「取消排程」撤回。
                    </div>
                  ) : null}

                  <div className="sys-power-actions">
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower}
                      onClick={() => {
                        setPowerConfirm('');
                        setPowerDlg({
                          action: 'reboot',
                          confirmNeed: 'REBOOT',
                          delaySec: 10,
                        });
                      }}
                    >
                      重啟主機…
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower}
                      onClick={() => {
                        setPowerConfirm('');
                        setPowerDlg({
                          action: 'poweroff',
                          confirmNeed: 'POWEROFF',
                          delaySec: 60,
                        });
                      }}
                    >
                      關機…
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      loading={busy}
                      disabled={!host?.caps.canPower}
                      onClick={() => {
                        setBusy(true);
                        setErr(null);
                        setMsg(null);
                        void systemApi
                          .hostPower({ action: 'cancel' })
                          .then((r) => {
                            if (r.ok) setMsg(r.notes?.join('；') ?? '已取消');
                            else
                              setErr(
                                r.blockMessage || r.notes?.join('；') || '取消失敗',
                              );
                            return refresh();
                          })
                          .catch((e: Error) => setErr(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      取消排程
                    </Button>
                  </div>
                  <p className="sys-footnote">
                    確認字串 <code>REBOOT</code> / <code>POWEROFF</code>
                    。關機預設延遲約 1 分鐘、重啟約 1 分鐘（shutdown +N）。寫入 audit。
                  </p>
                </section>

                <Modal
                  open={Boolean(powerDlg)}
                  onClose={() => {
                    if (!busy) setPowerDlg(null);
                  }}
                  title={
                    powerDlg?.action === 'reboot' ? '確認重啟主機？' : '確認關機？'
                  }
                  description={
                    powerDlg?.action === 'reboot'
                      ? '所有服務與面板連線將中斷。請輸入 REBOOT 確認。'
                      : '主機將關電；面板無法遠端再開機。請輸入 POWEROFF 確認。'
                  }
                  size="sm"
                  footer={
                    <>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={() => setPowerDlg(null)}
                      >
                        取消
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
                              delaySec: powerDlg.delaySec,
                            })
                            .then((r) => {
                              if (r.ok) {
                                setMsg(
                                  (r.notes?.join('；') ?? '已送出') +
                                    ' — 連線即將中斷',
                                );
                                setPowerDlg(null);
                              } else {
                                setErr(
                                  r.blockMessage ||
                                    r.notes?.join('；') ||
                                    '電源操作失敗',
                                );
                              }
                            })
                            .catch((e: Error) => setErr(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {powerDlg?.action === 'reboot' ? '確認重啟' : '確認關機'}
                      </Button>
                    </>
                  }
                >
                  <Field
                    label={`輸入 ${powerDlg?.confirmNeed ?? ''} 以解鎖`}
                    htmlFor="power-confirm"
                    flush
                  >
                    <input
                      id="power-confirm"
                      autoComplete="off"
                      value={powerConfirm}
                      onChange={(e) => setPowerConfirm(e.target.value)}
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
              <strong>匯出</strong> = 面板 DB 摘要 JSON。 <strong>Rebuild</strong> = managed
              conf → <code>/etc/nginx/conf.d</code> + reload。同步需 root + EXECUTE。
            </Alert>

            <div className="sys-steps">
              {/* Step 1 */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">1</span>
                    <div>
                      <h3 className="sys-panel__title">控制面摘要</h3>
                      <p className="sys-panel__sub">
                        即時 DB 快照 · 預覽 / 下載 / 寫入伺服器
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
                          setMsg(`已載入摘要 · ${r.exportedAt}`);
                        })
                        .catch((e: Error) => setErr(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    預覽摘要
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
                      setMsg('已下載 JSON 到瀏覽器');
                    }}
                  >
                    下載 JSON
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void runRebuild({ writeExport: true, syncNginx: false })
                    }
                  >
                    寫入 exports/
                  </Button>
                </div>
                {snapshot ? (
                  <div className="sys-preview">
                    <div className="sys-preview__meta">
                      產生 {new Date(snapshot.exportedAt).toLocaleString('zh-TW')} · 用戶{' '}
                      {snapshot.users} · 方案 {snapshot.packages}
                    </div>
                    <LogViewer
                      text={JSON.stringify(snapshot, null, 2)}
                      emptyLabel="—"
                      highlight={false}
                      linkIps={false}
                      maxHeight={260}
                    />
                  </div>
                ) : (
                  <p className="sys-muted">按「預覽摘要」載入控制面快照。</p>
                )}
              </section>

              {/* Step 2 */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">2</span>
                    <div>
                      <h3 className="sys-panel__title">Managed Nginx</h3>
                      <p className="sys-panel__sub">
                        dataDir/nginx/conf.d — 唔等於 /etc 已套用
                      </p>
                    </div>
                  </div>
                  <Badge tone="neutral">{managed.length} 檔</Badge>
                </header>
                {managed.length === 0 ? (
                  <EmptyState
                    title="尚無 managed conf"
                    description="發布專案 Nginx 後會出現在此"
                  />
                ) : (
                  <div className="sys-conf-list">
                    {managed.map((c) => (
                      <div key={c.name} className="sys-conf-row">
                        <div className="sys-conf-row__main">
                          <code className="sys-conf-row__name">{c.name}</code>
                          <span className="sys-conf-row__meta">
                            {formatBytes(c.bytes)}
                            {c.mtime
                              ? ` · ${new Date(c.mtime).toLocaleString('zh-TW')}`
                              : ''}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy}
                          onClick={() => {
                            setBusy(true);
                            void api
                              .requestRaw<{
                                ok: boolean;
                                content?: string;
                                notes?: string[];
                              }>(
                                `/api/v1/system/managed-nginx/${encodeURIComponent(c.name)}`,
                              )
                              .then((r) => {
                                if (r.ok && r.content != null) {
                                  setConfPreview({
                                    name: c.name,
                                    content: r.content,
                                  });
                                } else {
                                  setErr(r.notes?.join('；') ?? '讀取失敗');
                                }
                              })
                              .catch((e: Error) => setErr(e.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          預覽
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {confPreview ? (
                  <div className="sys-preview">
                    <div className="sys-preview__bar">
                      <strong>{confPreview.name}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfPreview(null)}
                      >
                        關閉
                      </Button>
                    </div>
                    <LogViewer
                      text={confPreview.content}
                      highlight={false}
                      linkIps={false}
                      maxHeight={300}
                    />
                  </div>
                ) : null}
              </section>

              {/* Step 3 */}
              <section className="sys-panel sys-panel--sync">
                <header className="sys-panel__head">
                  <div className="sys-step-label">
                    <span className="sys-step-num">3</span>
                    <div>
                      <h3 className="sys-panel__title">同步到系統</h3>
                      <p className="sys-panel__sub">
                        複製到 /etc/nginx/conf.d 並 reload — 需 root + EXECUTE
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
                        dryRun: true,
                      })
                    }
                  >
                    Dry-run
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => setRebuildSyncConfirm(true)}
                  >
                    同步 + reload
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void runRebuild({
                        writeExport: true,
                        syncNginx: false,
                        dryRun: false,
                      })
                    }
                  >
                    只匯出 + 列 conf
                  </Button>
                </div>
                <p className="sys-footnote">
                  Dry-run 不改系統。
                </p>
              </section>

              {/* Archives */}
              <section className="sys-panel">
                <header className="sys-panel__head">
                  <div>
                    <h3 className="sys-panel__title">伺服器 exports/ 歷史</h3>
                    <p className="sys-panel__sub">
                      dataDir/exports · Bearer 下載
                    </p>
                  </div>
                  <Badge tone="neutral">{archives.length}</Badge>
                </header>
                {archives.length === 0 ? (
                  <EmptyState
                    title="尚未有伺服器匯出檔"
                    description="按「寫入 exports/」產生"
                  />
                ) : (
                  <div className="sys-archive-list">
                    {archives.map((a) => (
                      <div key={a.name} className="sys-archive-row">
                        <div>
                          <code className="sys-conf-row__name">{a.name}</code>
                          <div className="sys-conf-row__meta">
                            {formatBytes(a.bytes)} ·{' '}
                            {new Date(a.mtime).toLocaleString('zh-TW')}
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
                              .then(() => setMsg(`已下載 ${a.name}`))
                              .catch((e: Error) => setErr(e.message));
                          }}
                        >
                          下載
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <OpsResultPanel
              title="操作結果"
              result={opsResult}
              message={msg}
              busy={busy}
              facts={
                opsResult
                  ? [
                      ...(opsResult.exportPath
                        ? [{ label: 'exportPath', value: opsResult.exportPath }]
                        : []),
                      ...(opsResult.mode
                        ? [{ label: 'mode', value: String(opsResult.mode) }]
                        : []),
                      ...(opsResult.nginxConfDetails
                        ? [
                            {
                              label: 'managed conf',
                              value: String(opsResult.nginxConfDetails.length),
                            },
                          ]
                        : []),
                      ...(opsResult.dryRun
                        ? [{ label: 'dryRun', value: 'true' }]
                        : []),
                    ]
                  : []
              }
            />
          </div>
        ) : null}
      </PageTabs>

      <ConfirmDialog
        open={rebuildSyncConfirm}
        onClose={() => !busy && setRebuildSyncConfirm(false)}
        title="同步 nginx 到系統？"
        description="將 managed nginx conf 同步到 /etc/nginx/conf.d 並 reload。需 root + YSK_EXECUTE。"
        confirmLabel="同步 + reload"
        cancelLabel="取消"
        danger
        busy={busy}
        onConfirm={() => {
          setRebuildSyncConfirm(false);
          void runRebuild({
            writeExport: true,
            syncNginx: true,
            dryRun: false,
          });
        }}
      />
    </FeaturePageLayout>
  );
}
