/**
 * Cron — store jobs vs host crontab honesty.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import {
  buildCronExpr,
  CronScheduleBuilder,
  defaultScheduleState,
  humanizeSchedule,
  parseCronToState,
  type ScheduleState,
} from './CronScheduleBuilder';

const CRON_TABS = ['jobs', 'status', 'about'] as const;

type CronProjectOpt = {
  id: string;
  name: string;
  linuxUser: string;
  homeDir: string;
  runtime: string;
};

/** Suggested cron commands under project home (cwd-aware via cd) */
function projectCommandPresets(p: CronProjectOpt): Array<{ label: string; command: string }> {
  const home = p.homeDir.replace(/\/$/, '') || '/home/ysk';
  const app = `${home}/app`;
  const log = `${home}/logs/cron.log`;
  const common = [
    {
      label: 'cd app + true（測試）',
      command: `cd ${app} && /usr/bin/true`,
    },
    {
      label: '清理暫存（示例）',
      command: `find ${home}/tmp -type f -mtime +7 -delete 2>/dev/null || true`,
    },
  ];
  switch (p.runtime) {
    case 'php':
      return [
        {
          label: 'Laravel schedule:run',
          command: `cd ${app} && /usr/bin/php artisan schedule:run >> ${log} 2>&1`,
        },
        {
          label: 'wp-cron.php',
          command: `cd ${app} && /usr/bin/php wp-cron.php >> ${log} 2>&1`,
        },
        {
          label: 'composer dump-autoload',
          command: `cd ${app} && /usr/bin/composer dump-autoload -o >> ${log} 2>&1`,
        },
        ...common,
      ];
    case 'node':
      return [
        {
          label: 'npm run cron（若有）',
          command: `cd ${app} && /usr/bin/npm run cron >> ${log} 2>&1`,
        },
        {
          label: 'node scripts/cron.js',
          command: `cd ${app} && /usr/bin/node scripts/cron.js >> ${log} 2>&1`,
        },
        ...common,
      ];
    case 'python':
      return [
        {
          label: 'venv + manage.py（Django）',
          command: `cd ${app} && . .venv/bin/activate && python manage.py cron >> ${log} 2>&1`,
        },
        {
          label: 'python scripts/job.py',
          command: `cd ${app} && . .venv/bin/activate 2>/dev/null; python scripts/job.py >> ${log} 2>&1`,
        },
        ...common,
      ];
    case 'go':
    case 'rust':
      return [
        {
          label: '執行 app binary',
          command: `cd ${app} && ./app --cron >> ${log} 2>&1`,
        },
        ...common,
      ];
    case 'static':
      return [
        {
          label: '同步靜態（示例 rsync）',
          command: `rsync -a --delete ${app}/ ${home}/public/ >> ${log} 2>&1`,
        },
        ...common,
      ];
    default:
      return common;
  }
}

function defaultCommandForProject(p: CronProjectOpt): string {
  const presets = projectCommandPresets(p);
  return presets[0]?.command ?? `cd ${p.homeDir}/app && /usr/bin/true`;
}

/** True if command looks like our auto template / placeholder */
function isAutoCommand(cmd: string, projects: CronProjectOpt[]): boolean {
  const t = cmd.trim();
  if (!t || t === '/usr/bin/true') return true;
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
  last_install?: { ok?: boolean; at?: string };
};

type CronStatus = {
  managedPath: string;
  managedLines: number;
  enabledJobs: number;
  totalJobs: number;
  hostHasYskEntries: boolean | null;
  hostCrontabPreview: string;
  executeEnabled: boolean;
  lastInstallOk: boolean | null;
  lastInstallAt: string | null;
};

export function CronPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CronJob[]>([]);
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedState, setSchedState] = useState<ScheduleState>(() => defaultScheduleState());
  const schedule = useMemo(() => buildCronExpr(schedState), [schedState]);
  const scheduleHuman = useMemo(() => humanizeSchedule(schedState), [schedState]);
  const [command, setCommand] = useState('/usr/bin/true');
  /** Only used when no project (系統級工作) */
  const [systemUser, setSystemUser] = useState('ysk');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<CronProjectOpt[]>([]);
  const [needsInstallHint, setNeedsInstallHint] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();

  function openCreate() {
    setError(null);
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
        : `（未有 linux 用戶）· ${p.name}`,
      disabled: !p.linuxUser?.trim(),
      group: '專案用戶' as const,
    }));
    const systemOpts = [
      { value: 's:ysk', label: 'ysk · 面板／系統', group: '系統' as const },
      { value: 's:root', label: 'root · 系統（慎用）', group: '系統' as const },
      { value: 's:www-data', label: 'www-data · Web', group: '系統' as const },
    ];
    const known = new Set(systemOpts.map((o) => o.value));
    if (!projectId && systemUser && !known.has(`s:${systemUser}`)) {
      systemOpts.push({
        value: `s:${systemUser}`,
        label: `${systemUser} · 自訂`,
        group: '系統',
      });
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
    const [r, st, proj] = await Promise.all([
      api.listCron(), // always full list; project is only for create binding
      api.cronStatus().catch(() => null),
      api.listProjects().catch(() => ({ items: [] })),
    ]);
    setItems(r.items as CronJob[]);
    if (st) setStatus(st);
    setProjects(
      (proj.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linuxUser,
        homeDir: p.homeDir,
        runtime: p.runtime,
      })),
    );
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (projectId && !selectedProject?.linuxUser) {
      setError('所選專案沒有 Linux 用戶 — 請先到專案資源建立系統用戶');
      return;
    }
    await run(async () => {
      const r = await api.createCron({
        schedule,
        command,
        user: runAsUser,
        projectId: projectId || undefined,
      });
      setNeedsInstallHint(true);
      setCreateOpen(false);
      await refresh();
      return {
        ok: true,
        notes: [
          projectId
            ? `已綁專案；執行用戶 ${runAsUser}（指令會以 runuser 隔離）`
            : `系統工作；執行用戶 ${runAsUser}`,
          '已寫入管理 crontab（尚未安裝到系統）',
          '請按「安裝到系統 crontab」才會真正生效',
        ],
        ...r,
      } as unknown as OpsResultLike;
    }, '已建立（僅管理檔）');
  }

  async function onInstall() {
    await run(async () => {
      try {
        const r = await api.installCron();
        setNeedsInstallHint(false);
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '已安裝到系統');
  }

  const hostOk = status?.hostHasYskEntries === true;
  const hostNo = status?.hostHasYskEntries === false;

  const [tab, setTab] = usePageTab(CRON_TABS, 'jobs');

  const heroTone = hostOk ? 'ok' : hostNo || needsInstallHint ? 'warn' : 'ok';

  return (
    <FeaturePageLayout
      title={t('nav.cron', { defaultValue: 'Cron' })}
      showCapability={false}
      status={{
        pill: {
          label: hostOk ? '系統已同步' : hostNo ? '未裝到系統' : '狀態未知',
          tone: heroTone,
        },
        items: [
          { label: '工作', value: status?.totalJobs ?? items.length },
          { label: '啟用', value: status?.enabledJobs ?? '—' },
          {
            label: '系統 crontab',
            value: hostOk ? '已同步' : hostNo ? '未安裝' : '未知',
            tone: hostOk ? 'ok' : hostNo ? 'warn' : 'neutral',
          },
          { label: '管理行數', value: status?.managedLines ?? '—' },
          {
            label: 'EXECUTE',
            value: status?.executeEnabled ? '開' : '關',
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            重新整理
          </Button>
          
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void onInstall()}
          >
            安裝到系統
          </Button>
        </ActionBar>
      }
    >
      {error || actErr ? <Alert variant="error">{error ?? actErr}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <div className="ops">
        {needsInstallHint || (status && status.enabledJobs > 0 && hostNo) ? (
          <Alert variant="info">
            工作只寫在管理檔。系統 crontab{' '}
            {hostOk ? '已包含 YSK 項目' : '尚未安裝或無 YSK 項目'}。
            請按「安裝到系統 crontab」。
          </Alert>
        ) : null}

      <PageTabs
        tabs={[
          { id: 'jobs', label: `工作 (${items.length})` },
          { id: 'status', label: '狀態' },
        
          { id: 'about', label: '說明' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'jobs' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">已登記工作 ({items.length})</h3>
                  <p className="ops-panel__sub">
                    管理檔項目 · 改動後需「安裝到系統」才生效
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={openCreate}>
                  + 新增工作
                </Button>
              </header>
              {items.length === 0 ? (
                <EmptyState
                  title="尚未有 cron"
                  description="用列表右上角新增工作，再安裝到系統 crontab"
                />
              ) : (
                <div className="ops-svc-list">
                  {items.map((job) => {
                    const installed = job.last_install?.ok === true;
                    const tone =
                      job.enabled === false
                        ? 'warn'
                        : installed
                          ? 'ok'
                          : 'warn';
                    return (
                      <article
                        key={job.id}
                        className={`ops-svc ops-svc--${tone}`}
                      >
                        <div className="ops-svc__body">
                          <div className="ops-svc__head">
                            <h4 className="ops-svc__name">
                              {job.schedule
                                ? humanizeSchedule(
                                    parseCronToState(String(job.schedule)),
                                  )
                                : '—'}
                            </h4>
                            <Badge
                              tone={job.enabled === false ? 'neutral' : 'ok'}
                            >
                              {job.enabled === false ? '已停用' : '已啟用'}
                            </Badge>
                            {job.last_install?.ok != null ? (
                              <Badge
                                tone={job.last_install.ok ? 'ok' : 'warn'}
                              >
                                {job.last_install.ok ? '曾安裝' : '安裝失敗'}
                              </Badge>
                            ) : (
                              <Badge tone="warn">僅管理檔</Badge>
                            )}
                          </div>
                          <div className="ops-svc__meta">
                            <code>{job.schedule}</code>
                            <span>
                              用戶 <code>{job.user ?? '—'}</code>
                            </span>
                            {job.projectId || job.project_id ? (
                              <span>
                                專案{' '}
                                {projects.find(
                                  (p) =>
                                    p.id === (job.projectId ?? job.project_id),
                                )?.name ??
                                  job.projectId ??
                                  job.project_id}
                              </span>
                            ) : (
                              <span className="muted">系統級</span>
                            )}
                          </div>
                          <p className="ops-svc__cmd">{job.command}</p>
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
                              }, '已執行一次')
                            }
                          >
                            立即執行
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.requestRaw(`/api/v1/cron/${job.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    enabled: job.enabled === false,
                                  }),
                                });
                                setNeedsInstallHint(true);
                                await refresh();
                                return {
                                  ok: true,
                                  notes: [
                                    '已更新管理檔；請重新安裝到系統 crontab',
                                  ],
                                };
                              }, '已更新管理檔')
                            }
                          >
                            {job.enabled === false ? '啟用' : '停用'}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.requestRaw(`/api/v1/cron/${job.id}`, {
                                  method: 'DELETE',
                                });
                                setNeedsInstallHint(true);
                                await refresh();
                                return {
                                  ok: true,
                                  notes: [
                                    '已從管理檔刪除；請重新安裝同步系統',
                                  ],
                                };
                              }, '已刪除')
                            }
                          >
                            刪除
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}
        {tab === 'status' ? (
          <div className="tab-panel">
            <div className="ops-grid">
              <section className="ops-panel">
                <header className="ops-panel__head">
                  <div>
                    <h3 className="ops-panel__title">安裝狀態</h3>
                    <p className="ops-panel__sub">管理檔 vs 主機</p>
                  </div>
                </header>
                <dl className="ops-dl">
                  <div>
                    <dt>管理檔</dt>
                    <dd>
                      <code className="ops-svc__cmd">{status?.managedPath ?? '—'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>行數</dt>
                    <dd>{status?.managedLines ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>主機 YSK</dt>
                    <dd>
                      <Badge
                        tone={
                          status?.hostHasYskEntries
                            ? 'ok'
                            : status?.hostHasYskEntries === false
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {status?.hostHasYskEntries == null
                          ? '—'
                          : status.hostHasYskEntries
                            ? '有'
                            : '無'}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>上次安裝</dt>
                    <dd>
                      {status?.lastInstallAt
                        ? `${status.lastInstallOk ? '成功' : '失敗'} · ${new Date(status.lastInstallAt).toLocaleString('zh-TW')}`
                        : '尚未'}
                    </dd>
                  </div>
                </dl>
                <div className="ops-panel__actions">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => void onInstall()}
                  >
                    安裝到系統 crontab
                  </Button>
                </div>
                <p className="ops-footnote">
                  建立／啟用／停用只改管理檔；必須安裝後系統才會執行。
                </p>
              </section>
              <section className="ops-panel">
                <header className="ops-panel__head">
                  <h3 className="ops-panel__title">主機 crontab 預覽</h3>
                </header>
                {status?.hostCrontabPreview ? (
                  <pre className="ops-pre">{status.hostCrontabPreview}</pre>
                ) : (
                  <p className="ops-muted">無法讀取或尚未安裝（需權限）</p>
                )}
              </section>
            </div>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="cron" /> : null}
      </PageTabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新增工作"
        description="寫入管理檔；需「安裝到系統」後 crontab 才會執行"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="cron-create"
              variant="primary"
              size="md"
              loading={busy}
            >
              建立（僅管理檔）
            </Button>
          </>
        }
      >
        <form
          id="cron-create"
          className="feature-form"
          onSubmit={(e) => void onCreate(e)}
        >
          <Field
            label="何時執行"
            htmlFor="cron-sched-builder"
            flush
            fullWidth
            required
            hint="用下方卡片揀頻率與時間；進階模式可手寫 crontab"
          >
            <div id="cron-sched-builder">
              <CronScheduleBuilder value={schedState} onChange={setSchedState} />
            </div>
          </Field>

          <FormLayout columns={2}>
            <Field
              label="專案"
              htmlFor="cron-pid"
              flush
              required
              hint="用戶 + 指令路徑會跟專案 home／runtime 更新"
            >
              <select
                id="cron-pid"
                value={projectId}
                onChange={(e) => onProjectChange(e.target.value)}
              >
                <option value="">— 請選擇專案 —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.runtime} · {p.linuxUser || '（未有 linux 用戶）'}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="執行用戶"
              htmlFor="cron-user"
              flush
              required
              hint="揀專案用戶會同步上方專案；揀系統用戶則為系統級 cron"
            >
              <select
                id="cron-user"
                value={runUserSelectValue}
                onChange={(e) => onRunUserChange(e.target.value)}
              >
                <optgroup label="專案用戶">
                  {runUserOptions.projectOpts.length === 0 ? (
                    <option value="__none_proj" disabled>
                      （尚未有專案）
                    </option>
                  ) : (
                    runUserOptions.projectOpts.map((o) => (
                      <option key={o.value} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </option>
                    ))
                  )}
                </optgroup>
                <optgroup label="系統">
                  {runUserOptions.systemOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field
              label="指令"
              htmlFor="cron-cmd"
              fullWidth
              flush
              required
              hint={
                selectedProject
                  ? `在專案 home 下執行（${selectedProject.homeDir}）；儲存時會包 runuser`
                  : '建議絕對路徑'
              }
            >
              <input
                id="cron-cmd"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
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
          {selectedProject && commandPresets.length > 0 ? (
            <div className="cron-cmd-presets">
              <span className="cron-cmd-presets__label">
                常用指令（{selectedProject.runtime}）
              </span>
              <div className="cron-cmd-presets__row">
                {commandPresets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn btn--sm${command === p.command ? ' btn--secondary' : ' btn--ghost'}`}
                    onClick={() => setCommand(p.command)}
                    title={p.command}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {selectedProject ? (
            <div className="cron-sched__preview" style={{ maxWidth: '100%' }}>
              <div className="cron-sched__preview-human">
                <span className="cron-sched__preview-label">
                  實際寫入 crontab（預覽）
                </span>
                <code
                  className="u-text-sm u-break-all"
                  style={{ fontWeight: 500 }}
                >
                  {wrappedPreview}
                </code>
              </div>
            </div>
          ) : null}
          {projects.length === 0 ? (
            <EmptyState
              title="尚未有專案"
              description="請先建立專案並（建議）建立系統用戶，再登記 cron"
            />
          ) : null}
          {selectedProject && !selectedProject.linuxUser ? (
            <Alert variant="error">
              此專案未有 Linux 用戶名 — 請到專案「資源」建立系統用戶後再試。
            </Alert>
          ) : null}
          <p className="form-hint u-mb-0">
            建立後：<strong>{scheduleHuman}</strong>
            {' · '}
            <code className="inline">{schedule}</code>
            {' · 用戶 '}
            <code className="inline">{runAsUser}</code>
            {selectedProject ? (
              <span className="muted">（專案 {selectedProject.name}）</span>
            ) : (
              <span className="muted">（系統級，未綁專案）</span>
            )}
          </p>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
