/**
 * 整機遷移 — 專業控制台：盤點 → 目標與認證 → 確認執行 → 結果 / cutover
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  OpsResultPanel,
  PageTabs } from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { bindInput, bindCheck, bindVoid } from '../bind-handlers';
import {
  migrateApi,
  type MigrateJob,
  type MigrateOpsResult } from '../../features/migrate/api';

const TABS = ['wizard', 'jobs', 'about'] as const;

const STEPS = [
  { id: 'scan', label: i18n.t('migrate.tabInventory') },
  { id: 'target', label: i18n.t('common.target') },
  { id: 'run', label: i18n.t('migrate.tabRun') },
  { id: 'done', label: i18n.t('ssl.step.ok') },
] as const;

export function MigrateHostPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'wizard');
  const [inventory, setInventory] = useState<MigrateOpsResult | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('22');
  const [authMode, setAuthMode] = useState<'password' | 'identityId' | 'agent'>(
    'password',
  );
  const [password, setPassword] = useState('');
  const [identityId, setIdentityId] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [forceWipe, setForceWipe] = useState(false);
  const [targetDataDir, setTargetDataDir] = useState('/var/lib/ysk-server');
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<MigrateOpsResult | null>(null);
  const [jobs, setJobs] = useState<MigrateJob[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const r = await migrateApi.listJobs();
      setJobs(r.jobs ?? []);
    } catch {
      /* list optional */
    }
  }, []);

  /** Single refresh: inventory + job list（頁面只留一顆「重新整理」） */
  const refreshAll = useCallback(async () => {
    setInvLoading(true);
    setErr(null);
    try {
      const [inv] = await Promise.all([
        migrateApi.inventory(),
        loadJobs(),
      ]);
      setInventory(inv);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('migrate.refreshFailed'));
      setInventory(null);
    } finally {
      setInvLoading(false);
    }
  }, [loadJobs]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function runMigrate() {
    setBusy(true);
    setErr(null);
    setLast(null);
    try {
      const body: Parameters<typeof migrateApi.runHost>[0] = {
        target: target.trim(),
        port: Number(port) || 22,
        maintenanceAccepted: maintenance,
        forceWipeTarget: forceWipe,
        targetDataDir: targetDataDir.trim() || '/var/lib/ysk-server',
        dryRun,
        execute: !dryRun };
      if (authMode === 'password' && password) {
        body.password = password;
      } else if (authMode === 'identityId' && identityId) {
        body.identityId = identityId.trim();
      }
      const r = await migrateApi.runHost(body);
      setLast(r);
      setPassword('');
      await loadJobs(); // keep job list in sync after run
      if (!r.ok && r.notes?.length) {
        setErr(r.blockMessage || r.notes[0] || t('projects.resMigrateIncomplete'));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('migrate.requestFailed'));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const counts = inventory?.manifest?.counts ?? {};
  const warnings = (inventory?.manifest?.warnings as string[] | undefined) ?? [];
  const softwareNeeded =
    (inventory?.manifest?.softwareNeeded as string[] | undefined) ?? [];
  const cutover =
    (last?.manifest?.cutoverHostnames as string[] | undefined) ??
    (inventory?.manifest?.cutoverHostnames as string[] | undefined) ??
    [];

  const canRun = useMemo(() => {
    if (!target.trim()) return false;
    if (!dryRun && !maintenance) return false;
    if (authMode === 'password' && !password && !dryRun) return false;
    if (authMode === 'identityId' && !identityId.trim() && !dryRun) return false;
    return true;
  }, [target, dryRun, maintenance, authMode, password, identityId]);

  const stepIndex = last?.ok
    ? 3
    : last
      ? 2
      : inventory?.ok
        ? 1
        : 0;

  return (
    <FeaturePageLayout
      title={t('nav.migrate')}
      subtitle={t('migrate.subtitle')}
      status={{
        pill: {
          label: invLoading
            ? t('migrate.inventorying')
            : inventory?.ok
              ? t('migrate.inventoried')
              : err
                ? t('migrate.inventoryFailed')
                : t('migrate.pendingInventory'),
          tone: inventory?.ok ? 'ok' : err ? 'danger' : 'neutral' },
        items: [
          { label: t('common.project'), value: counts.projects ?? '—' },
          { label: t('users.mailboxes'), value: counts.mailboxes ?? '—' },
          { label: t('common.user'), value: counts.users ?? '—' },
          {
            label: t('migrate.software'),
            value: softwareNeeded.length || '—' },
          {
            label: t('migrate.jobs'),
            value: jobs.length },
        ] }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={invLoading}
            onClick={bindVoid(refreshAll)}
          >
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      {err ? (
        <Alert variant="error">
          {err}
          {err.includes(t('migrate.notFound')) || err.includes('404') ? (
            <span className="u-block u-mt-2 muted u-text-sm">
              {t('migrate.restartApiHint')}
              <code>ysk-server serve</code> /{' '}
              <code>pnpm --filter @ysk/server dev</code>
              {t('migrate.afterRestart')}
            </span>
          ) : null}
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'wizard', label: t('migrate.wizard') },
          { id: 'jobs', label: t('migrate.jobLog'), badge: jobs.length || undefined },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {tab === 'wizard' ? (
          <div className="tab-panel mig-wizard">
            {/* Step rail */}
            <nav className="mig-steps" aria-label={t('migrate.steps')}>
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  className={`mig-steps__item${
                    i === stepIndex ? ' is-current' : ''
                  }${i < stepIndex ? ' is-done' : ''}`}
                >
                  <span className="mig-steps__num" aria-hidden>
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  <span className="mig-steps__label">{s.label}</span>
                </div>
              ))}
            </nav>

            {/* 1 Inventory */}
            <Card>
              <CardSection
                title={t('migrate.sourceInventory')}
                description={t('migrate.sourceInventoryDesc')}
              >
                {invLoading && !inventory ? (
                  <LoadingBlock label={t('migrate.inventoryRunning')} />
                ) : inventory?.ok ? (
                  <>
                    <DescriptionList
                      columns={2}
                      items={[
                        {
                          label: t('common.host'),
                          value: String(
                            (inventory.manifest as { source?: { hostname?: string } })
                              ?.source?.hostname ?? '—',
                          ) },
                        {
                          label: 'dataDir',
                          value: (
                            <code className="u-break-all u-text-sm">
                              {String(
                                (inventory.manifest as { source?: { dataDir?: string } })
                                  ?.source?.dataDir ?? '—',
                              )}
                            </code>
                          ) },
                        {
                          label: t('migrate.projectHome'),
                          value: `${counts.projects ?? 0} / ${counts.homes_on_disk ?? '—'}` },
                        {
                          label: t('users.mailboxes'),
                          value: String(counts.mailboxes ?? 0) },
                        {
                          label: 'DB / Redis',
                          value: `${
                            (counts.mysql_databases ?? 0) +
                            (counts.postgres_databases ?? 0)
                          } / ${counts.redis_instances ?? 0}` },
                        {
                          label: t('migrate.needSoftware'),
                          value: softwareNeeded.length
                            ? softwareNeeded.slice(0, 6).join(', ') +
                              (softwareNeeded.length > 6 ? '…' : '')
                            : '—' },
                      ]}
                    />
                    {inventory.notes?.length ? (
                      <p className="muted u-text-sm u-mt-3 u-mb-0">
                        {inventory.notes.join(' · ')}
                      </p>
                    ) : null}
                    {warnings.length > 0 ? (
                      <Alert variant="info" className="u-mt-3">
                        <strong>{t('migrate.inventoryWarnings', { count: warnings.length })}</strong>
                        <ul className="mig-warn-list">
                          {warnings.slice(0, 6).map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                          {warnings.length > 6 ? (
                            <li>{t('migrate.moreWarnings', { n: warnings.length - 6 })}</li>
                          ) : null}
                        </ul>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    title={t('migrate.noInventory')}
                    description={t('migrate.noInventoryHint')}
                  />
                )}
              </CardSection>
            </Card>

            {/* 2 Target */}
            <Card>
              <CardSection
                title={t('migrate.targetHost')}
                description={t('migrate.targetHostDesc')}
              >
                <FormLayout columns={2}>
                  <Field label={t('migrate.sshTarget')} htmlFor="mig-target" required fullWidth>
                    <input
                      id="mig-target"
                      value={target}
                      onChange={bindInput(setTarget)}
                      placeholder="root@203.0.113.10"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t('migrate.sshPort')} htmlFor="mig-port">
                    <input
                      id="mig-port"
                      value={port}
                      onChange={bindInput(setPort)}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label={t('migrate.targetDataDir')} htmlFor="mig-dd" fullWidth>
                    <input
                      id="mig-dd"
                      value={targetDataDir}
                      onChange={bindInput(setTargetDataDir)}
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t('migrate.authMethod')} htmlFor="mig-auth">
                    <select
                      id="mig-auth"
                      value={authMode}
                      onChange={(e) =>
                        setAuthMode(e.target.value as typeof authMode)
                      }
                    >
                      <option value="password">
                        {t('migrate.authPassword')}
                      </option>
                      <option value="identityId">{t('migrate.authIdentity')}</option>
                      <option value="agent">{t('migrate.authAgent')}</option>
                    </select>
                  </Field>
                  {authMode === 'password' ? (
                    <Field label={t('migrate.rootPassword')} htmlFor="mig-pw" required fullWidth>
                      <input
                        id="mig-pw"
                        type="password"
                        value={password}
                        onChange={bindInput(setPassword)}
                        autoComplete="new-password"
                        placeholder={t('migrate.notPersisted')}
                      />
                    </Field>
                  ) : null}
                  {authMode === 'identityId' ? (
                    <Field label="identityId" htmlFor="mig-id" required fullWidth>
                      <input
                        id="mig-id"
                        value={identityId}
                        onChange={bindInput(setIdentityId)}
                        placeholder={t('migrate.outboundIdentity')}
                        spellCheck={false}
                      />
                    </Field>
                  ) : null}
                </FormLayout>

                <div className="mig-checks u-mt-4">
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={maintenance}
                      onChange={bindCheck(setMaintenance)}
                    />
                    <span>
                      <strong>{t('migrate.confirmMaint')}</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        {t('migrate.confirmMaintDesc')}
                      </span>
                    </span>
                  </label>
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={forceWipe}
                      onChange={bindCheck(setForceWipe)}
                    />
                    <span>
                      <strong>{t('migrate.allowOverwrite')}</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        {t('migrate.allowOverwriteDesc')}
                      </span>
                    </span>
                  </label>
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={dryRun}
                      onChange={bindCheck(setDryRun)}
                    />
                    <span>
                      <strong>{t('migrate.dryRunOnly')}</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        {t('migrate.dryRunOnlyDesc')}
                      </span>
                    </span>
                  </label>
                </div>

                <Alert variant="info" className="u-mt-3">
                  {t('migrate.executeNote')}
                </Alert>

                <ActionBar className="u-mt-4">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!canRun || busy}
                    onClick={() => {
                      if (dryRun) void runMigrate();
                      else setConfirmOpen(true);
                    }}
                  >
                    {dryRun ? t('migrate.dryRun') : t('migrate.startMigrate')}
                  </Button>
                  {!canRun && !busy ? (
                    <span className="muted u-text-sm">
                      {!target.trim()
                        ? t('migrate.needSshTarget')
                        : !dryRun && !maintenance
                          ? t('migrate.needMaintWindow')
                          : authMode === 'password' && !password
                            ? t('migrate.needRootPassword')
                            : t('migrate.needRequired')}
                    </span>
                  ) : null}
                </ActionBar>
              </CardSection>
            </Card>

            {/* 3 Result */}
            {last ? (
              <Card>
                <CardSection
                  title={last.ok ? t('migrate.result') : t('projects.resMigrateIncomplete')}
                  description={
                    last.job
                      ? `Job ${last.job.id.slice(0, 8)}… · phase ${last.job.phase}`
                      : undefined
                  }
                >
                  <div className="mig-result-head u-mb-3">
                    <Badge
                      tone={
                        last.ok
                          ? 'ok'
                          : last.blocked
                            ? 'warn'
                            : 'danger'
                      }
                    >
                      {last.ok
                        ? t('common.success')
                        : last.blocked
                          ? t('migrate.blocked')
                          : t('common.failed')}
                    </Badge>
                    {last.job ? (
                      <Badge tone="neutral">{last.job.phase}</Badge>
                    ) : null}
                    {last.apply_status ? (
                      <span className="muted u-text-sm">
                        apply_status={last.apply_status}
                      </span>
                    ) : null}
                  </div>

                  {last.phases ? (
                    <div className="mig-phases u-mb-3">
                      {Object.entries(last.phases).map(([name, ph]) => (
                        <div
                          key={name}
                          className={`mig-phases__item${
                            ph?.ok === false ? ' is-bad' : ' is-ok'
                          }`}
                        >
                          <span className="mig-phases__name">{name}</span>
                          <Badge tone={ph?.ok === false ? 'danger' : 'ok'}>
                            {ph?.ok === false ? 'fail' : 'ok'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <OpsResultPanel
                    title={t('migrate.detail')}
                    result={{
                      ok: last.ok,
                      blocked: last.blocked,
                      blockMessage: last.blockMessage,
                      requiresExecute: last.requiresExecute,
                      notes: last.notes,
                      apply_status: last.apply_status as
                        | 'written'
                        | 'applied'
                        | 'blocked'
                        | 'failed'
                        | 'partial'
                        | undefined }}
                  />

                  {cutover.length > 0 ? (
                    <div className="mig-cutover u-mt-4">
                      <h4 className="mig-cutover__title">{t('migrate.dnsCutover')}</h4>
                      <p className="muted u-text-sm u-mb-2">
                        {t('migrate.dnsCutoverDesc')}
                      </p>
                      <ul className="mig-cutover__list">
                        {cutover.map((h) => (
                          <li key={h}>
                            <code>{h}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === 'jobs' ? (
          <div className="tab-panel">
            <DataTable
              title={t('migrate.jobsTitle', { count: jobs.length })}
              description={t('migrate.jobsDesc')}
              columns={[
                {
                  key: 'id',
                  header: 'Job',
                  nowrap: true,
                  render: (j) => (
                    <code className="u-text-sm" title={j.id}>
                      {j.id.slice(0, 8)}…
                    </code>
                  ) },
                {
                  key: 'phase',
                  header: t('migrate.phase'),
                  nowrap: true,
                  render: (j) => (
                    <Badge
                      tone={
                        j.phase === 'done'
                          ? 'ok'
                          : j.phase === 'failed'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {j.phase}
                    </Badge>
                  ) },
                {
                  key: 'target',
                  header: t('common.target'),
                  render: (j) =>
                    j.target
                      ? `${j.target.user}@${j.target.host}:${j.target.port}`
                      : '—' },
                {
                  key: 'at',
                  header: t('updates.badgeUpdate'),
                  nowrap: true,
                  render: (j) =>
                    new Date(j.updatedAt).toLocaleString() },
                {
                  key: 'err',
                  header: t('common.notes'),
                  render: (j) => (
                    <span className="muted u-text-sm">
                      {j.lastError || '—'}
                    </span>
                  ) },
              ]}
              rows={jobs}
              rowKey={(j) => j.id}
              empty={
                <EmptyState
                  title={t('migrate.noJobs')}
                  description={t('migrate.noJobsHint')}
                />
              }
            />
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="migrate" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={bindVoid(runMigrate)}
        title={t('migrate.confirmTitle')}
        description={t('migrate.confirmDesc', { target: target.trim() || t('migrate.unfilledTarget') })}
        confirmLabel={t('migrate.confirmStart')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
