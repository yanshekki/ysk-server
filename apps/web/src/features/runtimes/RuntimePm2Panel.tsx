/**
 * Node/Bun Processes tab — YSK systemd projects + PM2 (panel user) + SSE.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  DataTable,
  DescriptionList,
  EmptyState,
  Modal,
  buttonClassName,
} from '../../shared/components/ui';
import {
  pm2Api,
  type Pm2AppRow,
  type Pm2StartupProbe,
  type ProcessFleetSnapshot,
  type ProjectProcessRow,
} from '../pm2/api';

function formatMem(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatUptime(pmUptime: number | null): string {
  if (pmUptime == null || !Number.isFinite(pmUptime)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - pmUptime) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'online' || s === 'launching' || s === 'active' || s === 'running') return 'ok';
  if (s === 'stopped' || s === 'stopping' || s === 'inactive') return 'warn';
  if (s === 'errored' || s === 'error' || s === 'failed') return 'danger';
  return 'neutral';
}

export function filterPm2Rows(
  apps: Pm2AppRow[],
  opts: { yskOnly: boolean; q: string },
): Pm2AppRow[] {
  let out = apps;
  if (opts.yskOnly) out = out.filter((a) => a.yskManaged);
  const q = opts.q.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.script.toLowerCase().includes(q) ||
        a.cwd.toLowerCase().includes(q) ||
        a.interpreter.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q) ||
        String(a.pid ?? '').includes(q) ||
        a.port.includes(q),
    );
  }
  return out;
}

export function RuntimePm2Panel({ runtimes = 'node,bun' }: { runtimes?: string }) {
  const { t } = useTranslation();
  const [fleet, setFleet] = useState<ProcessFleetSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [yskOnly, setYskOnly] = useState(false);
  const [q, setQ] = useState('');
  const [rawApp, setRawApp] = useState<Pm2AppRow | null>(null);
  const [tickLog, setTickLog] = useState<string[]>([]);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [startup, setStartup] = useState<Pm2StartupProbe | null>(null);
  const acRef = useRef<AbortController | null>(null);

  const applyFleet = useCallback((s: ProcessFleetSnapshot) => {
    setFleet(s);
    setErr(null);
    const pm2 = s.pm2;
    setTickLog((prev) =>
      [
        `${s.at} · projects=${s.projects.length} pm2=${pm2.apps.length} run=${pm2.running}`,
        ...prev,
      ].slice(0, 40),
    );
  }, []);

  const refreshStartup = useCallback(async () => {
    try {
      setStartup(await pm2Api.startupStatus());
    } catch {
      setStartup(null);
    }
  }, []);

  const refreshOnce = useCallback(async () => {
    try {
      const s = await pm2Api.fleet(runtimes);
      applyFleet(s);
      await refreshStartup();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [applyFleet, refreshStartup, runtimes, t]);

  useEffect(() => {
    if (!live) {
      acRef.current?.abort();
      acRef.current = null;
      void refreshOnce();
      return;
    }
    acRef.current?.abort();
    const ac = pm2Api.openFleetStream({
      interval: 2,
      runtimes,
      onTick: applyFleet,
      onError: (msg) => setErr(msg),
    });
    acRef.current = ac;
    return () => {
      ac.abort();
      acRef.current = null;
    };
  }, [live, applyFleet, refreshOnce, runtimes]);

  const snap = fleet?.pm2 ?? null;
  const projects = fleet?.projects ?? [];
  const rows = useMemo(
    () => filterPm2Rows(snap?.apps ?? [], { yskOnly, q }),
    [snap?.apps, yskOnly, q],
  );

  const runStartup = useCallback(
    async (action: 'install' | 'save') => {
      const key = `startup:${action}`;
      setBusyKey(key);
      setActionMsg(null);
      try {
        const r = await pm2Api.startupAction(action);
        setActionMsg(
          r.ok
            ? t('runtime.pm2.startupOk', { notes: r.notes?.join('；') || '' })
            : t('runtime.pm2.startupFail', { notes: r.notes?.join('；') || '' }),
        );
        await refreshStartup();
        await refreshOnce();
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : t('common.applyFailed'));
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOnce, refreshStartup, t],
  );

  const runPm2Action = useCallback(
    async (name: string, action: 'restart' | 'reload' | 'stop') => {
      const key = `pm2:${action}:${name}`;
      setBusyKey(key);
      setActionMsg(null);
      try {
        const r = await pm2Api.pm2Action(name, action);
        const notes = r.notes?.join('；') || '';
        setActionMsg(
          r.ok
            ? t('runtime.pm2.actionOk', { action, name, notes })
            : t('runtime.pm2.actionFail', { action, name, notes }),
        );
        await refreshOnce();
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : t('common.applyFailed'));
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOnce, t],
  );

  const runSystemdAction = useCallback(
    async (projectId: string, name: string, action: 'restart' | 'stop') => {
      const key = `sd:${action}:${projectId}`;
      setBusyKey(key);
      setActionMsg(null);
      try {
        const r = await pm2Api.systemdAction(projectId, action);
        const notes = r.notes?.join('；') || '';
        setActionMsg(
          r.ok
            ? t('runtime.pm2.actionOk', { action, name, notes })
            : t('runtime.pm2.actionFail', { action, name, notes }),
        );
        await refreshOnce();
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : t('common.applyFailed'));
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOnce, t],
  );

  return (
    <div className="u-stack u-gap-4">
      <Card>
        <CardHeader
          title={t('runtime.pm2.title')}
          description={t('runtime.pm2.desc')}
          actions={
            <div className="u-flex u-flex-wrap u-gap-2 u-items-center">
              <label className="u-flex u-items-center u-gap-1 u-text-sm">
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                />
                {t('runtime.pm2.live')}
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={() => void refreshOnce()}>
                {t('common.refresh')}
              </Button>
            </div>
          }
        />
        <CardSection>
          {err ? <Alert variant="error">{err}</Alert> : null}
          {actionMsg ? (
            <Alert variant="info" className="u-mb-2">
              {actionMsg}
            </Alert>
          ) : null}
          {snap ? (
            <DescriptionList
              columns={2}
              items={[
                {
                  label: t('runtime.pm2.installed'),
                  value: (
                    <Badge tone={snap.available ? 'ok' : 'warn'}>
                      {snap.available ? t('common.yes') : t('common.no')}
                    </Badge>
                  ),
                },
                { label: t('runtime.pm2.version'), value: snap.version || '—' },
                { label: t('runtime.pm2.path'), value: snap.path || '—' },
                {
                  label: t('runtime.pm2.counts'),
                  value: t('runtime.pm2.countsValue', {
                    n: snap.apps.length,
                    run: snap.running,
                    stop: snap.stopped,
                    err: snap.errored,
                  }),
                },
                {
                  label: t('runtime.pm2.projectsCount'),
                  value: String(projects.length),
                },
                { label: t('runtime.pm2.updatedAt'), value: fleet?.at || snap.at || '—' },
              ]}
            />
          ) : (
            <p className="muted u-text-sm">{t('common.loading')}</p>
          )}
          {(fleet?.notes ?? snap?.notes)?.length ? (
            <ul className="muted u-text-sm u-mt-2">
              {(fleet?.notes ?? snap?.notes ?? []).slice(0, 6).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </CardSection>
      </Card>

      {/* PM2 boot survival */}
      <Card>
        <CardSection
          title={t('runtime.pm2.startupTitle')}
          description={t('runtime.pm2.startupDesc')}
        >
          {startup ? (
            <>
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: t('runtime.pm2.startupReady'),
                    value: (
                      <Badge tone={startup.readyForBoot ? 'ok' : 'warn'}>
                        {startup.readyForBoot
                          ? t('runtime.pm2.startupReadyYes')
                          : t('runtime.pm2.startupReadyNo')}
                      </Badge>
                    ),
                  },
                  {
                    label: t('runtime.pm2.startupUnit'),
                    value: startup.unit
                      ? `${startup.unit} · ${startup.unitActive ?? '?'} / ${startup.unitEnabled ?? '?'}`
                      : '—',
                  },
                  {
                    label: t('runtime.pm2.startupDump'),
                    value: startup.dumpExists
                      ? startup.dumpPath || t('common.yes')
                      : t('common.no'),
                  },
                ]}
              />
              {startup.suggestedCommands.length > 0 ? (
                <pre className="code-block u-text-sm u-mt-2">
                  {startup.suggestedCommands.join('\n')}
                </pre>
              ) : null}
              {startup.notes.length > 0 ? (
                <ul className="muted u-text-sm u-mt-2">
                  {startup.notes.slice(0, 6).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
              <div className="u-flex u-flex-wrap u-gap-2 u-mt-3">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={busyKey === 'startup:install'}
                  disabled={busyKey != null || !startup.pm2Available}
                  onClick={() => void runStartup('install')}
                >
                  {t('runtime.pm2.startupInstall')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busyKey === 'startup:save'}
                  disabled={busyKey != null || !startup.pm2Available}
                  onClick={() => void runStartup('save')}
                >
                  {t('runtime.pm2.startupSave')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyKey != null}
                  onClick={() => void refreshStartup()}
                >
                  {t('common.refresh')}
                </Button>
              </div>
              <p className="muted u-text-sm u-mt-2">{t('runtime.pm2.startupHint')}</p>
            </>
          ) : (
            <p className="muted u-text-sm">{t('common.loading')}</p>
          )}
        </CardSection>
      </Card>

      {/* YSK projects (systemd) — primary visibility for running deploys */}
      <Card>
        <CardSection
          title={t('runtime.pm2.projectsTitle')}
          description={t('runtime.pm2.projectsDesc')}
        >
          {projects.length === 0 ? (
            <EmptyState
              title={t('runtime.pm2.noProjects')}
              description={t('runtime.pm2.noProjectsDesc')}
            />
          ) : (
            <DataTable<ProjectProcessRow>
              rowKey={(r) => r.projectId}
              columns={[
                {
                  key: 'name',
                  header: t('runtime.pm2.col.name'),
                  render: (r) => (
                    <Link to={`/projects/${r.projectId}`}>{r.name}</Link>
                  ),
                },
                {
                  key: 'user',
                  header: t('runtime.pm2.col.user'),
                  render: (r) => r.linuxUser,
                },
                {
                  key: 'active',
                  header: t('runtime.pm2.col.status'),
                  render: (r) => <Badge tone={statusTone(r.active)}>{r.active}</Badge>,
                },
                {
                  key: 'pid',
                  header: 'PID',
                  render: (r) => (r.mainPid ? String(r.mainPid) : '—'),
                },
                {
                  key: 'port',
                  header: t('common.port'),
                  render: (r) => (r.port != null ? String(r.port) : '—'),
                },
                {
                  key: 'mode',
                  header: t('runtime.pm2.col.mode'),
                  render: (r) => r.deployMode || '—',
                },
                {
                  key: 'unit',
                  header: t('runtime.pm2.col.unit'),
                  render: (r) => <span className="u-text-sm">{r.unit}</span>,
                },
                {
                  key: 'rt',
                  header: t('runtime.pm2.col.runtime'),
                  render: (r) =>
                    `${r.runtime}${r.runtimeVersion ? ` ${r.runtimeVersion}` : ''}`,
                },
              ]}
              rows={projects}
              rowActions={(r) => (
                <div className="u-flex u-flex-wrap u-gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={busyKey === `sd:restart:${r.projectId}`}
                    disabled={busyKey != null}
                    onClick={() => void runSystemdAction(r.projectId, r.name, 'restart')}
                  >
                    {t('runtime.pm2.actRestart')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busyKey === `sd:stop:${r.projectId}`}
                    disabled={busyKey != null}
                    onClick={() => void runSystemdAction(r.projectId, r.name, 'stop')}
                  >
                    {t('runtime.pm2.actStop')}
                  </Button>
                </div>
              )}
            />
          )}
          <p className="muted u-text-sm u-mt-2">{t('runtime.pm2.systemdActionsHint')}</p>
        </CardSection>
      </Card>

      {/* PM2 (panel user) */}
      <Card>
        <CardSection title={t('runtime.pm2.tableTitle')} description={t('runtime.pm2.pm2OnlyDesc')}>
          <div className="u-flex u-flex-wrap u-gap-3 u-mb-3 u-items-center">
            <label className="u-flex u-items-center u-gap-1 u-text-sm">
              <input
                type="checkbox"
                checked={yskOnly}
                onChange={(e) => setYskOnly(e.target.checked)}
              />
              {t('runtime.pm2.yskOnly')}
            </label>
            <input
              className="input"
              style={{ maxWidth: 240 }}
              placeholder={t('runtime.pm2.filterPh')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {!snap?.available ? (
            <EmptyState
              title={t('runtime.pm2.emptyTitle')}
              description={t('runtime.pm2.emptyDesc')}
            />
          ) : rows.length === 0 ? (
            <EmptyState title={t('runtime.pm2.noApps')} description={t('runtime.pm2.noAppsDesc')} />
          ) : (
            <DataTable<Pm2AppRow>
              rowKey={(a, i) => `${a.pmId ?? a.name}-${a.pid ?? i}`}
              columns={[
                {
                  key: 'name',
                  header: t('runtime.pm2.col.name'),
                  render: (a) => (
                    <span>
                      {a.name} {a.yskManaged ? <Badge tone="ok">ysk</Badge> : null}
                    </span>
                  ),
                },
                {
                  key: 'pid',
                  header: 'PID',
                  render: (a) => (a.pid && a.pid > 0 ? String(a.pid) : '—'),
                },
                {
                  key: 'status',
                  header: t('runtime.pm2.col.status'),
                  render: (a) => <Badge tone={statusTone(a.status)}>{a.status}</Badge>,
                },
                {
                  key: 'cpu',
                  header: 'CPU%',
                  render: (a) => (a.cpu != null ? a.cpu.toFixed(1) : '—'),
                },
                {
                  key: 'mem',
                  header: t('runtime.pm2.col.mem'),
                  render: (a) => formatMem(a.memory),
                },
                {
                  key: 'restarts',
                  header: t('runtime.pm2.col.restarts'),
                  render: (a) =>
                    a.restarts != null
                      ? `${a.restarts}${a.unstableRestarts ? ` (u${a.unstableRestarts})` : ''}`
                      : '—',
                },
                {
                  key: 'uptime',
                  header: t('runtime.pm2.col.uptime'),
                  render: (a) => formatUptime(a.pmUptime),
                },
                {
                  key: 'port',
                  header: t('common.port'),
                  render: (a) => a.port || '—',
                },
                {
                  key: 'script',
                  header: t('runtime.pm2.col.script'),
                  render: (a) => (
                    <span className="u-text-sm" title={a.cwd}>
                      {a.script || '—'}
                    </span>
                  ),
                },
                {
                  key: 'interp',
                  header: t('runtime.pm2.col.interpreter'),
                  render: (a) => (
                    <span className="u-text-sm" title={a.interpreter}>
                      {(a.interpreter || '—').split('/').slice(-2).join('/')}
                    </span>
                  ),
                },
              ]}
              rows={rows}
              rowActions={(a) => (
                <div className="u-flex u-flex-wrap u-gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={busyKey === `pm2:restart:${a.name}`}
                    disabled={busyKey != null}
                    onClick={() => void runPm2Action(a.name, 'restart')}
                  >
                    {t('runtime.pm2.actRestart')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={busyKey === `pm2:reload:${a.name}`}
                    disabled={busyKey != null}
                    onClick={() => void runPm2Action(a.name, 'reload')}
                  >
                    {t('runtime.pm2.actReload')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busyKey === `pm2:stop:${a.name}`}
                    disabled={busyKey != null}
                    onClick={() => void runPm2Action(a.name, 'stop')}
                  >
                    {t('runtime.pm2.actStop')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRawApp(a)}>
                    JSON
                  </Button>
                </div>
              )}
            />
          )}
          <p className="muted u-text-sm u-mt-2">{t('runtime.pm2.pm2ActionsHint')}</p>
          {snap && !snap.available ? (
            <Alert variant="info" className="u-mt-3">
              {t('runtime.pm2.notInstalled')}{' '}
              <Link
                to="?tab=overview"
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                {t('runtime.pm2.installHint')}
              </Link>
            </Alert>
          ) : null}
        </CardSection>
      </Card>

      {live && tickLog.length > 0 ? (
        <Card>
          <CardSection title={t('runtime.pm2.streamLog')} description={t('runtime.pm2.streamLogDesc')}>
            <pre className="code-block u-text-sm" style={{ maxHeight: 160, overflow: 'auto' }}>
              {tickLog.join('\n')}
            </pre>
          </CardSection>
        </Card>
      ) : null}

      <Modal open={rawApp != null} onClose={() => setRawApp(null)} title={rawApp?.name ?? 'JSON'}>
        <pre className="code-block u-text-sm" style={{ maxHeight: 420, overflow: 'auto' }}>
          {rawApp ? JSON.stringify(rawApp.raw, null, 2) : ''}
        </pre>
      </Modal>
    </div>
  );
}
