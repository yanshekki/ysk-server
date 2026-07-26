/**
 * Admin users + packages + impersonate.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  FeaturePageLayout,
  Field,
  FormGrid,
  Tabs,
} from '../shared/components/ui';
import { api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';

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
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer' | 'admin'>('operator');
  const [userPkgId, setUserPkgId] = useState('');
  const [pkgName, setPkgName] = useState('default');
  const [pkgProjects, setPkgProjects] = useState('10');
  const [pkgDisk, setPkgDisk] = useState('10240');

  const refresh = useCallback(async () => {
    const [u, p] = await Promise.all([
      api.requestRaw<{ items: UserRow[] }>('/api/v1/users'),
      api.requestRaw<{ items: Pkg[] }>('/api/v1/packages'),
    ]);
    setUsers(u.items ?? []);
    setPackages(p.items ?? []);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FeaturePageLayout title="用戶與方案" subtitle="Admin · 配額方案 · 模擬登入" showCapability={false}>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="ok">{msg}</Alert> : null}

      <Tabs
        tabs={[
          { id: 'users', label: '用戶' },
          { id: 'packages', label: '方案' },
        ]}
        active={tab}
        onChange={setTab}
      >
        {tab === 'users' ? (
          <div className="stack">
            <Card>
              <CardSection title="建立用戶">
                <form onSubmit={(e) => void onCreateUser(e)}>
                  <FormGrid>
                    <Field label="用戶名" htmlFor="u-name" flush>
                      <input
                        id="u-name"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="密碼" htmlFor="u-pass" flush>
                      <input
                        id="u-pass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
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
                  </FormGrid>
                  <div className="btn-row u-mt-3">
                    <Button type="submit" variant="primary" size="md" loading={busy}>
                      建立
                    </Button>
                  </div>
                </form>
              </CardSection>
            </Card>
            <Card>
              <CardSection title={`用戶 (${users.length})`}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>用戶</th>
                        <th>角色</th>
                        <th>方案</th>
                        <th>狀態</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <strong>{u.username}</strong>
                            {u.totpEnabled ? <Badge tone="ok">2FA</Badge> : null}
                          </td>
                          <td>{u.roles.join(', ')}</td>
                          <td>
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
                                  .catch((err: Error) => setError(err.message))
                                  .finally(() => setBusy(false));
                              }}
                              aria-label={`方案 ${u.username}`}
                            >
                              <option value="">— 無 —</option>
                              {packages.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <Badge tone={u.suspended ? 'warn' : 'ok'}>
                              {u.suspended ? '暫停' : '正常'}
                            </Badge>
                          </td>
                          <td>
                            <div className="btn-row">
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={busy}
                                onClick={() => {
                                  setBusy(true);
                                  void api
                                    .requestRaw(`/api/v1/users/${u.id}`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ suspended: !u.suspended }),
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
                                  setBusy(true);
                                  void api
                                    .requestRaw<{
                                      token: string;
                                      user: { id: string; username: string; roles: string[]; locale: string };
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
                                    .requestRaw(`/api/v1/users/${u.id}`, { method: 'DELETE' })
                                    .then(() => refresh())
                                    .catch((e: Error) => setError(e.message))
                                    .finally(() => setBusy(false));
                                }}
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
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'packages' ? (
          <div className="stack">
            <Card>
              <CardSection title="建立方案">
                <form onSubmit={(e) => void onCreatePkg(e)}>
                  <FormGrid>
                    <Field label="名稱" htmlFor="p-name" flush>
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
                      />
                    </Field>
                    <Field label="磁碟 MiB" htmlFor="p-disk" flush>
                      <input
                        id="p-disk"
                        value={pkgDisk}
                        onChange={(e) => setPkgDisk(e.target.value)}
                      />
                    </Field>
                  </FormGrid>
                  <div className="btn-row u-mt-3">
                    <Button type="submit" variant="primary" size="md" loading={busy}>
                      建立方案
                    </Button>
                  </div>
                </form>
              </CardSection>
            </Card>
            <Card>
              <CardSection title={`方案 (${packages.length})`}>
                <ul className="list-plain list-spaced">
                  {packages.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong> · 專案 {p.max_projects} · 碟 {p.disk_mb} MiB · FTP{' '}
                      {p.allow_ftp ? '是' : '否'} · SSH {p.allow_ssh ? '是' : '否'}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          void api
                            .requestRaw(`/api/v1/packages/${p.id}`, { method: 'DELETE' })
                            .then(() => refresh())
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
          </div>
        ) : null}
      </Tabs>
    </FeaturePageLayout>
  );
}
