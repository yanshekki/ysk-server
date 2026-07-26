/**
 * PostgreSQL databases — parity with SqlEngine (status strip + install/start + apply honesty).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  FormGrid,
  Modal,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import { consoleApi, type ServiceConsole } from '../../features/db-service/console-api';
import { useFeatureAction } from '../../features/system/useFeatureAction';

export function PostgresPage() {
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

  const refreshSvc = useCallback(async () => {
    setLoadError(null);
    try {
      setSvc(await consoleApi.get('postgres'));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '狀態載入失敗');
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
      password: createUser ? password : undefined,
    });
    setCreateOpen(false);
    setName('');
    setUsername('');
    setPassword('');
  }

  async function onInstall() {
    await run(async () => {
      try {
        const r = await consoleApi.install('postgres');
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : '安裝失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, 'PostgreSQL 已安裝');
  }

  async function onStart() {
    await run(async () => {
      try {
        const r = await consoleApi.lifecycle('postgres', 'start');
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : '啟動失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, 'PostgreSQL 已啟動');
  }

  const busy = dbs.busy || actBusy;
  const error = dbs.error || actError || loadError;
  const installed = Boolean(svc?.installed);
  const running = svc?.active === 'active';

  return (
    <FeaturePageLayout
      title="PostgreSQL"
      subtitle="PostgreSQL 資料庫與服務狀態"
      actions={
        <div className="btn-row">
          <Link to="/databases/postgres/service">
            <Button variant="secondary" size="md">
              服務控制台
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refreshSvc();
              void dbs.refresh();
            }}
          >
            重新整理
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={busy || !installed}
            title={!installed ? '請先安裝 PostgreSQL' : undefined}
            onClick={() => setCreateOpen(true)}
          >
            建立資料庫
          </Button>
        </div>
      }
    >
      <SoftwareInstallBanner feature="postgres" title="PostgreSQL 所需軟件尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {dbs.msg ? <Alert variant="ok">{dbs.msg}</Alert> : null}
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
          {
            label: '狀態',
            value: svc?.activeLabel ?? '—',
            tone: running ? 'ok' : installed ? 'warn' : 'danger',
          },
          {
            label: '系統變更',
            value: svc?.executeEnabled ? '已開啟' : '未開啟',
            tone: svc?.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: '管理員',
            value: svc?.isRoot ? '是' : '否',
            tone: svc?.isRoot ? 'ok' : 'warn',
          },
          { label: '資料庫', value: String(dbs.items.length) },
        ]}
      />

      <Card>
        <CardSection title="服務概覽" description="唯讀探測">
          <DescriptionList
            columns={2}
            items={[
              {
                label: '狀態',
                value: (
                  <Badge tone={running ? 'ok' : installed ? 'warn' : 'danger'}>
                    {svc?.activeLabel ?? '—'}
                  </Badge>
                ),
              },
              { label: '版本', value: svc?.version ?? '—' },
              { label: 'unit', value: svc?.unit ?? 'postgresql' },
              {
                label: '系統變更',
                value: svc?.executeEnabled ? '已開啟' : '未開啟',
              },
            ]}
          />
          {svc?.blockMessage ? (
            <p className="muted u-text-sm u-mt-3" style={{ marginBottom: 0 }}>
              {svc.blockMessage}
            </p>
          ) : null}
          <div className="lifecycle-toolbar u-mt-3">
            {!installed ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onInstall()}>
                一鍵安裝 PostgreSQL
              </Button>
            ) : !running ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onStart()}>
                啟動服務
              </Button>
            ) : (
              <Link to="/databases/postgres/service">
                <Button variant="secondary" size="md">
                  開啟服務控制台
                </Button>
              </Link>
            )}
          </div>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />

      <Card>
        <CardSection title={`資料庫 (${dbs.items.length})`}>
          <ResourceTable
            columns={[
              { key: 'name', header: '資料庫', render: (r) => <strong>{String(r.name)}</strong> },
              {
                key: 'status',
                header: '狀態',
                render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
              },
              {
                key: 'updated',
                header: '更新',
                render: (r) => (
                  <span className="muted u-nowrap">
                    {String(r.updated_at ?? '').slice(0, 19).replace('T', ' ') || '—'}
                  </span>
                ),
              },
            ]}
            rows={dbs.items}
            empty={
              <EmptyState
                title="尚未有 PostgreSQL 庫"
                description={
                  !installed
                    ? '請先一鍵安裝 PostgreSQL'
                    : '建立後按「套用到系統」寫入伺服器'
                }
                action={
                  installed ? (
                    <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
                      + 建立
                    </Button>
                  ) : (
                    <Button variant="primary" size="md" loading={busy} onClick={() => void onInstall()}>
                      一鍵安裝
                    </Button>
                  )
                }
              />
            }
            rowActions={(r) => (
              <div className="btn-row">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => void dbs.apply(r.id, true)}
                >
                  套用到系統
                </Button>
                <Button variant="danger" size="sm" loading={busy} onClick={() => setDelId(r.id)}>
                  刪除
                </Button>
              </div>
            )}
          />
        </CardSection>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="建立 PostgreSQL 資料庫"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="pg-c" variant="primary" size="md" loading={busy}>
              建立
            </Button>
          </>
        }
      >
        <form id="pg-c" onSubmit={(e) => void onCreate(e)}>
          <Field label="資料庫名稱" techKey="database" htmlFor="pn">
            <input id="pn" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={createUser}
                onChange={(e) => setCreateUser(e.target.checked)}
              />{' '}
              同時建立角色
            </span>
          </label>
          {createUser ? (
            <FormGrid>
              <Field label="用戶名" techKey="role" htmlFor="pu">
                <input id="pu" value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Field label="密碼" techKey="password" htmlFor="pp" hint="至少 8 字元">
                <input
                  id="pp"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </Field>
            </FormGrid>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delId)}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) void dbs.remove(delId).then(() => setDelId(null));
        }}
        title="刪除資料庫登記？"
        description="移除控制面紀錄（唔會自動 DROP 伺服器上的庫，除非另有套用撤銷）。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
