/**
 * Server-wide backups — list / run-all / restore / delete (honest ok).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  OpsResultPanel,
  Tabs,
  FormActions,
  SegRadio,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

const BK_TABS = ['files', 'ops', 'remote'] as const;

type BackupItem = {
  projectId: string;
  name: string;
  path: string;
  bytes: number;
  mtime: string;
};

type RemoteSettings = {
  enabled: boolean;
  kind: 'sftp' | 'local' | 's3';
  host?: string;
  port?: number;
  username?: string;
  path?: string;
  password?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
};

type ResticSettings = {
  enabled: boolean;
  repoPath?: string;
  password?: string;
  s3Repo?: string;
};

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPage() {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null);
  const [liveProjectCount, setLiveProjectCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [restoreMode, setRestoreMode] = useState<'full' | 'web' | 'dry-run'>('full');
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [remote, setRemote] = useState<RemoteSettings>({
    enabled: false,
    kind: 'sftp',
    port: 22,
    path: '/backups/ysk',
  });
  const [restic, setRestic] = useState<ResticSettings>({ enabled: false });
  /** true when server already has a password (masked as ***) */
  const [resticPasswordSet, setResticPasswordSet] = useState(false);
  const [exclusionsText, setExclusionsText] = useState(
    'node_modules\n.git\nvendor\n.cache',
  );
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Array<{ id: string; time?: string; tags?: string[]; paths?: string[] }>
  >([]);
  const [restoreProjectId, setRestoreProjectId] = useState('');
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();

  const refresh = useCallback(async () => {
    const [r, s, proj] = await Promise.all([
      api.requestRaw<{
        items: BackupItem[];
        lastRun?: Record<string, unknown> | null;
      }>('/api/v1/backups'),
      api.requestRaw<{
        remote?: RemoteSettings;
        exclusions?: string[];
        restic?: ResticSettings;
      }>('/api/v1/backups/settings'),
      api.listProjects().catch(() => ({ items: [] })),
    ]);
    setItems(r.items ?? []);
    setLastRun(r.lastRun ?? null);
    setLiveProjectCount(proj.items?.length ?? 0);
    if (s.remote) {
      const kind =
        s.remote.kind === 'local' || s.remote.kind === 's3' ? s.remote.kind : 'sftp';
      setRemote({
        enabled: Boolean(s.remote.enabled),
        kind,
        host: s.remote.host ?? '',
        port: s.remote.port ?? 22,
        username: s.remote.username ?? '',
        path: s.remote.path ?? '/backups/ysk',
        password: s.remote.password === '***' ? '' : (s.remote.password ?? ''),
        s3Bucket: s.remote.s3Bucket ?? '',
        s3Region: s.remote.s3Region ?? 'us-east-1',
        s3Endpoint: s.remote.s3Endpoint ?? '',
        awsAccessKeyId: s.remote.awsAccessKeyId ?? '',
        awsSecretAccessKey:
          s.remote.awsSecretAccessKey === '***' ? '' : (s.remote.awsSecretAccessKey ?? ''),
      });
    }
    if (s.restic) {
      const hasPw =
        s.restic.password === '***' ||
        Boolean(s.restic.password && s.restic.password !== '***');
      setResticPasswordSet(hasPw);
      setRestic({
        enabled: Boolean(s.restic.enabled),
        repoPath: s.restic.repoPath ?? '',
        password: s.restic.password === '***' ? '' : (s.restic.password ?? ''),
        s3Repo: s.restic.s3Repo ?? '',
      });
    }
    if (s.exclusions?.length) {
      setExclusionsText(s.exclusions.join('\n'));
    }
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  async function saveSettings() {
    setSettingsBusy(true);
    setError(null);
    try {
      const exclusions = exclusionsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        remote: {
          enabled: remote.enabled,
          kind: remote.kind,
          host: remote.host || undefined,
          port: Number(remote.port) || 22,
          username: remote.username || undefined,
          path: remote.path || undefined,
          s3Bucket: remote.s3Bucket || undefined,
          s3Region: remote.s3Region || undefined,
          s3Endpoint: remote.s3Endpoint || undefined,
          awsAccessKeyId: remote.awsAccessKeyId || undefined,
          ...(remote.password ? { password: remote.password } : {}),
          ...(remote.awsSecretAccessKey
            ? { awsSecretAccessKey: remote.awsSecretAccessKey }
            : {}),
        },
        exclusions,
        restic: {
          enabled: restic.enabled,
          repoPath: restic.repoPath || undefined,
          s3Repo: restic.s3Repo || undefined,
          ...(restic.password ? { password: restic.password } : {}),
        },
      };
      await api.requestRaw('/api/v1/backups/settings', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg('已儲存備份設定');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSettingsBusy(false);
    }
  }

  const lastOk = lastRun?.ok;
  /** Unique project ids that have archives — not live hosting project count */
  const archiveProjectCount = new Set(items.map((i) => i.projectId)).size;
  const lastResults = Array.isArray(lastRun?.results)
    ? (lastRun!.results as Array<{
        projectId?: string;
        ok?: boolean;
        skipped?: boolean;
        notes?: string[];
        archivePath?: string;
      }>)
    : [];
  const sideResults = Array.isArray(lastRun?.sideResults)
    ? (lastRun!.sideResults as Array<{
        projectId?: string;
        kind?: string;
        ok?: boolean;
        skipped?: boolean;
        notes?: string[];
      }>)
    : [];

  const [tab, setTab] = usePageTab(BK_TABS, 'files');

  async function downloadBackup(b: BackupItem) {
    setError(null);
    try {
      const q = new URLSearchParams({ projectId: b.projectId, name: b.name });
      await api.downloadAuthenticated(`/api/v1/backups/download?${q}`, b.name);
      setMsg(`已開始下載 ${b.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下載失敗');
    }
  }

  const lastLabel =
    lastOk === true
      ? lastRun?.empty
        ? '無事可做'
        : lastRun?.sideOk === false
          ? 'tar OK／副步驟有問題'
          : '成功'
      : lastOk === false
        ? '有失敗'
        : '尚未';
  const lastTone =
    lastOk === true
      ? lastRun?.sideOk === false
        ? 'warn'
        : 'ok'
      : lastOk === false
        ? 'danger'
        : 'ok';
  const resticLabel = restic.enabled
    ? resticPasswordSet || restic.password
      ? '已啟用'
      : '缺 password'
    : '關閉';
  const resticTone = restic.enabled
    ? resticPasswordSet || restic.password
      ? 'ok'
      : 'warn'
    : 'neutral';
  const heroTone =
    lastOk === false || (restic.enabled && !(resticPasswordSet || restic.password))
      ? 'warn'
      : 'ok';

  return (
    <FeaturePageLayout
      title="備份"
      subtitle="專案 tar · 還原 · 遠端 / restic · 誠實結果"
      showCapability={false}
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            重新整理
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            onClick={() => setTab('ops')}
          >
            操作
          </Button>
        </>
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
        <section className={`ops-hero ops-hero--${heroTone}`}>
          <div className="ops-hero__main">
            <div className="ops-hero__copy">
              <div className="ops-hero__eyebrow">Backups</div>
              <h2 className="ops-hero__title">
                <span className={`ops-hero__pill ops-hero__pill--${lastTone === 'danger' ? 'danger' : lastTone === 'warn' ? 'warn' : 'ok'}`}>
                  上次 {lastLabel}
                </span>
                專案備份中心
              </h2>
              <p className="ops-hero__hint">
                tar 歸檔於管理目錄；還原可 dry-run／web／完整。遠端與 restic
                為可選。written／上傳失敗會誠實標示，唔會假成功。
              </p>
              <div className="ops-hero__meta">
                <span>
                  檔案 <strong>{items.length}</strong>
                </span>
                <span className="ops-hero__dot" />
                <span>
                  面板專案 <strong>{liveProjectCount}</strong>
                </span>
                <span className="ops-hero__dot" />
                <span>
                  有備份專案 <strong>{archiveProjectCount}</strong>
                </span>
                <span className="ops-hero__dot" />
                <span>
                  restic <strong>{resticLabel}</strong>
                </span>
              </div>
              <div className="ops-hero__cta">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setTab('ops')}
                >
                  備份／還原操作
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setTab('files')}
                >
                  瀏覽備份檔
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setTab('remote')}
                >
                  遠端設定
                </Button>
              </div>
            </div>
            <div className="ops-hero__stats">
              <div className="ops-stat">
                <span className="ops-stat__lab">備份檔</span>
                <span className="ops-stat__val">{items.length}</span>
              </div>
              <div className="ops-stat">
                <span className="ops-stat__lab">專案</span>
                <span className="ops-stat__val">{liveProjectCount}</span>
              </div>
              <div className="ops-stat">
                <span className="ops-stat__lab">上次全部</span>
                <span className="ops-stat__val">
                  <Badge
                    tone={
                      lastTone === 'danger'
                        ? 'danger'
                        : lastTone === 'warn'
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {lastLabel}
                  </Badge>
                </span>
              </div>
              <div className="ops-stat">
                <span className="ops-stat__lab">restic</span>
                <span className="ops-stat__val">
                  <Badge tone={resticTone as 'ok' | 'warn' | 'neutral'}>
                    {resticLabel}
                  </Badge>
                </span>
              </div>
            </div>
          </div>
          <ul className="ops-rail">
            <li>
              <span className="ops-rail__k">遠端</span>
              <Badge tone={remote.enabled ? 'ok' : 'neutral'}>
                {remote.enabled ? remote.kind : '關閉'}
              </Badge>
            </li>
            <li>
              <span className="ops-rail__k">有備份專案</span>
              <span className="ops-rail__text">{archiveProjectCount}</span>
            </li>
          </ul>
        </section>

      <Tabs
        tabs={[
          { id: 'files', label: '備份檔', badge: items.length || undefined },
          { id: 'ops', label: '操作' },
          { id: 'remote', label: '遠端 / 排除' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'files' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">備份檔案 ({items.length})</h3>
                  <p className="ops-panel__sub">
                    管理目錄 tar · 下載需登入 · 還原有 dry-run／web／完整
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setTab('ops')}>
                  全部備份
                </Button>
              </header>
          {items.length === 0 ? (
            <EmptyState
              title="尚無備份"
              description="執行「備份所有專案」或於專案詳情 Backup"
              action={
                <Button variant="primary" size="md" onClick={() => setTab('ops')}>
                  去操作
                </Button>
              }
            />
          ) : (
            <div className="ops-svc-list">
                  {items.map((b) => (
                    <article key={`${b.projectId}:${b.name}`} className="ops-svc ops-svc--ok">
                      <div className="ops-svc__body">
                        <div className="ops-svc__head">
                          <h4 className="ops-svc__name">{b.name}</h4>
                          <Badge tone="neutral">{formatBytes(b.bytes)}</Badge>
                        </div>
                        <div className="ops-svc__meta">
                          <span>
                            專案 <code>{b.projectId.slice(0, 10)}…</code>
                          </span>
                          <span>
                            {b.mtime
                              ? new Date(b.mtime).toLocaleString('zh-TW')
                              : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="ops-svc__actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void downloadBackup(b)}
                          >
                            下載
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              setRestoreMode('dry-run');
                              setRestoreTarget(b);
                            }}
                          >
                            預覽
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              setRestoreMode('web');
                              setRestoreTarget(b);
                            }}
                          >
                            還原 web
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              setRestoreMode('full');
                              setRestoreTarget(b);
                            }}
                          >
                            完整還原
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() => setDeleteTarget(b)}
                          >
                            刪除
                          </Button>
                      </div>
                    </article>
                  ))}
            </div>
          )}
            </section>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel">
      <section className="ops-panel">
        <header className="ops-panel__head">
          <div>
            <h3 className="ops-panel__title">操作</h3>
            <p className="ops-panel__sub">
              0 個專案或全部略過 = 成功；真正有試過備而失敗先算失敗
            </p>
          </div>
        </header>
          <div className="lifecycle-toolbar">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    const r = (await api.requestRaw('/api/v1/backups/run-all', {
                      method: 'POST',
                    })) as OpsResultLike & {
                      results?: Array<{
                        projectId?: string;
                        ok?: boolean;
                        skipped?: boolean;
                        notes?: string[];
                      }>;
                      empty?: boolean;
                    };
                    await refresh();
                    const extra =
                      r.empty
                        ? '（沒有專案）'
                        : Array.isArray(r.results)
                          ? ` · ${r.results.filter((x) => x.ok && !x.skipped).length}/${r.results.filter((x) => !x.skipped).length} 成功`
                          : '';
                    return {
                      ...r,
                      notes: [
                        ...(r.notes ?? []),
                        extra ? `摘要${extra}` : '',
                      ].filter(Boolean),
                    };
                  } catch (e) {
                    const m = e instanceof Error ? e.message : '備份失敗';
                    return { ok: false, notes: [m], blockMessage: m };
                  }
                }, '備份完成')
              }
            >
              備份所有專案
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = (await api.requestRaw('/api/v1/backups/schedule', {
                    method: 'POST',
                    body: JSON.stringify({ schedule: '0 3 * * *' }),
                  })) as OpsResultLike;
                  return {
                    ...r,
                    notes: [
                      ...(r.notes ?? []),
                      '指令：ysk-server backup all --data-dir …',
                      '記得到「Cron」頁安裝到系統 crontab 才會真正跑',
                    ],
                  };
                }, '已登記每日 03:00 排程')
              }
            >
              登記每日排程
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!restic.enabled}
              title={
                !restic.enabled
                  ? '請先在「遠端／排除」啟用 restic 並設定 password'
                  : undefined
              }
              onClick={() =>
                void run(async () => {
                  try {
                    return (await api.requestRaw('/api/v1/backups/restic/run', {
                      method: 'POST',
                      body: '{}',
                    })) as OpsResultLike;
                  } catch (e) {
                    const m = e instanceof Error ? e.message : 'restic 失敗';
                    return { ok: false, notes: [m], blockMessage: m };
                  }
                }, 'restic 增量完成')
              }
            >
              只跑 restic 增量
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => {
                void api
                  .requestRaw<{
                    ok?: boolean;
                    snapshots?: Array<{
                      id: string;
                      time?: string;
                      tags?: string[];
                      paths?: string[];
                    }>;
                    notes?: string[];
                  }>(
                    `/api/v1/backups/restic/snapshots${
                      restoreProjectId
                        ? `?projectId=${encodeURIComponent(restoreProjectId)}`
                        : ''
                    }`,
                  )
                  .then((r) => {
                    setSnapshots(r.snapshots ?? []);
                    setMsg(r.notes?.join('；') ?? `snapshots ${r.snapshots?.length ?? 0}`);
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              列出 restic snapshots
            </Button>
          </div>

          {lastRun ? (
            <div className="u-mt-4">
              <h4 className="u-mb-2" style={{ marginTop: 0 }}>
                上次全部備份明細
              </h4>
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: '時間',
                    value: lastRun.at
                      ? new Date(String(lastRun.at)).toLocaleString()
                      : '—',
                  },
                  {
                    label: '結果',
                    value:
                      lastOk === true
                        ? lastRun.empty
                          ? '無事可做（0 專案）'
                          : '成功'
                        : lastOk === false
                          ? '有失敗'
                          : '—',
                  },
                  {
                    label: '備註',
                    value: Array.isArray(lastRun.notes)
                      ? (lastRun.notes as string[]).join('；')
                      : '—',
                  },
                ]}
              />
              {lastResults.length > 0 ? (
                <div className="table-wrap u-mt-3">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>專案</th>
                        <th>狀態</th>
                        <th>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastResults.map((row, i) => (
                        <tr key={`${row.projectId ?? i}`}>
                          <td>
                            <code className="inline">
                              {(row.projectId ?? '—').slice(0, 8)}
                              {(row.projectId?.length ?? 0) > 8 ? '…' : ''}
                            </code>
                          </td>
                          <td>
                            {row.skipped ? (
                              <Badge tone="neutral">略過</Badge>
                            ) : row.ok ? (
                              <Badge tone="ok">成功</Badge>
                            ) : (
                              <Badge tone="danger">失敗</Badge>
                            )}
                          </td>
                          <td className="muted u-text-sm">
                            {(row.notes ?? []).join('；') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted u-text-sm u-mt-2">
                  {lastRun.empty
                    ? '上次沒有專案需要備份。'
                    : '沒有 per-project results。'}
                </p>
              )}
              {sideResults.length > 0 ? (
                <div className="table-wrap u-mt-3">
                  <h4 className="u-mb-2">遠端／restic 副步驟</h4>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>專案</th>
                        <th>步驟</th>
                        <th>狀態</th>
                        <th>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sideResults.map((row, i) => (
                        <tr key={`side-${row.projectId ?? i}-${row.kind ?? i}`}>
                          <td>
                            <code className="inline">
                              {(row.projectId ?? '—').slice(0, 8)}
                              {(row.projectId?.length ?? 0) > 8 ? '…' : ''}
                            </code>
                          </td>
                          <td>{row.kind === 'restic' ? 'restic' : '遠端'}</td>
                          <td>
                            {row.skipped ? (
                              <Badge tone="neutral">略過</Badge>
                            ) : row.ok ? (
                              <Badge tone="ok">成功</Badge>
                            ) : (
                              <Badge tone="danger">失敗</Badge>
                            )}
                          </td>
                          <td className="muted u-text-sm">
                            {(row.notes ?? []).slice(0, 3).join('；') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {snapshots.length > 0 ? (
            <div className="u-mt-4">
              <Field label="還原用 projectId（可空=全部 list）" htmlFor="rs-pid" flush>
                <input
                  id="rs-pid"
                  value={restoreProjectId}
                  onChange={(e) => setRestoreProjectId(e.target.value)}
                  placeholder="uuid"
                />
              </Field>
              <div className="table-wrap u-mt-2">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Snapshot</th>
                      <th>時間</th>
                      <th>Tags</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <code className="inline">{s.id}</code>
                        </td>
                        <td className="muted">
                          {s.time ? new Date(s.time).toLocaleString() : '—'}
                        </td>
                        <td className="muted u-text-sm">{(s.tags ?? []).join(', ') || '—'}</td>
                        <td>
                          <div className="btn-row">
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                const pid =
                                  restoreProjectId ||
                                  (s.tags ?? [])
                                    .find((t) => t.startsWith('project:'))
                                    ?.replace('project:', '') ||
                                  '';
                                if (!pid) {
                                  setError('請填 projectId 或 snapshot 需有 project: tag');
                                  return;
                                }
                                void run(async () => {
                                  return (await api.requestRaw(
                                    '/api/v1/backups/restic/restore',
                                    {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        projectId: pid,
                                        snapshotId: s.id,
                                        dryRun: true,
                                      }),
                                    },
                                  )) as OpsResultLike;
                                }, 'dry-run 完成（未寫檔）');
                              }}
                            >
                              預覽
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                const pid =
                                  restoreProjectId ||
                                  (s.tags ?? [])
                                    .find((t) => t.startsWith('project:'))
                                    ?.replace('project:', '') ||
                                  '';
                                if (!pid) {
                                  setError('請填 projectId 或 snapshot 需有 project: tag');
                                  return;
                                }
                                if (
                                  !confirm(
                                    `還原 ${s.id} 到專案 ${pid.slice(0, 8)}… 的 .restic-restore-* 目錄？`,
                                  )
                                ) {
                                  return;
                                }
                                void run(async () => {
                                  return (await api.requestRaw(
                                    '/api/v1/backups/restic/restore',
                                    {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        projectId: pid,
                                        snapshotId: s.id,
                                        overwriteHome: false,
                                      }),
                                    },
                                  )) as OpsResultLike;
                                }, 'restic 還原完成');
                              }}
                            >
                              安全目錄
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                const pid =
                                  restoreProjectId ||
                                  (s.tags ?? [])
                                    .find((t) => t.startsWith('project:'))
                                    ?.replace('project:', '') ||
                                  '';
                                if (!pid) {
                                  setError('請填 projectId 或 snapshot 需有 project: tag');
                                  return;
                                }
                                if (
                                  !confirm(
                                    `危險：將覆寫專案 ${pid.slice(0, 8)}… 的 home 目錄！\n先確認已備份。`,
                                  )
                                ) {
                                  return;
                                }
                                const phrase = window.prompt(
                                  '請輸入 OVERWRITE 以確認覆寫 home',
                                  '',
                                );
                                if (phrase !== 'OVERWRITE') {
                                  setError('未輸入 OVERWRITE — 已取消');
                                  return;
                                }
                                void run(async () => {
                                  return (await api.requestRaw(
                                    '/api/v1/backups/restic/restore',
                                    {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        projectId: pid,
                                        snapshotId: s.id,
                                        overwriteHome: true,
                                        confirmPhrase: 'OVERWRITE',
                                      }),
                                    },
                                  )) as OpsResultLike;
                                }, 'restic 覆寫 home 完成');
                              }}
                            >
                              覆寫 home
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {lastRun ? (
            <div className="u-mt-4">
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: '結果',
                    value: (
                      <Badge tone={lastRun.ok ? 'ok' : 'warn'}>
                        {lastRun.ok ? '全部成功' : '有失敗／略過'}
                      </Badge>
                    ),
                  },
                  {
                    label: '時間',
                    value: lastRun.at
                      ? new Date(String(lastRun.at)).toLocaleString()
                      : '—',
                  },
                  ...(Array.isArray(lastRun.notes)
                    ? (lastRun.notes as string[]).slice(0, 4).map((n, i) => ({
                        label: i === 0 ? '備註' : `備註 ${i + 1}`,
                        value: n,
                      }))
                    : []),
                ]}
              />
            </div>
          ) : null}
      </section>
          </div>
        ) : null}

        {tab === 'remote' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">遠端推送目標</h3>
                  <p className="ops-panel__sub">
                    本地 tar 成功後可推送到 SFTP、本機路徑或 S3
                  </p>
                </div>
                <Badge tone={remote.enabled ? 'ok' : 'neutral'}>
                  {remote.enabled ? remote.kind : '關閉'}
                </Badge>
              </header>
                <FormLayout columns={2}>
                  <Field label="啟用遠端推送" htmlFor="bk-en" flush>
                    <SegRadio
                      name="bk-en"
                      aria-label="啟用遠端推送"
                      value={remote.enabled ? 'yes' : 'no'}
                      onChange={(v) =>
                        setRemote((r) => ({ ...r, enabled: v === 'yes' }))
                      }
                      options={[
                        { value: 'no', label: '否' },
                        { value: 'yes', label: '是' },
                      ]}
                    />
                  </Field>
                  <Field label="目標類型" htmlFor="bk-kind" flush>
                    <SegRadio
                      name="bk-kind"
                      aria-label="遠端目標類型"
                      value={remote.kind}
                      onChange={(v) =>
                        setRemote((r) => ({
                          ...r,
                          kind: v === 'local' || v === 's3' ? v : 'sftp',
                        }))
                      }
                      options={[
                        { value: 'sftp', label: 'SFTP / scp' },
                        { value: 'local', label: '本機路徑' },
                        { value: 's3', label: 'S3' },
                      ]}
                    />
                  </Field>
                  {remote.kind === 'sftp' ? (
                    <>
                      <Field label="主機" htmlFor="bk-host" flush>
                        <input
                          id="bk-host"
                          value={remote.host ?? ''}
                          onChange={(e) => setRemote((r) => ({ ...r, host: e.target.value }))}
                          placeholder="backup.example.com"
                        />
                      </Field>
                      <Field label="埠" htmlFor="bk-port" flush>
                        <input
                          id="bk-port"
                          value={String(remote.port ?? 22)}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, port: Number(e.target.value) || 22 }))
                          }
                        />
                      </Field>
                      <Field label="用戶名" htmlFor="bk-user" flush>
                        <input
                          id="bk-user"
                          value={remote.username ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, username: e.target.value }))
                          }
                        />
                      </Field>
                      <Field
                        label="密碼"
                        htmlFor="bk-pass"
                        hint="可留空，改用主機 SSH key"
                        flush
                      >
                        <input
                          id="bk-pass"
                          type="password"
                          value={remote.password ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, password: e.target.value }))
                          }
                          placeholder="已儲存則留空"
                        />
                      </Field>
                    </>
                  ) : null}
                  {remote.kind === 's3' ? (
                    <>
                      <Field label="Bucket 路徑" htmlFor="bk-s3b" flush>
                        <input
                          id="bk-s3b"
                          value={remote.s3Bucket ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Bucket: e.target.value }))
                          }
                          placeholder="my-bucket/ysk"
                        />
                      </Field>
                      <Field label="區域" htmlFor="bk-s3r" flush>
                        <input
                          id="bk-s3r"
                          value={remote.s3Region ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Region: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Endpoint（可選）" htmlFor="bk-s3e" flush>
                        <input
                          id="bk-s3e"
                          value={remote.s3Endpoint ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Endpoint: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Access Key" htmlFor="bk-ak" flush>
                        <input
                          id="bk-ak"
                          value={remote.awsAccessKeyId ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, awsAccessKeyId: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Secret Key" htmlFor="bk-sk" flush>
                        <input
                          id="bk-sk"
                          type="password"
                          value={remote.awsSecretAccessKey ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({
                              ...r,
                              awsSecretAccessKey: e.target.value,
                            }))
                          }
                          placeholder="已儲存則留空"
                        />
                      </Field>
                    </>
                  ) : null}
                  {remote.kind !== 's3' ? (
                    <Field
                      label={remote.kind === 'local' ? '本機鏡像路徑' : '遠端路徑'}
                      htmlFor="bk-path"
                      fullWidth
                      flush
                    >
                      <input
                        id="bk-path"
                        value={remote.path ?? ''}
                        onChange={(e) => setRemote((r) => ({ ...r, path: e.target.value }))}
                        placeholder="/backups/ysk"
                      />
                    </Field>
                  ) : null}
                </FormLayout>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">Restic 增量</h3>
                  <p className="ops-panel__sub">
                    可選；需 PATH 有 restic。啟用後必須設定 password（唔會用預設密碼）
                  </p>
                </div>
                <Badge tone={resticTone as 'ok' | 'warn' | 'neutral'}>
                  {resticLabel}
                </Badge>
              </header>
                <FormLayout columns={2}>
                  <Field label="啟用 restic" htmlFor="rs-en" flush>
                    <SegRadio
                      name="rs-en"
                      aria-label="啟用 restic"
                      value={restic.enabled ? 'yes' : 'no'}
                      onChange={(v) =>
                        setRestic((r) => ({ ...r, enabled: v === 'yes' }))
                      }
                      options={[
                        { value: 'no', label: '否' },
                        { value: 'yes', label: '是' },
                      ]}
                    />
                  </Field>
                  <Field label="Repo 路徑" htmlFor="rs-path" flush>
                    <input
                      id="rs-path"
                      value={restic.repoPath ?? ''}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, repoPath: e.target.value }))
                      }
                      placeholder="dataDir/restic-repo"
                    />
                  </Field>
                  <Field
                    label="Repo 密碼"
                    htmlFor="rs-pw"
                    flush
                    required={restic.enabled}
                    hint={
                      resticPasswordSet
                        ? '已儲存；留空＝不改。啟用後必填。'
                        : '啟用 restic 時必填（唔會用預設密碼）'
                    }
                  >
                    <input
                      id="rs-pw"
                      type="password"
                      value={restic.password ?? ''}
                      onChange={(e) => {
                        setRestic((r) => ({ ...r, password: e.target.value }));
                        if (e.target.value) setResticPasswordSet(true);
                      }}
                      placeholder={resticPasswordSet ? '已儲存（留空不改）' : '必填'}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="或 S3 repo URL" htmlFor="rs-s3" flush>
                    <input
                      id="rs-s3"
                      value={restic.s3Repo ?? ''}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, s3Repo: e.target.value }))
                      }
                      placeholder="s3:s3.amazonaws.com/bucket/path"
                    />
                  </Field>
                </FormLayout>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">排除規則</h3>
                  <p className="ops-panel__sub">tar 排除路徑，每行一個 glob</p>
                </div>
              </header>
                <FormLayout>
                  <Field label="排除清單" htmlFor="bk-ex" fullWidth flush>
                    <textarea
                      id="bk-ex"
                      rows={5}
                      value={exclusionsText}
                      onChange={(e) => setExclusionsText(e.target.value)}
                      placeholder={'node_modules\n.git'}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={settingsBusy}
                    onClick={() => void saveSettings()}
                  >
                    儲存全部設定
                  </Button>
                </FormActions>
            </section>
          </div>
        ) : null}
      </Tabs>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (!restoreTarget) return;
          void run(async () => {
            try {
              const r = await api.requestRaw('/api/v1/backups/restore', {
                method: 'POST',
                body: JSON.stringify({
                  projectId: restoreTarget.projectId,
                  name: restoreTarget.name,
                  mode: restoreMode,
                }),
              });
              setRestoreTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : '還原失敗';
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, restoreMode === 'dry-run' ? '預覽完成' : '還原完成');
        }}
        title={
          restoreMode === 'dry-run'
            ? '預覽備份內容？'
            : restoreMode === 'web'
              ? '選擇性還原 (web)？'
              : '完整還原？'
        }
        description={
          restoreTarget
            ? restoreMode === 'dry-run'
              ? `只列出 ${restoreTarget.name} 內容，唔會改檔。`
              : restoreMode === 'web'
                ? `將 ${restoreTarget.name} 解壓到專案 home（較保守）。`
                : `完整 tar 還原 ${restoreTarget.name}，可能覆蓋現有檔案。`
            : ''
        }
        confirmLabel={restoreMode === 'dry-run' ? '預覽' : '還原'}
        cancelLabel="取消"
        danger={restoreMode === 'full'}
        busy={busy}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void run(async () => {
            try {
              const r = await api.requestRaw('/api/v1/backups', {
                method: 'DELETE',
                body: JSON.stringify({
                  projectId: deleteTarget.projectId,
                  name: deleteTarget.name,
                }),
              });
              setDeleteTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : '刪除失敗';
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, '已刪除');
        }}
        title="刪除備份檔？"
        description={deleteTarget ? `永久刪除 ${deleteTarget.name}` : ''}
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
      </div>
    </FeaturePageLayout>
  );
}
