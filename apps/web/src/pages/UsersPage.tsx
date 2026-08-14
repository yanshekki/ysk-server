/**
 * Admin users + packages + adjustable multi-level RBAC.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CAPABILITY_CATALOG,
  OPERATION_LEVELS,
  computeEffectiveCapabilities,
  factoryRolePolicy,
  type CapabilityId,
  type OperationLevel,
  type SystemRole } from 'ysk-server-shared';
import { useCapabilities } from '../shared/hooks/useCapabilities';
import { useServerList } from '../shared/hooks/useServerList';
import { toast } from '../shared/stores/toast-store';
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
  ListToolbar,
  LoadingBlock,
  Modal,
  ConfirmDialog,
  PromptDialog,
  PageTabs,
  PresetChips,
  SegRadio,
  buttonClassName } from '../shared/components/ui';
import { UserDetailModal } from '../features/users/UserDetailModal';
import { RolePermissionsPanel } from '../features/users/RolePermissionsPanel';
import { ApiError, api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';
import { usePageTab } from '../shared/hooks/usePageTab';
import { bindCall1, bindCheck, bindCloseIfIdle, bindInput, bindSet, bindValueSet } from './bind-handlers';

type HostUsage = {
  scope: 'host';
  projects: number;
  mailboxes: number;
  databases: number;
};

type UserRow = {
  id: string;
  username: string;
  roles: string[];
  packageId?: string;
  packageName?: string;
  suspended?: boolean;
  totpEnabled?: boolean;
  capabilityGrants?: CapabilityId[];
  capabilityRevokes?: CapabilityId[];
  capabilities?: CapabilityId[];
  lastSeenAt?: string;
};

type Pkg = {
  id: string;
  name: string;
  max_projects: number;
  max_mailboxes: number;
  max_databases: number;
  disk_mb: number;
  bandwidth_mb?: number;
  allow_ftp: boolean;
  allow_ssh: boolean;
  notes?: string;
  subscriberCount?: number;
  hostUsage?: HostUsage;
  usageScope?: string;
};

export function usageBar(used: number, max: number): string {
  if (max <= 0) return `${used} / ∞`;
  const pct = Math.min(100, Math.round((used / max) * 100));
  return `${used} / ${max} (${pct}%)`;
}

/** Usage percent 0–100; unlimited max → 0. */
export function usagePct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export function isUserSuspended(u: { suspended?: boolean }): boolean {
  return Boolean(u.suspended);
}

export function primaryRole(roles: string[] | null | undefined): string {
  return roles?.[0] ?? '—';
}

export function packageDiskLabel(diskMb: number): string {
  if (!Number.isFinite(diskMb) || diskMb < 0) return '—';
  if (diskMb >= 1024) return `${(diskMb / 1024).toFixed(1)} GB`;
  return `${diskMb} MB`;
}

export function userStatusTone(u: {
  suspended?: boolean;
  totpEnabled?: boolean;
}): 'danger' | 'ok' | 'warn' {
  if (u.suspended) return 'danger';
  if (u.totpEnabled) return 'ok';
  return 'warn';
}

export function packageQuotaTone(used: number, max: number): 'ok' | 'warn' | 'danger' {
  if (max <= 0) return 'ok';
  const pct = usagePct(used, max);
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

export function filterUsersByQuery<
  T extends { username: string; roles?: string[] },
>(users: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return users;
  return users.filter(
    (u) =>
      u.username.toLowerCase().includes(s) ||
      (u.roles ?? []).some((r) => r.toLowerCase().includes(s)),
  );
}

export function isLastAdminUser(
  user: { roles?: string[] },
  adminCount: number,
): boolean {
  return (user.roles ?? []).includes('admin') && adminCount <= 1;
}

export function userMutationLock(
  user: { id: string; roles?: string[] },
  currentUserId: string | undefined,
  adminCount: number,
): 'self' | 'last-admin' | null {
  if (currentUserId && user.id === currentUserId) return 'self';
  if (isLastAdminUser(user, adminCount)) return 'last-admin';
  return null;
}

type RolePolicyView = {
  role: SystemRole;
  dirty: boolean;
  policy: { maxLevel: OperationLevel; capabilities: CapabilityId[] };
  factory: { maxLevel: OperationLevel; capabilities: CapabilityId[] };
};

export function UsersPage() {
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const me = authStore.getUser();
  const canImpersonate = can('users.impersonate');
  const canEditRbac = can('rbac.policy');
  const [tab, setTab] = usePageTab(
    ['users', 'packages', 'permissions', 'about'] as const,
    'users',
  );

  const usersList = useServerList<UserRow>({ path: '/api/v1/users', debounceMs: 300 });
  const packagesList = useServerList<Pkg>({ path: '/api/v1/packages', debounceMs: 300 });

  /** Unfiltered package options for create/edit user dropdowns */
  const [pkgOptions, setPkgOptions] = useState<Pkg[]>([]);
  const [hostUsage, setHostUsage] = useState<HostUsage | null>(null);
  const [policies, setPolicies] = useState<RolePolicyView[]>([]);
  const [createLocale, setCreateLocale] = useState('zh-HK');
  const [error, setErrorRaw] = useState<string | null>(null);
  const setError = useCallback((text: string | null) => {
    if (text) toast.error(text);
    setErrorRaw(null);
  }, []);
  const setMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer' | 'admin'>('operator');
  const [userPkgId, setUserPkgId] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [pkgFormOpen, setPkgFormOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Pkg | null>(null);
  const [pkgName, setPkgName] = useState('default');
  const [pkgProjects, setPkgProjects] = useState('10');
  const [pkgMail, setPkgMail] = useState('10');
  const [pkgDb, setPkgDb] = useState('5');
  const [pkgDisk, setPkgDisk] = useState('10240');
  const [pkgBw, setPkgBw] = useState('0');
  const [pkgFtp, setPkgFtp] = useState(true);
  const [pkgSsh, setPkgSsh] = useState(true);
  const [pkgNotes, setPkgNotes] = useState('');
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  const [detailRole, setDetailRole] = useState<SystemRole>('operator');
  const [detailPkg, setDetailPkg] = useState('');
  const [detailSuspended, setDetailSuspended] = useState(false);
  const [detailPassword, setDetailPassword] = useState('');
  const [detailGrants, setDetailGrants] = useState<CapabilityId[]>([]);
  const [detailRevokes, setDetailRevokes] = useState<CapabilityId[]>([]);
  const [policyRole, setPolicyRole] = useState<SystemRole>('operator');
  const [draftMax, setDraftMax] = useState<OperationLevel>('write-high');
  const [draftCaps, setDraftCaps] = useState<CapabilityId[]>([]);
  const [pending, setPending] = useState<
    | { kind: 'impersonate'; user: UserRow }
    | { kind: 'delUser'; user: UserRow }
    | { kind: 'delPkg'; pkg: Pkg }
    | { kind: 'restoreRole'; role: SystemRole }
    | { kind: 'restoreAll' }
    | { kind: 'restoreUserOverrides'; user: UserRow }
    | { kind: 'promoteAdmin'; next: () => void }
    | { kind: 'demoteAdmin'; next: () => void }
    | { kind: 'dangerPolicySave'; next: () => void }
    | null
  >(null);
  /** Admin force-clear another user's 2FA (per-user secret). */
  const [clearTotp, setClearTotp] = useState<
    | null
    | { user: UserRow; phase: 'username' | 'totp'; confirmUsername?: string }
  >(null);
  const [clearTotpBusy, setClearTotpBusy] = useState(false);

  const loadPkgOptions = useCallback(async () => {
    const p = await api.requestRaw<{ items: Pkg[]; hostUsage?: HostUsage }>('/api/v1/packages');
    setPkgOptions(p.items ?? []);
    setHostUsage(p.hostUsage ?? p.items?.[0]?.hostUsage ?? null);
  }, []);

  const loadPolicies = useCallback(async () => {
    try {
      const pol = await api.requestRaw<{ items: RolePolicyView[] }>('/api/v1/rbac/policies');
      setPolicies(pol.items ?? []);
    } catch {
      setPolicies([]);
    }
  }, []);

  const refreshUsers = usersList.refresh;
  const refreshPackages = packagesList.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshUsers(),
      refreshPackages(),
      loadPkgOptions(),
      loadPolicies(),
    ]);
  }, [refreshUsers, refreshPackages, loadPkgOptions, loadPolicies]);

  useEffect(() => {
    void loadPkgOptions().catch((e: Error) => setError(e.message));
    void loadPolicies().catch(() => undefined);
  }, [loadPkgOptions, loadPolicies]);

  // Surface list errors
  useEffect(() => {
    if (usersList.error) setError(usersList.error);
  }, [usersList.error]);
  useEffect(() => {
    if (packagesList.error) setError(packagesList.error);
  }, [packagesList.error]);

  const users = usersList.items;
  const packages = packagesList.items;
  const loading = usersList.loading && packagesList.loading && users.length === 0;

  /** Map UI chip id → API filters (single primary dimension) */
  function applyUserChip(id: string) {
    if (id === 'all' || id === '') {
      usersList.setFilters({});
      return;
    }
    if (id === 'admin' || id === 'operator' || id === 'viewer') {
      usersList.setFilters({ role: id });
      return;
    }
    if (id === 'suspended') {
      usersList.setFilters({ status: 'suspended' });
      return;
    }
    if (id === 'noPkg') {
      usersList.setFilters({ package: 'none' });
      return;
    }
    if (id === '2faOff') {
      usersList.setFilters({ totp: '0' });
      return;
    }
    if (id === 'overrides') {
      usersList.setFilters({ overrides: '1' });
    }
  }

  function activeUserChip(): string {
    const f = usersList.filters;
    if (f.role) return f.role;
    if (f.status === 'suspended') return 'suspended';
    if (f.package === 'none') return 'noPkg';
    if (f.totp === '0') return '2faOff';
    if (f.overrides === '1') return 'overrides';
    return 'all';
  }

  useEffect(() => {
    const view = policies.find((x) => x.role === policyRole);
    if (view) {
      setDraftMax(view.policy.maxLevel);
      setDraftCaps([...view.policy.capabilities]);
    } else {
      const f = factoryRolePolicy(policyRole);
      setDraftMax(f.maxLevel);
      setDraftCaps([...f.capabilities]);
    }
  }, [policyRole, policies]);

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
    setEditingPkg(null);
    setPkgName('default');
    setPkgProjects('10');
    setPkgMail('10');
    setPkgDb('5');
    setPkgDisk('10240');
    setPkgBw('0');
    setPkgFtp(true);
    setPkgSsh(true);
    setPkgNotes('');
    setError(null);
    setTab('packages');
    setPkgFormOpen(true);
  }

  function openEditPkg(p: Pkg) {
    setEditingPkg(p);
    setPkgName(p.name);
    setPkgProjects(String(p.max_projects));
    setPkgMail(String(p.max_mailboxes));
    setPkgDb(String(p.max_databases));
    setPkgDisk(String(p.disk_mb));
    setPkgBw(String(p.bandwidth_mb ?? 0));
    setPkgFtp(p.allow_ftp);
    setPkgSsh(p.allow_ssh);
    setPkgNotes(p.notes ?? '');
    setPkgFormOpen(true);
  }

  function openDetail(u: UserRow) {
    setDetailUser(u);
    setDetailRole((u.roles[0] as SystemRole) || 'operator');
    setDetailPkg(u.packageId ?? '');
    setDetailSuspended(Boolean(u.suspended));
    setDetailPassword('');
    setDetailGrants([...(u.capabilityGrants ?? [])]);
    setDetailRevokes([...(u.capabilityRevokes ?? [])]);
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    const doCreate = async () => {
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
            locale: createLocale || undefined }) });
        setCreateUserOpen(false);
        setMsg(t('users.createdUser', { name: username }));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.createFailed'));
      } finally {
        setBusy(false);
      }
    };
    if (role === 'admin') {
      setPending({ kind: 'promoteAdmin', next: () => void doCreate() });
      return;
    }
    await doCreate();
  }

  async function onSavePkg(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: pkgName,
      max_projects: Number(pkgProjects) || 10,
      max_mailboxes: Number(pkgMail) || 10,
      max_databases: Number(pkgDb) || 5,
      disk_mb: Number(pkgDisk) || 10240,
      bandwidth_mb: Number(pkgBw) || 0,
      allow_ftp: pkgFtp,
      allow_ssh: pkgSsh,
      notes: pkgNotes || undefined };
    try {
      if (editingPkg) {
        await api.requestRaw(`/api/v1/packages/${editingPkg.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body) });
        setMsg(t('users.pkgUpdated', { name: pkgName }));
      } else {
        await api.requestRaw('/api/v1/packages', {
          method: 'POST',
          body: JSON.stringify({
            name: pkgName,
            maxProjects: body.max_projects,
            maxMailboxes: body.max_mailboxes,
            maxDatabases: body.max_databases,
            diskMb: body.disk_mb,
            bandwidthMb: body.bandwidth_mb,
            allowFtp: body.allow_ftp,
            allowSsh: body.allow_ssh,
            notes: body.notes }) });
        setMsg(t('users.createdPkg', { name: pkgName }));
      }
      setPkgFormOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetailUser() {
    if (!detailUser) return;
    const adminCount =
      usersList.meta?.facets?.role?.admin ??
      users.filter((u) => u.roles.includes('admin')).length;
    const lock = userMutationLock(detailUser, me?.id, adminCount);
    const wasAdmin = detailUser.roles.includes('admin');
    const demoting = wasAdmin && detailRole !== 'admin';
    const suspending = detailSuspended && !detailUser.suspended;
    if (lock && (demoting || suspending)) {
      setError(
        lock === 'self' ? t('users.cannotModifySelf') : t('users.cannotDemoteLastAdmin'),
      );
      return;
    }
    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        const patch: Record<string, unknown> = {
          roles: [detailRole],
          packageId: detailPkg || null,
          suspended: detailSuspended,
          capabilityGrants: detailGrants,
          capabilityRevokes: detailRevokes };
        if (detailPassword.length >= 8) patch.password = detailPassword;
        await api.requestRaw(`/api/v1/users/${detailUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch) });
        setMsg(t('users.userSaved', { name: detailUser.username }));
        setDetailUser(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.saveFailed', { defaultValue: 'Save failed' }));
      } finally {
        setBusy(false);
      }
    };
    if (detailRole === 'admin' && !detailUser.roles.includes('admin')) {
      setPending({ kind: 'promoteAdmin', next: () => void run() });
      return;
    }
    if (demoting) {
      setPending({ kind: 'demoteAdmin', next: () => void run() });
      return;
    }
    await run();
  }

  async function saveRolePolicy(force = false) {
    const factory = factoryRolePolicy(policyRole);
    const addsDanger = draftCaps.some((id) => {
      const def = CAPABILITY_CATALOG.find((c) => c.id === id);
      if (!def || (def.band !== 'destructive' && def.band !== 'privilege')) return false;
      return !factory.capabilities.includes(id);
    });
    const elevatesMax =
      OPERATION_LEVELS.indexOf(draftMax) >
      OPERATION_LEVELS.indexOf(factory.maxLevel);
    if ((addsDanger || elevatesMax) && !force) {
      setPending({
        kind: 'dangerPolicySave',
        next: () => void saveRolePolicy(true) });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.requestRaw(`/api/v1/rbac/policies/${policyRole}`, {
        method: 'PUT',
        body: JSON.stringify({ maxLevel: draftMax, capabilities: draftCaps }) });
      setMsg(t('rbac.saved', { role: policyRole }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.saveFailed', { defaultValue: 'Save failed' }));
    } finally {
      setBusy(false);
    }
  }

  const facets = usersList.meta?.facets;
  const userTotal = usersList.meta?.total ?? users.length;
  const admins = facets?.role?.admin ?? users.filter((u) => u.roles.includes('admin')).length;
  const suspended =
    facets?.status?.suspended ?? users.filter((u) => u.suspended).length;
  const with2fa = facets?.totp?.['1'] ?? users.filter((u) => u.totpEnabled).length;
  const pkgTotal = packagesList.meta?.total ?? packages.length;

  const effectivePreview = useMemo(() => {
    if (!detailUser) return [] as CapabilityId[];
    const map: Partial<Record<SystemRole, { maxLevel: OperationLevel; capabilities: CapabilityId[] }>> =
      {};
    for (const p of policies) {
      map[p.role] = p.policy;
    }
    return computeEffectiveCapabilities({
      roles: [detailRole],
      rolePolicies: map,
      grants: detailGrants,
      revokes: detailRevokes });
  }, [detailUser, detailRole, detailGrants, detailRevokes, policies]);

  const userChipId = activeUserChip();
  const userFilterChips = [
    { id: 'all', label: t('users.filterAll'), count: undefined as number | undefined },
    {
      id: 'admin',
      label: t('users.filterAdmin'),
      count: facets?.role?.admin },
    {
      id: 'operator',
      label: t('users.filterOperator'),
      count: facets?.role?.operator },
    {
      id: 'viewer',
      label: t('users.filterViewer'),
      count: facets?.role?.viewer },
    {
      id: 'suspended',
      label: t('users.filterSuspended'),
      count: facets?.status?.suspended,
      tone: 'warn' as const },
    {
      id: 'noPkg',
      label: t('users.filterNoPkg'),
      count: facets?.package?.none },
    {
      id: '2faOff',
      label: t('users.filter2faOff'),
      count: facets?.totp?.['0'] },
    {
      id: 'overrides',
      label: t('users.filterOverrides'),
      count: facets?.overrides?.['1'],
      tone: 'warn' as const },
  ];

  return (
    <FeaturePageLayout
      title={t('nav.users')}
      showCapability={false}
      status={{
        pill: { label: t('users.userCount', { count: userTotal }), tone: 'ok' },
        items: [
          { label: t('users.users'), value: userTotal },
          { label: 'Admin', value: admins },
          {
            label: t('users.suspended'),
            value: suspended,
            tone: suspended ? 'warn' : 'ok' },
          { label: t('users.packages'), value: pkgOptions.length || pkgTotal },
          { label: '2FA', value: with2fa },
        ] }}
      actions={
        <ActionBar align="end">
          <Button
            variant="ghost"
            size="sm"
            loading={busy || usersList.loading || packagesList.loading}
            onClick={() => {
              void refresh().catch((e: Error) => setError(e.message));
            }}
          >
            {t('common.refresh')}
          </Button>
          <Link to="/security" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('users.securityCenter')}
          </Link>
        </ActionBar>
      }
    >
      {loading ? (
        <LoadingBlock label={t('users.loading')} />
      ) : (
        <PageTabs
          tabs={[
            { id: 'users', label: t('users.users'), badge: userTotal || undefined },
            {
              id: 'packages',
              label: t('users.packages'),
              badge: pkgTotal || undefined },
            { id: 'permissions', label: t('rbac.permissions') },
            { id: 'about', label: t('common.about') },
          ]}
          active={tab}
          onChange={setTab}
          variant="scroll"
        >
          {tab === 'users' ? (
            <DataTable
              title={t('users.userList', { count: userTotal })}
              description={t('users.userListDesc')}
              toolbar={
                <ActionBar>
                  <Button variant="primary" size="sm" onClick={openCreateUser}>
                    {t('users.createUserPlus')}
                  </Button>
                </ActionBar>
              }
              filters={
                <ListToolbar
                  search={usersList.q}
                  onSearchChange={usersList.setQ}
                  searchPlaceholder={t('users.searchPh')}
                  searchAriaLabel={t('users.searchUsersAria')}
                  searching={usersList.searching}
                  loading={usersList.loading}
                  total={userTotal}
                  shown={users.length}
                  activeFilterCount={usersList.activeFilterCount}
                  onClear={usersList.clear}
                  chipGroups={[
                    {
                      key: 'userFilter',
                      ariaLabel: t('common.filter', { defaultValue: 'Filter' }),
                      chips: userFilterChips
                        .filter((c) => c.id !== 'all')
                        .map((c) => ({
                          id: c.id,
                          label: c.label,
                          count: c.count,
                          tone: c.tone })),
                      allLabel: t('users.filterAll'),
                      value: userChipId === 'all' ? '' : userChipId,
                      onChange: (v) => applyUserChip(v || 'all') },
                  ]}
                />
              }
              columns={[
                {
                  key: 'user',
                  header: t('users.user'),
                  render: (u) => (
                    <span className="u-font-semibold">{u.username}</span>
                  ) },
                {
                  key: 'roles',
                  header: t('users.roles'),
                  render: (u) => (
                    <span className="badge-row">
                      {u.roles.map((r) => (
                        <Badge key={r} tone={r === 'admin' ? 'warn' : 'neutral'}>
                          {r}
                        </Badge>
                      ))}
                      {u.totpEnabled ? <Badge tone="ok">2FA</Badge> : null}
                      {(u.capabilityGrants?.length || u.capabilityRevokes?.length) ? (
                        <Badge tone="info">{t('rbac.overridesBadge')}</Badge>
                      ) : null}
                    </span>
                  ) },
                {
                  key: 'status',
                  header: t('common.status'),
                  nowrap: true,
                  render: (u) => (
                    <Badge tone={u.suspended ? 'warn' : 'ok'}>
                      {u.suspended ? t('users.suspended') : t('common.normal')}
                    </Badge>
                  ) },
                {
                  key: 'pkg',
                  header: t('users.package'),
                  render: (u) => u.packageName || u.packageId || t('users.noneOption') },
                {
                  key: 'seen',
                  header: t('users.lastSeen'),
                  nowrap: true,
                  render: (u) =>
                    u.lastSeenAt
                      ? new Date(u.lastSeenAt).toLocaleString()
                      : t('users.neverSeen') },
              ]}
              rows={users}
              rowKey={(u) => u.id}
              empty={
                usersList.activeFilterCount > 0 ? (
                  <p className="muted u-text-sm">
                    {t('listToolbar.noResults')} — {t('listToolbar.noResultsHint')}
                  </p>
                ) : undefined
              }
              rowActions={(u) => (
                <ActionBar align="end">
                  <Button variant="secondary" size="sm" onClick={bindCall1(openDetail, u)}>
                    {t('users.openDetail')}
                  </Button>
                  {canImpersonate ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => setPending({ kind: 'impersonate', user: u })}
                    >
                      {t('users.impersonate')}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    disabled={Boolean(userMutationLock(u, me?.id, admins))}
                    onClick={() => {
                      if (userMutationLock(u, me?.id, admins)) return;
                      setPending({ kind: 'delUser', user: u });
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
          ) : null}

          {tab === 'packages' ? (
            <div className="tab-panel">
              <DataTable
                title={t('users.pkgList', { count: pkgTotal })}
                description={t('users.pkgListDesc')}
                toolbar={
                  <ActionBar>
                    <Button variant="primary" size="sm" onClick={openCreatePkg}>
                      {t('users.createPkgPlus')}
                    </Button>
                  </ActionBar>
                }
                filters={
                  <ListToolbar
                    search={packagesList.q}
                    onSearchChange={packagesList.setQ}
                    searchPlaceholder={t('users.searchPh')}
                    searchAriaLabel={t('users.packages')}
                    searching={packagesList.searching}
                    loading={packagesList.loading}
                    total={pkgTotal}
                    shown={packages.length}
                    activeFilterCount={packagesList.activeFilterCount}
                    onClear={packagesList.clear}
                  />
                }
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    render: (p) => (
                      <span className="u-font-semibold">{p.name}</span>
                    ) },
                  {
                    key: 'subs',
                    header: t('users.subscribers'),
                    nowrap: true,
                    render: (p) => t('users.subscribersN', { count: p.subscriberCount ?? 0 }) },
                  {
                    key: 'usage',
                    header: t('users.hostUsage'),
                    render: (p) => {
                      const hu = p.hostUsage ?? hostUsage;
                      if (!hu) return '—';
                      return (
                        <span
                          className="u-text-sm"
                          title={t('users.hostUsageHint')}
                        >
                          {t('common.project')}: {usageBar(hu.projects, p.max_projects)}
                          {' · '}
                          {t('users.mailboxes')}: {usageBar(hu.mailboxes, p.max_mailboxes)}
                          {' · '}
                          {t('users.databases')}: {usageBar(hu.databases, p.max_databases)}
                        </span>
                      );
                    } },
                  {
                    key: 'projects',
                    header: t('common.project'),
                    nowrap: true,
                    render: (p) => p.max_projects },
                  {
                    key: 'mail',
                    header: t('users.mailboxes'),
                    nowrap: true,
                    render: (p) => p.max_mailboxes },
                  {
                    key: 'db',
                    header: t('users.databases'),
                    nowrap: true,
                    render: (p) => p.max_databases },
                  {
                    key: 'disk',
                    header: t('users.diskMiB'),
                    nowrap: true,
                    render: (p) => p.disk_mb },
                  {
                    key: 'bw',
                    header: t('users.bandwidth'),
                    nowrap: true,
                    render: (p) => p.bandwidth_mb ?? 0 },
                  {
                    key: 'ftp',
                    header: t('users.ftp'),
                    nowrap: true,
                    render: (p) => (p.allow_ftp ? t('common.yes') : t('common.no')) },
                  {
                    key: 'ssh',
                    header: t('users.ssh'),
                    nowrap: true,
                    render: (p) => (p.allow_ssh ? t('common.yes') : t('common.no')) },
                ]}
                rows={packages}
                rowKey={(p) => p.id}
                rowActions={(p) => (
                  <ActionBar align="end">
                    <Button variant="secondary" size="sm" onClick={bindCall1(openEditPkg, p)}>
                      {t('users.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      disabled={(p.subscriberCount ?? 0) > 0}
                      onClick={() => setPending({ kind: 'delPkg', pkg: p })}
                    >
                      {t('common.delete')}
                    </Button>
                  </ActionBar>
                )}
                empty={<p className="muted u-text-sm">{t('users.noPackages')}</p>}
              />
            </div>
          ) : null}

          {tab === 'permissions' ? (
            <div className="tab-panel">
              <RolePermissionsPanel
                policies={policies}
                policyRole={policyRole}
                draftMax={draftMax}
                draftCaps={draftCaps}
                busy={busy}
                canEdit={canEditRbac}
                onRoleChange={setPolicyRole}
                onMaxLevelChange={(next) => {
                  setDraftMax(next);
                  setDraftCaps((caps) =>
                    caps.filter((id) => {
                      const def = CAPABILITY_CATALOG.find((c) => c.id === id);
                      if (!def) return false;
                      return (
                        OPERATION_LEVELS.indexOf(def.band) <= OPERATION_LEVELS.indexOf(next)
                      );
                    }),
                  );
                }}
                onCapsChange={setDraftCaps}
                onSave={() => void saveRolePolicy()}
                onRestoreRole={() => setPending({ kind: 'restoreRole', role: policyRole })}
                onRestoreAll={() => setPending({ kind: 'restoreAll' })}
              />
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="tab-panel">
              <PageGuide guideId="users" />
              <div className="u-mt-4">
                <h3 className="u-font-semibold">{t('rbac.aboutRoles')}</h3>
                <p className="muted u-text-sm">{t('rbac.aboutRolesBody')}</p>
                <h3 className="u-font-semibold u-mt-3">{t('rbac.aboutQuota')}</h3>
                <p className="muted u-text-sm">{t('rbac.aboutQuotaBody')}</p>
                {hostUsage ? (
                  <p className="u-text-sm u-mt-2" title={t('users.hostUsageHint')}>
                    <strong>{t('users.hostUsage')}:</strong>{' '}
                    {t('common.project')} {hostUsage.projects} · {t('users.mailboxes')}{' '}
                    {hostUsage.mailboxes} · {t('users.databases')} {hostUsage.databases}{' '}
                    <Badge tone="warn">{t('users.hostTotalsBadge')}</Badge>
                  </p>
                ) : null}
                <h3 className="u-font-semibold u-mt-3">{t('users.opsChecklist')}</h3>
                <ul className="u-text-sm muted">
                  <li>{t('users.opsCheck1')}</li>
                  <li>{t('users.opsCheck2')}</li>
                  <li>{t('users.opsCheck3')}</li>
                  <li>{t('users.opsCheck4')}</li>
                </ul>
              </div>
            </div>
          ) : null}
        </PageTabs>
      )}

      {/* Create user */}
      <Modal
        open={createUserOpen}
        onClose={bindSet(setCreateUserOpen, false)}
        title={t('users.createUser')}
        description={t('users.createUserDesc')}
        footer={
          <ActionBar align="end" size="md">
            <Button variant="secondary" size="sm" onClick={bindSet(setCreateUserOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="users-create" variant="primary" size="sm" loading={busy}>
              {t('users.createUser')}
            </Button>
          </ActionBar>
        }
      >
        <Form id="users-create" columns={1} onSubmit={(e) => void onCreateUser(e)}>
          <Field label={t('users.username')} htmlFor="u-name" flush required>
            <input
              id="u-name"
              value={username}
              onChange={bindInput(setUsername)}
              required
              autoComplete="off"
            />
          </Field>
          <Field
            label={t('common.password')}
            htmlFor="u-pass"
            flush
            required
            hint={t('users.passwordHint')}
          >
            <input
              id="u-pass"
              type="password"
              value={password}
              onChange={bindInput(setPassword)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('users.role')} htmlFor="u-role" flush>
            <SegRadio
              name="u-role"
              aria-label={t('users.roleAria')}
              value={role}
              onChange={(v) => setRole(v as typeof role)}
              options={[
                { value: 'operator', label: 'operator' },
                { value: 'viewer', label: 'viewer' },
                { value: 'admin', label: 'admin' },
              ]}
            />
          </Field>
          <Field label={t('users.package')} htmlFor="u-pkg" flush>
            <select id="u-pkg" value={userPkgId} onChange={bindInput(setUserPkgId)}>
              <option value="">{t('users.noneOption')}</option>
              {pkgOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('common.language', { defaultValue: 'Locale' })} htmlFor="u-locale" flush>
            <select
              id="u-locale"
              value={createLocale}
              onChange={bindInput(setCreateLocale)}
            >
              <option value="zh-HK">zh-HK</option>
              <option value="zh-CN">zh-CN</option>
              <option value="en">en</option>
            </select>
          </Field>
          <div className="u-mt-2">
            <strong className="u-text-sm">{t('rbac.effectivePreview')}</strong>
            <div className="badge-row u-mt-1">
              {factoryRolePolicy(role).capabilities.slice(0, 12).map((id) => (
                <Badge key={id} tone="neutral">
                  {id}
                </Badge>
              ))}
              {factoryRolePolicy(role).capabilities.length > 12 ? (
                <Badge tone="info">+{factoryRolePolicy(role).capabilities.length - 12}</Badge>
              ) : null}
            </div>
          </div>
        </Form>
      </Modal>

      {/* Package create/edit */}
      <Modal
        open={pkgFormOpen}
        onClose={bindSet(setPkgFormOpen, false)}
        title={editingPkg ? t('users.editPkg') : t('users.createPkg')}
        description={t('users.createPkgDesc')}
        footer={
          <ActionBar align="end" size="md">
            <Button variant="secondary" size="sm" onClick={bindSet(setPkgFormOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="pkg-form" variant="primary" size="sm" loading={busy}>
              {editingPkg ? t('common.save') : t('users.createPkg')}
            </Button>
          </ActionBar>
        }
      >
        <Form id="pkg-form" columns={1} onSubmit={(e) => void onSavePkg(e)}>
          <Field label={t('common.name')} htmlFor="p-name" flush required>
            <input
              id="p-name"
              value={pkgName}
              onChange={bindInput(setPkgName)}
              required
            />
          </Field>
          <Field label={t('users.maxProjects')} htmlFor="p-proj" flush>
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
              customPlaceholder={t('users.custom')}
            />
          </Field>
          <Field label={t('users.mailboxes')} htmlFor="p-mail" flush>
            <input
              id="p-mail"
              type="number"
              min={0}
              value={pkgMail}
              onChange={bindInput(setPkgMail)}
            />
          </Field>
          <Field label={t('users.databases')} htmlFor="p-db" flush>
            <input
              id="p-db"
              type="number"
              min={0}
              value={pkgDb}
              onChange={bindInput(setPkgDb)}
            />
          </Field>
          <Field label={t('users.diskQuota')} htmlFor="p-disk" flush>
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
          <Field label={t('users.bandwidth')} htmlFor="p-bw" flush>
            <input
              id="p-bw"
              type="number"
              min={0}
              value={pkgBw}
              onChange={bindInput(setPkgBw)}
            />
          </Field>
          <label className="u-text-sm u-flex u-items-center u-gap-2">
            <input type="checkbox" checked={pkgFtp} onChange={bindCheck(setPkgFtp)} />
            {t('users.ftp')}
          </label>
          <label className="u-text-sm u-flex u-items-center u-gap-2">
            <input type="checkbox" checked={pkgSsh} onChange={bindCheck(setPkgSsh)} />
            {t('users.ssh')}
          </label>
          <Field label={t('users.notes')} htmlFor="p-notes" flush>
            <textarea
              id="p-notes"
              value={pkgNotes}
              onChange={bindInput(setPkgNotes)}
              rows={2}
            />
          </Field>
        </Form>
      </Modal>

      <UserDetailModal
        open={detailUser != null}
        user={detailUser}
        packages={pkgOptions.map((p) => ({ id: p.id, name: p.name }))}
        role={detailRole}
        packageId={detailPkg}
        suspended={detailSuspended}
        password={detailPassword}
        grants={detailGrants}
        revokes={detailRevokes}
        effective={effectivePreview}
        busy={busy}
        canImpersonate={canImpersonate}
        isAdminRole={detailRole === 'admin'}
        lock={detailUser ? userMutationLock(detailUser, me?.id, admins) : null}
        onRoleChange={setDetailRole}
        onPackageChange={setDetailPkg}
        onSuspendedChange={setDetailSuspended}
        onPasswordChange={setDetailPassword}
        onGrantsChange={setDetailGrants}
        onRevokesChange={setDetailRevokes}
        onSave={() => void saveDetailUser()}
        onClose={bindSet(setDetailUser, null)}
        onImpersonate={
          detailUser
            ? () => setPending({ kind: 'impersonate', user: detailUser })
            : undefined
        }
        onDelete={
          detailUser && !userMutationLock(detailUser, me?.id, admins)
            ? () => setPending({ kind: 'delUser', user: detailUser })
            : undefined
        }
        onRestoreOverrides={
          detailUser
            ? () => setPending({ kind: 'restoreUserOverrides', user: detailUser })
            : undefined
        }
        onClearTotp={
          detailUser
            ? () => setClearTotp({ user: detailUser, phase: 'username' })
            : undefined
        }
        clearTotpBusy={clearTotpBusy}
      />

      <PromptDialog
        open={clearTotp?.phase === 'username'}
        onClose={() => !clearTotpBusy && setClearTotp(null)}
        title={t('users.securityClearTotp')}
        description={t('users.securityClearConfirm')}
        label={t('users.username')}
        expectExact={clearTotp?.user.username}
        placeholder={clearTotp?.user.username}
        danger
        busy={clearTotpBusy}
        confirmLabel={t('common.confirm')}
        onSubmit={async (name) => {
          if (!clearTotp) return false;
          const target = clearTotp.user;
          setClearTotpBusy(true);
          try {
            await api.requestRaw(`/api/v1/users/${target.id}/security/totp/clear`, {
              method: 'POST',
              body: JSON.stringify({ confirmUsername: name }) });
            setMsg(t('users.securityClearOk', { name: target.username }));
            setDetailUser((u) =>
              u && u.id === target.id ? { ...u, totpEnabled: false } : u,
            );
            setClearTotp(null);
            await refresh();
            return true;
          } catch (e) {
            // Admin has 2FA: require step-up code (keep dialog chain via phase change).
            if (e instanceof ApiError && e.needsTotp) {
              setClearTotp({
                user: target,
                phase: 'totp',
                confirmUsername: name });
              // false → do not run onClose (would wipe phase); open prop switches dialogs
              return false;
            }
            setError(e instanceof Error ? e.message : t('common.failed'));
            return false;
          } finally {
            setClearTotpBusy(false);
          }
        }}
      />

      <PromptDialog
        open={clearTotp?.phase === 'totp'}
        onClose={() => !clearTotpBusy && setClearTotp(null)}
        title={t('users.securityClearTotp')}
        description={t('security.enterTotpCode')}
        label="TOTP"
        secret
        placeholder={t('security.digit6Placeholder')}
        danger
        busy={clearTotpBusy}
        confirmLabel={t('common.confirm')}
        onSubmit={async (totp) => {
          if (!clearTotp) return false;
          const target = clearTotp.user;
          const confirmUsername = clearTotp.confirmUsername ?? target.username;
          setClearTotpBusy(true);
          try {
            await api.requestRaw(`/api/v1/users/${target.id}/security/totp/clear`, {
              method: 'POST',
              body: JSON.stringify({ totp, confirmUsername }) });
            setMsg(t('users.securityClearOk', { name: target.username }));
            setDetailUser((u) =>
              u && u.id === target.id ? { ...u, totpEnabled: false } : u,
            );
            setClearTotp(null);
            await refresh();
            return true;
          } catch (e) {
            setError(e instanceof Error ? e.message : t('common.failed'));
            return false;
          } finally {
            setClearTotpBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={pending != null}
        onClose={() => !busy && setPending(null)}
        title={
          pending?.kind === 'impersonate'
            ? t('users.impersonateTitle', { name: pending.user.username })
            : pending?.kind === 'delUser'
              ? t('users.deleteUserTitle', { name: pending.user.username })
              : pending?.kind === 'delPkg'
                ? t('users.deletePkgTitle', { name: pending.pkg.name })
                : pending?.kind === 'restoreRole'
                  ? t('rbac.restoreRoleTitle', { role: pending.role })
                  : pending?.kind === 'restoreAll'
                    ? t('rbac.restoreAllTitle')
                    : pending?.kind === 'restoreUserOverrides'
                      ? t('rbac.restoreUserOverridesTitle', { name: pending.user.username })
                      : pending?.kind === 'promoteAdmin'
                        ? t('rbac.promoteAdminTitle')
                        : pending?.kind === 'demoteAdmin'
                          ? t('users.demoteAdminTitle')
                          : pending?.kind === 'dangerPolicySave'
                            ? t('rbac.dangerPolicyTitle')
                            : t('common.confirm')
        }
        description={
          pending?.kind === 'impersonate'
            ? t('users.impersonateDesc')
            : pending?.kind === 'delUser'
              ? t('users.deleteUserDesc')
              : pending?.kind === 'delPkg'
                ? t('users.deletePkgDesc')
                : pending?.kind === 'restoreRole'
                  ? t('rbac.restoreRoleDesc')
                  : pending?.kind === 'restoreAll'
                    ? t('rbac.restoreAllDesc')
                    : pending?.kind === 'restoreUserOverrides'
                      ? t('rbac.restoreUserOverridesDesc')
                      : pending?.kind === 'promoteAdmin'
                        ? t('rbac.promoteAdminDesc')
                        : pending?.kind === 'demoteAdmin'
                          ? t('users.demoteAdminDesc')
                          : pending?.kind === 'dangerPolicySave'
                            ? t('rbac.dangerPolicyDesc')
                            : ''
        }
        confirmLabel={
          pending?.kind === 'impersonate'
            ? t('users.impersonate')
            : pending?.kind === 'promoteAdmin' ||
                pending?.kind === 'demoteAdmin' ||
                pending?.kind === 'dangerPolicySave' ||
                pending?.kind === 'restoreRole' ||
                pending?.kind === 'restoreAll' ||
                pending?.kind === 'restoreUserOverrides'
              ? t('common.confirm')
              : t('common.delete')
        }
        cancelLabel={t('common.cancel')}
        danger={
          pending?.kind === 'delUser' ||
          pending?.kind === 'delPkg' ||
          pending?.kind === 'restoreAll' ||
          pending?.kind === 'dangerPolicySave'
        }
        busy={busy}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          if (
            p.kind === 'promoteAdmin' ||
            p.kind === 'demoteAdmin' ||
            p.kind === 'dangerPolicySave'
          ) {
            p.next();
            return;
          }
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
                body: '{}' })
              .then((r) => {
                authStore.setSession(r.token, {
                  id: r.user.id,
                  username: r.user.username,
                  roles: r.user.roles,
                  locale: r.user.locale ?? 'zh-HK' });
                window.location.href = '/';
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'delUser') {
            setBusy(true);
            void api
              .requestRaw(`/api/v1/users/${p.user.id}`, { method: 'DELETE' })
              .then(() => {
                setDetailUser(null);
                return refresh();
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'delPkg') {
            setBusy(true);
            void api
              .requestRaw(`/api/v1/packages/${p.pkg.id}`, { method: 'DELETE' })
              .then(() => refresh())
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'restoreRole') {
            setBusy(true);
            void api
              .requestRaw(`/api/v1/rbac/policies/${p.role}/restore`, { method: 'POST', body: '{}' })
              .then(() => {
                setMsg(t('rbac.restoredRole', { role: p.role }));
                return refresh();
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'restoreAll') {
            setBusy(true);
            void api
              .requestRaw('/api/v1/rbac/policies/restore-all', { method: 'POST', body: '{}' })
              .then(() => {
                setMsg(t('rbac.restoredAll'));
                return refresh();
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          } else if (p.kind === 'restoreUserOverrides') {
            setBusy(true);
            void api
              .requestRaw(`/api/v1/rbac/users/${p.user.id}/restore`, {
                method: 'POST',
                body: '{}' })
              .then(() => {
                setDetailGrants([]);
                setDetailRevokes([]);
                return refresh();
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }
        }}
      />
    </FeaturePageLayout>
  );
}
