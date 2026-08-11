/**
 * PostgreSQL databases — parity with SqlEngine (status strip + install/start + apply honesty).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  WithPageGuide,
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
  ServerListFilters,
  FormHint,
  CheckboxField } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import { consoleApi, type ServiceConsole } from '../../features/db-service/console-api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import {
  ServiceAccessStrip,
  ServiceExposureDialog,
  usePrivateStartGate,
} from '../../features/network/service-exposure';
import { bindSet, bindInput } from '../bind-handlers';

export function PostgresPage() {
  const { t } = useTranslation();
  const dbs = useResourceCrud('postgres/databases');
  const [svc, setSvc] = useState<ServiceConsole | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [createUser, setCreateUser] = useState(true);
  const { busy: actBusy, error: actError, result, msg, run, setMsg, setError } = useFeatureAction();
  const startGate = usePrivateStartGate('postgresql');

  const refreshSvc = useCallback(async () => {
    setLoadError(null);
    try {
      setSvc(await consoleApi.get('postgres'));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.statusLoadFailed'));
    }
  }, []);

  useEffect(() => {
    void refreshSvc();
  }, [refreshSvc]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await dbs.create({
      name,
      createUser,
      username: createUser ? username || name : undefined,
      password: createUser ? password : undefined });
    setCreateOpen(false);
    setName('');
    setUsername('');
    setPassword('');
  }


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
        const r = await consoleApi.lifecycle('postgres', 'start', exposure);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : t('common.startFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('db.pgStarted'));
  }

  const busy = dbs.busy || actBusy;
  const error = dbs.error || actError || loadError;
  const installed = Boolean(svc?.installed);
  const running = svc?.active === 'active';

  return (
    <FeaturePageLayout
      title={t('nav.postgres', { defaultValue: 'PostgreSQL' })}
      status={{
        pill: {
          label: svc?.activeLabel ?? (installed ? t('common.installed') : t('db.notInstalledShort')),
          tone: running ? 'ok' : installed ? 'warn' : 'danger' },
        items: [
          {
            label: t('common.status'),
            value: svc?.activeLabel ?? '—',
            tone: running ? 'ok' : installed ? 'warn' : 'danger' },
          {
            label: 'EXECUTE',
            value: svc?.executeEnabled ? t('common.on') : t('common.off'),
            tone: svc?.executeEnabled ? 'ok' : 'warn' },
          {
            label: 'Root',
            value: svc?.isRoot ? t('common.yes') : t('common.no'),
            tone: svc?.isRoot ? 'ok' : 'warn' },
          { label: t('common.database'), value: dbs.items.length },
        ] }}
      actions={<ActionBar>
          <Link to="/databases/postgres/service">
            <Button variant="secondary" size="sm">
              {t('db.serviceConsole')}
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refreshSvc();
              void dbs.refresh();
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !installed}
            title={!installed ? t('db.installPgFirst') : undefined}
            onClick={bindSet(setCreateOpen, true)}
          >
            {t('db.createDatabase')}
          </Button>
        </ActionBar>
      }
    >
      <WithPageGuide guideId="postgres">

      {error ? <Alert variant="error">{error}</Alert> : null}
      <Card>
        <CardSection title={t('db.serviceOverview')} description={t('db.readonlyProbe')}>
          <DescriptionList
            columns={2}
            items={[
              {
                label: t('common.status'),
                value: (
                  <Badge tone={running ? 'ok' : installed ? 'warn' : 'danger'}>
                    {svc?.activeLabel ?? '—'}
                  </Badge>
                ) },
              { label: t('common.version'), value: svc?.version ?? '—' },
              { label: 'unit', value: svc?.unit ?? 'postgresql' },
              {
                label: t('db.systemChange'),
                value: svc?.executeEnabled ? t('db.opened') : t('db.notOpened') },
            ]}
          />
          {svc?.blockMessage ? (
            <p className="muted u-text-sm u-mt-3">
              {svc.blockMessage}
            </p>
          ) : null}
          <div className="lifecycle-toolbar u-mt-3">
            {!installed ? (
              <p className="muted u-text-sm u-mb-0">
                {t('db.installPgBanner')}
              </p>
            ) : !running ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onStart()}>
                {t('fail2ban.startService')}
              </Button>
            ) : (
              <Link to="/databases/postgres/service">
                <Button variant="secondary" size="md">
                  {t('db.openServiceConsole')}
                </Button>
              </Link>
            )}
          </div>
          {installed ? (
            <div className="u-mt-3">
              <ServiceAccessStrip serviceId="postgresql" compact />
            </div>
          ) : null}
        </CardSection>
      </Card>

      <ServiceExposureDialog
        open={startGate.pending}
        onClose={startGate.dismiss}
        serviceId="postgresql"
        initial={startGate.status}
        title={t('serviceExposure.privateStartTitle', { service: 'PostgreSQL' })}
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

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />

      <Card>
        <CardSection title={t('db.tabDatabasesSimple', { count: dbs.items.length })}>
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
              { key: 'name', header: t('common.database'), render: (r) => <strong>{String(r.name)}</strong> },
              {
                key: 'status',
                header: t('common.status'),
                render: (r) => <ResourceStatusBadge status={String(r.apply_status)} /> },
              {
                key: 'updated',
                header: t('updates.badgeUpdate'),
                render: (r) => (
                  <span className="muted u-nowrap">
                    {String(r.updated_at ?? '').slice(0, 19).replace('T', ' ') || '—'}
                  </span>
                ) },
            ]}
            rows={dbs.items}
            empty={
              <EmptyState
                title={t('db.pgNoDbs')}
                description={
                  !installed
                    ? t('db.pgInstallBanner')
                    : t('db.pgEmptyCreateHint')
                }
              />
            }
            rowActions={(r) => (
              <ActionBar>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => void dbs.apply(r.id, true)}
                >
                  {t('firewall.applyToSystem')}
                </Button>
                <Button variant="danger" size="sm" loading={busy} onClick={bindSet(setDelId, r.id)}>
                  {t('common.delete')}
                </Button>
              </ActionBar>
            )}
          />
        </CardSection>
      </Card>

      <Modal
        open={createOpen}
        onClose={bindSet(setCreateOpen, false)}
        title={t('db.pgCreateTitle')}
        description={t('db.pgCreateDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setCreateOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="pg-c" variant="primary" size="md" loading={busy}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <form id="pg-c" onSubmit={(e) => void onCreate(e)}>
          <FormLayout columns={2}>
            <Field
              label={t('db.dbName')}
              htmlFor="pn"
              fullWidth
              flush
              required
              hint={t('db.dbNameHintPg')}
            >
              <input
                id="pn"
                value={name}
                onChange={bindInput(setName)}
                required
                placeholder="my_app"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </FormLayout>
          <div className="form-check-row u-mt-4">
            <CheckboxField
              id="pg-create-user"
              label={t('db.alsoCreateRole')}
              description={t('db.pgAlsoCreateRoleDesc')}
              checked={createUser}
              onChange={setCreateUser}
            />
          </div>
          {createUser ? (
            <FormLayout columns={2}>
              <Field
                label={t('db.roleName')}
                htmlFor="pu"
                flush
                required
                hint={t('db.roleHint')}
              >
                <input
                  id="pu"
                  value={username}
                  onChange={bindInput(setUsername)}
                  required
                  placeholder="my_app_user"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('common.password')} htmlFor="pp" flush required hint={t('ftp.passwordMin8')}>
                <input
                  id="pp"
                  type="password"
                  value={password}
                  onChange={bindInput(setPassword)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </Field>
            </FormLayout>
          ) : null}
          <FormHint>
            {t('db.deleteNotePg')}
          </FormHint>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delId)}
        onClose={bindSet(setDelId, null)}
        onConfirm={() => {
          if (delId) void dbs.remove(delId).then(() => setDelId(null));
        }}
        title={t('db.deleteDbTitle')}
        description={t('db.pgDeleteDbDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
    
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
