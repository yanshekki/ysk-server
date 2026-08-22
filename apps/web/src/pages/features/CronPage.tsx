/**
 * Cron — store jobs vs host crontab honesty.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  OpsResultPanel,
  PageTabs,
  Modal,
  ConfirmDialog,
  TableMore } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { bindSet, bindInput } from '../bind-handlers';
import { formatDateTime } from '../../shared/lib/datetime';
import {
  buildCronExpr,
  CronScheduleBuilder,
  defaultScheduleState,
  humanizeSchedule,
  parseCronToState,
  isValidCronSchedule,
  type ScheduleState } from './CronScheduleBuilder';

const CRON_TABS = ['jobs', 'status', 'about'] as const;

type CronProjectOpt = {
  id: string;
  name: string;
  linuxUser: string;
  homeDir: string;
  runtime: string;
};

/** Suggested cron commands under project home (cwd-aware via cd) */
export function projectCommandPresets(p: CronProjectOpt): Array<{ label: string; command: string }> {
  const home = p.homeDir.replace(/\/$/, '') || '/home/ysk';
  const app = `${home}/app`;
  const log = `${home}/logs/cron.log`;
  const common = [
    {
      label: i18n.t('cron.presetCdTrue'),
      command: `cd ${app} && /usr/bin/true` },
    {
      label: i18n.t('cron.presetCleanTmp'),
      command: `find ${home}/tmp -type f -mtime +7 -delete 2>/dev/null || true` },
  ];
  switch (p.runtime) {
    case 'php':
      return [
        {
          label: 'Laravel schedule:run',
          command: `cd ${app} && /usr/bin/php artisan schedule:run >> ${log} 2>&1` },
        {
          label: 'wp-cron.php',
          command: `cd ${app} && /usr/bin/php wp-cron.php >> ${log} 2>&1` },
        {
          label: 'composer dump-autoload',
          command: `cd ${app} && /usr/bin/composer dump-autoload -o >> ${log} 2>&1` },
        ...common,
      ];
    case 'node':
      return [
        {
          label: i18n.t('cron.presetNpmCron'),
          command: `cd ${app} && /usr/bin/npm run cron >> ${log} 2>&1` },
        {
          label: 'node scripts/cron.js',
          command: `cd ${app} && /usr/bin/node scripts/cron.js >> ${log} 2>&1` },
        ...common,
      ];
    case 'python':
      return [
        {
          label: 'venv + manage.py（Django）',
          command: `cd ${app} && . .venv/bin/activate && python manage.py cron >> ${log} 2>&1` },
        {
          label: 'python scripts/job.py',
          command: `cd ${app} && . .venv/bin/activate 2>/dev/null; python scripts/job.py >> ${log} 2>&1` },
        ...common,
      ];
    case 'go':
    case 'rust':
      return [
        {
          label: i18n.t('cron.presetAppBin'),
          command: `cd ${app} && ./app --cron >> ${log} 2>&1` },
        ...common,
      ];
    case 'static':
      return [
        {
          label: i18n.t('cron.presetRsync'),
          command: `rsync -a --delete ${app}/ ${home}/public/ >> ${log} 2>&1` },
        ...common,
      ];
    default:
      return common;
  }
}

export function defaultCommandForProject(p: CronProjectOpt): string {
  const presets = projectCommandPresets(p);
  return presets[0]?.command ?? `cd ${p.homeDir}/app && /usr/bin/true`;
}

/** True if command looks like our auto template / placeholder */
export function isAutoCommand(cmd: string, projects: CronProjectOpt[]): boolean {
  const t = cmd.trim();
  if (!t) return false;
  if (t === '/usr/bin/true') return true;
  return projects.some((p) => projectCommandPresets(p).some((x) => x.command === t));
}

type CronJob = {
  id: string;
  schedule?: string;
  command?: string;
  user?: string;
  projectId?: string;
  project_id?: string;
  enabled?: boolean;
  created_at?: string;
  createdAt?: string;
  last_install?: { ok?: boolean; at?: string };
};

function pendingAgeDays(job: CronJob, now = Date.now()): number | null {
  const raw = job.created_at || job.createdAt || job.last_install?.at;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

type CronStatus = {
  managedPath: string;
  managedLines: number;
  enabledJobs: number;
  totalJobs: number;
  hostHasYskEntries: boolean | null;
  hostCrontabPreview: string;
  hostOtherLines?: number | null;
  hostTotalLines?: number | null;
  executeEnabled: boolean;
  lastInstallOk: boolean | null;
  lastInstallAt: string | null;
};

type HostCronLine = {
  user: string;
  projectId?: string;
  projectName?: string;
  schedule?: string;
  command?: string;
  raw: string;
  kind: string;
  source: string;
  managedJobId?: string;
  disabled?: boolean;
};

type HostCronInventory = {
  users: Array<{
    user: string;
    projectId?: string;
    projectName?: string;
    available: boolean;
    notes: string[];
    lineCount: number;
    jobCount: number;
  }>;
  lines: HostCronLine[];
  notes: string[];
  partial: boolean;
  isRoot: boolean;
  executeEnabled: boolean;
};

export function filterHostCronJobs(
  lines: HostCronLine[],
  userFilter: string,
): HostCronLine[] {
  const jobs = lines.filter((l) => l.kind === 'job');
  const u = userFilter.trim();
  if (!u) return jobs;
  return jobs.filter((l) => l.user === u);
}

/** Status tab census: panel jobs + host-other = total (pending included in panel). */
export function cronLineCensus(opts: {
  panelJobs: number;
  hostOtherLines?: number | null;
}): { panel: number; other: number; total: number } {
  const panel = Math.max(0, opts.panelJobs);
  const other = Math.max(0, opts.hostOtherLines ?? 0);
  return { panel, other, total: panel + other };
}

export function CronPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CronJob[]>([]);
  const [hostInv, setHostInv] = useState<HostCronInventory | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedState, setSchedState] = useState<ScheduleState>(() => defaultScheduleState());
  const schedule = useMemo(() => buildCronExpr(schedState), [schedState]);
  const scheduleHuman = useMemo(() => humanizeSchedule(schedState), [schedState]);
  const [command, setCommand] = useState('/usr/bin/true');
  const [commandTouched, setCommandTouched] = useState(false);
  /** Only used when no project ({t('cron.systemLevel')}工作) */
  const [systemUser, setSystemUser] = useState('ysk');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<CronProjectOpt[]>([]);
  const [needsInstallHint, setNeedsInstallHint] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hostEditing, setHostEditing] = useState<HostCronLine | null>(null);
  const [hostOp, setHostOp] = useState<{
    type: 'save' | 'disable' | 'enable' | 'delete' | 'run' | 'adopt';
    line: HostCronLine;
  } | null>(null);
  const [delCron, setDelCron] = useState<{ id: string; label: string } | null>(null);
  const { busy, error: actErr, result, msg, run: runRaw, setMsg } = useFeatureAction();
  const [tab, setTab, unknownTab] = usePageTab(CRON_TABS, 'jobs');
  const panel = unknownTab ? null : tab;
  const [resultTab, setResultTab] = useState<string | null>(null);
  const run: typeof runRaw = useCallback(
    (fn, okMessage) => {
      setResultTab(tab);
      return runRaw(fn, okMessage);
    },
    [runRaw, tab],
  );
  useEffect(() => {
    setResultTab((prev) => (prev == null || prev === tab ? prev : null));
  }, [tab]);

  function openCreate() {
    setError(null);
    setEditingId(null);
    setHostEditing(null);
    setCreateOpen(true);
  }

  function openHostEdit(line: HostCronLine) {
    setError(null);
    setEditingId(null);
    setHostEditing(line);
    setSchedState(parseCronToState(String(line.schedule || '')));
    setCommand(String(line.command || ''));
    setCommandTouched(true);
    setProjectId('');
    setSystemUser(String(line.user || 'root'));
    setCreateOpen(true);
  }

  function openEdit(job: CronJob) {
    setError(null);
    setEditingId(job.id);
    setSchedState(parseCronToState(String(job.schedule || '')));
    setCommand(String(job.command || ''));
    setCommandTouched(true);
    const pid = String(job.projectId || job.project_id || '');
    if (pid) {
      setProjectId(pid);
    } else {
      setProjectId('');
      setSystemUser(String(job.user || 'ysk'));
    }
    setCreateOpen(true);
  }

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  /** 綁專案 → 專案 Linux 用戶；否則系統用戶 */
  const runAsUser = selectedProject?.linuxUser?.trim() || systemUser.trim() || 'ysk';
  /** select value: p:{projectId} | s:{username} */
  const runUserSelectValue = projectId
    ? `p:${projectId}`
    : `s:${systemUser.trim() || 'ysk'}`;

  const runUserOptions = useMemo(() => {
    const projectOpts = projects.map((p) => ({
      value: `p:${p.id}`,
      label: p.linuxUser?.trim()
        ? `${p.linuxUser} · ${p.name}`
        : t('cron.noLinuxUser', { name: p.name }),
      disabled: !p.linuxUser?.trim(),
      group: t('security.ssh.filterUser') }));
    const systemOpts = [
      { value: 's:ysk', label: t('cron.panelUser'), group: t('common.system') },
      { value: 's:root', label: t('cron.rootCareful'), group: t('common.system') },
      { value: 's:www-data', label: 'www-data · Web', group: t('common.system') },
    ];
    const known = new Set(systemOpts.map((o) => o.value));
    if (!projectId && systemUser && !known.has(`s:${systemUser}`)) {
      systemOpts.push({
        value: `s:${systemUser}`,
        label: t('cron.customUser', { user: systemUser }),
        group: t('common.system') });
    }
    return { projectOpts, systemOpts };
  }, [projects, projectId, systemUser]);

  const commandPresets = useMemo(
    () => (selectedProject ? projectCommandPresets(selectedProject) : []),
    [selectedProject],
  );
  const wrappedPreview = useMemo(() => {
    if (!selectedProject?.linuxUser || !command.trim()) return command;
    const u = selectedProject.linuxUser;
    if (/\brunuser\s+-u\b/.test(command)) return command;
    const quoted = `'${command.replace(/'/g, `'\\''`)}'`;
    return `runuser -u ${u} -- bash -lc ${quoted}`;
  }, [selectedProject, command]);

  const applyProjectSideEffects = (prevId: string, nextId: string) => {
    const prev = projects.find((p) => p.id === prevId) ?? null;
    const next = projects.find((p) => p.id === nextId) ?? null;
    if (!next) {
      if (isAutoCommand(command, projects)) setCommand('/usr/bin/true');
      return;
    }
    const shouldReplace =
      isAutoCommand(command, projects) ||
      (prev ? projectCommandPresets(prev).some((x) => x.command === command.trim()) : false);
    if (shouldReplace) setCommand(defaultCommandForProject(next));
  };

  const onProjectChange = (nextId: string) => {
    const prevId = projectId;
    setProjectId(nextId);
    applyProjectSideEffects(prevId, nextId);
  };

  const onRunUserChange = (raw: string) => {
    if (raw.startsWith('p:')) {
      const nextId = raw.slice(2);
      onProjectChange(nextId);
      return;
    }
    if (raw.startsWith('s:')) {
      const prevId = projectId;
      setProjectId('');
      setSystemUser(raw.slice(2) || 'ysk');
      applyProjectSideEffects(prevId, '');
    }
  };

  const refresh = useCallback(async () => {
    const [r, st, proj, host] = await Promise.all([
      api.listCron(),
      api.cronStatus().catch(() => null),
      api.listProjects().catch(() => ({ items: [] })),
      api.listCronHost().catch(() => null),
    ]);
    setItems(r.items as CronJob[]);
    if (st) setStatus(st);
    if (host) setHostInv(host as HostCronInventory);
    setProjects(
      (proj.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linuxUser,
        homeDir: p.homeDir,
        runtime: p.runtime })),
    );
  }, []);

  const hostJobs = useMemo(
    () => filterHostCronJobs(hostInv?.lines ?? [], userFilter),
    [hostInv, userFilter],
  );

  const managedById = useMemo(() => {
    const m = new Map<string, CronJob>();
    for (const j of items) m.set(j.id, j);
    return m;
  }, [items]);

  /** Managed rows not yet visible on any host crontab (pending install). */
  const pendingManaged = useMemo(() => {
    const onHost = new Set(
      (hostInv?.lines ?? [])
        .map((l) => l.managedJobId)
        .filter(Boolean) as string[],
    );
    return items.filter((j) => j.enabled !== false && !onHost.has(j.id));
  }, [items, hostInv]);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const scheduleOk =
    schedState.mode !== 'custom' || isValidCronSchedule(schedState.custom);
  const canCreate =
    Boolean(command.trim()) &&
    scheduleOk &&
    Boolean(hostEditing || projectId || systemUser.trim()) &&
    !/[\r\n]/.test(command);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCommandTouched(true);
    if (!command.trim()) {
      setError(t('cron.needCommand'));
      return;
    }
    if (!scheduleOk) {
      setError(t('cron.invalidExpr'));
      return;
    }
    if (/[\r\n]/.test(command)) {
      setError(t('cron.invalidExpr'));
      return;
    }
    if (hostEditing) {
      setHostOp({ type: 'save', line: hostEditing });
      return;
    }
    if (!projectId && !systemUser.trim()) {
      setError(t('cron.needUser'));
      return;
    }
    if (projectId && !selectedProject?.linuxUser) {
      setError(t('cron.needLinuxUser'));
      return;
    }
    await run(async () => {
      if (editingId) {
        await api.requestRaw(`/api/v1/cron/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            schedule,
            command,
            user: runAsUser,
            projectId: projectId || undefined,
          }),
        });
        setNeedsInstallHint(true);
        setCreateOpen(false);
        setEditingId(null);
        await refresh();
        return {
          ok: true,
          notes: [t('cron.updatedManage'), t('cron.needInstall')],
        };
      }
      const r = await api.createCron({
        schedule,
        command,
        user: runAsUser,
        projectId: projectId || undefined });
      setNeedsInstallHint(true);
      setCreateOpen(false);
      await refresh();
      return {
        ok: true,
        notes: [
          projectId
            ? t('cron.boundProject', { user: runAsUser })
            : t('cron.systemJob', { user: runAsUser }),
          t('cron.writtenManage'),
          t('cron.needInstall'),
        ],
        ...r } as unknown as OpsResultLike;
    }, editingId ? t('cron.updatedManageShort') : t('cron.createdManageOnly'));
  }

  async function onInstall() {
    await run(async () => {
      try {
        const r = await api.installCron();
        setNeedsInstallHint(false);
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('cron.installedSystem'));
  }

  const hostSavePreview = (() => {
    if (!hostEditing && hostOp?.type !== 'save') return '';
    const live = `${schedule} ${command.trim()}`;
    const disabled = Boolean(hostEditing?.disabled || hostOp?.line.disabled);
    return disabled ? `# ${live}` : live;
  })();

  async function runHostOp() {
    const op = hostOp;
    if (!op) return;
    const line = op.line;
    await run(async () => {
      const body: Record<string, unknown> = {
        user: line.user,
        oldRaw: line.raw,
        command: line.command,
        schedule: line.schedule,
      };
      if (op.type === 'save') {
        body.schedule = schedule;
        body.command = command.trim();
      }
      if (op.type === 'delete') body.confirm = line.command;
      if (op.type === 'run') body.command = line.command;
      const action =
        op.type === 'save'
          ? 'replace'
          : op.type === 'disable'
            ? 'disable'
            : op.type === 'enable'
              ? 'enable'
              : op.type;
      const r = await api.cronHostOp(action, body);
      setCreateOpen(false);
      setHostEditing(null);
      await refresh();
      return r as OpsResultLike;
    }, op.type === 'save'
      ? t('cron.writtenHost')
      : op.type === 'run'
        ? t('cron.runOnceOk')
        : op.type === 'adopt'
          ? t('cron.adoptedHost')
          : t('cron.success'));
    setHostOp(null);
  }

  const hostOk = status?.hostHasYskEntries === true;
  const hostNo = status?.hostHasYskEntries === false;

  const heroTone = hostOk ? 'ok' : hostNo || needsInstallHint ? 'warn' : 'ok';
  const lineCensus = cronLineCensus({
    panelJobs: items.length,
    hostOtherLines: status?.hostOtherLines,
  });

  return (
    <FeaturePageLayout
      title={t('nav.cron')}
      showCapability={false}
      status={{
        pill: {
          label: hostOk ? t('cron.hostSynced') : hostNo ? t('cron.hostNotInstalled') : t('cron.statusUnknown'),
          tone: heroTone },
        items: [
          {
            label: t('cron.writtenOnHost'),
            value: (hostInv?.lines ?? []).filter((l) => l.kind === 'job').length,
            hint: t('cron.writtenOnHostHint'),
          },
          {
            label: t('cron.registeredJobsChip'),
            value: items.length,
            hint: t('cron.registeredJobsHint'),
          },
          {
            label: t('cron.usersScanned'),
            value: hostInv?.users?.length ?? '—',
          },
          {
            label: t('cron.managedLines'),
            value: status?.managedLines ?? items.length,
          },
          {
            label: t('dashboard.executeLabel'),
            value: status?.executeEnabled ? t('common.on') : t('common.off'),
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
        ] }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            {t('common.refresh')}
          </Button>
          
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            title={t('cron.installPreviewTitle')}
            onClick={() => setInstallOpen(true)}
          >
            {t('security.ssh.installToSystem')}
          </Button>
        </ActionBar>
      }
    >
      {error || actErr ? <Alert variant="error">{error ?? actErr}</Alert> : null}
      <div className="ops">
        {hostInv?.partial ? (
          <Alert variant="warn">
            {(hostInv.notes ?? []).slice(0, 2).join(' · ') || t('cron.hostPartial')}
          </Alert>
        ) : null}
        {needsInstallHint || (pendingManaged.length > 0 && hostNo) ? (
          <Alert variant="info">
            <p className="u-mb-2">{t('cron.pressInstall')}</p>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => void onInstall()}
            >
              {t('cron.installToSystem')}
            </Button>
          </Alert>
        ) : null}

      <PageTabs
        tabs={[
          {
            id: 'jobs',
            label: pendingManaged.length
              ? t('cron.jobsTabPending', {
                  count: (hostInv?.lines ?? []).filter((l) => l.kind === 'job').length,
                  pending: pendingManaged.length,
                })
              : t('cron.jobsTab', {
                  count: (hostInv?.lines ?? []).filter((l) => l.kind === 'job').length,
                }),
          },
          { id: 'status', label: t('common.status') },
          { id: 'about', label: t('common.about') },
        ]}
        active={unknownTab ? '' : tab}
        onChange={setTab}
        variant="scroll"
      >
        {unknownTab ? (
          <div className="tab-panel">
            <EmptyState
              title={t('tabs.unknown')}
              description={t('tabs.unknownHint', { tab: unknownTab })}
            />
          </div>
        ) : null}
        {panel === 'jobs' ? (
          <div className="tab-panel">
            <section className="ops-panel cron-host">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">
                    {t('cron.hostJobsTitle', { count: hostJobs.length })}
                  </h3>
                </div>
                <ActionBar>
                  <label className="cron-host__filter">
                    <span className="cron-host__filter-label">{t('cron.filterUser')}</span>
                    <select
                      className="cron-host__filter-select"
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                      aria-label={t('cron.filterUser')}
                    >
                      <option value="">{t('cron.filterAll')}</option>
                      {(hostInv?.users ?? []).map((u) => (
                        <option key={u.user} value={u.user}>
                          {u.projectName
                            ? `${u.user} · ${u.projectName}`
                            : u.user}
                          {u.jobCount != null ? ` (${u.jobCount})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    {t('cron.addJob')}
                  </Button>
                </ActionBar>
              </header>

              {hostJobs.length === 0 ? (
                <EmptyState title={t('cron.noHostJobs')} />
              ) : (
                <div className="ops-svc-list">
                  {hostJobs.map((line, idx) => {
                    const managed = line.managedJobId
                      ? managedById.get(line.managedJobId)
                      : undefined;
                    const tone = line.disabled
                      ? 'warn'
                      : line.source === 'ysk'
                        ? managed?.enabled === false
                          ? 'warn'
                          : 'ok'
                        : 'neutral';
                    return (
                      <article
                        key={`${line.user}-${idx}-${line.raw.slice(0, 24)}`}
                        className={`ops-svc ops-svc--${tone}`}
                      >
                        <div className="ops-svc__body">
                          <div className="ops-svc__head">
                            <h4 className="ops-svc__name">
                              <code className="cron-host__user">{line.user}</code>
                              {line.schedule
                                ? ` · ${
                                    line.schedule.startsWith('@')
                                      ? line.schedule
                                      : humanizeSchedule(
                                          parseCronToState(String(line.schedule)),
                                        )
                                  }`
                                : ''}
                            </h4>
                            <Badge tone={line.source === 'ysk' ? 'ok' : 'neutral'}>
                              {line.source === 'ysk'
                                ? t('cron.sourceYsk')
                                : t('cron.sourceHost')}
                            </Badge>
                            {line.disabled ? (
                              <Badge tone="warn">{t('cron.disabledJob')}</Badge>
                            ) : null}
                            {line.projectName ? (
                              <Badge tone="info">{line.projectName}</Badge>
                            ) : null}
                          </div>
                          <div className="ops-svc__meta">
                            {line.schedule ? <code>{line.schedule}</code> : null}
                          </div>
                          <p className="ops-svc__cmd" title={line.command || line.raw}>
                            {line.command || line.raw}
                          </p>
                        </div>
                        <div className="ops-svc__actions">
                          {managed ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() => openEdit(managed)}
                              >
                                {t('common.edit')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const r = await api.runCronNow(managed.id);
                                    return r as unknown as OpsResultLike;
                                  }, t('cron.runOnceOk'))
                                }
                              >
                                {t('cron.runOnce')}
                              </Button>
                              <TableMore label={t('common.more')}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await api.requestRaw(`/api/v1/cron/${managed.id}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({
                                          enabled: managed.enabled === false,
                                        }),
                                      });
                                      setNeedsInstallHint(true);
                                      await refresh();
                                      return {
                                        ok: true,
                                        notes: [t('cron.updatedManage')],
                                      };
                                    }, t('cron.updatedManageShort'))
                                  }
                                >
                                  {managed.enabled === false
                                    ? t('protection.enable')
                                    : t('files.disable')}
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  loading={busy}
                                  title={t('cron.deleteTitle')}
                                  data-confirm={String(
                                    managed.command || managed.schedule || managed.id,
                                  )}
                                  onClick={() =>
                                    setDelCron({
                                      id: managed.id,
                                      label: String(
                                        managed.command || managed.schedule || managed.id,
                                      ),
                                    })
                                  }
                                >
                                  {t('common.delete')}
                                </Button>
                              </TableMore>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() => openHostEdit(line)}
                              >
                                {t('cron.hostEdit')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                data-confirm
                                disabled={busy}
                                onClick={() => setHostOp({ type: 'run', line })}
                              >
                                {t('cron.runOnce')}
                              </Button>
                              <TableMore label={t('common.more')}>
                                {line.disabled ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-confirm
                                    disabled={busy}
                                    onClick={() => setHostOp({ type: 'enable', line })}
                                  >
                                    {t('cron.hostEnable')}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-confirm
                                    disabled={busy}
                                    onClick={() => setHostOp({ type: 'disable', line })}
                                  >
                                    {t('cron.hostDisable')}
                                  </Button>
                                )}
                                {line.user === 'root' || line.user === 'current' ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-confirm
                                  disabled={busy || Boolean(line.disabled)}
                                  onClick={() => setHostOp({ type: 'adopt', line })}
                                >
                                  {t('cron.hostAdopt')}
                                </Button>
                                ) : null}
                                <Button
                                  variant="danger"
                                  size="sm"
                                  data-confirm
                                  disabled={busy}
                                  title={t('cron.hostDeleteTitle')}
                                  onClick={() => setHostOp({ type: 'delete', line })}
                                >
                                  {t('common.delete')}
                                </Button>
                              </TableMore>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {pendingManaged.length > 0 ? (
              <section className="ops-panel u-mt-4">
                <header className="ops-panel__head">
                  <h3 className="ops-panel__title">
                    {t('cron.pendingInstall', { count: pendingManaged.length })}
                  </h3>
                  <p className="ops-panel__sub">{t('cron.willNotRun')}</p>
                </header>
                <div className="ops-svc-list">
                  {pendingManaged.map((job) => (
                    <article key={job.id} className="ops-svc ops-svc--warn">
                      <div className="ops-svc__body">
                        <div className="ops-svc__head">
                          <h4 className="ops-svc__name">
                            {job.schedule
                              ? humanizeSchedule(
                                  parseCronToState(String(job.schedule)),
                                )
                              : '—'}
                          </h4>
                          <Badge tone="warn">{t('cron.manageOnly')}</Badge>
                        </div>
                        <div className="ops-svc__meta">
                          <code>{job.schedule}</code>
                          <span>
                            {t('common.user')} <code>{job.user ?? '—'}</code>
                          </span>
                        </div>
                        <p className="ops-svc__cmd">{job.command}</p>
                        {pendingAgeDays(job) != null && pendingAgeDays(job)! >= 1 ? (
                          <p className="muted u-text-sm u-mt-1">
                            {t('cron.pendingStale', { days: pendingAgeDays(job) })}
                          </p>
                        ) : (
                          <p className="muted u-text-sm u-mt-1">{t('cron.willNotRun')}</p>
                        )}
                      </div>
                      <div className="ops-svc__actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await api.runCronNow(job.id);
                              return r as unknown as OpsResultLike;
                            }, t('cron.runOnceOk'))
                          }
                        >
                          {t('cron.runOnce')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => openEdit(job)}
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          title={t('cron.deleteTitle')}
                          data-confirm={String(job.command || job.schedule || job.id)}
                          onClick={() =>
                            setDelCron({
                              id: job.id,
                              label: String(job.command || job.schedule || job.id),
                            })
                          }
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
        {panel === 'status' ? (
          <div className="tab-panel">
            <div className="ops-grid">
              <section className="ops-panel">
                <header className="ops-panel__head">
                  <div>
                    <h3 className="ops-panel__title">{t('cron.installStatus')}</h3>
                    <p className="ops-panel__sub">{t('cron.manageVsHost')}</p>
                  </div>
                </header>
                <dl className="ops-dl">
                  <div>
                    <dt>{t('email.pillManaged')}</dt>
                    <dd>
                      <code className="ops-svc__cmd">{status?.managedPath ?? '—'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('metrics.rows')}</dt>
                    <dd>{status?.managedLines ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('cron.panelLines')}</dt>
                    <dd>
                      {lineCensus.panel}
                      {pendingManaged.length
                        ? ` · ${t('cron.pendingInstallCount', { n: pendingManaged.length })}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('cron.otherLines')}</dt>
                    <dd>{lineCensus.other}</dd>
                  </div>
                  <div>
                    <dt>{t('cron.totalLines')}</dt>
                    <dd>{lineCensus.total}</dd>
                  </div>
                  <div>
                    <dt>{t('cron.lastInstall')}</dt>
                    <dd>
                      {status?.lastInstallAt
                        ? `${status.lastInstallOk ? t('common.success') : t('common.failed')} · ${formatDateTime(status.lastInstallAt)}`
                        : t('backups.notYet')}
                    </dd>
                  </div>
                </dl>
                <p className="ops-footnote">
                  {t('cron.installHint')}
                </p>
              </section>
              <section className="ops-panel">
                <header className="ops-panel__head">
                  <h3 className="ops-panel__title">{t('cron.hostPreview')}</h3>
                </header>
                {pendingManaged.length ? (
                  <div className="u-mb-3">
                    <p className="ops-panel__sub">
                      {t('cron.pendingInstall', { count: pendingManaged.length })}
                    </p>
                    <ul className="list-plain list-spaced">
                      {pendingManaged.map((job) => (
                        <li key={job.id}>
                          <code>{job.schedule}</code> · {job.user} · {job.command}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(() => {
                  const preview = String(status?.hostCrontabPreview ?? '').trim();
                  const emptyHost =
                    !preview || /^no crontab for /i.test(preview);
                  if (emptyHost) {
                    return pendingManaged.length ? null : (
                      <p className="ops-muted">
                        {t('cron.emptyHostCrontab', {
                          user: userFilter || 'root',
                        })}
                      </p>
                    );
                  }
                  const deduped = preview
                    .split('\n')
                    .filter((line, i, arr) => {
                      const t = line.trim();
                      if (!t.startsWith('# YSK Server crontab merge')) return true;
                      return arr.findIndex((x) => x.trim().startsWith('# YSK Server crontab merge')) === i;
                    })
                    .join('\n');
                  return <pre className="ops-pre">{deduped}</pre>;
                })()}
              </section>
            </div>
          </div>
        ) : null}
      
        {panel === 'about' ? <PageGuide guideId="cron" /> : null}
      </PageTabs>

      {result && resultTab === tab ? (
        <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />
      ) : null}
      </div>

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setHostEditing(null);
        }}
        title={
          hostEditing
            ? t('cron.hostEditTitle')
            : editingId
              ? t('cron.editJobTitle')
              : t('cron.addJobTitle')
        }
        description={
          hostEditing
            ? t('cron.hostEditDesc')
            : editingId
              ? t('cron.editJobDesc')
              : t('cron.addJobDesc')
        }
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setCreateOpen(false);
                setHostEditing(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="cron-create"
              variant="primary"
              size="md"
              loading={busy}
              disabled={!canCreate}
              title={
                !scheduleOk
                  ? t('cron.invalidExpr')
                  : !command.trim()
                    ? t('cron.needCommand')
                    : hostEditing
                      ? undefined
                    : !projectId && !systemUser.trim()
                      ? t('cron.needUser')
                      : undefined
              }
            >
              {hostEditing
                ? t('cron.hostSave')
                : editingId
                  ? t('cron.saveJob')
                  : t('cron.createManageOnlyParen')}
            </Button>
          </>
        }
      >
        <form
          id="cron-create"
          className="feature-form"
          noValidate
          onSubmit={(e) => void onCreate(e)}
        >
          <Field
            label={t('cron.whenRun')}
            htmlFor="cron-sched-builder"
            flush
            fullWidth
            required
            hint={t('cron.whenRunHint')}
          >
            <div id="cron-sched-builder">
              <CronScheduleBuilder value={schedState} onChange={setSchedState} />
            </div>
          </Field>

          <FormLayout columns={2}>
            {hostEditing ? (
              <Field
                label={t('cron.runAsUser')}
                htmlFor="cron-host-user"
                flush
                hint={t('cron.hostUserLocked')}
              >
                <input id="cron-host-user" value={hostEditing.user} readOnly />
              </Field>
            ) : (
            <>
            <Field
              label={t('common.project')}
              htmlFor="cron-pid"
              flush
              hint={t('cron.userPathHint')}
            >
              <select
                id="cron-pid"
                value={projectId}
                onChange={(e) => onProjectChange(e.target.value)}
              >
                <option value="">{t('cron.pickProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.runtime} · {p.linuxUser || t('cron.projectNoLinux')}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t('cron.runAsUser')}
              htmlFor="cron-user"
              flush
              required
              hint={t('cron.runAsHintFull')}
            >
              <select
                id="cron-user"
                value={runUserSelectValue}
                onChange={(e) => onRunUserChange(e.target.value)}
              >
                <optgroup label={t('security.ssh.filterUser')}>
                  {runUserOptions.projectOpts.length === 0 ? (
                    <option value="__none_proj" disabled>
                      {t('cron.noProjectsYet')}
                    </option>
                  ) : (
                    runUserOptions.projectOpts.map((o) => (
                      <option key={o.value} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </option>
                    ))
                  )}
                </optgroup>
                <optgroup label={t('common.system')}>
                  {runUserOptions.systemOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            </>
            )}
            <Field
              label={t('metrics.command')}
              htmlFor="cron-cmd"
              fullWidth
              flush
              required
              hint={
                hostEditing
                  ? t('cron.hostLinePreview')
                  : selectedProject
                    ? t('cron.runInHome', { home: selectedProject.homeDir })
                    : t('cron.absPath')
              }
              error={
                commandTouched && !command.trim()
                  ? t('cron.needCommand')
                  : commandTouched && /[\r\n]/.test(command)
                    ? t('cron.invalidExpr')
                    : undefined
              }
            >
              <textarea
                id="cron-cmd"
                className="u-mono-input"
                rows={hostEditing ? 4 : 3}
                value={command}
                onChange={(e) => {
                  setCommandTouched(true);
                  setCommand(e.target.value);
                }}
                required
                placeholder={
                  selectedProject
                    ? `cd ${selectedProject.homeDir}/app && …`
                    : '/usr/bin/true'
                }
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          {hostEditing ? (
            <>
              {hostEditing.disabled ? (
                <Alert variant="warn">{t('cron.keepDisabledHint')}</Alert>
              ) : null}
              <p className="form-hint">
                {t('cron.hostLinePreview')}:{' '}
                <code className="u-break-all">{hostSavePreview}</code>
              </p>
            </>
          ) : null}
          {!hostEditing && selectedProject && commandPresets.length > 0 ? (
            <div className="cron-cmd-presets">
              <span className="cron-cmd-presets__label">
                {t('cron.commonCmds', { runtime: selectedProject.runtime })}
              </span>
              <div className="cron-cmd-presets__row">
                {commandPresets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn btn--sm${command === p.command ? ' btn--secondary' : ' btn--ghost'}`}
                    onClick={bindSet(setCommand, p.command)}
                    title={p.command}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!hostEditing && selectedProject ? (
            <div className="cron-sched__preview u-max-w-full">
              <div className="cron-sched__preview-human">
                <span className="cron-sched__preview-label">
                  {t('cron.actualPreview')}
                </span>
                <code
                  className="u-text-sm u-break-all u-font-medium"
                >
                  {wrappedPreview}
                </code>
              </div>
            </div>
          ) : null}
          {!hostEditing && projects.length === 0 ? (
            <EmptyState
              title={t('dashboard.noProjects')}
              description={t('cron.noProjectsHint')}
            />
          ) : null}
          {!hostEditing && selectedProject && !selectedProject.linuxUser ? (
            <Alert variant="error">
              {t('cron.noLinuxName')}
            </Alert>
          ) : null}
          {!hostEditing && !projectId ? (
            <p className="u-mb-2">
              <Badge tone="warn">{t('cron.systemJobBadge')}</Badge>
            </p>
          ) : null}
          <p className="form-hint u-mb-0">
            {hostEditing
              ? [scheduleHuman, hostEditing.user].filter(Boolean).join(' · ')
              : [
                  t('cron.afterCreate'),
                  scheduleHuman,
                  runAsUser ? `${t('cron.userSuffix')} ${runAsUser}` : '',
                  selectedProject
                    ? t('cron.projectParen', { name: selectedProject.name })
                    : t('cron.systemParenFull'),
                ]
                  .map((s) => String(s || '').trim())
                  .filter((s) => s && s !== '·')
                  .join(' · ')}
          </p>
        </form>
      </Modal>

      <Modal
        open={installOpen}
        onClose={() => !busy && setInstallOpen(false)}
        title={t('cron.installPreviewTitle')}
        description={t('cron.installPreviewDesc')}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setInstallOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                setInstallOpen(false);
                void onInstall();
              }}
            >
              {t('security.ssh.installToSystem')}
            </Button>
          </>
        }
      >
        <Alert variant="warn">{t('cron.installPreviewMerge')}</Alert>
        {pendingManaged.length > 0 ? (
          <ul className="list-plain list-spaced u-mt-3">
            {pendingManaged.map((job) => (
              <li key={job.id}>
                <code>{job.schedule}</code> · {job.user} · {job.command}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted u-mt-3">{t('cron.installPreviewEmpty')}</p>
        )}
        {status?.hostCrontabPreview ? (
          <pre className="ops-pre u-mt-3">{status.hostCrontabPreview}</pre>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(delCron)}
        onClose={() => {
          if (!busy) setDelCron(null);
        }}
        onConfirm={() => {
          if (!delCron) return;
          const id = delCron.id;
          setDelCron(null);
          void run(async () => {
            await api.requestRaw(`/api/v1/cron/${id}`, { method: 'DELETE' });
            setNeedsInstallHint(true);
            await refresh();
            return {
              ok: true,
              notes: [t('cron.deletedManage')],
            };
          }, t('redis.deleted'));
        }}
        title={t('cron.deleteTitle')}
        description={t('cron.deleteDesc', { name: delCron?.label ?? '' })}
        dataConfirm={delCron?.label}
        confirmLabel={t('common.delete')}
        severity="standard"
        busy={busy}
      />
      <ConfirmDialog
        open={hostOp?.type === 'save'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostSaveTitle')}
        description={t('cron.hostSaveDesc', {
          user: hostOp?.line.user ?? '',
        })}
        confirmLabel={t('cron.hostSave')}
        cancelLabel={t('common.cancel')}
        dataConfirm="EDIT"
        confirmText="EDIT"
        busy={busy}
      >
        <p className="u-text-sm u-mt-0">{t('cron.currentLine')}</p>
        <code className="u-mono-input u-pre-wrap u-break-all">{hostOp?.line.raw ?? ''}</code>
        <p className="u-text-sm">{t('cron.nextLine')}</p>
        <code className="u-mono-input u-pre-wrap u-break-all">{hostSavePreview}</code>
      </ConfirmDialog>
      <ConfirmDialog
        open={hostOp?.type === 'disable'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostDisableTitle')}
        description={t('cron.hostDisableDesc', { user: hostOp?.line.user ?? '' })}
        confirmLabel={t('cron.hostDisable')}
        cancelLabel={t('common.cancel')}
        dataConfirm="DISABLE"
        confirmText="DISABLE"
        busy={busy}
      />
      <ConfirmDialog
        open={hostOp?.type === 'enable'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostEnableTitle')}
        description={t('cron.hostEnableDesc', { user: hostOp?.line.user ?? '' })}
        confirmLabel={t('cron.hostEnable')}
        cancelLabel={t('common.cancel')}
        dataConfirm="ENABLE"
        confirmText="ENABLE"
        busy={busy}
      />
      <ConfirmDialog
        open={hostOp?.type === 'run'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostRunTitle')}
        description={t('cron.hostRunDesc', { user: hostOp?.line.user ?? '' })}
        confirmLabel={t('cron.runOnce')}
        cancelLabel={t('common.cancel')}
        dataConfirm="RUN"
        confirmText="RUN"
        busy={busy}
      />
      <ConfirmDialog
        open={hostOp?.type === 'adopt'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostAdoptTitle')}
        description={t('cron.hostAdoptDesc')}
        confirmLabel={t('cron.hostAdopt')}
        cancelLabel={t('common.cancel')}
        dataConfirm="ADOPT"
        confirmText="ADOPT"
        busy={busy}
      />
      <ConfirmDialog
        open={hostOp?.type === 'delete'}
        onClose={() => !busy && setHostOp(null)}
        onConfirm={() => void runHostOp()}
        title={t('cron.hostDeleteTitle')}
        description={t('cron.hostDeleteDesc', { user: hostOp?.line.user ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        dataConfirm={hostOp?.line.command}
        confirmText={hostOp?.line.command}
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
