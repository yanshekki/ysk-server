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
  FormGrid,
  OpsResultPanel,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';

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

      <Card>
        <CardSection title="新增工作" description="標準 cron 五欄語法">
          <form className="feature-form" onSubmit={(e) => void onCreate(e)}>
            <FormGrid>
              <Field label="排程" techKey="schedule" htmlFor="cron-sched" hint="例如 0 3 * * *">
                <input
                  id="cron-sched"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  required
                />
              </Field>
              <Field label="執行用戶" techKey="user" htmlFor="cron-user" hint="記錄用；安裝用目前程序用戶">
                <input id="cron-user" value={user} onChange={(e) => setUser(e.target.value)} />
              </Field>
              <Field label="專案 ID" techKey="project_id" htmlFor="cron-pid" hint="可選過濾">
                <input
                  id="cron-pid"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="指令" techKey="command" htmlFor="cron-cmd">
              <input
                id="cron-cmd"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                required
              />
            </Field>
            <div className="form-actions btn-row">
              <Button type="submit" variant="primary" size="md" loading={busy}>
                建立（管理檔）
              </Button>
            </div>
          </form>
        </CardSection>
      </Card>

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

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
