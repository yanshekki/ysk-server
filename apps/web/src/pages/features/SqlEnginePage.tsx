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
  ServerListFilters,
  SoftwareInstallBanner,
  buttonClassName } from '../../shared/components/ui';
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
import {
  ServiceAccessStrip,
  ServiceExposureDialog,
  usePrivateStartGate,
} from '../../features/network/service-exposure';
import { bindCall1, bindCloseIfIdle, bindFormSubmit, bindInput, bindRemoveIf, bindSet, bindValueSet, bindVoid, bindVoidCall2 } from '../bind-handlers';

export function serviceLabel(s: DbEngineStatus | null, t: (key: string, opts?: Record<string, unknown>) => string): {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  if (!s) return { text: t('common.loading'), tone: 'neutral' };
  if (!s.serverInstalled) return { text: t('common.notInstalled'), tone: 'danger' };
  if (s.active === 'active') return { text: t('common.running'), tone: 'ok' };
  if (s.active === 'inactive') return { text: t('common.stopped'), tone: 'warn' };
  return { text: s.active || t('common.unknown'), tone: 'warn' };
}

export function engineTitle(engine: DbEngineKind): string {
  return engine === 'mysql' ? 'MySQL' : 'MariaDB';
}

export function engineServicePath(engine: DbEngineKind): string {
  return engine === 'mysql'
    ? '/databases/mysql/service'
    : '/databases/mariadb/service';
}

export function defaultAdminerDomain(engine: DbEngineKind): string {
  return `adminer.${engine}.local`;
}

export function defaultDbBrowserName(
  tool: 'adminer' | 'phpmyadmin',
  engine: DbEngineKind,
): string {
  return tool === 'phpmyadmin' ? `phpmyadmin-${engine}` : `adminer-${engine}`;
}

export function defaultDbBrowserDomain(
  tool: 'adminer' | 'phpmyadmin',
  engine: DbEngineKind,
): string {
  return tool === 'phpmyadmin'
    ? `phpmyadmin.${engine}.local`
    : `adminer.${engine}.local`;
}

export function buildDbNameById(
  items: Array<{ id: string; name?: unknown }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of items) m.set(d.id, String(d.name));
  return m;
}

/** Map service-label tone onto FeaturePageLayout pill tones. */
export function pillToneFromService(
  tone: 'ok' | 'warn' | 'danger' | 'neutral',
): 'ok' | 'warn' | 'danger' {
  return tone === 'neutral' ? 'warn' : tone;
}

export function SqlEnginePage({ engine }: { engine: DbEngineKind }) {
  const { t } = useTranslation();
  const title = engineTitle(engine);
  const servicePath = engineServicePath(engine);
  const dbs = useResourceCrud('mysql/databases', { engine });
  const users = useResourceCrud('mysql/users', { engine });
  const [svc, setSvc] = useState<DbEngineStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy: actBusy, error: actError, result, msg, run, setMsg, setError } =
    useFeatureAction();
  const startGate = usePrivateStartGate(engine);

  const [tab, setTab] = useState('databases');
  const [createOpen, setCreateOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [delDb, setDelDb] = useState<string | null>(null);
  const [delUser, setDelUser] = useState<string | null>(null);
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);
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
  const [browserTool, setBrowserTool] = useState<'adminer' | 'phpmyadmin'>('adminer');
  const [browserName, setBrowserName] = useState(() => defaultDbBrowserName('adminer', engine));
  const [adminerDomain, setAdminerDomain] = useState(() => defaultDbBrowserDomain('adminer', engine));
  const [adminerDownload, setAdminerDownload] = useState(true);
  const [nameClash, setNameClash] = useState<string | null>(null);
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


  async function onStart(exposure?: {
    exposureDecision?: 'keep-private' | 'public' | 'restricted';
    allowFrom?: string[];
  }) {
    if (!exposure?.exposureDecision) {
      const gate = await startGate.prepareStart();
      if (!gate.proceed) return;
    }
    await run(async () => {
      try {
        const r = await dbEngineApi.start(engine, exposure);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.startFailed');
        return {
          ok: false,
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m] } satisfies OpsResultLike;
      }
    }, t('db.startedOk', { engine: title }));
  }

  async function onUnfreezeConfirm() {
    setUnfreezeOpen(false);
    await run(async () => {
      try {
        const r = await dbEngineApi.unfreeze(engine, true);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.opFailed');
        return {
          ok: false,
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m] } satisfies OpsResultLike;
      }
    }, t('db.unfreezeOk', { engine: title }));
  }

  async function onCreateDb(e: FormEvent) {
    e.preventDefault();
    await dbs.create({
      name,
      engine,
      createUser,
      username: createUser ? username || name : undefined,
      password: createUser ? password : undefined,
      host });
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
      privileges: ['ALL'] });
    setUserOpen(false);
    setUsername('');
    setPassword('');
  }

  const dbNameById = useMemo(() => buildDbNameById(dbs.items), [dbs.items]);

  const st = serviceLabel(svc, t);
  const installed = Boolean(svc?.serverInstalled);
  const running = svc?.active === 'active';
  const hostDatabases = svc?.hostDatabases ?? [];
  const panelDbNames = useMemo(
    () => new Set(dbs.items.map((r) => String(r.name ?? ''))),
    [dbs.items],
  );
  const hostOnlyDatabases = hostDatabases.filter((n) => n && !panelDbNames.has(n));
  const firstDumpName = String(dbs.items[0]?.name ?? hostDatabases[0] ?? '');

  return (
    <FeaturePageLayout
      title={title}
      showCapability={false}
      status={{
        pill: {
          label: st.text,
          tone: pillToneFromService(st.tone) },
        items: [
          {
            label: t('common.status'),
            value: st.text,
            tone: st.tone === 'neutral' ? 'neutral' : st.tone },
          {
            label: t('dashboard.executeLabel'),
            value: svc?.executeEnabled ? t('common.on') : t('common.off'),
            tone: svc?.executeEnabled ? 'ok' : 'warn' },
          {
            label: t('common.database'),
            value:
              hostOnlyDatabases.length > 0
                ? `${dbs.items.length} / ${hostDatabases.length}`
                : dbs.items.length,
          },
          { label: t('common.user'), value: users.items.length },
          {
            label: t('roles.admin'),
            value: svc?.isRoot ? t('common.yes') : t('common.no'),
            tone: svc?.isRoot ? 'ok' : 'warn' },
          {
            label: t('db.client'),
            value: svc?.clientInstalled ? t('ssl.filesYes') : t('ssl.filesNo'),
            tone: svc?.clientInstalled ? 'ok' : 'danger' },
        ] }}
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
            disabled={busy || !firstDumpName}
            onClick={() => {
              const name = firstDumpName;
              if (!name) return;
              setMsg(null);
              setError(null);
              void systemApi
                .dbDump({
                  engine: engine === 'mariadb' ? 'mariadb' : 'mysql',
                  dbName: name })
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
            disabled={busy || !firstDumpName}
            onClick={() => {
              const name = firstDumpName;
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
            disabled={!installed}
            title={!installed ? t('db.installFirst', { engine: title }) : undefined}
            onClick={() => {
              void api
                .requestRaw('/api/v1/db/temp-users/expire', {
                  method: 'POST',
                  body: JSON.stringify({ dropSystem: true }) })
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
              const tool = 'adminer' as const;
              setBrowserTool(tool);
              setBrowserName(defaultDbBrowserName(tool, engine));
              setAdminerDomain(defaultDbBrowserDomain(tool, engine));
              setAdminerDownload(true);
              setNameClash(null);
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
            onClick={bindSet(setCreateOpen, true)}
          >
            {t('db.createDatabase')}
          </Button>
        </ActionBar>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {!installed ? (
        <SoftwareInstallBanner
          feature={engine === 'mariadb' ? 'mariadb' : 'mysql'}
          title={t('db.installBannerHint', { engine: title })}
        />
      ) : null}
      <Card>
        <CardSection title={t('db.serviceOverview')} description={t('db.readonlyStatus')}>
          <DescriptionList
            columns={2}
            items={[
              { label: t('common.status'), value: <Badge tone={st.tone}>{st.text}</Badge> },
              {
                label: t('common.version'),
                value:
                  !installed && svc?.blockedByExclusive
                    ? '—'
                    : (svc?.version ?? '—'),
              },
              {
                label: t('db.systemChange'),
                value: svc?.executeEnabled ? t('db.opened') : t('db.notOpened') },
              { label: t('roles.admin'), value: svc?.isRoot ? t('common.yes') : t('common.no') },
              {
                label: t('db.client'),
                value: svc?.clientInstalled ? t('common.installed') : t('common.notInstalled') },
              {
                label: t('db.canProvision'),
                value: svc?.canProvision ? t('common.yes') : t('common.no') },
            ]}
          />
          {svc?.blockMessage && !svc.canProvision ? (
            <p className="muted u-text-sm u-mt-3">
              {svc.blockMessage}
            </p>
          ) : null}
          {installed && !running ? (
            <Alert variant="error">
              <strong>{t('db.serviceDownTitle')}</strong>
              <p className="u-mb-0 u-mt-2 u-text-sm">
                {t('db.serviceDownBody', {
                  empty: svc?.datadirEmpty ? t('common.yes') : t('common.no') })}
              </p>
              {Array.isArray(svc?.healthFindings) && svc.healthFindings.length > 0 ? (
                <ul className="list-plain u-mt-2 u-mb-0 u-text-sm">
                  {svc.healthFindings.map((f) => (
                    <li key={f.id}>{t(f.messageKey)}</li>
                  ))}
                </ul>
              ) : null}
              <div className="u-mt-3 u-flex u-gap-2 u-flex-wrap">
                <Button
                  variant="danger"
                  size="md"
                  loading={busy}
                  disabled={!svc?.executeEnabled || !svc?.isRoot}
                  onClick={() => setUnfreezeOpen(true)}
                >
                  {t('db.unfreezeBtn')}
                </Button>
                <Button variant="primary" size="md" loading={busy} onClick={() => void onStart()}>
                  {t('db.startAfterUnfreeze')}
                </Button>
              </div>
            </Alert>
          ) : null}
          <div className="lifecycle-toolbar u-mt-3">
            {!installed ? (
              <p className="muted u-text-sm u-mb-0">
                {svc?.blockedByExclusive === 'mariadb-server' ? (
                  <>
                    {t('db.exclusiveMariaHint')}{' '}
                    <Link to="/databases/mariadb">{t('db.openMaria')}</Link>
                  </>
                ) : svc?.blockedByExclusive === 'mysql-server' ? (
                  <>
                    {t('db.exclusiveMysqlHint')}{' '}
                    <Link to="/databases/mysql">{t('db.openMysql')}</Link>
                  </>
                ) : (
                  t('db.installBannerHint', { engine: title })
                )}
              </p>
            ) : running ? (
              <Link to={servicePath}>
                <Button variant="secondary" size="md">
                  {t('db.openServiceConsole')}
                </Button>
              </Link>
            ) : null}
          </div>
          {installed ? (
            <div className="u-mt-3">
              <ServiceAccessStrip serviceId={engine} compact />
            </div>
          ) : null}
        </CardSection>
      </Card>

      <ServiceExposureDialog
        open={startGate.pending}
        onClose={startGate.dismiss}
        serviceId={engine}
        initial={startGate.status}
        title={t('serviceExposure.privateStartTitle', { service: title })}
        confirmLabel={t('serviceExposure.confirmAndStart')}
        decisionOnly
        onSaved={async (decision) => {
          startGate.dismiss();
          await onStart({
            exposureDecision: decision.exposureDecision,
            allowFrom: decision.allowFrom,
          });
        }}
      />

      <ConfirmDialog
        open={unfreezeOpen}
        onClose={() => setUnfreezeOpen(false)}
        onConfirm={() => void onUnfreezeConfirm()}
        danger
        busy={busy}
        title={t('db.unfreezeConfirmTitle', { engine: title })}
        description={t('db.unfreezeConfirmDesc', {
          engine: title,
          empty: svc?.datadirEmpty ? t('common.yes') : t('common.no') })}
        confirmLabel={t('db.unfreezeConfirmBtn')}
      />

      <OpsResultPanel
        title={t('systemd.opsResult')}
        result={result}
        message={msg}
        onRetry={
          installed && !running ? () => void onStart() : undefined
        }
        busy={busy}
      />

      <Modal
        open={Boolean(lastTempPassword)}
        onClose={() => setLastTempPassword(null)}
        title={t('db.tempPasswordOnce')}
        size="sm"
        footer={
          <Button variant="primary" size="md" onClick={() => setLastTempPassword(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {lastTempPassword ? (
          <p className="u-break-all">
            <code>{lastTempPassword}</code>
          </p>
        ) : null}
      </Modal>

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
              {hostOnlyDatabases.length ? (
                <Alert variant="info">
                  {t('db.hostHasUntracked', { count: hostOnlyDatabases.length })}{' '}
                  <span className="u-text-sm muted">
                    {t('db.hostInventoryHint')} ({hostOnlyDatabases.join(', ')})
                  </span>
                  <div className="u-flex u-flex-wrap u-gap-2 u-mt-2">
                    {hostOnlyDatabases.slice(0, 6).map((n) => (
                      <Button
                        key={n}
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          void dbs.create({ name: n, engine });
                        }}
                      >
                        {t('db.adoptHostDb', { name: n })}
                      </Button>
                    ))}
                  </div>
                </Alert>
              ) : null}
              <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                filters={
                  <ServerListFilters
                    q={dbs.q}
                    setQ={dbs.setQ}
                    searching={dbs.searching}
                    loading={dbs.listLoading}
                    total={dbs.total}
                    shown={dbs.items.length}
                    activeFilterCount={dbs.activeFilterCount}
                    clear={dbs.clearSearch}
                  />
                }
                columns={[
                  {
                    key: 'name',
                    header: t('common.database'),
                    render: (r) => <strong>{String(r.name)}</strong> },
                  {
                    key: 'charset',
                    header: t('db.charset'),
                    render: (r) => String(r.charset ?? 'utf8mb4') },
                  {
                    key: 'status',
                    header: t('common.status'),
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} /> },
                ]}
                rows={dbs.items}
                empty={
                  <EmptyState
                    title={t('db.noDatabasesYet')}
                    description={
                      !installed
                        ? t('db.emptyDbInstallFirst', { engine: title })
                        : hostDatabases.length
                          ? t('db.emptyDbHostHasRows')
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
                      onClick={bindVoidCall2(dbs.apply, r.id, true)}
                    >
                      {t('common.apply')}
                    </button>
                    <button
                      type="button"
                      className={buttonClassName({ variant: 'danger', size: 'sm' })}
                      disabled={busy}
                      onClick={bindSet(setDelDb, r.id)}
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
                  onClick={bindSet(setUserOpen, true)}
                >
                  {t('users.createUserPlus')}
                </button>
              </div>
              <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                filters={
                  <ServerListFilters
                    q={users.q}
                    setQ={users.setQ}
                    searching={users.searching}
                    loading={users.listLoading}
                    total={users.total}
                    shown={users.items.length}
                    activeFilterCount={users.activeFilterCount}
                    clear={users.clearSearch}
                  />
                }
                columns={[
                  {
                    key: 'username',
                    header: t('common.user'),
                    render: (r) => (
                      <strong>
                        {String(r.username)}@{String(r.host ?? '%')}
                      </strong>
                    ) },
                  {
                    key: 'db',
                    header: t('common.database'),
                    render: (r) =>
                      r.databaseId
                        ? dbNameById.get(String(r.databaseId)) ?? String(r.databaseId)
                        : '—' },
                  {
                    key: 'status',
                    header: t('common.status'),
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} /> },
                ]}
                rows={users.items}
                empty={<EmptyState title={t('db.noUsersYet')} />}
                rowActions={(r: ResourceRow) => (
                  <button
                    type="button"
                    className={buttonClassName({ variant: 'danger', size: 'sm' })}
                    disabled={busy}
                    onClick={bindSet(setDelUser, r.id)}
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
                    onChange={bindInput(setTempDb)}
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
                    onChange={bindValueSet(setTempTtl)}
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
                          apply: true }) });
                      if (r.password) setLastTempPassword(r.password);
                      await refreshExtras();
                      return {
                        ...r,
                        ok: r.ok,
                        notes: r.notes ?? [] } as OpsResultLike;
                    }, t('db.tempUserCreated'));
                  }}
                >
                  {t('db.createReadonlyUser')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={bindVoid(refreshExtras)}
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
                    onChange={bindInput(setRemoteLabel)}
                    placeholder={t('db.prodReplicaPlaceholder')}
                  />
                </Field>
                <Field label={t('common.host')} htmlFor="rh-host" required flush>
                  <input
                    id="rh-host"
                    value={remoteHost}
                    onChange={bindInput(setRemoteHost)}
                    required
                  />
                </Field>
                <Field label={t('common.port')} htmlFor="rh-port" flush>
                  <input
                    id="rh-port"
                    value={remotePort}
                    onChange={bindInput(setRemotePort)}
                  />
                </Field>
                <Field label={t('common.username')} htmlFor="rh-user" flush>
                  <input
                    id="rh-user"
                    value={remoteUser}
                    onChange={bindInput(setRemoteUser)}
                  />
                </Field>
                <Field label={t('common.password')} htmlFor="rh-pass" flush>
                  <input
                    id="rh-pass"
                    type="password"
                    value={remotePass}
                    onChange={bindInput(setRemotePass)}
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
                          password: remotePass || undefined }) })
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
                            method: 'DELETE' })
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
        onClose={bindSet(setCreateOpen, false)}
        title={t('db.createDbTitle', { engine: title })}
        description={t('db.createDbDesc')}
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={bindSet(setCreateOpen, false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="sql-create" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={busy}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="sql-create" onSubmit={bindFormSubmit(onCreateDb)}>
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
                onChange={bindInput(setName)}
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
                  onChange={bindInput(setUsername)}
                  placeholder={name || 'user'}
                  spellCheck={false}
                />
              </Field>
              <Field label={t('common.password')} htmlFor="pw" hint={t('users.passwordHint')} flush required>
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={bindInput(setPassword)}
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
                  onChange={bindInput(setHost)}
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
        onClose={bindSet(setUserOpen, false)}
        title={t('db.createUserTitle', { engine: title })}
        description={t('db.createUserDesc')}
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={bindSet(setUserOpen, false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="sql-user" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={busy}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <form id="sql-user" onSubmit={bindFormSubmit(onCreateUser)}>
          <FormLayout columns={2}>
            <Field label={t('common.username')} htmlFor="uun" required flush>
              <input
                id="uun"
                value={username}
                onChange={bindInput(setUsername)}
                required
                spellCheck={false}
              />
            </Field>
            <Field label={t('common.password')} htmlFor="upw" required hint={t('users.passwordHint')} flush>
              <input
                id="upw"
                type="password"
                value={password}
                onChange={bindInput(setPassword)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('db.allowConnectHost')} htmlFor="uh" flush hint={t('db.allowConnectHostHintShort')}>
              <input
                id="uh"
                value={host}
                onChange={bindInput(setHost)}
                spellCheck={false}
              />
            </Field>
            <Field label={t('db.bindDatabase')} htmlFor="udb" flush hint={t('db.bindDatabaseHint')}>
              <select id="udb" value={dbId} onChange={bindInput(setDbId)}>
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
        onClose={bindSet(setImportConfirm, null)}
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
              name: c.dumpName })
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
        onClose={bindSet(setDelDb, null)}
        onConfirm={bindRemoveIf(delDb, dbs.remove, setDelDb)}
        title={t('db.deleteDbTitle')}
        description={t('db.deleteDbDesc')}
        severity="destructive"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delUser)}
        onClose={bindSet(setDelUser, null)}
        onConfirm={bindRemoveIf(delUser, users.remove, setDelUser)}
        title={t('db.deleteUserTitle')}
        description={t('db.deleteUserDesc')}
        severity="standard"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />

      <Modal
        open={adminerOpen}
        onClose={bindCloseIfIdle(busy, bindSet(setAdminerOpen, false))}
        title={t('db.browserProjectTitle', { })}
        size="md"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setAdminerOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={Boolean(nameClash) || !browserName.trim() || !adminerDomain.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    const r = await run(async () => {
                      // Pre-check name against live project list
                      const list = await api.listProjects();
                      const want = browserName.trim().toLowerCase();
                      const hit = (list.items ?? []).find(
                        (p) => String(p.name ?? '').trim().toLowerCase() === want,
                      );
                      if (hit) {
                        setNameClash(hit.name);
                        return {
                          ok: false,
                          notes: [
                            t('db.browserNameTaken', {
                              name: hit.name }),
                          ] } as OpsResultLike;
                      }
                      const res = await api.requestRaw<{
                        ok: boolean;
                        notes?: string[];
                        blocked?: boolean;
                        blockMessage?: string;
                        urlHint?: string;
                        apply_status?: string;
                        projectId?: string;
                        project?: { id?: string };
                      }>('/api/v1/db/adminer/apply', {
                        method: 'POST',
                        body: JSON.stringify({
                          asProject: true,
                          tool: browserTool,
                          projectName: browserName.trim(),
                          domain:
                            adminerDomain.trim() ||
                            defaultDbBrowserDomain(browserTool, engine),
                          download: adminerDownload,
                          engine }) });
                      return {
                        ok: res.ok,
                        blocked: res.blocked,
                        blockMessage: res.blockMessage,
                        notes: [
                          ...(res.notes ?? []),
                          res.apply_status ? `apply_status=${res.apply_status}` : '',
                          res.urlHint
                            ? t('db.importEntry', { url: res.urlHint })
                            : '',
                          res.projectId || res.project?.id
                            ? `projectId=${res.projectId ?? res.project?.id}`
                            : '',
                        ].filter(Boolean),
                        url: res.urlHint } as OpsResultLike;
                    }, t('db.browserProjectCreated'));
                    // Navigate to project when we got an id in notes
                    const idNote = (r as OpsResultLike | null)?.notes?.find((n) =>
                      n.startsWith('projectId='),
                    );
                    if (idNote) {
                      const id = idNote.slice('projectId='.length);
                      if (id) window.location.assign(`/projects/${id}`);
                    }
                  } finally {
                    setAdminerOpen(false);
                  }
                })();
              }}
            >
              {t('db.createBrowserProject')}
            </Button>
          </FormActions>
        }
      >
        <FormLayout columns={1}>
          <Field
            label={t('db.browserTool')}
            htmlFor="browser-tool"
            required
            flush
          >
            <SegRadio
              name="browser-tool"
              aria-label={t('db.browserTool')}
              value={browserTool}
              onChange={(v) => {
                const tool = v === 'phpmyadmin' ? 'phpmyadmin' : 'adminer';
                setBrowserTool(tool);
                setBrowserName(defaultDbBrowserName(tool, engine));
                setAdminerDomain(defaultDbBrowserDomain(tool, engine));
                setNameClash(null);
              }}
              options={[
                { value: 'adminer', label: 'Adminer' },
                { value: 'phpmyadmin', label: 'phpMyAdmin' },
              ]}
            />
          </Field>
          <Field
            label={t('projects.createName')}
            htmlFor="browser-name"
            required
            flush
            hint={
              nameClash
                ? t('db.browserNameTaken', {
                    name: nameClash })
                : t('db.browserNameHint', { })
            }
          >
            <input
              id="browser-name"
              value={browserName}
              onChange={(e) => {
                setBrowserName(e.target.value);
                setNameClash(null);
              }}
              placeholder={defaultDbBrowserName(browserTool, engine)}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
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
              onChange={bindInput(setAdminerDomain)}
              placeholder={defaultDbBrowserDomain(browserTool, engine)}
              spellCheck={false}
            />
          </Field>
          <CheckboxField
            id="adminer-dl"
            label={
              browserTool === 'phpmyadmin'
                ? t('db.downloadPhpMyAdmin', { })
                : t('db.downloadAdminer')
            }
            checked={adminerDownload}
            onChange={setAdminerDownload}
            disabled={busy}
          />
        </FormLayout>
      </Modal>
    </FeaturePageLayout>
  );
}
