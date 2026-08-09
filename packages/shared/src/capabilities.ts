/**
 * Adjustable multi-level RBAC — capability catalog + factory defaults.
 * Browser-safe (no Node APIs). Single source for server enforce + web UI.
 */

import type { OperationLevel, SystemRole } from './types.js';

/** Stable capability ids used in API, policies, and UI. */
export type CapabilityId =
  | 'dashboard.read'
  | 'logs.read'
  | 'metrics.read'
  | 'projects.read'
  | 'mail.read'
  | 'dns.read'
  | 'ssl.read'
  | 'backups.read'
  | 'updates.read'
  | 'services.read'
  | 'firewall.read'
  | 'approvals.view'
  | 'users.self'
  | 'projects.write'
  | 'mail.write'
  | 'db.write'
  | 'ssl.upload'
  | 'files.project'
  | 'approvals.respond'
  | 'cron.manage'
  | 'backups.run'
  | 'services.control'
  | 'updates.apply'
  | 'dns.apply'
  | 'ssl.issue'
  | 'publish.apply'
  | 'firewall.edit'
  | 'mail.apply'
  | 'runtime.tuning'
  | 'mysql.console.write'
  | 'projects.delete'
  | 'db.drop'
  | 'backups.restore'
  | 'firewall.flush'
  | 'logs.purge'
  | 'users.manage'
  | 'packages.manage'
  | 'users.impersonate'
  | 'security.policy'
  | 'rbac.policy'
  | 'settings.system'
  | 'network.browse'
  | 'audit.export'
  | 'security.api_keys.admin';

export interface CapabilityDef {
  id: CapabilityId;
  /** Danger band — used for maxLevel filter + UI grouping */
  band: OperationLevel;
  /** i18n key under rbac.cap.* */
  labelKey: string;
}

/** Bump when factory grants change so dirty merge can reason about versions. */
export const RBAC_DEFAULTS_VERSION = 1;

const LEVEL_RANK: Record<OperationLevel, number> = {
  read: 1,
  'write-low': 2,
  'write-high': 3,
  destructive: 4,
  privilege: 5,
};

export const OPERATION_LEVELS: OperationLevel[] = [
  'read',
  'write-low',
  'write-high',
  'destructive',
  'privilege',
];

export const SYSTEM_ROLES: SystemRole[] = ['admin', 'operator', 'viewer', 'agent'];

/** Full catalog — add new capabilities here first. */
export const CAPABILITY_CATALOG: readonly CapabilityDef[] = [
  // read
  { id: 'dashboard.read', band: 'read', labelKey: 'rbac.cap.dashboardRead' },
  { id: 'logs.read', band: 'read', labelKey: 'rbac.cap.logsRead' },
  { id: 'metrics.read', band: 'read', labelKey: 'rbac.cap.metricsRead' },
  { id: 'projects.read', band: 'read', labelKey: 'rbac.cap.projectsRead' },
  { id: 'mail.read', band: 'read', labelKey: 'rbac.cap.mailRead' },
  { id: 'dns.read', band: 'read', labelKey: 'rbac.cap.dnsRead' },
  { id: 'ssl.read', band: 'read', labelKey: 'rbac.cap.sslRead' },
  { id: 'backups.read', band: 'read', labelKey: 'rbac.cap.backupsRead' },
  { id: 'updates.read', band: 'read', labelKey: 'rbac.cap.updatesRead' },
  { id: 'services.read', band: 'read', labelKey: 'rbac.cap.servicesRead' },
  { id: 'firewall.read', band: 'read', labelKey: 'rbac.cap.firewallRead' },
  { id: 'approvals.view', band: 'read', labelKey: 'rbac.cap.approvalsView' },
  { id: 'users.self', band: 'read', labelKey: 'rbac.cap.usersSelf' },
  // write-low
  { id: 'projects.write', band: 'write-low', labelKey: 'rbac.cap.projectsWrite' },
  { id: 'mail.write', band: 'write-low', labelKey: 'rbac.cap.mailWrite' },
  { id: 'db.write', band: 'write-low', labelKey: 'rbac.cap.dbWrite' },
  { id: 'ssl.upload', band: 'write-low', labelKey: 'rbac.cap.sslUpload' },
  { id: 'files.project', band: 'write-low', labelKey: 'rbac.cap.filesProject' },
  { id: 'approvals.respond', band: 'write-low', labelKey: 'rbac.cap.approvalsRespond' },
  { id: 'cron.manage', band: 'write-low', labelKey: 'rbac.cap.cronManage' },
  // write-high
  { id: 'backups.run', band: 'write-high', labelKey: 'rbac.cap.backupsRun' },
  { id: 'services.control', band: 'write-high', labelKey: 'rbac.cap.servicesControl' },
  { id: 'updates.apply', band: 'write-high', labelKey: 'rbac.cap.updatesApply' },
  { id: 'dns.apply', band: 'write-high', labelKey: 'rbac.cap.dnsApply' },
  { id: 'ssl.issue', band: 'write-high', labelKey: 'rbac.cap.sslIssue' },
  { id: 'publish.apply', band: 'write-high', labelKey: 'rbac.cap.publishApply' },
  { id: 'firewall.edit', band: 'write-high', labelKey: 'rbac.cap.firewallEdit' },
  { id: 'mail.apply', band: 'write-high', labelKey: 'rbac.cap.mailApply' },
  { id: 'runtime.tuning', band: 'write-high', labelKey: 'rbac.cap.runtimeTuning' },
  { id: 'mysql.console.write', band: 'write-high', labelKey: 'rbac.cap.mysqlConsoleWrite' },
  // destructive
  { id: 'projects.delete', band: 'destructive', labelKey: 'rbac.cap.projectsDelete' },
  { id: 'db.drop', band: 'destructive', labelKey: 'rbac.cap.dbDrop' },
  { id: 'backups.restore', band: 'destructive', labelKey: 'rbac.cap.backupsRestore' },
  { id: 'firewall.flush', band: 'destructive', labelKey: 'rbac.cap.firewallFlush' },
  { id: 'logs.purge', band: 'destructive', labelKey: 'rbac.cap.logsPurge' },
  // privilege
  { id: 'users.manage', band: 'privilege', labelKey: 'rbac.cap.usersManage' },
  { id: 'packages.manage', band: 'privilege', labelKey: 'rbac.cap.packagesManage' },
  { id: 'users.impersonate', band: 'privilege', labelKey: 'rbac.cap.usersImpersonate' },
  { id: 'security.policy', band: 'privilege', labelKey: 'rbac.cap.securityPolicy' },
  { id: 'rbac.policy', band: 'privilege', labelKey: 'rbac.cap.rbacPolicy' },
  { id: 'settings.system', band: 'privilege', labelKey: 'rbac.cap.settingsSystem' },
  { id: 'network.browse', band: 'privilege', labelKey: 'rbac.cap.networkBrowse' },
  { id: 'audit.export', band: 'privilege', labelKey: 'rbac.cap.auditExport' },
  { id: 'security.api_keys.admin', band: 'privilege', labelKey: 'rbac.cap.securityApiKeysAdmin' },
] as const;

const CATALOG_BY_ID = new Map(CAPABILITY_CATALOG.map((c) => [c.id, c]));

export function isCapabilityId(value: string): value is CapabilityId {
  return CATALOG_BY_ID.has(value as CapabilityId);
}

export function getCapabilityDef(id: CapabilityId): CapabilityDef | undefined {
  return CATALOG_BY_ID.get(id);
}

export function capabilitiesInBand(band: OperationLevel): CapabilityId[] {
  return CAPABILITY_CATALOG.filter((c) => c.band === band).map((c) => c.id);
}

export function capabilitiesUpToLevel(maxLevel: OperationLevel): CapabilityId[] {
  const max = LEVEL_RANK[maxLevel];
  return CAPABILITY_CATALOG.filter((c) => LEVEL_RANK[c.band] <= max).map((c) => c.id);
}

export function levelRank(level: OperationLevel): number {
  return LEVEL_RANK[level];
}

export function compareLevels(a: OperationLevel, b: OperationLevel): number {
  return LEVEL_RANK[a] - LEVEL_RANK[b];
}

/** Persisted / API shape for one role's policy */
export interface RolePolicy {
  maxLevel: OperationLevel;
  /** Explicit grants (after maxLevel filter on write) */
  capabilities: CapabilityId[];
  /** When set, diverged from factory for this defaultsVersion */
  defaultsVersion?: number;
}

/** Factory max level per role */
export const ROLE_FACTORY_MAX_LEVEL: Record<SystemRole, OperationLevel> = {
  admin: 'privilege',
  operator: 'write-high',
  viewer: 'read',
  agent: 'write-low',
};

function factoryCaps(role: SystemRole): CapabilityId[] {
  return capabilitiesUpToLevel(ROLE_FACTORY_MAX_LEVEL[role]);
}

/** Code-level factory defaults — restore target */
export function factoryRolePolicy(role: SystemRole): RolePolicy {
  return {
    maxLevel: ROLE_FACTORY_MAX_LEVEL[role],
    capabilities: factoryCaps(role),
    defaultsVersion: RBAC_DEFAULTS_VERSION,
  };
}

export function factoryRolePolicies(): Record<SystemRole, RolePolicy> {
  return {
    admin: factoryRolePolicy('admin'),
    operator: factoryRolePolicy('operator'),
    viewer: factoryRolePolicy('viewer'),
    agent: factoryRolePolicy('agent'),
  };
}

/** Normalize + filter caps by maxLevel; drop unknown ids */
export function normalizeRolePolicy(input: {
  maxLevel?: OperationLevel;
  capabilities?: string[];
}): RolePolicy {
  const maxLevel = input.maxLevel && LEVEL_RANK[input.maxLevel] ? input.maxLevel : 'read';
  const max = LEVEL_RANK[maxLevel];
  const capabilities = [
    ...new Set(
      (input.capabilities ?? [])
        .filter((id): id is CapabilityId => isCapabilityId(id))
        .filter((id) => {
          const def = CATALOG_BY_ID.get(id);
          return def ? LEVEL_RANK[def.band] <= max : false;
        }),
    ),
  ].sort();
  return {
    maxLevel,
    capabilities,
    defaultsVersion: RBAC_DEFAULTS_VERSION,
  };
}

/** Whether policy matches factory for role (order-independent) */
export function isFactoryPolicy(role: SystemRole, policy: RolePolicy): boolean {
  const factory = factoryRolePolicy(role);
  if (policy.maxLevel !== factory.maxLevel) return false;
  const a = [...policy.capabilities].sort().join('\0');
  const b = [...factory.capabilities].sort().join('\0');
  return a === b;
}

/**
 * Resolve stored policy against current factory.
 * - missing / exact factory / pure subset of factory (same maxLevel) → full factory, not dirty
 *   (auto-picks new catalog caps after defaultsVersion bumps without re-adding intentional extras)
 * - otherwise keep stored list as dirty custom policy
 */
export function resolveRolePolicy(
  role: SystemRole,
  stored: RolePolicy | null | undefined,
): { policy: RolePolicy; dirty: boolean } {
  const factory = factoryRolePolicy(role);
  // Admin role is locked to full factory — stored customizations ignored
  if (role === 'admin') {
    return { policy: factory, dirty: false };
  }
  if (!stored) {
    return { policy: factory, dirty: false };
  }
  const norm = normalizeRolePolicy(stored);
  if (isFactoryPolicy(role, norm)) {
    return { policy: factory, dirty: false };
  }
  const factorySet = new Set(factory.capabilities);
  const hasExtra = norm.capabilities.some((c) => !factorySet.has(c));
  const maxMatches = norm.maxLevel === factory.maxLevel;
  if (maxMatches && !hasExtra) {
    // Pure subset of factory (e.g. older snapshot missing backups.run) → upgrade
    return { policy: factory, dirty: false };
  }
  return {
    policy: {
      ...norm,
      defaultsVersion: RBAC_DEFAULTS_VERSION,
    },
    dirty: true,
  };
}

/**
 * Critical privilege set that must never be fully removed from the panel
 * (at least one non-suspended holder must keep these).
 */
export const CRITICAL_PRIVILEGE_CAPS: readonly CapabilityId[] = [
  'users.manage',
  'rbac.policy',
  'packages.manage',
  'users.impersonate',
  'security.policy',
  'settings.system',
] as const;

/** True if set contains the minimum privilege pair to recover the panel. */
export function hasCriticalPrivilege(caps: readonly CapabilityId[]): boolean {
  return (
    hasCapability(caps, 'users.manage') && hasCapability(caps, 'rbac.policy')
  );
}

/**
 * Effective capabilities for an actor.
 * roles → union of (rolePolicy ?? factory), then +grants −revokes.
 *
 * **Hard guarantee:** any principal with the `admin` system role always keeps
 * the full admin factory pack (cannot be stripped by dirty role policy or
 * per-user revokes). This ensures at least panel admins stay fully open.
 */
export function computeEffectiveCapabilities(input: {
  roles: SystemRole[];
  /** Custom policies; missing role → factory */
  rolePolicies?: Partial<Record<SystemRole, RolePolicy | null | undefined>>;
  grants?: CapabilityId[] | string[];
  revokes?: CapabilityId[] | string[];
}): CapabilityId[] {
  const set = new Set<CapabilityId>();
  const roles = input.roles?.length ? input.roles : (['viewer'] as SystemRole[]);
  const isAdmin = roles.includes('admin');

  for (const role of roles) {
    if (!ROLE_FACTORY_MAX_LEVEL[role]) continue;
    // Admin role is never reduced by stored policy — always full factory open.
    if (role === 'admin') {
      for (const cap of factoryRolePolicy('admin').capabilities) {
        set.add(cap);
      }
      continue;
    }
    const custom = input.rolePolicies?.[role];
    const policy =
      custom === null || custom === undefined
        ? factoryRolePolicy(role)
        : normalizeRolePolicy(custom);
    for (const cap of policy.capabilities) {
      set.add(cap);
    }
  }

  for (const g of input.grants ?? []) {
    if (isCapabilityId(g)) set.add(g);
  }
  // Per-user revokes: never strip anything from admin principals
  if (!isAdmin) {
    for (const r of input.revokes ?? []) {
      if (isCapabilityId(r)) set.delete(r);
    }
  }

  // Belt: if somehow empty but marked admin, force full factory
  if (isAdmin && set.size === 0) {
    for (const cap of factoryRolePolicy('admin').capabilities) set.add(cap);
  }

  return [...set].sort();
}

export function hasCapability(
  effective: readonly CapabilityId[] | Set<CapabilityId>,
  cap: CapabilityId,
): boolean {
  if (effective instanceof Set) return effective.has(cap);
  return effective.includes(cap);
}

/** Batch: all caps in band for toggle-all UI */
export function applyBandToCapabilities(
  current: CapabilityId[],
  band: OperationLevel,
  enabled: boolean,
  maxLevel: OperationLevel,
): CapabilityId[] {
  const bandCaps = capabilitiesInBand(band);
  if (LEVEL_RANK[band] > LEVEL_RANK[maxLevel]) {
    // cannot enable above maxLevel
    if (enabled) return [...current];
  }
  const set = new Set(current);
  for (const id of bandCaps) {
    if (enabled) {
      if (LEVEL_RANK[band] <= LEVEL_RANK[maxLevel]) set.add(id);
    } else {
      set.delete(id);
    }
  }
  return normalizeRolePolicy({ maxLevel, capabilities: [...set] }).capabilities;
}
