/**
 * Shared MySQL or MariaDB management page:
 * service status + permission strip + one install CTA + DB/users CRUD.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
  SummaryStrip,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { dbEngineApi, type DbEngineKind, type DbEngineStatus } from '../../features/db-engine';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { api } from '../../shared/services/api';

function serviceLabel(s: DbEngineStatus | null): {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  if (!s) return { text: '載入中', tone: 'neutral' };
  if (!s.serverInstalled) return { text: '未安裝', tone: 'danger' };
  if (s.active === 'active') return { text: '運行中', tone: 'ok' };
  if (s.active === 'inactive') return { text: '已停止', tone: 'warn' };
  return { text: s.active || '未知', tone: 'warn' };
}

export function SqlEnginePage({ engine }: { engine: DbEngineKind }) {
  const title = engine === 'mysql' ? 'MySQL' : 'MariaDB';
  const servicePath =
    engine === 'mysql' ? '/databases/mysql/service' : '/databases/mariadb/service';
  const dbs = useResourceCrud('mysql/databases', { engine });
  const users = useResourceCrud('mysql/users', { engine });
  const [svc, setSvc] = useState<DbEngineStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy: actBusy, error: actError, result, msg, run, setMsg, setError } =
    useFeatureAction();

  const [tab, setTab] = useState('databases');
  const [createOpen, setCreateOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [delDb, setDelDb] = useState<string | null>(null);
  const [delUser, setDelUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [createUser, setCreateUser] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('localhost');
  const [dbId, setDbId] = useState('');
  const [tempUsers, setTempUsers] = useState<Array<Record<string, unknown>>>([]);
  const [remoteHosts, setRemoteHosts] = useState<Array<Record<string, unknown>>>([]);
  const [tempDb, setTempDb] = useState('');
  const [tempTtl, setTempTtl] = useState('24');
  const [remoteLabel, setRemoteLabel] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [remotePort, setRemotePort] = useState('3306');
  const [remoteUser, setRemoteUser] = useState('');
  const [remotePass, setRemotePass] = useState('');
  const [lastTempPassword, setLastTempPassword] = useState<string | null>(null);

  const busy = dbs.busy || users.busy || actBusy;
  const error = dbs.error || users.error || actError;

  const refreshSvc = useCallback(async () => {
    setLoadError(null);
    try {
      setSvc(await dbEngineApi.status(engine));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '狀態載入失敗');
    }
  }, [engine]);

  const refreshExtras = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/db/temp-users'),
        api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/db/remote-hosts'),
      ]);
      setTempUsers((t.items ?? []).filter((u) => String(u.engine) === engine));
      setRemoteHosts((r.items ?? []).filter((h) => String(h.engine) === engine));
    } catch {
      /* optional */
    }
  }, [engine]);

  useEffect(() => {
    void refreshSvc();
    void refreshExtras();
  }, [refreshSvc, refreshExtras]);

  async function onInstall() {
    await run(async () => {
      try {
        const r = await dbEngineApi.install(engine);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        return {
          ok: false,
          blocked: /權限|系統變更|管理員/.test(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
    }, `${title} 已安裝`);
  }

  async function onStart() {
    await run(async () => {
      try {
        const r = await dbEngineApi.start(engine);
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '啟動失敗';
        return {
          ok: false,
          blocked: /權限|系統變更|管理員/.test(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
    }, `${title} 已啟動`);
  }

  async function onCreateDb(e: FormEvent) {
    e.preventDefault();
    await dbs.create({
      name,
      engine,
      createUser,
      username: createUser ? username || name : undefined,
      password: createUser ? password : undefined,
      host,
    });
    await users.refresh();
    setCreateOpen(false);
    setName('');
    setUsername('');
    setPassword('');
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    await users.create({
      username,
      password,
      host,
      engine,
      databaseId: dbId || undefined,
      privileges: ['ALL'],
    });
    setUserOpen(false);
    setUsername('');
    setPassword('');
  }

  const dbNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dbs.items) m.set(d.id, String(d.name));
    return m;
  }, [dbs.items]);

  const st = serviceLabel(svc);
  const installed = Boolean(svc?.serverInstalled);
  const running = svc?.active === 'active';

  return (
    <FeaturePageLayout
      title={title}
      subtitle={`${title} 資料庫與用戶`}
      actions={
        <div className="btn-row">
          <Link to={servicePath}>
            <Button variant="secondary" size="md">
              服務設定
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refreshSvc();
              void dbs.refresh();
              void users.refresh();
            }}
          >
            重新整理
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={busy || !dbs.items[0]}
            onClick={() => {
              const name = String(dbs.items[0]?.name ?? '');
              if (!name) return;
              setMsg(null);
              setError(null);
              void systemApi
                .dbDump({
                  engine: engine === 'mariadb' ? 'mariadb' : 'mysql',
                  dbName: name,
                })
                .then((r) => {
                  const notes = (r as { notes?: string[]; ok?: boolean }).notes;
                  if ((r as { ok?: boolean }).ok) setMsg(notes?.[0] ?? '已 dump');
                  else setError(notes?.[0] ?? 'dump 失敗');
                })
                .catch((e: Error) => setError(e.message));
            }}
          >
            Dump 首個庫
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => {
              void run(async () => {
                const r = await api.requestRaw<{
                  ok: boolean;
                  notes?: string[];
                  blocked?: boolean;
                  blockMessage?: string;
                  urlHint?: string;
                }>('/api/v1/db/adminer/apply', {
                  method: 'POST',
                  body: JSON.stringify({
                    domain: `adminer.${engine}.local`,
                    download: true,
                  }),
                });
                return {
                  ok: r.ok,
                  blocked: r.blocked,
                  blockMessage: r.blockMessage,
                  notes: [
                    ...(r.notes ?? []),
                    r.urlHint ? `入口提示: ${r.urlHint}` : '',
                  ].filter(Boolean),
                } as OpsResultLike;
              }, 'Adminer 套用完成');
            }}
          >
            Adminer 入口
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={busy || !installed}
            title={!installed ? `請先安裝 ${title}` : undefined}
            onClick={() => setCreateOpen(true)}
          >
            建立資料庫
          </Button>
        </div>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {dbs.msg || users.msg ? <Alert variant="ok">{dbs.msg ?? users.msg}</Alert> : null}

      <SummaryStrip
        items={[
          { label: '狀態', value: st.text, tone: st.tone === 'neutral' ? 'default' : st.tone },
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
          {
            label: '客戶端',
            value: svc?.clientInstalled ? '有' : '無',
            tone: svc?.clientInstalled ? 'ok' : 'danger',
          },
          { label: '資料庫', value: String(dbs.items.length) },
          { label: '用戶', value: String(users.items.length) },
        ]}
      />

      <Card>
        <CardSection title="服務概覽" description="唯讀狀態">
          <DescriptionList
            columns={2}
            items={[
              { label: '狀態', value: <Badge tone={st.tone}>{st.text}</Badge> },
              { label: '版本', value: svc?.version ?? '—' },
              {
                label: '系統變更',
                value: svc?.executeEnabled ? '已開啟' : '未開啟',
              },
              { label: '管理員', value: svc?.isRoot ? '是' : '否' },
              {
                label: '客戶端',
                value: svc?.clientInstalled ? '已安裝' : '未安裝',
              },
              {
                label: '可開庫',
                value: svc?.canProvision ? '是' : '否',
              },
            ]}
          />
          {svc?.blockMessage && !svc.canProvision ? (
            <p className="muted u-text-sm u-mt-3" style={{ marginBottom: 0 }}>
              {svc.blockMessage}
            </p>
          ) : null}
          <div className="lifecycle-toolbar u-mt-3">
            {!installed ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onInstall()}>
                一鍵安裝 {title}
              </Button>
            ) : !running ? (
              <Button variant="primary" size="md" loading={busy} onClick={() => void onStart()}>
                啟動服務
              </Button>
            ) : (
              <Link to={servicePath}>
                <Button variant="secondary" size="md">
                  開啟服務控制台
                </Button>
              </Link>
            )}
          </div>
        </CardSection>
      </Card>

      <OpsResultPanel
        title="操作結果"
        result={result}
        message={msg}
        onRetry={!installed ? () => void onInstall() : !running ? () => void onStart() : undefined}
        busy={busy}
      />

      {lastTempPassword ? (
        <Alert variant="ok">
          臨時只讀密碼（只顯示一次）：
          <code className="inline">{lastTempPassword}</code>
        </Alert>
      ) : null}

      <Tabs
        tabs={[
          { id: 'databases', label: `資料庫 (${dbs.items.length})` },
          { id: 'users', label: `用戶 (${users.items.length})` },
          { id: 'temp', label: `臨時只讀 (${tempUsers.length})` },
          { id: 'remote', label: `遠端主機 (${remoteHosts.length})` },
        ]}
        active={tab}
        onChange={setTab}
      >
        {tab === 'databases' ? (
          <Card>
            <CardSection title="資料庫列表">
              <ResourceTable
                columns={[
                  {
                    key: 'name',
                    header: '資料庫',
                    render: (r) => <strong>{String(r.name)}</strong>,
                  },
                  {
                    key: 'charset',
                    header: 'Charset',
                    render: (r) => String(r.charset ?? 'utf8mb4'),
                  },
                  {
                    key: 'status',
                    header: '狀態',
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
                  },
                ]}
                rows={dbs.items}
                empty={
                  <EmptyState
                    title="尚未有資料庫"
                    description={
                      !installed
                        ? `請先一鍵安裝 ${title}`
                        : !svc?.canProvision
                          ? svc?.blockMessage ?? '目前無法在伺服器建立資料庫'
                          : '建立後按「套用」寫入伺服器'
                    }
                    action={
                      installed ? (
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => setCreateOpen(true)}
                        >
                          + 建立資料庫
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={busy}
                          onClick={() => void onInstall()}
                        >
                          一鍵安裝 {title}
                        </button>
                      )
                    }
                  />
                }
                rowActions={(r) => (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={busy}
                      onClick={() => void dbs.apply(r.id, true)}
                    >
                      套用
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      disabled={busy}
                      onClick={() => setDelDb(r.id)}
                    >
                      刪除
                    </button>
                  </div>
                )}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'users' ? (
          <Card>
            <CardSection title="用戶列表" description="可為資料庫授權用戶">
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={!installed}
                  onClick={() => setUserOpen(true)}
                >
                  + 建立用戶
                </button>
              </div>
              <ResourceTable
                columns={[
                  {
                    key: 'username',
                    header: '用戶',
                    render: (r) => (
                      <strong>
                        {String(r.username)}@{String(r.host ?? '%')}
                      </strong>
                    ),
                  },
                  {
                    key: 'db',
                    header: '資料庫',
                    render: (r) =>
                      r.databaseId
                        ? dbNameById.get(String(r.databaseId)) ?? String(r.databaseId)
                        : '—',
                  },
                  {
                    key: 'status',
                    header: '狀態',
                    render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
                  },
                ]}
                rows={users.items}
                empty={<EmptyState title="尚未有用戶" />}
                rowActions={(r: ResourceRow) => (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={() => setDelUser(r.id)}
                  >
                    刪除
                  </button>
                )}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'temp' ? (
          <Card>
            <CardSection
              title="臨時只讀用戶"
              description="TTL 到期後控制面標記 expired；系統 DROP 需手動（誠實）"
            >
              <FormGrid>
                <Field label="資料庫名" htmlFor="tmp-db" flush>
                  <input
                    id="tmp-db"
                    value={tempDb}
                    onChange={(e) => setTempDb(e.target.value)}
                    placeholder="app_db"
                  />
                </Field>
                <Field label="TTL 小時" htmlFor="tmp-ttl" flush>
                  <input
                    id="tmp-ttl"
                    value={tempTtl}
                    onChange={(e) => setTempTtl(e.target.value)}
                  />
                </Field>
              </FormGrid>
              <div className="btn-row u-mt-3">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => {
                    void run(async () => {
                      const r = await api.requestRaw<{
                        ok: boolean;
                        password?: string;
                        notes?: string[];
                        user?: Record<string, unknown>;
                      }>('/api/v1/db/temp-users', {
                        method: 'POST',
                        body: JSON.stringify({
                          engine,
                          database: tempDb,
                          ttlHours: Number(tempTtl) || 24,
                          apply: true,
                        }),
                      });
                      if (r.password) setLastTempPassword(r.password);
                      await refreshExtras();
                      return {
                        ...r,
                        ok: r.ok,
                        notes: r.notes ?? [],
                      } as OpsResultLike;
                    }, '已建立臨時只讀用戶');
                  }}
                >
                  建立只讀（套用系統）
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => void refreshExtras()}
                >
                  重新整理
                </Button>
              </div>
              <ul className="list-plain list-spaced u-mt-3">
                {tempUsers.map((u) => (
                  <li key={String(u.id)} className="btn-row">
                    <span>
                      <strong>{String(u.username)}</strong> @ {String(u.database)} ·{' '}
                      <Badge>{String(u.apply_status)}</Badge> · 到期{' '}
                      {u.expiresAt ? new Date(String(u.expiresAt)).toLocaleString() : '—'}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void api
                          .requestRaw(`/api/v1/db/temp-users/${u.id}`, { method: 'DELETE' })
                          .then(() => refreshExtras())
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      撤銷登記
                    </Button>
                  </li>
                ))}
              </ul>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'remote' ? (
          <Card>
            <CardSection
              title="遠端 DB 主機"
              description="登記連線目標（密碼不回顯）；面板 dump/瀏覽可後續接"
            >
              <FormGrid>
                <Field label="標籤" htmlFor="rh-label" flush>
                  <input
                    id="rh-label"
                    value={remoteLabel}
                    onChange={(e) => setRemoteLabel(e.target.value)}
                  />
                </Field>
                <Field label="Host" htmlFor="rh-host" flush>
                  <input
                    id="rh-host"
                    value={remoteHost}
                    onChange={(e) => setRemoteHost(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Port" htmlFor="rh-port" flush>
                  <input
                    id="rh-port"
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                  />
                </Field>
                <Field label="Username" htmlFor="rh-user" flush>
                  <input
                    id="rh-user"
                    value={remoteUser}
                    onChange={(e) => setRemoteUser(e.target.value)}
                  />
                </Field>
                <Field label="Password" htmlFor="rh-pass" flush>
                  <input
                    id="rh-pass"
                    type="password"
                    value={remotePass}
                    onChange={(e) => setRemotePass(e.target.value)}
                  />
                </Field>
              </FormGrid>
              <div className="btn-row u-mt-3">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => {
                    void api
                      .requestRaw('/api/v1/db/remote-hosts', {
                        method: 'POST',
                        body: JSON.stringify({
                          engine,
                          label: remoteLabel || remoteHost,
                          host: remoteHost,
                          port: Number(remotePort) || undefined,
                          username: remoteUser || undefined,
                          password: remotePass || undefined,
                        }),
                      })
                      .then(() => {
                        setRemotePass('');
                        setMsg('已儲存遠端主機');
                        return refreshExtras();
                      })
                      .catch((e: Error) => setError(e.message));
                  }}
                >
                  儲存
                </Button>
              </div>
              <ul className="list-plain list-spaced u-mt-3">
                {remoteHosts.map((h) => (
                  <li key={String(h.id)} className="btn-row">
                    <span>
                      <strong>{String(h.label)}</strong> · {String(h.host)}:
                      {String(h.port)} · {String(h.username ?? '—')}
                      {h.hasPassword ? ' · 🔐' : ''}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void api
                          .requestRaw(`/api/v1/db/remote-hosts/${h.id}`, {
                            method: 'DELETE',
                          })
                          .then(() => refreshExtras())
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      刪除
                    </Button>
                  </li>
                ))}
              </ul>
            </CardSection>
          </Card>
        ) : null}
      </Tabs>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`建立 ${title} 資料庫`}
        description="建立控制面登記後，請按「套用」寫入伺服器"
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="submit" form="sql-create" className="btn btn--primary" disabled={busy}>
              建立
            </button>
          </>
        }
      >
        <form id="sql-create" onSubmit={(e) => void onCreateDb(e)}>
          <Field label="資料庫名稱" htmlFor="dn">
            <input id="dn" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={createUser}
                onChange={(e) => setCreateUser(e.target.checked)}
              />{' '}
              同時建立用戶
            </span>
          </label>
          {createUser ? (
            <FormGrid>
              <Field label="用戶名" htmlFor="un">
                <input
                  id="un"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={name || 'user'}
                />
              </Field>
              <Field label="密碼（≥8）" htmlFor="pw">
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={createUser}
                  minLength={8}
                />
              </Field>
              <Field label="Host" htmlFor="hh">
                <input id="hh" value={host} onChange={(e) => setHost(e.target.value)} />
              </Field>
            </FormGrid>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={userOpen}
        onClose={() => setUserOpen(false)}
        title={`建立 ${title} 用戶`}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setUserOpen(false)}>
              取消
            </button>
            <button type="submit" form="sql-user" className="btn btn--primary" disabled={busy}>
              建立
            </button>
          </>
        }
      >
        <form id="sql-user" onSubmit={(e) => void onCreateUser(e)}>
          <FormGrid>
            <Field label="用戶名" htmlFor="uun">
              <input
                id="uun"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field label="密碼" htmlFor="upw">
              <input
                id="upw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            <Field label="Host" htmlFor="uh">
              <input id="uh" value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Field label="綁定資料庫" htmlFor="udb">
              <select id="udb" value={dbId} onChange={(e) => setDbId(e.target.value)}>
                <option value="">— 無 —</option>
                {dbs.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {String(d.name)}
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delDb)}
        onClose={() => setDelDb(null)}
        onConfirm={() => {
          if (delDb) void dbs.remove(delDb).then(() => setDelDb(null));
        }}
        title="刪除資料庫登記？"
        description="僅移除控制面紀錄；不會自動 DROP 伺服器上的庫。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(delUser)}
        onClose={() => setDelUser(null)}
        onConfirm={() => {
          if (delUser) void users.remove(delUser).then(() => setDelUser(null));
        }}
        title="刪除用戶登記？"
        description="僅移除控制面紀錄。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
