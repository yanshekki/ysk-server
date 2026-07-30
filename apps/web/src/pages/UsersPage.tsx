/**
 * Admin users + packages — FeaturePageLayout + system primitives only.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  DataTable,
  FeaturePageLayout,
  Field,
  Form,
  LoadingBlock,
  Modal,
  ConfirmDialog,
  PageTabs,
  PresetChips,
  SegRadio,
  buttonClassName,
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
  const { t } = useTranslation();
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
  const [pending, setPending] = useState<
    | { kind: 'impersonate'; user: UserRow }
    | { kind: 'delUser'; user: UserRow }
    | { kind: 'delPkg'; pkg: Pkg }
    | null
  >(null);

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
      setCreateUserOpen(false);
      setMsg(`已建立用戶 ${username}`);
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
          max_projects: Number(pkgProjects) || 10,
          max_mailboxes: 10,
          max_databases: 5,
          disk_mb: Number(pkgDisk) || 10240,
          allow_ftp: true,
          allow_ssh: true,
        }),
      });
      setCreatePkgOpen(false);
      setMsg(`已建立方案 ${pkgName}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setBusy(false);
    }
  }

  const admins = users.filter((u) => u.roles.includes('admin')).length;
  const suspended = users.filter((u) => u.suspended).length;
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

  return (
    <FeaturePageLayout
      title={t('nav.users', { defaultValue: '用戶與方案' })}
      showCapability={false}
      status={{
        pill: { label: `${users.length} 用戶`, tone: 'ok' },
        items: [
          { label: '用戶', value: users.length },
          { label: 'Admin', value: admins },
          {
            label: '暫停',
            value: suspended,
            tone: suspended ? 'warn' : 'ok',
          },
          { label: '方案', value: packages.length },
          { label: '2FA', value: with2fa },
        ],
      }}
      actions={<ActionBar align="end">
          <Button
            variant="ghost"
            size="sm"
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
          <Link to="/security" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            安全中心
          </Link>
        </ActionBar>
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
        <PageTabs
          tabs={[
            { id: 'users', label: '用戶', badge: users.length || undefined },
            {
              id: 'packages',
              label: '方案',
              badge: packages.length || undefined,
            },
          
          { id: 'about', label: '說明' },
        ]}
          active={tab}
          onChange={setTab}
          variant="scroll"
        >
          {tab === 'users' ? (
            <DataTable
              title={`用戶列表 (${filteredUsers.length})`}
              description="暫停／方案／模擬登入／刪除"
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreateUser}>
                    + 建立用戶
                  </Button>
                </ActionBar>
              }
              filters={
                <Form layoutOnly columns={1}>
                  <Field label="搜尋" htmlFor="user-q" flush>
                    <input
                      id="user-q"
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="用戶名 / 角色"
                      aria-label="搜尋用戶"
                    />
                  </Field>
                </Form>
              }
              columns={[
                {
                  key: 'user',
                  header: '用戶',
                  render: (u) => (
                    <span className="u-font-semibold">{u.username}</span>
                  ),
                },
                {
                  key: 'roles',
                  header: '角色',
                  render: (u) => (
                    <span className="badge-row">
                      {u.roles.map((r) => (
                        <Badge
                          key={r}
                          tone={r === 'admin' ? 'warn' : 'neutral'}
                        >
                          {r}
                        </Badge>
                      ))}
                      {u.totpEnabled ? <Badge tone="ok">2FA</Badge> : null}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: '狀態',
                  nowrap: true,
                  render: (u) => (
                    <Badge tone={u.suspended ? 'warn' : 'ok'}>
                      {u.suspended ? '暫停' : '正常'}
                    </Badge>
                  ),
                },
                {
                  key: 'pkg',
                  header: '方案',
                  render: (u) => (
                    <select
                      value={u.packageId ?? ''}
                      disabled={busy}
                      aria-label={`${u.username} 方案`}
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
                    >
                      <option value="">— 無 —</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ),
                },
              ]}
              rows={filteredUsers}
              rowKey={(u) => u.id}
              rowActions={(u) => (
                <ActionBar align="end">
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
                    onClick={() => setPending({ kind: 'impersonate', user: u })}
                  >
                    模擬登入
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={() => setPending({ kind: 'delUser', user: u })}
                  >
                    刪除
                  </Button>
                </ActionBar>
              )}
            />
        ) : null}

        {tab === 'packages' ? (
          <div className="tab-panel">
            <DataTable
              title={`方案列表 (${packages.length})`}
              description="專案／磁碟配額"
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreatePkg}>
                    + 建立方案
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: '名稱',
                  render: (p) => (
                    <span className="u-font-semibold">{p.name}</span>
                  ),
                },
                {
                  key: 'projects',
                  header: '專案',
                  nowrap: true,
                  render: (p) => p.max_projects,
                },
                {
                  key: 'mail',
                  header: '信箱',
                  nowrap: true,
                  render: (p) => p.max_mailboxes,
                },
                {
                  key: 'db',
                  header: 'DB',
                  nowrap: true,
                  render: (p) => p.max_databases,
                },
                {
                  key: 'disk',
                  header: '碟 MiB',
                  nowrap: true,
                  render: (p) => p.disk_mb,
                },
                {
                  key: 'ftp',
                  header: 'FTP',
                  nowrap: true,
                  render: (p) => (p.allow_ftp ? '是' : '否'),
                },
                {
                  key: 'ssh',
                  header: 'SSH',
                  nowrap: true,
                  render: (p) => (p.allow_ssh ? '是' : '否'),
                },
              ]}
              rows={packages}
              rowKey={(p) => p.id}
              rowActions={(p) => (
                <ActionBar align="end">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={() => setPending({ kind: 'delPkg', pkg: p })}
                  >
                    刪除
                  </Button>
                </ActionBar>
              )}
              empty={<p className="muted u-text-sm">尚未有方案</p>}
            />
          </div>
        ) : null}
        
        {tab === 'about' ? <PageGuide guideId="users" /> : null}
      </PageTabs>
      )}

      <Modal
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        title="建立用戶"
        description="密碼至少 8 位；建立後可改方案或暫停"
        footer={
          <ActionBar align="end" size="md">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateUserOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="users-create"
              variant="primary"
              size="sm"
              loading={busy}
            >
              建立用戶
            </Button>
          </ActionBar>
        }
      >
        <Form id="users-create" columns={1} onSubmit={(e) => void onCreateUser(e)}>
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
            <SegRadio
              name="u-role"
              aria-label="用戶角色"
              value={role}
              onChange={(v) => setRole(v as typeof role)}
              options={[
                { value: 'operator', label: 'operator' },
                { value: 'viewer', label: 'viewer' },
                { value: 'admin', label: 'admin' },
              ]}
            />
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
        </Form>
      </Modal>

      <Modal
        open={createPkgOpen}
        onClose={() => setCreatePkgOpen(false)}
        title="建立方案"
        description="配額模板；可之後綁到用戶"
        footer={
          <ActionBar align="end" size="md">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreatePkgOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="pkg-create"
              variant="primary"
              size="sm"
              loading={busy}
            >
              建立方案
            </Button>
          </ActionBar>
        }
      >
        <Form id="pkg-create" columns={1} onSubmit={(e) => void onCreatePkg(e)}>
          <Field label="名稱" htmlFor="p-name" flush required>
            <input
              id="p-name"
              value={pkgName}
              onChange={(e) => setPkgName(e.target.value)}
              required
            />
          </Field>
          <Field label="最大專案數" htmlFor="p-proj" flush>
            <PresetChips
              options={[
                { value: '1', label: '1' },
                { value: '3', label: '3' },
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '20', label: '20' },
                { value: '50', label: '50' },
              ]}
              value={pkgProjects}
              onChange={setPkgProjects}
              allowCustom
              customPlaceholder="自訂"
            />
          </Field>
          <Field label="磁碟 MiB" htmlFor="p-disk" flush>
            <PresetChips
              options={[
                { value: '1024', label: '1G' },
                { value: '5120', label: '5G' },
                { value: '10240', label: '10G' },
                { value: '20480', label: '20G' },
                { value: '51200', label: '50G' },
              ]}
              value={pkgDisk}
              onChange={setPkgDisk}
              allowCustom
              customPlaceholder="MiB"
            />
          </Field>
        </Form>
      </Modal>

      <ConfirmDialog
        open={pending != null}
        onClose={() => !busy && setPending(null)}
        title={
          pending?.kind === 'impersonate'
            ? `模擬登入 ${pending.user.username}？`
            : pending?.kind === 'delUser'
              ? `刪除 ${pending.user.username}？`
              : pending?.kind === 'delPkg'
                ? `刪除方案 ${pending.pkg.name}？`
                : '確認'
        }
        description={
          pending?.kind === 'impersonate'
            ? '目前工作階段會被取代。'
            : pending?.kind === 'delUser'
              ? '此操作無法復原。'
              : pending?.kind === 'delPkg'
                ? '已綁定用戶的方案引用會失效。'
                : ''
        }
        confirmLabel={
          pending?.kind === 'impersonate' ? '模擬登入' : '刪除'
        }
        cancelLabel="取消"
        danger={pending?.kind !== 'impersonate'}
        busy={busy}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          if (p.kind === 'impersonate') {
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
              }>(`/api/v1/users/${p.user.id}/impersonate`, {
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
          } else if (p.kind === 'delUser') {
            setBusy(true);
            void api
              .requestRaw(`/api/v1/users/${p.user.id}`, { method: 'DELETE' })
              .then(() => refresh())
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'delPkg') {
            void api
              .requestRaw(`/api/v1/packages/${p.pkg.id}`, {
                method: 'DELETE',
              })
              .then(() => refresh())
              .catch((e: Error) => setError(e.message));
          }
        }}
      />
    </FeaturePageLayout>
  );
}
