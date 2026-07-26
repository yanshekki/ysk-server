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
  FormGrid,
  OpsResultPanel,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';

type BackupItem = {
  projectId: string;
  name: string;
  path: string;
  bytes: number;
  mtime: string;
};

type RemoteSettings = {
  enabled: boolean;
  kind: 'sftp' | 'local';
  host?: string;
  port?: number;
  username?: string;
  path?: string;
  password?: string;
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
  const [exclusionsText, setExclusionsText] = useState(
    'node_modules\n.git\nvendor\n.cache',
  );
  const [settingsBusy, setSettingsBusy] = useState(false);
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();

  const refresh = useCallback(async () => {
    const [r, s] = await Promise.all([
      api.requestRaw<{
        items: BackupItem[];
        lastRun?: Record<string, unknown> | null;
      }>('/api/v1/backups'),
      api.requestRaw<{ remote?: RemoteSettings; exclusions?: string[] }>(
        '/api/v1/backups/settings',
      ),
    ]);
    setItems(r.items ?? []);
    setLastRun(r.lastRun ?? null);
    if (s.remote) {
      setRemote({
        enabled: Boolean(s.remote.enabled),
        kind: s.remote.kind === 'local' ? 'local' : 'sftp',
        host: s.remote.host ?? '',
        port: s.remote.port ?? 22,
        username: s.remote.username ?? '',
        path: s.remote.path ?? '/backups/ysk',
        password: s.remote.password === '***' ? '' : (s.remote.password ?? ''),
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
      const body: { remote: RemoteSettings; exclusions: string[] } = {
        remote: {
          enabled: remote.enabled,
          kind: remote.kind,
          host: remote.host || undefined,
          port: Number(remote.port) || 22,
          username: remote.username || undefined,
          path: remote.path || undefined,
          ...(remote.password ? { password: remote.password } : {}),
        },
        exclusions,
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

      <Card>
        <CardSection
          title="遠端目標 / 排除"
          description="本地 tar 成功後可 scp 或複製到本機路徑；排除 globs 用於 tar"
        >
          <FormGrid>
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
            <Field label="類型" htmlFor="bk-kind" flush>
              <select
                id="bk-kind"
                value={remote.kind}
                onChange={(e) =>
                  setRemote((r) => ({
                    ...r,
                    kind: e.target.value === 'local' ? 'local' : 'sftp',
                  }))
                }
              >
                <option value="sftp">SFTP / scp</option>
                <option value="local">本機路徑鏡像</option>
              </select>
            </Field>
            {remote.kind === 'sftp' ? (
              <>
                <Field label="Host" htmlFor="bk-host" flush>
                  <input
                    id="bk-host"
                    value={remote.host ?? ''}
                    onChange={(e) => setRemote((r) => ({ ...r, host: e.target.value }))}
                    placeholder="backup.example.com"
                  />
                </Field>
                <Field label="Port" htmlFor="bk-port" flush>
                  <input
                    id="bk-port"
                    value={String(remote.port ?? 22)}
                    onChange={(e) =>
                      setRemote((r) => ({ ...r, port: Number(e.target.value) || 22 }))
                    }
                  />
                </Field>
                <Field label="Username" htmlFor="bk-user" flush>
                  <input
                    id="bk-user"
                    value={remote.username ?? ''}
                    onChange={(e) => setRemote((r) => ({ ...r, username: e.target.value }))}
                  />
                </Field>
                <Field label="密碼（可選；留空用 SSH key）" htmlFor="bk-pass" flush>
                  <input
                    id="bk-pass"
                    type="password"
                    value={remote.password ?? ''}
                    onChange={(e) => setRemote((r) => ({ ...r, password: e.target.value }))}
                    placeholder="已儲存則留空"
                  />
                </Field>
              </>
            ) : null}
            <Field
              label={remote.kind === 'local' ? '本機鏡像路徑' : '遠端路徑'}
              htmlFor="bk-path"
              flush
            >
              <input
                id="bk-path"
                value={remote.path ?? ''}
                onChange={(e) => setRemote((r) => ({ ...r, path: e.target.value }))}
                placeholder="/backups/ysk"
              />
            </Field>
          </FormGrid>
          <Field label="排除（每行一個）" htmlFor="bk-ex" flush>
            <textarea
              id="bk-ex"
              rows={4}
              value={exclusionsText}
              onChange={(e) => setExclusionsText(e.target.value)}
              placeholder="node_modules"
            />
          </Field>
          <div className="btn-row u-mt-3">
            <Button
              variant="primary"
              size="md"
              loading={settingsBusy}
              onClick={() => void saveSettings()}
            >
              儲存設定
            </Button>
          </div>
        </CardSection>
      </Card>

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
          </div>
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
