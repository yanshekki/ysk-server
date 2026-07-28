/**
 * Admin users + packages — professional ops console.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  Field,
  FormLayout,
  Tabs,
  LoadingBlock,
  Modal,
} from '../shared/components/ui';
import { api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';
import { usePageTab } from '../shared/hooks/usePageTab';

type UserRow = {
  id: string;
  username: string;
  roles: string[];
  packageId?: string;
  suspended?: boolean;
  totpEnabled?: boolean;
};

type Pkg = {
  id: string;
  name: string;
  max_projects: number;
  max_mailboxes: number;
  max_databases: number;
  disk_mb: number;
  allow_ftp: boolean;
  allow_ssh: boolean;
};

export function UsersPage() {
  const [tab, setTab] = usePageTab(['users', 'packages'] as const, 'users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer' | 'admin'>('operator');
  const [userPkgId, setUserPkgId] = useState('');
  const [pkgName, setPkgName] = useState('default');
  const [pkgProjects, setPkgProjects] = useState('10');
  const [pkgDisk, setPkgDisk] = useState('10240');
  const [q, setQ] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createPkgOpen, setCreatePkgOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [u, p] = await Promise.all([
      api.requestRaw<{ items: UserRow[] }>('/api/v1/users'),
      api.requestRaw<{ items: Pkg[] }>('/api/v1/packages'),
    ]);
    setUsers(u.items ?? []);
    setPackages(p.items ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  function openCreateUser() {
    setUsername('');
    setPassword('');
    setRole('operator');
    setUserPkgId('');
    setError(null);
    setTab('users');
    setCreateUserOpen(true);
  }

  function openCreatePkg() {
    setPkgName('default');
    setPkgProjects('10');
    setPkgDisk('10240');
    setError(null);
    setTab('packages');
    setCreatePkgOpen(true);
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestRaw('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          roles: [role],
          packageId: userPkgId || undefined,
        }),
      });
      setMsg(`已建立 ${username}`);
      setUsername('');
      setPassword('');
      setUserPkgId('');
      setCreateUserOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setBusy(false);
    }
  }

  async function onCreatePkg(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestRaw('/api/v1/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: pkgName,
          maxProjects: Number(pkgProjects) || 10,
          diskMb: Number(pkgDisk) || 10240,
        }),
      });
      setMsg(`已建立 package ${pkgName}`);
      setCreatePkgOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setBusy(false);
    }
  }

  const suspended = users.filter((u) => u.suspended).length;
  const admins = users.filter((u) => u.roles.includes('admin')).length;
  const with2fa = users.filter((u) => u.totpEnabled).length;

  const filteredUsers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(needle) ||
        u.roles.join(' ').toLowerCase().includes(needle),
    );
  }, [users, q]);

  const pkgNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of packages) m.set(p.id, p.name);
    return m;
  }, [packages]);

  return (
    <FeaturePageLayout
      title="用戶與方案"
      subtitle="管理員 · 角色 · 配額方案 · 模擬登入"
      showCapability={false}
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            loading={busy || loading}
            onClick={() => {
              setLoading(true);
              void refresh()
                .catch((e: Error) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            重新整理
          </Button>
          <Link to="/security" className="btn btn--ghost btn--md">
            安全中心
          </Link>
        </>
      }
    >
      {error ? (
        <Alert variant="error">
          {error}{' '}
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      {loading && users.length === 0 && packages.length === 0 ? (
        <LoadingBlock label="載入用戶與方案…" />
      ) : (
        <div className="ops">
          <section className="ops-hero ops-hero--ok">
            <div className="ops-hero__main">
              <div className="ops-hero__copy">
                <div className="ops-hero__eyebrow">Users & packages</div>
                <h2 className="ops-hero__title">
                  <span className="ops-hero__pill ops-hero__pill--ok">
                    {users.length} 用戶
                  </span>
                  存取與配額
                </h2>
                <p className="ops-hero__hint">
                  管理面板帳號、角色、方案配額。模擬登入會切換目前工作階段。刪除不可復原。
                </p>
                <div className="ops-hero__meta">
                  <span>
                    方案 <strong>{packages.length}</strong>
                  </span>
                  <span className="ops-hero__dot" />
                  <span>
                    暫停 <strong>{suspended}</strong>
                  </span>
                  <span className="ops-hero__dot" />
                  <span>
                    2FA <strong>{with2fa}</strong>
                  </span>
                </div>
                <div className="ops-hero__cta">
                  <Button variant="primary" size="md" onClick={openCreateUser}>
                    + 建立用戶
                  </Button>
                  <Button variant="secondary" size="md" onClick={openCreatePkg}>
                    + 建立方案
                  </Button>
                </div>
              </div>
              <div className="ops-hero__stats">
                <div className="ops-stat">
                  <span className="ops-stat__lab">用戶</span>
                  <span className="ops-stat__val">{users.length}</span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">Admin</span>
                  <span className="ops-stat__val">
                    <Badge tone="neutral">{admins}</Badge>
                  </span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">暫停</span>
                  <span className="ops-stat__val">
                    <Badge tone={suspended ? 'warn' : 'ok'}>{suspended}</Badge>
                  </span>
                </div>
                <div className="ops-stat">
                  <span className="ops-stat__lab">方案</span>
                  <span className="ops-stat__val">{packages.length}</span>
                </div>
              </div>
            </div>
          </section>

          <Tabs
            tabs={[
              { id: 'users', label: `用戶 (${users.length})` },
              { id: 'packages', label: `方案 (${packages.length})` },
            ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'users' ? (
              <div className="ops-grid">
                <section className="ops-panel ops-panel--wide">
                  <header className="ops-panel__head ops-panel__head--stack">
                    <div className="ops-panel__head-row">
                      <div>
                        <h3 className="ops-panel__title">
                          用戶列表 ({filteredUsers.length})
                        </h3>
                        <p className="ops-panel__sub">
                          暫停／方案／模擬登入／刪除
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={openCreateUser}
                      >
                        + 建立用戶
                      </Button>
                    </div>
                    <label className="ops-field">
                      <span className="ops-field__lab">搜尋</span>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="用戶名 / 角色"
                      />
                    </label>
                  </header>
                  {filteredUsers.length === 0 ? (
                    <p className="ops-muted">沒有用戶</p>
                  ) : (
                    <div className="ops-user-list">
                      {filteredUsers.map((u) => (
                        <article
                          key={u.id}
                          className={`ops-user${u.suspended ? ' ops-user--suspended' : ''}`}
                        >
                          <div className="ops-user__body">
                            <div className="ops-user__head">
                              <h4 className="ops-user__name">{u.username}</h4>
                              {u.roles.map((r) => (
                                <Badge
                                  key={r}
                                  tone={r === 'admin' ? 'warn' : 'neutral'}
                                >
                                  {r}
                                </Badge>
                              ))}
                              {u.totpEnabled ? (
                                <Badge tone="ok">2FA</Badge>
                              ) : null}
                              <Badge tone={u.suspended ? 'warn' : 'ok'}>
                                {u.suspended ? '暫停' : '正常'}
                              </Badge>
                            </div>
                            <div className="ops-user__meta">
                              <label className="ops-user__pkg">
                                方案
                                <select
                                  value={u.packageId ?? ''}
                                  disabled={busy}
                                  onChange={(e) => {
                                    const packageId = e.target.value || null;
                                    setBusy(true);
                                    void api
                                      .requestRaw(`/api/v1/users/${u.id}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({ packageId }),
                                      })
                                      .then(() => refresh())
                                      .catch((err: Error) =>
                                        setError(err.message),
                                      )
                                      .finally(() => setBusy(false));
                                  }}
                                >
                                  <option value="">— 無 —</option>
                                  {packages.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {u.packageId ? (
                                <span className="ops-muted">
                                  {pkgNameById.get(u.packageId) ?? u.packageId}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="ops-user__actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                setBusy(true);
                                void api
                                  .requestRaw(`/api/v1/users/${u.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({
                                      suspended: !u.suspended,
                                    }),
                                  })
                                  .then(() => refresh())
                                  .catch((e: Error) => setError(e.message))
                                  .finally(() => setBusy(false));
                              }}
                            >
                              {u.suspended ? '恢復' : '暫停'}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                if (
                                  !confirm(
                                    `以 ${u.username} 模擬登入？目前工作階段會被取代。`,
                                  )
                                )
                                  return;
                                setBusy(true);
                                void api
                                  .requestRaw<{
                                    token: string;
                                    user: {
                                      id: string;
                                      username: string;
                                      roles: string[];
                                      locale: string;
                                    };
                                  }>(`/api/v1/users/${u.id}/impersonate`, {
                                    method: 'POST',
                                    body: '{}',
                                  })
                                  .then((r) => {
                                    authStore.setSession(r.token, {
                                      id: r.user.id,
                                      username: r.user.username,
                                      roles: r.user.roles,
                                      locale: r.user.locale ?? 'zh-TW',
                                    });
                                    window.location.href = '/';
                                  })
                                  .catch((e: Error) => setError(e.message))
                                  .finally(() => setBusy(false));
                              }}
                            >
                              模擬登入
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                if (!confirm(`刪除 ${u.username}？`)) return;
                                setBusy(true);
                                void api
                                  .requestRaw(`/api/v1/users/${u.id}`, {
                                    method: 'DELETE',
                                  })
                                  .then(() => refresh())
                                  .catch((e: Error) => setError(e.message))
                                  .finally(() => setBusy(false));
                              }}
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

            {tab === 'packages' ? (
              <div className="ops-grid">
                <section className="ops-panel ops-panel--wide">
                  <header className="ops-panel__head">
                    <div>
                      <h3 className="ops-panel__title">
                        方案列表 ({packages.length})
                      </h3>
                      <p className="ops-panel__sub">專案／磁碟配額</p>
                    </div>
                    <Button variant="primary" size="sm" onClick={openCreatePkg}>
                      + 建立方案
                    </Button>
                  </header>
                  {packages.length === 0 ? (
                    <p className="ops-muted">尚未有方案</p>
                  ) : (
                    <div className="ops-pkg-list">
                      {packages.map((p) => (
                        <article key={p.id} className="ops-pkg-card">
                          <div className="ops-pkg-card__body">
                            <h4 className="ops-pkg-card__name">{p.name}</h4>
                            <div className="ops-pkg-card__facts">
                              <span>專案 {p.max_projects}</span>
                              <span>信箱 {p.max_mailboxes}</span>
                              <span>DB {p.max_databases}</span>
                              <span>碟 {p.disk_mb} MiB</span>
                              <span>FTP {p.allow_ftp ? '是' : '否'}</span>
                              <span>SSH {p.allow_ssh ? '是' : '否'}</span>
                            </div>
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              if (!confirm(`刪除方案 ${p.name}？`)) return;
                              void api
                                .requestRaw(`/api/v1/packages/${p.id}`, {
                                  method: 'DELETE',
                                })
                                .then(() => refresh())
                                .catch((e: Error) => setError(e.message));
                            }}
                          >
                            刪除
                          </Button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </Tabs>
        </div>
      )}

      <Modal
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        title="建立用戶"
        description="密碼至少 8 位；建立後可改方案或暫停"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateUserOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="users-create"
              variant="primary"
              size="md"
              loading={busy}
            >
              建立用戶
            </Button>
          </>
        }
      >
        <form id="users-create" onSubmit={(e) => void onCreateUser(e)}>
          <FormLayout columns={1}>
            <Field label="用戶名" htmlFor="u-name" flush required>
              <input
                id="u-name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            <Field label="密碼" htmlFor="u-pass" flush required hint="至少 8 位">
              <input
                id="u-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
            <Field label="角色" htmlFor="u-role" flush>
              <select
                id="u-role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            <Field label="方案" htmlFor="u-pkg" flush>
              <select
                id="u-pkg"
                value={userPkgId}
                onChange={(e) => setUserPkgId(e.target.value)}
              >
                <option value="">— 無 —</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={createPkgOpen}
        onClose={() => setCreatePkgOpen(false)}
        title="建立方案"
        description="配額模板；可之後綁到用戶"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreatePkgOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="pkg-create"
              variant="primary"
              size="md"
              loading={busy}
            >
              建立方案
            </Button>
          </>
        }
      >
        <form id="pkg-create" onSubmit={(e) => void onCreatePkg(e)}>
          <FormLayout columns={1}>
            <Field label="名稱" htmlFor="p-name" flush required>
              <input
                id="p-name"
                value={pkgName}
                onChange={(e) => setPkgName(e.target.value)}
                required
              />
            </Field>
            <Field label="最大專案數" htmlFor="p-proj" flush>
              <input
                id="p-proj"
                value={pkgProjects}
                onChange={(e) => setPkgProjects(e.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="磁碟 MiB" htmlFor="p-disk" flush>
              <input
                id="p-disk"
                value={pkgDisk}
                onChange={(e) => setPkgDisk(e.target.value)}
                inputMode="numeric"
              />
            </Field>
          </FormLayout>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
