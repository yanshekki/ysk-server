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
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();

  const refresh = useCallback(async () => {
    const r = await api.requestRaw<{
      items: BackupItem[];
      lastRun?: Record<string, unknown> | null;
    }>('/api/v1/backups');
    setItems(r.items ?? []);
    setLastRun(r.lastRun ?? null);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

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
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => setRestoreTarget(b)}
                          >
                            還原
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
                }),
              });
              setRestoreTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : '還原失敗';
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, '還原完成');
        }}
        title="還原此備份？"
        description={
          restoreTarget
            ? `會以 tar 展開 ${restoreTarget.name} 到專案目錄。可能覆蓋現有檔案。`
            : ''
        }
        confirmLabel="還原"
        cancelLabel="取消"
        danger
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
