/**
 * Server-wide backups — list / run-all / restore / delete (honest ok).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  OpsResultPanel,
  SummaryStrip,
  Tabs,
  FormActions,
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
    const [r, s] = await Promise.all([
      api.requestRaw<{
        items: BackupItem[];
        lastRun?: Record<string, unknown> | null;
      }>('/api/v1/backups'),
      api.requestRaw<{
        remote?: RemoteSettings;
        exclusions?: string[];
        restic?: ResticSettings;
      }>('/api/v1/backups/settings'),
    ]);
    setItems(r.items ?? []);
    setLastRun(r.lastRun ?? null);
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
  const projectCount = new Set(items.map((i) => i.projectId)).size;

  const [tab, setTab] = usePageTab(BK_TABS, 'files');

  return (
    <FeaturePageLayout
      title="備份"
      subtitle="專案 tar 備份 · 還原 · 刪除"
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

      <SummaryStrip
        items={[
          { label: '備份檔', value: String(items.length) },
          { label: '專案數', value: String(projectCount) },
          {
            label: '上次全部備份',
            value:
              lastOk === true ? '全部成功' : lastOk === false ? '有失敗' : '尚未',
            tone: lastOk === true ? 'ok' : lastOk === false ? 'warn' : 'default',
          },
        ]}
      />

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
      <Card>
        <CardSection title={`備份檔案 (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState
              title="尚無備份"
              description="執行「備份所有專案」或於專案詳情 Backup"
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>專案</th>
                    <th>檔名</th>
                    <th>大小</th>
                    <th>時間</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={`${b.projectId}:${b.name}`}>
                      <td>
                        <code className="inline">{b.projectId.slice(0, 8)}…</code>
                      </td>
                      <td>
                        <code className="inline u-break-all">{b.name}</code>
                      </td>
                      <td>{formatBytes(b.bytes)}</td>
                      <td className="muted u-nowrap">
                        {b.mtime ? new Date(b.mtime).toLocaleString() : '—'}
                      </td>
                      <td>
                        <div className="btn-row">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const q = new URLSearchParams({
                                projectId: b.projectId,
                                name: b.name,
                              });
                              window.open(`/api/v1/backups/download?${q}`, '_blank');
                            }}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </Card>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel">
      <Card>
        <CardSection title="操作" description="全部成功才算 ok；部分失敗會顯示失敗">
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
                    })) as OpsResultLike;
                    await refresh();
                    return r;
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
                  return r;
                }, '已登記每日 03:00 排程')
              }
            >
              登記每日排程
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  return (await api.requestRaw('/api/v1/backups/restic/run', {
                    method: 'POST',
                    body: '{}',
                  })) as OpsResultLike;
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
        </CardSection>
      </Card>
          </div>
        ) : null}

        {tab === 'remote' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="遠端推送目標"
                description="本地 tar 成功後可推送到 SFTP、本機路徑或 S3"
              >
                <FormLayout columns={2}>
                  <Field label="啟用遠端推送" htmlFor="bk-en" flush>
                    <select
                      id="bk-en"
                      value={remote.enabled ? 'yes' : 'no'}
                      onChange={(e) =>
                        setRemote((r) => ({ ...r, enabled: e.target.value === 'yes' }))
                      }
                    >
                      <option value="no">否</option>
                      <option value="yes">是</option>
                    </select>
                  </Field>
                  <Field label="目標類型" htmlFor="bk-kind" flush>
                    <select
                      id="bk-kind"
                      value={remote.kind}
                      onChange={(e) =>
                        setRemote((r) => ({
                          ...r,
                          kind:
                            e.target.value === 'local' || e.target.value === 's3'
                              ? e.target.value
                              : 'sftp',
                        }))
                      }
                    >
                      <option value="sftp">SFTP / scp</option>
                      <option value="local">本機路徑鏡像</option>
                      <option value="s3">S3（需 aws cli）</option>
                    </select>
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
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="Restic 增量"
                description="可選；需主機 PATH 有 restic"
              >
                <FormLayout columns={2}>
                  <Field label="啟用 restic" htmlFor="rs-en" flush>
                    <select
                      id="rs-en"
                      value={restic.enabled ? 'yes' : 'no'}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, enabled: e.target.value === 'yes' }))
                      }
                    >
                      <option value="no">否</option>
                      <option value="yes">是</option>
                    </select>
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
                  <Field label="Repo 密碼" htmlFor="rs-pw" flush>
                    <input
                      id="rs-pw"
                      type="password"
                      value={restic.password ?? ''}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, password: e.target.value }))
                      }
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
              </CardSection>
            </Card>

            <Card>
              <CardSection title="排除規則" description="tar 排除路徑，每行一個 glob">
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
              </CardSection>
            </Card>
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
    </FeaturePageLayout>
  );
}
