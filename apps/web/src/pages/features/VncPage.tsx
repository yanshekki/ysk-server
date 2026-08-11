/**
 * VNC — multi-account server (Linux users) + client dual path + noVNC.
 * PR-B: account DataTable, create/edit/password/start/stop/delete.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  type OpsResultLike,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';
import {
  vncApi,
  type VncAccountSummary,
  type VncClientProfile,
  type VncConnectPath,
  type VncDesktopProfile,
  type VncOpsResult,
  type VncRfbBind,
} from '../../features/vnc/api';
import {
  VncViewer,
  type VncViewerTarget,
} from '../../features/vnc/VncViewer';

const TABS = ['accounts', 'client', 'install', 'settings', 'about'] as const;
const PAGE_SIZE = 10;

function accountStatusTone(
  s: string,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (s === 'running') return 'ok';
  if (s === 'failed') return 'danger';
  if (s === 'written' || s === 'stopped') return 'warn';
  return 'neutral';
}

function opsToPanel(r: VncOpsResult): OpsResultLike {
  return {
    ok: r.ok,
    notes: r.notes,
    blocked: r.blocked,
    requiresExecute: r.requiresExecute,
    requiresRoot: r.requiresRoot,
  };
}

export function VncPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'accounts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<VncAccountSummary[]>([]);
  const [clients, setClients] = useState<VncClientProfile[]>([]);
  const [lastOps, setLastOps] = useState<OpsResultLike | null>(null);
  const [page, setPage] = useState(0);

  // Client create form
  const [clientOpen, setClientOpen] = useState(false);
  const [clName, setClName] = useState('');
  const [clHost, setClHost] = useState('');
  const [clPort, setClPort] = useState(5901);
  const [clPath, setClPath] = useState<VncConnectPath>('via_server');
  const [clPassword, setClPassword] = useState('');
  const [clRememberPass, setClRememberPass] = useState(false);
  /** Multi-session in-browser RFB viewers (panel WS proxy) */
  const [viewerSessions, setViewerSessions] = useState<VncViewerTarget[]>([]);
  const [viewerActiveKey, setViewerActiveKey] = useState<string | null>(null);
  const MAX_VIEWER_SESSIONS = 4;

  const viewerKey = (t: VncViewerTarget) => `${t.kind}:${t.id}`;

  const openViewer = useCallback(
    (target: VncViewerTarget) => {
      const key = viewerKey(target);
      setViewerSessions((prev) => {
        if (prev.some((s) => viewerKey(s) === key)) return prev;
        if (prev.length >= MAX_VIEWER_SESSIONS) {
          notifyWarn(
            t('vnc.viewer.sessionLimit', { max: String(MAX_VIEWER_SESSIONS) }),
          );
          return prev;
        }
        return [...prev, target];
      });
      setViewerActiveKey(key);
    },
    [t],
  );

  const closeViewerSession = useCallback((key: string) => {
    setViewerSessions((prev) => {
      const next = prev.filter((s) => viewerKey(s) !== key);
      setViewerActiveKey((cur) => {
        if (cur !== key) return cur;
        const last = next[next.length - 1];
        return last ? viewerKey(last) : null;
      });
      return next;
    });
  }, []);

  const isViewing = useCallback(
    (kind: 'account' | 'client', id: string) =>
      viewerSessions.some((s) => s.kind === kind && s.id === id),
    [viewerSessions],
  );

  // Settings form
  const [desktop, setDesktop] = useState<VncDesktopProfile>('xfce');
  const [geometry, setGeometry] = useState('1920x1080');
  const [depth, setDepth] = useState(24);
  const [rfbBind, setRfbBind] = useState<VncRfbBind>('localhost');
  const [autostart, setAutostart] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cPass, setCPass] = useState('');
  const [cPass2, setCPass2] = useState('');
  const [cDesktop, setCDesktop] = useState<VncDesktopProfile>('xfce');
  const [cGeo, setCGeo] = useState('1920x1080');
  const [cDepth, setCDepth] = useState(24);
  const [cBind, setCBind] = useState<VncRfbBind>('localhost');
  const [cStart, setCStart] = useState(true);

  // Edit modal
  const [edit, setEdit] = useState<VncAccountSummary | null>(null);
  const [eName, setEName] = useState('');
  const [eDesktop, setEDesktop] = useState<VncDesktopProfile>('xfce');
  const [eGeo, setEGeo] = useState('1920x1080');
  const [eDepth, setEDepth] = useState(24);
  const [eBind, setEBind] = useState<VncRfbBind>('localhost');
  const [eAuto, setEAuto] = useState(false);

  // Password modal
  const [pwTarget, setPwTarget] = useState<VncAccountSummary | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  // Delete
  const [delTarget, setDelTarget] = useState<VncAccountSummary | null>(null);
  const [delRemoveUser, setDelRemoveUser] = useState(false);

  // Connection materials
  const [connTarget, setConnTarget] = useState<VncAccountSummary | null>(null);
  const [connInfo, setConnInfo] = useState<Awaited<
    ReturnType<typeof vncApi.getConnection>
  > | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vncApi.status();
      setAccounts(s.accounts ?? []);
      setClients(s.clientProfiles ?? []);
      if (s.settings) {
        setDesktop(s.settings.defaultDesktop);
        setGeometry(s.settings.defaultGeometry);
        setDepth(s.settings.defaultDepth);
        setRfbBind(s.settings.defaultRfbBind);
        setAutostart(s.settings.defaultAutostart);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(accounts.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const pageItems = useMemo(() => {
    const start = pageSafe * PAGE_SIZE;
    return accounts.slice(start, start + PAGE_SIZE);
  }, [accounts, pageSafe]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const runOps = async (fn: () => Promise<VncOpsResult>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setLastOps(opsToPanel(r));
      if (r.ok && !r.blocked) notifyOk(r.notes?.[0] || t('common.completed'));
      else notifyWarn(r.notes?.[0] || t('common.opFailed'));
      await load();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setCName('');
    setCPass('');
    setCPass2('');
    setCDesktop(desktop);
    setCGeo(geometry);
    setCDepth(depth);
    setCBind(rfbBind);
    setCStart(true);
    setCreateOpen(true);
  };

  const openEdit = (a: VncAccountSummary) => {
    setEdit(a);
    setEName(a.name);
    setEDesktop(a.desktop);
    setEGeo(a.geometry);
    setEDepth(a.depth);
    setEBind(a.rfbBind);
    setEAuto(a.autostart);
  };

  const saveSettings = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await vncApi.patchSettings({
        defaultDesktop: desktop,
        defaultGeometry: geometry,
        defaultDepth: depth,
        defaultRfbBind: rfbBind,
        defaultAutostart: autostart,
      });
      setLastOps({ ok: r.ok, notes: [t('vnc.settingsSaved')] });
      if (r.ok) notifyOk(t('vnc.settingsSaved'));
      else notifyWarn(t('common.opFailed'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeaturePageLayout title={t('nav.vnc')} subtitle={t('vnc.pageDesc')}>
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`vnc.tab.${id}`) }))}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {lastOps ? (
          <OpsResultPanel
            title={t('vnc.result')}
            result={lastOps}
            defaultShowTechnical={!lastOps.ok || Boolean(lastOps.blocked)}
          />
        ) : null}

        {viewerSessions.length > 0 ? (
          <div className="vnc-viewer-panel">
            <div className="vnc-session-tabs" role="tablist" aria-label={t('vnc.viewer.sessions')}>
              {viewerSessions.map((s) => {
                const key = viewerKey(s);
                const active = key === viewerActiveKey;
                return (
                  <div
                    key={key}
                    className={`vnc-session-tab ${active ? 'is-active' : ''}`}
                    role="presentation"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className="vnc-session-tab__btn"
                      onClick={() => setViewerActiveKey(key)}
                    >
                      {s.label}
                      {s.subtitle ? (
                        <span className="muted u-text-xs"> · {s.subtitle}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="vnc-session-tab__close"
                      aria-label={t('vnc.viewer.closeSession', { name: s.label })}
                      onClick={() => closeViewerSession(key)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <span className="vnc-session-tabs__meta muted u-text-xs">
                {t('vnc.viewer.sessionCount', {
                  n: String(viewerSessions.length),
                  max: String(MAX_VIEWER_SESSIONS),
                })}
              </span>
            </div>
            {viewerSessions.map((s) => {
              const key = viewerKey(s);
              const active = key === viewerActiveKey;
              return (
                <div
                  key={key}
                  className={active ? undefined : 'u-hidden'}
                  hidden={!active}
                  role="tabpanel"
                >
                  <VncViewer
                    target={s}
                    createSession={async (tgt) => {
                      const r = await vncApi.createSession({
                        kind: tgt.kind,
                        id: tgt.id,
                      });
                      if (!r.ok || !r.wsPath) {
                        throw new Error(
                          r.notes?.[0] || r.message || t('vnc.viewer.error'),
                        );
                      }
                      return {
                        wsPath: r.wsPath,
                        password: r.password,
                        notes: r.notes,
                      };
                    }}
                    onClose={() => closeViewerSession(key)}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === 'accounts' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="tigervnc" title={t('vnc.needTigerVnc')} />
            <DataTable
              rowKey={(a) => a.id}
              title={t('vnc.accountListTitle', { count: accounts.length })}
              description={t('vnc.accountListDesc')}
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    {t('vnc.createAccount')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void load()}
                  >
                    {t('common.refresh')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: t('vnc.colName'),
                  render: (a) => <strong>{a.name}</strong>,
                },
                {
                  key: 'linux',
                  header: t('vnc.colLinuxUser'),
                  render: (a) => <code className="inline">{a.linuxUser}</code>,
                },
                {
                  key: 'display',
                  header: t('vnc.colDisplay'),
                  nowrap: true,
                  render: (a) => (
                    <span>
                      :{a.display}{' '}
                      <span className="muted">({a.rfbPort})</span>
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: t('vnc.colStatus'),
                  nowrap: true,
                  render: (a) => {
                    if (isViewing('account', a.id)) {
                      return (
                        <Badge tone="ok">{t('vnc.clientStatus.viewing')}</Badge>
                      );
                    }
                    return (
                      <Badge tone={accountStatusTone(a.status)}>
                        {t(`vnc.accountStatus.${a.status}`, {
                          defaultValue: a.status,
                        })}
                      </Badge>
                    );
                  },
                },
                {
                  key: 'desktop',
                  header: t('vnc.colDesktop'),
                  render: (a) => t(`vnc.desktop.${a.desktop}`),
                },
                {
                  key: 'bind',
                  header: t('vnc.colBind'),
                  nowrap: true,
                  render: (a) =>
                    a.rfbBind === 'localhost'
                      ? t('vnc.bind.localhostShort')
                      : t('vnc.bind.allShort'),
                },
              ]}
              rows={pageItems}
              empty={
                <EmptyState
                  title={t('vnc.accountsEmptyTitle')}
                  description={t('vnc.accountsEmptyDesc')}
                />
              }
              rowActions={(a) => (
                <ActionBar>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      openViewer({
                        kind: 'account',
                        id: a.id,
                        label: a.name,
                        subtitle: `:${a.display} · ${a.rfbPort}`,
                      })
                    }
                  >
                    {t('vnc.openInBrowser')}
                  </Button>
                  {a.status === 'running' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void runOps(() => vncApi.stopAccount(a.id))}
                    >
                      {t('vnc.stop')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void runOps(() => vncApi.startAccount(a.id))}
                    >
                      {t('vnc.start')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      void vncApi
                        .getConnection(a.id)
                        .then((c) => {
                          setConnTarget(a);
                          setConnInfo(c);
                        })
                        .catch((e) =>
                          setError(
                            e instanceof Error ? e.message : t('common.loadFailed'),
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('vnc.connection')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPwTarget(a);
                      setPw1('');
                      setPw2('');
                    }}
                  >
                    {t('vnc.setPassword')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setDelTarget(a);
                      setDelRemoveUser(false);
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
            {accounts.length > PAGE_SIZE ? (
              <div
                className="sys-conf-pager"
                role="navigation"
                aria-label={t('vnc.accountPager')}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageSafe <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  {t('vnc.prevPage')}
                </Button>
                <span className="sys-conf-pager__meta">
                  {t('vnc.pageOf', {
                    page: pageSafe + 1,
                    total: pageCount,
                    count: accounts.length,
                  })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageSafe >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  {t('vnc.nextPage')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'client' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needViewerOrNovnc')} />
            <Alert variant="info">{t('vnc.clientPathHint')}</Alert>
            <DataTable
              rowKey={(c) => c.id}
              title={t('vnc.clientListTitle', { count: clients.length })}
              description={t('vnc.clientListDesc')}
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setClName('');
                      setClHost('');
                      setClPort(5901);
                      setClPath('via_server');
                      setClPassword('');
                      setClRememberPass(false);
                      setClientOpen(true);
                    }}
                  >
                    {t('vnc.addClient')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void load()}
                  >
                    {t('common.refresh')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: t('vnc.colName'),
                  render: (c) => <strong>{c.name}</strong>,
                },
                {
                  key: 'target',
                  header: t('vnc.clientTarget'),
                  render: (c) => (
                    <code className="inline">
                      {c.host}:{c.port}
                    </code>
                  ),
                },
                {
                  key: 'path',
                  header: t('vnc.clientPath'),
                  nowrap: true,
                  render: (c) =>
                    c.path === 'direct'
                      ? t('vnc.pathHostViewer')
                      : t('vnc.pathBrowser'),
                },
                {
                  key: 'status',
                  header: t('vnc.colStatus'),
                  nowrap: true,
                  render: (c) => {
                    if (isViewing('client', c.id)) {
                      return (
                        <Badge tone="ok">{t('vnc.clientStatus.viewing')}</Badge>
                      );
                    }
                    return (
                      <Badge tone={c.status === 'up' ? 'ok' : 'neutral'}>
                        {t(`vnc.clientStatus.${c.status}`, {
                          defaultValue: c.status,
                        })}
                      </Badge>
                    );
                  },
                },
              ]}
              rows={clients}
              empty={
                <EmptyState
                  title={t('vnc.clientEmptyTitle')}
                  description={t('vnc.clientEmptyDesc')}
                />
              }
              rowActions={(c) => (
                <ActionBar>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      openViewer({
                        kind: 'client',
                        id: c.id,
                        label: c.name,
                        subtitle: `${c.host}:${c.port}`,
                      })
                    }
                  >
                    {t('vnc.openInBrowser')}
                  </Button>
                  {c.status === 'up' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void runOps(() => vncApi.clientDown(c.id))}
                    >
                      {t('vnc.disconnect')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() =>
                      void runOps(() => vncApi.clientUp(c.id, 'direct'))
                    }
                    title={t('vnc.pathHostViewer')}
                  >
                    {t('vnc.hostViewer')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onClick={() =>
                      void runOps(() => vncApi.deleteClientProfile(c.id))
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
          </div>
        ) : null}

        {tab === 'install' ? (
          <div className="stack">
            <Alert variant="info">{t('vnc.installHint')}</Alert>
            <SoftwareInstallBanner feature="tigervnc" title={t('vnc.needTigerVnc')} />
            <SoftwareVersionBar softwareId="tigervnc" />
            <SoftwareInstallBanner feature="novnc" title={t('vnc.needNovnc')} />
            <SoftwareVersionBar softwareId="novnc" />
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needXfce')} />
            <SoftwareVersionBar softwareId="vnc-desktop-xfce" />
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needViewer')} />
            <SoftwareVersionBar softwareId="tigervnc-viewer" />
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="stack">
            <Alert variant="info">{t('vnc.settingsHint')}</Alert>
            <FormLayout columns={2}>
              <Field label={t('vnc.defaultDesktop')} htmlFor="vnc-desk" flush>
                <select
                  id="vnc-desk"
                  value={desktop}
                  onChange={(e) => setDesktop(e.target.value as VncDesktopProfile)}
                >
                  <option value="xfce">{t('vnc.desktop.xfce')}</option>
                  <option value="terminal">{t('vnc.desktop.terminal')}</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultGeometry')} htmlFor="vnc-geo" flush>
                <select
                  id="vnc-geo"
                  value={geometry}
                  onChange={(e) => setGeometry(e.target.value)}
                >
                  <option value="1280x720">1280×720</option>
                  <option value="1600x900">1600×900</option>
                  <option value="1920x1080">1920×1080</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultDepth')} htmlFor="vnc-depth" flush>
                <select
                  id="vnc-depth"
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                >
                  <option value={16}>16</option>
                  <option value={24}>24</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultRfbBind')} htmlFor="vnc-bind" flush>
                <select
                  id="vnc-bind"
                  value={rfbBind}
                  onChange={(e) => setRfbBind(e.target.value as VncRfbBind)}
                >
                  <option value="localhost">{t('vnc.bind.localhost')}</option>
                  <option value="all">{t('vnc.bind.all')}</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultAutostart')} htmlFor="vnc-auto" flush>
                <label className="u-flex u-items-center u-gap-2">
                  <input
                    id="vnc-auto"
                    type="checkbox"
                    checked={autostart}
                    onChange={(e) => setAutostart(e.target.checked)}
                  />
                  {t('vnc.autostartLabel')}
                </label>
              </Field>
            </FormLayout>
            <div className="u-flex-gap">
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                onClick={() => void saveSettings()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="vnc" /> : null}
      </PageTabs>

      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        title={t('vnc.createAccountTitle')}
        description={t('vnc.createAccountDesc')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!cName.trim()) {
                  notifyWarn(t('vnc.needName'));
                  return;
                }
                if (cPass && cPass !== cPass2) {
                  notifyWarn(t('vnc.passwordMismatch'));
                  return;
                }
                if (cPass && cPass.length < 6) {
                  notifyWarn(t('vnc.passwordTooShort'));
                  return;
                }
                void runOps(() =>
                  vncApi.createAccount({
                    name: cName.trim(),
                    password: cPass || undefined,
                    desktop: cDesktop,
                    geometry: cGeo,
                    depth: cDepth,
                    rfbBind: cBind,
                    start: cStart,
                  }),
                ).then((r) => {
                  if (r?.ok) setCreateOpen(false);
                });
              }}
            >
              {t('vnc.createAccountBtn')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('vnc.colName')} htmlFor="c-name" required flush>
            <input
              id="c-name"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="alice"
            />
          </Field>
          <Field
            label={t('common.password')}
            htmlFor="c-pass"
            hint={t('vnc.passwordHint')}
            flush
          >
            <input
              id="c-pass"
              type="password"
              value={cPass}
              onChange={(e) => setCPass(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('vnc.confirmPassword')} htmlFor="c-pass2" flush>
            <input
              id="c-pass2"
              type="password"
              value={cPass2}
              onChange={(e) => setCPass2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('vnc.defaultDesktop')} htmlFor="c-desk" flush>
            <select
              id="c-desk"
              value={cDesktop}
              onChange={(e) => setCDesktop(e.target.value as VncDesktopProfile)}
            >
              <option value="xfce">{t('vnc.desktop.xfce')}</option>
              <option value="terminal">{t('vnc.desktop.terminal')}</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultGeometry')} htmlFor="c-geo" flush>
            <select id="c-geo" value={cGeo} onChange={(e) => setCGeo(e.target.value)}>
              <option value="1280x720">1280×720</option>
              <option value="1600x900">1600×900</option>
              <option value="1920x1080">1920×1080</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultDepth')} htmlFor="c-depth" flush>
            <select
              id="c-depth"
              value={cDepth}
              onChange={(e) => setCDepth(Number(e.target.value))}
            >
              <option value={16}>16</option>
              <option value={24}>24</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultRfbBind')} htmlFor="c-bind" flush>
            <select
              id="c-bind"
              value={cBind}
              onChange={(e) => setCBind(e.target.value as VncRfbBind)}
            >
              <option value="localhost">{t('vnc.bind.localhost')}</option>
              <option value="all">{t('vnc.bind.all')}</option>
            </select>
          </Field>
          <label className="u-flex u-items-center u-gap-2">
            <input
              type="checkbox"
              checked={cStart}
              onChange={(e) => setCStart(e.target.checked)}
            />
            {t('vnc.startAfterCreate')}
          </label>
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(edit)}
        onClose={() => !busy && setEdit(null)}
        title={t('vnc.editAccountTitle')}
        description={
          edit
            ? t('vnc.editAccountDesc', {
                user: edit.linuxUser,
                display: edit.display,
              })
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setEdit(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!edit) return;
                void runOps(() =>
                  vncApi.updateAccount(edit.id, {
                    name: eName.trim(),
                    desktop: eDesktop,
                    geometry: eGeo,
                    depth: eDepth,
                    rfbBind: eBind,
                    autostart: eAuto,
                  }),
                ).then((r) => {
                  if (r?.ok) setEdit(null);
                });
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('vnc.colLinuxUser')} htmlFor="e-user" flush>
            <input id="e-user" value={edit?.linuxUser ?? ''} readOnly disabled />
          </Field>
          <Field label={t('vnc.colName')} htmlFor="e-name" flush>
            <input id="e-name" value={eName} onChange={(e) => setEName(e.target.value)} />
          </Field>
          <Field label={t('vnc.defaultDesktop')} htmlFor="e-desk" flush>
            <select
              id="e-desk"
              value={eDesktop}
              onChange={(e) => setEDesktop(e.target.value as VncDesktopProfile)}
            >
              <option value="xfce">{t('vnc.desktop.xfce')}</option>
              <option value="terminal">{t('vnc.desktop.terminal')}</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultGeometry')} htmlFor="e-geo" flush>
            <select id="e-geo" value={eGeo} onChange={(e) => setEGeo(e.target.value)}>
              <option value="1280x720">1280×720</option>
              <option value="1600x900">1600×900</option>
              <option value="1920x1080">1920×1080</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultDepth')} htmlFor="e-depth" flush>
            <select
              id="e-depth"
              value={eDepth}
              onChange={(e) => setEDepth(Number(e.target.value))}
            >
              <option value={16}>16</option>
              <option value={24}>24</option>
            </select>
          </Field>
          <Field label={t('vnc.defaultRfbBind')} htmlFor="e-bind" flush>
            <select
              id="e-bind"
              value={eBind}
              onChange={(e) => setEBind(e.target.value as VncRfbBind)}
            >
              <option value="localhost">{t('vnc.bind.localhost')}</option>
              <option value="all">{t('vnc.bind.all')}</option>
            </select>
          </Field>
          <label className="u-flex u-items-center u-gap-2">
            <input
              type="checkbox"
              checked={eAuto}
              onChange={(e) => setEAuto(e.target.checked)}
            />
            {t('vnc.autostartLabel')}
          </label>
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(pwTarget)}
        onClose={() => !busy && setPwTarget(null)}
        title={t('vnc.setPasswordTitle')}
        description={
          pwTarget
            ? t('vnc.setPasswordDesc', { address: pwTarget.name })
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setPwTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!pwTarget) return;
                if (pw1 !== pw2) {
                  notifyWarn(t('vnc.passwordMismatch'));
                  return;
                }
                if (pw1.length < 6) {
                  notifyWarn(t('vnc.passwordTooShort'));
                  return;
                }
                void runOps(() => vncApi.setPassword(pwTarget.id, pw1)).then((r) => {
                  if (r?.ok) setPwTarget(null);
                });
              }}
            >
              {t('vnc.setPassword')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('vnc.newPassword')} htmlFor="pw1" flush>
            <input
              id="pw1"
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('vnc.confirmPassword')} htmlFor="pw2" flush>
            <input
              id="pw2"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </FormLayout>
      </Modal>

      <ConfirmDialog
        open={Boolean(delTarget)}
        onClose={() => {
          if (!busy) setDelTarget(null);
        }}
        onConfirm={() => {
          if (!delTarget) return;
          const target = delTarget;
          const remove = delRemoveUser;
          setDelTarget(null);
          void runOps(() =>
            vncApi.deleteAccount(target.id, { removeLinuxUser: remove }),
          );
        }}
        title={t('vnc.deleteAccountTitle')}
        description={t('vnc.deleteAccountDesc', {
          name: delTarget?.name ?? '',
          user: delTarget?.linuxUser ?? '',
        })}
        consequences={[
          t('vnc.deleteAccountC1'),
          t('vnc.deleteAccountC2'),
          delRemoveUser ? t('vnc.deleteAccountC3User') : t('vnc.deleteAccountC3Keep'),
        ]}
        confirmLabel={t('common.delete')}
        severity="destructive"
        busy={busy}
      >
        <label className="u-flex u-items-center u-gap-2 u-mt-3">
          <input
            type="checkbox"
            checked={delRemoveUser}
            onChange={(e) => setDelRemoveUser(e.target.checked)}
          />
          {t('vnc.removeLinuxUser')}
        </label>
      </ConfirmDialog>

      <Modal
        open={clientOpen}
        onClose={() => !busy && setClientOpen(false)}
        title={t('vnc.addClientTitle')}
        description={t('vnc.addClientDesc')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setClientOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!clName.trim() || !clHost.trim()) {
                  notifyWarn(t('vnc.clientNeedFields'));
                  return;
                }
                setBusy(true);
                void vncApi
                  .createClientProfile({
                    name: clName.trim(),
                    host: clHost.trim(),
                    port: clPort,
                    path: clPath,
                    password:
                      clRememberPass && clPassword.trim()
                        ? clPassword
                        : undefined,
                  })
                  .then(async () => {
                    notifyOk(t('vnc.clientCreated'));
                    setClientOpen(false);
                    setClPassword('');
                    setClRememberPass(false);
                    await load();
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : t('common.loadFailed')),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {t('vnc.addClient')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('vnc.colName')} htmlFor="cl-name" required flush>
            <input
              id="cl-name"
              value={clName}
              onChange={(e) => setClName(e.target.value)}
              placeholder="office-pc"
            />
          </Field>
          <Field label={t('vnc.clientHost')} htmlFor="cl-host" required flush>
            <input
              id="cl-host"
              value={clHost}
              onChange={(e) => setClHost(e.target.value)}
              placeholder="192.168.1.50"
            />
          </Field>
          <Field label={t('common.port')} htmlFor="cl-port" flush>
            <input
              id="cl-port"
              type="number"
              min={1}
              max={65535}
              value={clPort}
              onChange={(e) => setClPort(Number(e.target.value) || 5901)}
            />
          </Field>
          <Field label={t('vnc.clientPath')} htmlFor="cl-path" flush>
            <select
              id="cl-path"
              value={clPath}
              onChange={(e) =>
                setClPath(e.target.value === 'direct' ? 'direct' : 'via_server')
              }
            >
              <option value="via_server">{t('vnc.pathBrowser')}</option>
              <option value="direct">{t('vnc.pathHostViewer')}</option>
            </select>
          </Field>
          <Field
            label={t('vnc.clientPasswordOptional')}
            htmlFor="cl-pass"
            hint={t('vnc.clientPasswordHint')}
            flush
          >
            <input
              id="cl-pass"
              type="password"
              value={clPassword}
              onChange={(e) => setClPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>
          <label className="u-flex u-items-start u-gap-2">
            <input
              type="checkbox"
              checked={clRememberPass}
              onChange={(e) => setClRememberPass(e.target.checked)}
              disabled={!clPassword.trim()}
            />
            <span className="u-text-sm">{t('vnc.clientRememberPassword')}</span>
          </label>
          {clRememberPass ? (
            <Alert variant="warn">{t('vnc.clientRememberPasswordWarn')}</Alert>
          ) : null}
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(connTarget)}
        onClose={() => {
          if (!busy) {
            setConnTarget(null);
            setConnInfo(null);
          }
        }}
        title={t('vnc.connectionTitle')}
        description={
          connTarget
            ? t('vnc.connectionDesc', { name: connTarget.name })
            : undefined
        }
        size="lg"
        footer={
          <ActionBar>
            {connTarget ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  const a = connTarget;
                  setConnTarget(null);
                  setConnInfo(null);
                  openViewer({
                    kind: 'account',
                    id: a.id,
                    label: a.name,
                    subtitle: `:${a.display} · ${a.rfbPort}`,
                  });
                }}
              >
                {t('vnc.openInBrowser')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setConnTarget(null);
                setConnInfo(null);
              }}
            >
              {t('common.close')}
            </Button>
          </ActionBar>
        }
      >
        {!connInfo ? (
          <LoadingBlock />
        ) : (
          <div className="stack">
            <Alert variant="info">{t('vnc.connectionBrowserHint')}</Alert>

            <section className="stack">
              <h4 className="u-m-0">
                {t('vnc.openInBrowser')}{' '}
                <Badge tone="ok">{t('vnc.recommended')}</Badge>
              </h4>
              <p className="muted u-text-sm u-mb-0">
                {t('vnc.connectionBrowserDesc')}
              </p>
              <ActionBar>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const a = connTarget!;
                    setConnTarget(null);
                    setConnInfo(null);
                    openViewer({
                      kind: 'account',
                      id: a.id,
                      label: a.name,
                      subtitle: `:${a.display} · ${a.rfbPort}`,
                    });
                  }}
                >
                  {t('vnc.openInBrowser')}
                </Button>
              </ActionBar>
            </section>

            <details className="vnc-conn-advanced">
              <summary className="u-text-sm">{t('vnc.connectionAdvanced')}</summary>
              <div className="stack u-mt-2">
                <section className="stack">
                  <h4 className="u-m-0">{t('vnc.pathViaServerLegacy')}</h4>
                  <p className="muted u-text-sm u-mb-0">
                    {t('vnc.pathViaServerLegacyHint')}
                  </p>
                  <p className="muted u-text-sm u-mb-0">
                    {connInfo.connection.viaServer.notes.join(' · ')}
                  </p>
                  <ActionBar>
                    {connInfo.connection.viaServer.available ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() =>
                          void runOps(() =>
                            vncApi.stopNovnc(connTarget!.id),
                          ).then(async () => {
                            if (connTarget) {
                              setConnInfo(
                                await vncApi.getConnection(connTarget.id),
                              );
                            }
                          })
                        }
                      >
                        {t('vnc.stopNovnc')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() =>
                          void runOps(() =>
                            vncApi.startNovnc(connTarget!.id),
                          ).then(async () => {
                            if (connTarget) {
                              setConnInfo(
                                await vncApi.getConnection(connTarget.id),
                              );
                            }
                          })
                        }
                      >
                        {t('vnc.startNovnc')}
                      </Button>
                    )}
                    {connInfo.connection.viaServer.localUrl ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            connInfo.connection.viaServer.localUrl!,
                          );
                          notifyOk(t('vnc.copied'));
                        }}
                      >
                        {t('vnc.copyNovncUrl')}
                      </Button>
                    ) : null}
                  </ActionBar>
                  {connInfo.connection.viaServer.localUrl ? (
                    <p className="u-mb-0">
                      <code className="inline">
                        {connInfo.connection.viaServer.localUrl}
                      </code>
                    </p>
                  ) : null}
                </section>

                <section className="stack">
                  <h4 className="u-m-0">{t('vnc.pathDirect')}</h4>
                  <p className="muted u-text-sm u-mb-0">
                    {connInfo.connection.direct.notes.join(' · ')}
                  </p>
                  <p className="u-mb-0">
                    <strong>{t('vnc.directAddress')}:</strong>{' '}
                    <code className="inline">
                      {connInfo.connection.direct.address}
                    </code>
                  </p>
                  <ActionBar>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          connInfo.connection.direct.address,
                        );
                        notifyOk(t('vnc.copied'));
                      }}
                    >
                      {t('vnc.copyAddress')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() =>
                        void runOps(() => vncApi.openFirewall(connTarget!.id))
                      }
                    >
                      {t('vnc.openFirewall')}
                    </Button>
                  </ActionBar>
                  {connInfo.connection.direct.bind === 'localhost' ? (
                    <Alert variant="warn">{t('vnc.directLocalhostWarn')}</Alert>
                  ) : null}
                </section>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </FeaturePageLayout>
  );
}
