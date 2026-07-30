/**
 * Shared MySQL or MariaDB management page:
 * service status + permission strip + one install CTA + DB/users CRUD.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  DataTable,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  FormActions,
  FormHint,
  CheckboxField,
  SegRadio,
  SoftwareInstallBanner,
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { dbEngineApi, type DbEngineKind, type DbEngineStatus } from '../../features/db-engine';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { api } from '../../shared/services/api';
import { useTranslation } from 'react-i18next';
import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';

function serviceLabel(s: DbEngineStatus | null, t: (key: string, opts?: Record<string, unknown>) => string): {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  if (!s) return { text: t('common.loading'), tone: 'neutral' };
  if (!s.serverInstalled) return { text: t('common.notInstalled'), tone: 'danger' };
  if (s.active === 'active') return { text: t('common.running'), tone: 'ok' };
  if (s.active === 'inactive') return { text: t('common.stopped'), tone: 'warn' };
  return { text: s.active || t('common.unknown'), tone: 'warn' };
}

export function SqlEnginePage({ engine }: { engine: DbEngineKind }) {
  const { t } = useTranslation();
  const title = engine === 'mysql' ? 'MySQL' : 'MariaDB';
  const servicePath =
    engine === 'mysql' ? '/databases/mysql/service' : '/databases/mariadb/service';
  const dbs = useResourceCrud('mysql/databases', { engine });
  const users = useResourceCrud('mysql/users', { engine });
  const [svc, setSvc] = useState<DbEngineStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy: actBusy, error: actError, result, msg, run, setMsg, setError } =
    useFeatureAction();

  const [tab, setTab] = useState('databases');
  const [createOpen, setCreateOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [delDb, setDelDb] = useState<string | null>(null);
  const [delUser, setDelUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [createUser, setCreateUser] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('localhost');
  const [dbId, setDbId] = useState('');
  const [tempUsers, setTempUsers] = useState<Array<Record<string, unknown>>>([]);
  const [remoteHosts, setRemoteHosts] = useState<Array<Record<string, unknown>>>([]);
  const [tempDb, setTempDb] = useState('');
  const [tempTtl, setTempTtl] = useState('24');
  const [remoteLabel, setRemoteLabel] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [remotePort, setRemotePort] = useState('3306');
  const [remoteUser, setRemoteUser] = useState('');
  const [remotePass, setRemotePass] = useState('');
  const [lastTempPassword, setLastTempPassword] = useState<string | null>(null);
  const [adminerOpen, setAdminerOpen] = useState(false);
  const [adminerDomain, setAdminerDomain] = useState(`adminer.${engine}.local`);
  const [adminerDownload, setAdminerDownload] = useState(true);
  const [importConfirm, setImportConfirm] = useState<{
    dbName: string;
    dumpName: string;
  } | null>(null);

  const busy = dbs.busy || users.busy || actBusy;
  const error = dbs.error || users.error || actError;

  const refreshSvc = useCallback(async () => {
    setLoadError(null);
    try {
      setSvc(await dbEngineApi.status(engine));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.statusLoadFailed'));
    }
  }, [engine]);

  const refreshExtras = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/db/temp-users'),
        api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/db/remote-hosts'),
      ]);
      setTempUsers((t.items ?? []).filter((u) => String(u.engine) === engine));
      setRemoteHosts((r.items ?? []).filter((h) => String(h.engine) === engine));
    } catch {
      /* optional */
    }
  }, [engine]);

  useEffect(() => {
    void refreshSvc();
    void refreshExtras();
  }, [refreshSvc, refreshExtras]);

  async function onInstall() {
    await run(async () => {
      try {
        const r = await dbEngineApi.install(engine);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        return {
          ok: false,
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
    }, t('db.installedOk', { engine: title }));
  }

  async function onStart() {
    await run(async () => {
      try {
        const r = await dbEngineApi.start(engine);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.startFailed');
        return {
          ok: false,
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
    }, t('db.startedOk', { engine: title }));
  }

  async function onCreateDb(e: FormEvent) {
    e.preventDefault();
    await dbs.create({
      name,
      engine,
      createUser,
      username: createUser ? username || name : undefined,
      password: createUser ? password : undefined,
      host,
    });
    await users.refresh();
    setCreateOpen(false);
    setName('');
    setUsername('');
    setPassword('');
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    await users.create({
      username,
      password,
      host,
      engine,
      databaseId: dbId || undefined,
      privileges: ['ALL'],
    });
    setUserOpen(false);
    setUsername('');
    setPassword('');
  }

  const dbNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dbs.items) m.set(d.id, String(d.name));
    return m;
  }, [dbs.items]);

  const st = serviceLabel(svc, t);
  const installed = Boolean(svc?.serverInstalled);
  const running = svc?.active === 'active';

  return (
    <FeaturePageLayout
      title={title}
      showCapability={false}
      status={{
        pill: {
          label: st.text,
          tone: st.tone === 'neutral' ? 'warn' : st.tone,
        },
        items: [
          {
            label: t('common.status'),
            value: st.text,
            tone: st.tone === 'neutral' ? 'neutral' : st.tone,
          },
          {
            label: 'EXECUTE',
            value: svc?.executeEnabled ? t('common.on') : t('common.off'),
            tone: svc?.executeEnabled ? 'ok' : 'warn',
          },
          { label: t('common.database'), value: dbs.items.length },
          { label: t('common.user'), value: users.items.length },
          {
            label: 'Root',
            value: svc?.isRoot ? t('common.yes') : t('common.no'),
            tone: svc?.isRoot ? 'ok' : 'warn',
          },
          {
            label: t('db.client'),
            value: svc?.clientInstalled ? t('ssl.filesYes') : t('ssl.filesNo'),
            tone: svc?.clientInstalled ? 'ok' : 'danger',
          },
        ],
      }}
      actions={<ActionBar>
          <Link to={servicePath}>
            <Button variant="secondary" size="sm">
              {t('db.serviceSettings')}
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refreshSvc();
              void dbs.refresh();
              void users.refresh();
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !dbs.items[0]}
            onClick={() => {
              const name = String(dbs.items[0]?.name ?? '');
              if (!name) return;
              setMsg(null);
              setError(null);
              void systemApi
                .dbDump({
                  engine: engine === 'mariadb' ? 'mariadb' : 'mysql',
                  dbName: name,
                })
                .then((r) => {
                  const notes = (r as { notes?: string[]; ok?: boolean }).notes;
                  if ((r as { ok?: boolean }).ok) setMsg(notes?.[0] ?? t('db.dumpOk'));
                  else setError(notes?.[0] ?? t('db.dumpFailed'));
                })
                .catch((e: Error) => setError(e.message));
            }}
          >
            {t('db.dumpFirstDb')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !dbs.items[0]}
            onClick={() => {
              const name = String(dbs.items[0]?.name ?? '');
              if (!name) return;
              void systemApi
                .dbDumps(engine === 'mariadb' ? 'mariadb' : 'mysql')
                .then((list) => {
                  const first = list.items[0];
                  if (!first) {
                    setError(t('db.noDumpToImport'));
                    return;
                  }
                  setImportConfirm({ dbName: name, dumpName: first.name });
                })
                .catch((e: Error) => setError(e.message));
            }}
          >
            {t('db.importLatestDump')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => {
              void api
                .requestRaw('/api/v1/db/temp-users/expire', {
                  method: 'POST',
                  body: JSON.stringify({ dropSystem: true }),
                })
                .then((r) => {
                  setMsg(
                    ((r as { notes?: string[] }).notes ?? []).join('；') || t('db.expiredTempUsersProcessed'),
                  );
                  return refreshExtras();
                })
                .catch((e: Error) => setError(e.message));
            }}
          >
            {t('db.cleanupExpiredTempUsers')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              setAdminerDomain(`adminer.${engine}.local`);
              setAdminerDownload(true);
              setAdminerOpen(true);
            }}
          >
            {t('db.adminerEntry')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !installed}
            title={!installed ? t('db.installFirst', { engine: title }) : undefined}
            onClick={() => setCreateOpen(true)}
          >
            {t('db.createDatabase')}
          </Button>
        </ActionBar>
      }
    >
      <SoftwareInstallBanner
        feature={engine === 'mysql' ? 'mysql' : 'mariadb'}
        title={t('db.softwareMissing', { engine: title })}
        onInstalled={() => void refreshSvc()}
      />
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {dbs.msg || users.msg ? <Alert variant="ok">{dbs.msg ?? users.msg}</Alert> : null}

      <Card>
        <CardSection title={t('db.serviceOverview')} description={t('db.readonlyStatus')}>
          <DescriptionList
            columns={2}
            items={[
              { label: t('common.status'), value: <Badge tone={st.tone}>{st.text}</Badge> },
              { label: t('common.version'), value: svc?.version ?? '—' },
              {
                label: t('db.systemChange'),
                value: svc?.executeEnabled ? t('db.opened') : t('db.notOpened'),
              },
              { label: t('roles.admin'), value: svc?.isRoot ? t('common.yes') : t('common.no') },
              {
                label: t('db.client'),
                value: svc?.clientInstalled ? t('common.installed') : t('common.notInstalled'),
              },
              {
                label: t('db.canProvision'),
                value: svc?.canProvision ? t('common.yes') : t('common.no'),
              },
            ]}
          />
          {svc?.blockMessage && !svc.canProvision ? (
            <p className="muted u-text-sm u-mt-3">
              {svc.blockMessage}
            </p>
          ) : null}
          <div className="lifecycle-toolbar u-mt-3">
            {!installed ? (
              <p className="muted u-text-sm u-mb-0">
                {t('db.installBannerHint', { engine: title })}
              </p>
            ) : !running ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onStart()}>
                {t('fail2ban.startService')}
              </Button>
            ) : (
              <Link to={servicePath}>
                <Button variant="secondary" size="md">
                  {t('db.openServiceConsole')}
                </Button>
              </Link>
            )}
          </div>
        </CardSection>
      </Card>

      <OpsResultPanel
        title={t('systemd.opsResult')}
        result={result}
        message={msg}
        onRetry={
          installed && !running ? () => void onStart() : undefined
        }
        busy={busy}
      />

      {lastTempPassword ? (
        <Alert variant="ok">
          {t('db.tempPasswordOnce')}
          <code className="inline">{lastTempPassword}</code>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'databases', label: t('db.tabDatabases', { count: dbs.items.length }) },
          { id: 'users', label: t('db.tabUsers', { count: users.items.length }) },
          { id: 'temp', label: t('db.tabTemp', { count: tempUsers.length }) },
          { id: 'remote', label: t('db.tabRemote', { count: remoteHosts.length }) },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
      >
        {tab === 'databases' ? (
          <Card>
            <CardSection title={t('db.dbList')}>
              <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                columns={[
                  {
                    key: 'name',
                    header: t('common.database'),
                    render: (r) => <strong>{String(r.name)}</strong>,
                  },
                  {
                    key: 'charset',
                    header: t('db.charset'),
                    render: (r) => String(r.charset ?? 'utf8mb4'),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
                  },
                ]}
                rows={dbs.items}
                empty={
                  <EmptyState
                    title={t('db.noDatabasesYet')}
                    description={
                      !installed
                        ? t('db.emptyDbInstallFirst', { engine: title })
                        : !svc?.canProvision
                          ? svc?.blockMessage ?? t('db.emptyDbCannotProvision')
                          : t('db.emptyDbCreateHint')
                    }
                  />
                }
                rowActions={(r) => (
                  <ActionBar>
                    <button
                      type="button"
                      className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                      disabled={busy}
                      onClick={() => void dbs.apply(r.id, true)}
                    >
                      {t('common.apply')}
                    </button>
                    <button
                      type="button"
                      className={buttonClassName({ variant: 'danger', size: 'sm' })}
                      disabled={busy}
                      onClick={() => setDelDb(r.id)}
                    >
                      {t('common.delete')}
                    </button>
                  </ActionBar>
                )}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'users' ? (
          <Card>
            <CardSection title={t('db.userList')} description={t('db.userListDesc')}>
              <div className="form-actions">
                <button
                  type="button"
                  className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  disabled={!installed}
                  onClick={() => setUserOpen(true)}
                >
                  {t('users.createUserPlus')}
                </button>
              </div>
              <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                columns={[
                  {
                    key: 'username',
                    header: t('common.user'),
                    render: (r) => (
                      <strong>
                        {String(r.username)}@{String(r.host ?? '%')}
                      </strong>
                    ),
                  },
                  {
                    key: 'db',
                    header: t('common.database'),
                    render: (r) =>
                      r.databaseId
                        ? dbNameById.get(String(r.databaseId)) ?? String(r.databaseId)
                        : '—',
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
                  },
                ]}
                rows={users.items}
                empty={<EmptyState title={t('db.noUsersYet')} />}
                rowActions={(r: ResourceRow) => (
                  <button
                    type="button"
                    className={buttonClassName({ variant: 'danger', size: 'sm' })}
                    disabled={busy}
                    onClick={() => setDelUser(r.id)}
                  >
                    {t('common.delete')}
                  </button>
                )}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'temp' ? (
          <div className="tab-panel">
          <Card>
            <CardSection
              title={t('db.tempReadonlyUsers')}
              description={t('db.tempReadonlyDesc')}
            >
              <FormLayout columns={2}>
                <Field label={t('db.dbName')} htmlFor="tmp-db" required flush>
                  <input
                    id="tmp-db"
                    value={tempDb}
                    onChange={(e) => setTempDb(e.target.value)}
                    placeholder="app_db"
                  />
                </Field>
                <Field label={t('db.ttlHours')} htmlFor="tmp-ttl" hint={t('db.ttlHoursHint')} flush>
                  <SegRadio
                    name="tmp-ttl"
                    aria-label={t('db.ttlHours')}
                    value={String(
                      [1, 6, 12, 24, 48, 72].includes(Number(tempTtl))
                        ? Number(tempTtl)
                        : 24,
                    )}
                    onChange={(v) => setTempTtl(v)}
                    options={[
                      { value: '1', label: '1h' },
                      { value: '6', label: '6h' },
                      { value: '12', label: '12h' },
                      { value: '24', label: '24h' },
                      { value: '48', label: '48h' },
                      { value: '72', label: '72h' },
                    ]}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => {
                    void run(async () => {
                      const r = await api.requestRaw<{
                        ok: boolean;
                        password?: string;
                        notes?: string[];
                        user?: Record<string, unknown>;
                      }>('/api/v1/db/temp-users', {
                        method: 'POST',
                        body: JSON.stringify({
                          engine,
                          database: tempDb,
                          ttlHours: Number(tempTtl) || 24,
                          apply: true,
                        }),
                      });
                      if (r.password) setLastTempPassword(r.password);
                      await refreshExtras();
                      return {
                        ...r,
                        ok: r.ok,
                        notes: r.notes ?? [],
                      } as OpsResultLike;
                    }, t('db.tempUserCreated'));
                  }}
                >
                  {t('db.createReadonlyUser')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => void refreshExtras()}
                >
                  {t('common.refresh')}
                </Button>
              </FormActions>
              <ul className="list-plain list-spaced u-mt-3">
                {tempUsers.map((u) => (
                  <li key={String(u.id)} className="">
                    <span>
                      <strong>{String(u.username)}</strong> @ {String(u.database)} ·{' '}
                      <Badge>{String(u.apply_status)}</Badge> · {t('db.expiresLabel')}{' '}
                      {u.expiresAt ? new Date(String(u.expiresAt)).toLocaleString() : '—'}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void api
                          .requestRaw(`/api/v1/db/temp-users/${u.id}`, { method: 'DELETE' })
                          .then(() => refreshExtras())
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      {t('db.revokeRegistration')}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardSection>
          </Card>
          </div>
        ) : null}

        {tab === 'remote' ? (
          <div className="tab-panel">
          <Card>
            <CardSection
              title={t('db.remoteDbHosts')}
              description={t('db.remoteDbHostsDesc')}
            >
              <FormLayout columns={2}>
                <Field label={t('security.ssh.displayName')} htmlFor="rh-label" flush>
                  <input
                    id="rh-label"
                    value={remoteLabel}
                    onChange={(e) => setRemoteLabel(e.target.value)}
                    placeholder={t('db.prodReplicaPlaceholder')}
                  />
                </Field>
                <Field label={t('common.host')} htmlFor="rh-host" required flush>
                  <input
                    id="rh-host"
                    value={remoteHost}
                    onChange={(e) => setRemoteHost(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('common.port')} htmlFor="rh-port" flush>
                  <input
                    id="rh-port"
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                  />
                </Field>
                <Field label={t('common.username')} htmlFor="rh-user" flush>
                  <input
                    id="rh-user"
                    value={remoteUser}
                    onChange={(e) => setRemoteUser(e.target.value)}
                  />
                </Field>
                <Field label={t('common.password')} htmlFor="rh-pass" flush>
                  <input
                    id="rh-pass"
                    type="password"
                    value={remotePass}
                    onChange={(e) => setRemotePass(e.target.value)}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => {
                    void api
                      .requestRaw('/api/v1/db/remote-hosts', {
                        method: 'POST',
                        body: JSON.stringify({
                          engine,
                          label: remoteLabel || remoteHost,
                          host: remoteHost,
                          port: Number(remotePort) || undefined,
                          username: remoteUser || undefined,
                          password: remotePass || undefined,
                        }),
                      })
                      .then(() => {
                        setRemotePass('');
                        setMsg(t('db.remoteHostSaved'));
                        return refreshExtras();
                      })
                      .catch((e: Error) => setError(e.message));
                  }}
                >
                  {t('common.save')}
                </Button>
              </FormActions>
              <ul className="list-plain list-spaced u-mt-4">
                {remoteHosts.map((h) => (
                  <li key={String(h.id)} className="u-justify-between">
                    <span>
                      <strong>{String(h.label)}</strong> · {String(h.host)}:
                      {String(h.port)} · {String(h.username ?? '—')}
                      {h.hasPassword ? ' · 🔐' : ''}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void api
                          .requestRaw(`/api/v1/db/remote-hosts/${h.id}`, {
                            method: 'DELETE',
                          })
                          .then(() => refreshExtras())
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardSection>
          </Card>
          </div>
        ) : null}
        {tab === 'about' ? (
          <PageGuide guideId={engine === 'mariadb' ? 'mariadb' : 'mysql'} />
        ) : null}
      </PageTabs>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('db.createDbTitle', { engine: title })}
        description={t('db.createDbDesc')}
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="sql-create" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={busy}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="sql-create" onSubmit={(e) => void onCreateDb(e)}>
          <FormLayout>
            <Field
              label={t('db.dbName')}
              htmlFor="dn"
              required
              flush
              hint={t('db.dbNameHint')}
            >
              <input
                id="dn"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="my_app"
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <div className="form-check-row u-mt-3">
            <CheckboxField
              id="sql-cu"
              label={t('db.alsoCreateUser')}
              description={t('db.alsoCreateUserDesc')}
              checked={createUser}
              onChange={setCreateUser}
            />
          </div>
          {createUser ? (
            <FormLayout columns={2}>
              <Field label={t('common.username')} htmlFor="un" flush>
                <input
                  id="un"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={name || 'user'}
                  spellCheck={false}
                />
              </Field>
              <Field label={t('common.password')} htmlFor="pw" hint={t('users.passwordHint')} flush required>
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={createUser}
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>
              <Field
                label={t('db.allowConnectHost')}
                htmlFor="hh"
                hint={t('db.allowConnectHostHint')}
                flush
              >
                <input
                  id="hh"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </FormLayout>
          ) : null}
          <FormHint>{t('db.createDbHint')}</FormHint>
        </form>
      </Modal>

      <Modal
        open={userOpen}
        onClose={() => setUserOpen(false)}
        title={t('db.createUserTitle', { engine: title })}
        description={t('db.createUserDesc')}
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setUserOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="sql-user" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={busy}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="sql-user" onSubmit={(e) => void onCreateUser(e)}>
          <FormLayout columns={2}>
            <Field label={t('common.username')} htmlFor="uun" required flush>
              <input
                id="uun"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                spellCheck={false}
              />
            </Field>
            <Field label={t('common.password')} htmlFor="upw" required hint={t('users.passwordHint')} flush>
              <input
                id="upw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('db.allowConnectHost')} htmlFor="uh" flush hint={t('db.allowConnectHostHintShort')}>
              <input
                id="uh"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label={t('db.bindDatabase')} htmlFor="udb" flush hint={t('db.bindDatabaseHint')}>
              <select id="udb" value={dbId} onChange={(e) => setDbId(e.target.value)}>
                <option value="">{t('users.noneOption')}</option>
                {dbs.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {String(d.name)}
                  </option>
                ))}
              </select>
            </Field>
          </FormLayout>
        </form>
      </Modal>

      <ConfirmDialog
        open={importConfirm != null}
        onClose={() => setImportConfirm(null)}
        onConfirm={() => {
          const c = importConfirm;
          setImportConfirm(null);
          if (!c) return;
          setMsg(null);
          setError(null);
          void systemApi
            .dbImport({
              engine: engine === 'mariadb' ? 'mariadb' : 'mysql',
              dbName: c.dbName,
              name: c.dumpName,
            })
            .then((r) => {
              const notes = (r as { notes?: string[]; ok?: boolean }).notes;
              if ((r as { ok?: boolean }).ok) setMsg(notes?.[0] ?? t('db.importOk'));
              else setError(notes?.[0] ?? t('db.importFailed'));
            })
            .catch((e: Error) => setError(e.message));
        }}
        title={t('db.importDumpTitle')}
        description={
          importConfirm
            ? t('db.importDumpDesc', { dump: importConfirm.dumpName, db: importConfirm.dbName })
            : ''
        }
        confirmLabel={t('db.import')}
        cancelLabel={t('common.cancel')}
        danger
      />

      <ConfirmDialog
        open={Boolean(delDb)}
        onClose={() => setDelDb(null)}
        onConfirm={() => {
          if (delDb) void dbs.remove(delDb).then(() => setDelDb(null));
        }}
        title={t('db.deleteDbTitle')}
        description={t('db.deleteDbDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delUser)}
        onClose={() => setDelUser(null)}
        onConfirm={() => {
          if (delUser) void users.remove(delUser).then(() => setDelUser(null));
        }}
        title={t('db.deleteUserTitle')}
        description={t('db.deleteUserDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />

      <Modal
        open={adminerOpen}
        onClose={() => !busy && setAdminerOpen(false)}
        title={t('db.adminerTitle')}
        description={t('db.adminerDesc')}
        size="md"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setAdminerOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(async () => {
                  const r = await api.requestRaw<{
                    ok: boolean;
                    notes?: string[];
                    blocked?: boolean;
                    blockMessage?: string;
                    urlHint?: string;
                    apply_status?: string;
                  }>('/api/v1/db/adminer/apply', {
                    method: 'POST',
                    body: JSON.stringify({
                      domain: adminerDomain.trim() || `adminer.${engine}.local`,
                      download: adminerDownload,
                      applySystem: false,
                    }),
                  });
                  setAdminerOpen(false);
                  return {
                    ok: r.ok,
                    blocked: r.blocked,
                    blockMessage: r.blockMessage,
                    notes: [
                      ...(r.notes ?? []),
                      r.apply_status ? `apply_status=${r.apply_status}` : '',
                      r.urlHint ? t('db.importEntry', { url: r.urlHint }) : '',
                    ].filter(Boolean),
                  } as OpsResultLike;
                }, t('db.adminerWritten'));
              }}
            >
              {t('db.writeOnly')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(async () => {
                  const r = await api.requestRaw<{
                    ok: boolean;
                    notes?: string[];
                    blocked?: boolean;
                    blockMessage?: string;
                    urlHint?: string;
                    apply_status?: string;
                  }>('/api/v1/db/adminer/apply', {
                    method: 'POST',
                    body: JSON.stringify({
                      domain: adminerDomain.trim() || `adminer.${engine}.local`,
                      download: adminerDownload,
                      applySystem: true,
                    }),
                  });
                  setAdminerOpen(false);
                  return {
                    ok: r.ok,
                    blocked: r.blocked,
                    blockMessage: r.blockMessage,
                    notes: [
                      ...(r.notes ?? []),
                      r.apply_status ? `apply_status=${r.apply_status}` : '',
                      r.urlHint ? t('db.importEntry', { url: r.urlHint }) : '',
                    ].filter(Boolean),
                  } as OpsResultLike;
                }, t('db.adminerApplied'));
              }}
            >
              {t('firewall.applyToSystem')}
            </Button>
          </FormActions>
        }
      >
        <FormHint>
          {t('db.adminerRiskFull')}
        </FormHint>
        <FormLayout columns={1}>
          <Field
            label={t('db.vhostName')}
            htmlFor="adminer-domain"
            required
            flush
            hint={t('db.vhostHint')}
          >
            <input
              id="adminer-domain"
              value={adminerDomain}
              onChange={(e) => setAdminerDomain(e.target.value)}
              placeholder={`adminer.${engine}.local`}
              spellCheck={false}
            />
          </Field>
          <CheckboxField
            id="adminer-dl"
            label={t('db.downloadAdminer')}
            description={t('db.downloadAdminerDesc')}
            checked={adminerDownload}
            onChange={setAdminerDownload}
            disabled={busy}
          />
          <FormHint>
            {t('db.adminerWriteHintFull')}
          </FormHint>
        </FormLayout>
      </Modal>
    </FeaturePageLayout>
  );
}
