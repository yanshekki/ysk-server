/**
 * Cron — store jobs vs host crontab honesty.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  OpsResultPanel,
  SummaryStrip,
  Tabs,
  FormActions,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';

const CRON_TABS = ['status', 'jobs', 'create'] as const;
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';

const SCHEDULE_PRESETS = [
  { label: '每日 03:00', value: '0 3 * * *' },
  { label: '每小時', value: '0 * * * *' },
  { label: '每 5 分鐘', value: '*/5 * * * *' },
  { label: '每週日 04:00', value: '0 4 * * 0' },
] as const;

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
  const [items, setItems] = useState<CronJob[]>([]);
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [command, setCommand] = useState('/usr/bin/true');
  const [user, setUser] = useState('ysk');
  const [projectId, setProjectId] = useState('');
  const [needsInstallHint, setNeedsInstallHint] = useState(false);
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();

  const refresh = useCallback(async () => {
    const [r, st] = await Promise.all([
      api.listCron(projectId || undefined),
      api.cronStatus().catch(() => null),
    ]);
    setItems(r.items as CronJob[]);
    if (st) setStatus(st);
  }, [projectId]);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    await run(async () => {
      const r = await api.createCron({
        schedule,
        command,
        user,
        projectId: projectId || undefined,
      });
      setNeedsInstallHint(true);
      await refresh();
      return {
        ok: true,
        notes: [
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

  return (
    <FeaturePageLayout
      title="Cron 工作"
      subtitle="管理檔與系統 crontab 分開顯示"
      actions={
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() => void refresh().catch((e: Error) => setError(e.message))}
        >
          重新整理
        </Button>
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

      {needsInstallHint || (status && status.enabledJobs > 0 && hostNo) ? (
        <Alert variant="info">
          工作只寫在管理檔。系統 crontab{' '}
          {hostOk ? '已包含 YSK 項目' : '尚未安裝或無 YSK 項目'}。
          請用下方「安裝到系統 crontab」。
        </Alert>
      ) : null}

      <SummaryStrip
        items={[
          { label: '登記工作', value: String(status?.totalJobs ?? items.length) },
          { label: '已啟用', value: String(status?.enabledJobs ?? '—') },
          {
            label: '系統 crontab',
            value: hostOk ? '已同步' : hostNo ? '未安裝' : '未知',
            tone: hostOk ? 'ok' : hostNo ? 'warn' : 'default',
          },
          {
            label: '系統變更',
            value: status?.executeEnabled ? '已開啟' : '未開啟',
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
        ]}
      />

      <Tabs
        tabs={[
          { id: 'jobs', label: '工作' },
          { id: 'create', label: '新增' },
          { id: 'status', label: '狀態' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'jobs' ? (
          <div className="tab-panel">
      <Card>
        <CardSection title={`已登記工作 (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState title="尚未有 cron" description="先建立一筆工作" />
          ) : (
            <div className="list-panel">
              {items.map((job) => (
                <div key={job.id} className="list-row list-row--static">
                  <div className="list-row__main">
                    <div className="list-row__title">
                      <code className="inline">{job.schedule}</code>
                      <Badge tone={job.enabled === false ? 'neutral' : 'ok'}>
                        {job.enabled === false ? '已停用' : '已啟用'}
                      </Badge>
                      {job.last_install?.ok != null ? (
                        <Badge tone={job.last_install.ok ? 'ok' : 'warn'}>
                          {job.last_install.ok ? '曾安裝' : '安裝失敗'}
                        </Badge>
                      ) : (
                        <Badge tone="warn">僅管理檔</Badge>
                      )}
                    </div>
                    <div className="list-row__meta">
                      <span>{job.command}</span>
                      <span>user={job.user ?? '—'}</span>
                      {job.projectId || job.project_id ? (
                        <span>project={job.projectId ?? job.project_id}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="list-row__side btn-row">
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
                            body: JSON.stringify({ enabled: job.enabled === false }),
                          });
                          setNeedsInstallHint(true);
                          await refresh();
                          return {
                            ok: true,
                            notes: ['已更新管理檔；請重新安裝到系統 crontab'],
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
                          await api.requestRaw(`/api/v1/cron/${job.id}`, { method: 'DELETE' });
                          setNeedsInstallHint(true);
                          await refresh();
                          return {
                            ok: true,
                            notes: ['已從管理檔刪除；請重新安裝同步系統'],
                          };
                        }, '已刪除')
                      }
                    >
                      刪除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>
          </div>
        ) : null}
        {tab === 'create' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="新增工作"
                description="寫入管理檔；需再到「狀態」安裝後系統才會執行"
              >
                <form className="feature-form" onSubmit={(e) => void onCreate(e)}>
                  <FormLayout columns={2}>
                    <Field
                      label="排程"
                      htmlFor="cron-sched"
                      hint="標準五欄：分 時 日 月 週"
                      flush
                      required
                    >
                      <input
                        id="cron-sched"
                        value={schedule}
                        onChange={(e) => setSchedule(e.target.value)}
                        required
                        placeholder="0 3 * * *"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="執行用戶"
                      htmlFor="cron-user"
                      hint="記錄用；實際安裝以程序用戶為準"
                      flush
                    >
                      <input
                        id="cron-user"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        placeholder="ysk"
                      />
                    </Field>
                    <Field
                      label="指令"
                      htmlFor="cron-cmd"
                      fullWidth
                      flush
                      required
                      hint="建議用絕對路徑，例如 /usr/bin/php /var/www/app/artisan schedule:run"
                    >
                      <input
                        id="cron-cmd"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        required
                        placeholder="/usr/bin/true"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="專案 ID"
                      htmlFor="cron-pid"
                      flush
                      hint="可選；用於列表過濾"
                    >
                      <input
                        id="cron-pid"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        placeholder="（可留空）"
                      />
                    </Field>
                  </FormLayout>
                  <div className="form-hint" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem' }}>
                    <span>常用排程：</span>
                    {SCHEDULE_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setSchedule(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <FormActions>
                    <Button type="submit" variant="primary" size="md" loading={busy}>
                      建立（僅管理檔）
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => setTab('status')}
                    >
                      前往安裝
                    </Button>
                  </FormActions>
                </form>
              </CardSection>
            </Card>
          </div>
        ) : null}
        {tab === 'status' ? (
          <div className="tab-panel">
      <Card>
        <CardSection title="安裝狀態" description="誠實對照管理檔 vs 主機">
          <DescriptionList
            columns={2}
            items={[
              { label: '管理檔', value: status?.managedPath ?? '—' },
              { label: '管理檔行數', value: String(status?.managedLines ?? '—') },
              {
                label: '主機有 YSK 項',
                value:
                  status?.hostHasYskEntries == null
                    ? '—'
                    : status.hostHasYskEntries
                      ? '是'
                      : '否',
              },
              {
                label: '上次安裝',
                value: status?.lastInstallAt
                  ? `${status.lastInstallOk ? '成功' : '失敗'} · ${new Date(status.lastInstallAt).toLocaleString()}`
                  : '尚未',
              },
            ]}
          />
          <div className="lifecycle-toolbar u-mt-3">
            <Button variant="primary" size="md" loading={busy} onClick={() => void onInstall()}>
              安裝到系統 crontab
            </Button>
          </div>
          <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
            建立／啟用／停用只改管理檔；必須安裝後系統才會執行。
          </p>
        </CardSection>
      </Card>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
