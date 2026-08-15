/**
 * Durable JSON control-plane store (atomic writes).
 * Default backend. SQLite uses sql.js (no native addon) when YSK_STORE=sqlite.
 * Provides real restart-safe persistence for users/sessions/projects/audit.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type {
  CapabilityId,
  SystemRole,
  ApprovalStatus,
  RiskTier,
  OperationLevel,
  HostingRuntime,
} from 'ysk-server-shared';

export interface StoreUser {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  roles: SystemRole[];
  locale: string;
  /** Package template id */
  package_id?: string;
  /** Suspended panel user */
  suspended?: boolean;
  /** Base32 TOTP secret when 2FA enrolled (plain or yskenc:v1:…) */
  totp_secret?: string;
  /** true only after user confirms a valid code */
  totp_enabled?: boolean;
  /** Last accepted TOTP time-step (anti-replay) */
  totp_last_step?: number;
  /** SHA-256 hashes of one-time recovery codes */
  totp_recovery_hashes?: string[];
  /** Per-user capability grants on top of role policy */
  capability_grants?: CapabilityId[];
  /** Per-user capability revokes */
  capability_revokes?: CapabilityId[];
  /**
   * Force password change on next successful login flow.
   * Set when bootstrap used a weak/default password.
   */
  must_change_password?: boolean;
  created_at: string;
  updated_at: string;
}

/** Persisted role policy override (null/missing role → factory) */
export interface StoreRolePolicy {
  maxLevel: OperationLevel;
  capabilities: CapabilityId[];
  defaultsVersion?: number;
  updated_at?: string;
  updated_by?: string;
}

/** Hosting package quotas (Hestia/DA style) */
export interface StorePackage {
  id: string;
  name: string;
  /** max projects / sites */
  max_projects: number;
  max_mailboxes: number;
  max_databases: number;
  /** disk MiB, 0 = unlimited */
  disk_mb: number;
  /** bandwidth MiB/month, 0 = unlimited */
  bandwidth_mb: number;
  allow_ssh: boolean;
  allow_ftp: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface StoreSession {
  /**
   * Legacy plaintext token (migrated away on first use).
   * New sessions only store token_hash + token_prefix.
   */
  token?: string;
  /** SHA-256 hex of session bearer (preferred) */
  token_hash?: string;
  /** First 12 chars of plaintext for public session id / revoke */
  token_prefix?: string;
  user_id: string;
  /** Absolute expiry (max lifetime) */
  expires_at: string;
  created_at: string;
  /** Sliding idle activity */
  last_seen_at?: string;
  user_agent?: string;
  ip?: string;
  label?: string;
}

export interface StoreProject {
  id: string;
  name: string;
  domain?: string;
  /** Extra hostnames for server_name */
  domain_aliases?: string[];
  linux_user: string;
  linux_group: string;
  home_dir: string;
  runtime: HostingRuntime;
  runtime_version?: string;
  env: 'staging' | 'production';
  status: string;
  nginx_config_path?: string;
  os_provisioned: boolean;
  /** Listen port for app process (Node/PHP-FPM proxy target) */
  port?: number;
  /** User-requested fixed process port (deploy prefers this when free) */
  preferred_port?: number;
  /** Running process pid when managed by control plane */
  pid?: number;
  pidfile?: string;
  /** stopped | starting | running | unhealthy | failed */
  process_status?: string;
  /** Redirect HTTP→HTTPS when SSL conf published */
  force_https?: boolean;
  /** Emit HSTS when SSL conf published */
  hsts?: boolean;
  /** Whole-site 301 target URL (optional) */
  site_redirect_url?: string;
  /** HTTP basic auth user (optional) */
  http_auth_user?: string;
  http_auth_pass?: string;
  /** Custom document root relative to home (default app/public or app) */
  doc_root?: string;
  /** Optional bind IP for nginx listen (empty = all) */
  bind_ip?: string;
  /**
   * Real client IP provider override for this site.
   * undefined / omit = inherit host default; 'none' = force off.
   */
  real_ip_provider?: string;
  last_health?: Record<string, unknown>;
  last_deploy_at?: string;
  /** Git remote for deploy */
  git_url?: string;
  git_branch?: string;
  git_commit?: string;
  git_shallow?: boolean;
  git_last_error?: { code: string; message: string; at: string };
  git_auth_kind?: 'none' | 'ssh' | 'https-token';
  git_identity_id?: string;
  git_hook_enabled?: boolean;
  /** App env vars written to .env */
  env_vars?: Record<string, string>;
  last_backup_path?: string;
  last_backup_at?: string;
  /** Disk soft quota MiB */
  quota_mb?: number;
  /** systemd MemoryMax e.g. 512M */
  memory_max?: string;
  /** systemd CPUQuota percent */
  cpu_quota_percent?: number;
  /** systemd TasksMax (process count cap) */
  tasks_max?: number;
  /** systemd LimitNOFILE */
  limit_nofile?: number;
  /** login shell (default /usr/sbin/nologin) */
  shell?: string;
  /** usermod -L lock */
  account_locked?: boolean;
  /** Last process deploy entry (server.js, main:app, ./app, …) */
  deploy_entry?: string;
  /** Last resolved runtime binary (may differ from planned runtime_version) */
  runtime_bin?: string;
  /** Last deploy operator notes (short, newest first, max ~8) */
  last_deploy_notes?: string[];
  /**
   * Extra log scan dirs relative to home_dir (e.g. storage/logs, var/log).
   * Always also scans logs/ and log/.
   */
  log_extra_dirs?: string[];
  /** Panel user id that owns this project (package quota scope) */
  owner_user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface StoreApproval {
  id: string;
  action: string;
  risk: RiskTier;
  requested_by: string;
  status: ApprovalStatus;
  payload: unknown;
  created_at: string;
  decided_at?: string;
  decided_by?: string;
}

export interface StoreAudit {
  id: string;
  actor: string;
  action: string;
  resource?: string;
  detail: unknown;
  ok: boolean;
  created_at: string;
}

export interface StoreData {
  version: number;
  users: StoreUser[];
  packages: StorePackage[];
  sessions: StoreSession[];
  projects: StoreProject[];
  approvals: StoreApproval[];
  audit_events: StoreAudit[];
  settings: Record<string, string>;
  agent_sessions: Array<Record<string, unknown>>;
  agent_messages: Array<Record<string, unknown>>;
  email_domains: Array<Record<string, unknown>>;
  /** AI tasks Plan→Review→Execute */
  ai_tasks: Array<Record<string, unknown>>;
  playbook_runs: Array<Record<string, unknown>>;
  update_jobs: Array<Record<string, unknown>>;
  dns_zones: Array<Record<string, unknown>>;
  firewall_rules: Array<Record<string, unknown>>;
  certificates: Array<Record<string, unknown>>;
  mailboxes: Array<Record<string, unknown>>;
  /** Mail aliases / forwards / catch-all per domain */
  email_aliases: Array<Record<string, unknown>>;
  cron_jobs: Array<Record<string, unknown>>;
  /** Managed control-plane resource registries (CRUD entities) */
  nginx_sites: Array<Record<string, unknown>>;
  ftp_accounts: Array<Record<string, unknown>>;
  mysql_databases: Array<Record<string, unknown>>;
  mysql_users: Array<Record<string, unknown>>;
  postgres_databases: Array<Record<string, unknown>>;
  postgres_users: Array<Record<string, unknown>>;
  redis_instances: Array<Record<string, unknown>>;
  dns_records: Array<Record<string, unknown>>;
  /** Public file share links (ownCloud-style) */
  file_shares: Array<Record<string, unknown>>;
  /** File favorites paths per root */
  file_favorites: Array<Record<string, unknown>>;
  /** Panel API access keys (token hash) */
  api_keys: Array<Record<string, unknown>>;
  /**
   * Role-level RBAC policy overrides. Missing role key → factory defaults.
   * One-click restore deletes the role entry (or clears the whole map).
   */
  rbac_policies?: Partial<Record<SystemRole, StoreRolePolicy>>;
  /** Remote backup destination settings */
  backup_remote?: {
    enabled: boolean;
    kind: 'sftp' | 'local' | 's3';
    host?: string;
    port?: number;
    username?: string;
    /** path on remote or local extra mirror */
    path?: string;
    /** not ideal — store for MVP panel ops; prefer key later */
    password?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3Endpoint?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
  };
  /** Global backup exclusion globs */
  backup_exclusions?: string[];
}

const ARRAY_COLLECTION_KEYS = [
  'users',
  'packages',
  'sessions',
  'projects',
  'approvals',
  'audit_events',
  'agent_sessions',
  'agent_messages',
  'email_domains',
  'ai_tasks',
  'playbook_runs',
  'update_jobs',
  'dns_zones',
  'firewall_rules',
  'certificates',
  'mailboxes',
  'email_aliases',
  'cron_jobs',
  'nginx_sites',
  'ftp_accounts',
  'mysql_databases',
  'mysql_users',
  'postgres_databases',
  'postgres_users',
  'redis_instances',
  'dns_records',
  'file_shares',
  'file_favorites',
  'api_keys',
] as const;

function itemKey(it: unknown): string | undefined {
  if (!it || typeof it !== 'object') return undefined;
  const id = (it as { id?: unknown }).id;
  return id == null || id === '' ? undefined : String(id);
}

function idsOf(arr: unknown[]): Set<string> {
  const s = new Set<string>();
  for (const it of arr) {
    const k = itemKey(it);
    if (k) s.add(k);
  }
  return s;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function indexById<T>(arr: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of arr) {
    const k = itemKey(it);
    if (k) m.set(k, it);
  }
  return m;
}

function rowUpdatedAt(row: unknown): number {
  if (!row || typeof row !== 'object') return 0;
  const ts = Date.parse(String((row as { updated_at?: unknown }).updated_at ?? ''));
  return Number.isFinite(ts) ? ts : 0;
}

/** Never clobber these when this process did not change them (2FA / password). */
export const MERGE_PROTECT_FIELDS = [
  'totp_secret',
  'totp_enabled',
  'totp_last_step',
  'totp_recovery_hashes',
  'password_hash',
  'password_salt',
] as const;

function mergeConflictRow<T>(ours: T, disk: T, baseline: T | undefined): T {
  const oursObj = ours && typeof ours === 'object' ? (ours as Record<string, unknown>) : {};
  const diskObj = disk && typeof disk === 'object' ? (disk as Record<string, unknown>) : {};
  const baseObj =
    baseline && typeof baseline === 'object' ? (baseline as Record<string, unknown>) : {};
  const oursTs = rowUpdatedAt(ours);
  const diskTs = rowUpdatedAt(disk);
  const newer = diskTs > oursTs ? diskObj : oursObj;
  const older = newer === diskObj ? oursObj : diskObj;
  const merged: Record<string, unknown> = { ...older, ...newer };
  for (const f of MERGE_PROTECT_FIELDS) {
    const oursChanged = !sameJson(oursObj[f], baseObj[f]);
    const diskChanged = !sameJson(diskObj[f], baseObj[f]);
    const src = oursChanged && !diskChanged
      ? oursObj
      : !oursChanged && diskChanged
        ? diskObj
        : oursChanged && diskChanged
          ? diskTs > oursTs
            ? diskObj
            : oursObj
          : null;
    if (!src) continue;
    if (src[f] === undefined) delete merged[f];
    else merged[f] = src[f];
  }
  return merged as T;
}

/**
 * Three-way merge: keep our edits/deletes, pick up rows another process inserted.
 * Same id: unchanged local row takes disk; both-changed keeps totp_/password_ if we did not touch them.
 */
export function mergeIdArray<T>(baseline: T[], ours: T[], disk: T[]): T[] {
  const deleted = new Set(
    [...idsOf(baseline as unknown[])].filter((id) => !idsOf(ours as unknown[]).has(id)),
  );
  const baseBy = indexById(baseline);
  const diskBy = indexById(disk);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of ours) {
    const k = itemKey(it);
    if (!k) {
      out.push(it);
      continue;
    }
    seen.add(k);
    const b = baseBy.get(k);
    const d = diskBy.get(k);
    if (!d) {
      // Disk dropped a row we still hold. If we knew it (in baseline),
      // another process deleted it — do not resurrect. Keep only our inserts.
      if (!b) out.push(it);
      continue;
    }
    if (sameJson(it, b)) out.push(d);
    else if (sameJson(d, b)) out.push(it);
    else out.push(mergeConflictRow(it, d, b));
  }
  for (const it of disk) {
    const k = itemKey(it);
    if (!k || deleted.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function hydrateStoreData(raw: unknown): StoreData {
  const src = raw && typeof raw === 'object' ? (raw as Partial<StoreData>) : {};
  const data: StoreData = { ...structuredClone(EMPTY), ...src };
  for (const k of ARRAY_COLLECTION_KEYS) {
    const v = data[k];
    (data as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? v : [];
  }
  data.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  data.backup_exclusions = Array.isArray(data.backup_exclusions) ? data.backup_exclusions : [];
  data.version = typeof data.version === 'number' && Number.isFinite(data.version) ? data.version : EMPTY.version;
  return data;
}

/** Three-way settings: unchanged local keys take disk (WebDAV / last_backup_run). */
export function mergeSettingsMap(
  baseline: Record<string, string>,
  ours: Record<string, string>,
  disk: Record<string, string>,
): Record<string, string> {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(ours), ...Object.keys(disk)]);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const b = Object.prototype.hasOwnProperty.call(baseline, k) ? baseline[k] : undefined;
    const o = Object.prototype.hasOwnProperty.call(ours, k) ? ours[k] : undefined;
    const d = Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : undefined;
    const oursDeleted = b !== undefined && o === undefined;
    if (oursDeleted) continue;
    if (o === undefined) {
      if (d !== undefined) out[k] = d;
      continue;
    }
    if (sameJson(o, b)) {
      if (d !== undefined) out[k] = d;
      else out[k] = o;
      continue;
    }
    if (d === undefined || sameJson(d, b)) {
      out[k] = o;
      continue;
    }
    out[k] = o;
  }
  return out;
}

export function mergeStoreData(baseline: StoreData, ours: StoreData, disk: StoreData): StoreData {
  const out = hydrateStoreData(ours);
  for (const k of ARRAY_COLLECTION_KEYS) {
    (out as unknown as Record<string, unknown>)[k] = mergeIdArray(
      (baseline[k] as unknown[]) ?? [],
      (ours[k] as unknown[]) ?? [],
      (disk[k] as unknown[]) ?? [],
    );
  }
  out.settings = mergeSettingsMap(baseline.settings ?? {}, ours.settings ?? {}, disk.settings ?? {});
  const exclChanged =
    JSON.stringify(ours.backup_exclusions ?? []) !== JSON.stringify(baseline.backup_exclusions ?? []);
  out.backup_exclusions = exclChanged ? ours.backup_exclusions ?? [] : disk.backup_exclusions ?? [];
  const remoteChanged = JSON.stringify(ours.backup_remote) !== JSON.stringify(baseline.backup_remote);
  out.backup_remote = remoteChanged ? ours.backup_remote : disk.backup_remote;
  const rbacChanged = JSON.stringify(ours.rbac_policies) !== JSON.stringify(baseline.rbac_policies);
  out.rbac_policies = rbacChanged ? ours.rbac_policies : disk.rbac_policies;
  out.version = Math.max(ours.version ?? 0, disk.version ?? 0, EMPTY.version);
  return out;
}

function withStoreLock(storePath: string, fn: () => void): void {
  const lockPath = `${storePath}.lock`;
  const start = Date.now();
  let fd: number | undefined;
  while (fd == null) {
    try {
      fd = openSync(lockPath, 'wx');
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
    } catch {
      try {
        if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 30_000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* retry */
      }
      if (Date.now() - start > 15_000) {
        throw new Error(`ysk store lock timeout: ${lockPath}`);
      }
      const wait = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(wait, 0, 0, 25);
    }
  }
  try {
    fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

const EMPTY: StoreData = {
  version: 3,
  users: [],
  packages: [],
  sessions: [],
  projects: [],
  approvals: [],
  audit_events: [],
  settings: {},
  agent_sessions: [],
  agent_messages: [],
  email_domains: [],
  ai_tasks: [],
  playbook_runs: [],
  update_jobs: [],
  dns_zones: [],
  firewall_rules: [],
  certificates: [],
  mailboxes: [],
  email_aliases: [],
  cron_jobs: [],
  nginx_sites: [],
  ftp_accounts: [],
  mysql_databases: [],
  mysql_users: [],
  postgres_databases: [],
  postgres_users: [],
  redis_instances: [],
  dns_records: [],
  file_shares: [],
  file_favorites: [],
  api_keys: [],
};

export class JsonStore {
  private data: StoreData;
  private baseline: StoreData;
  private loadedMtime: number;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      this.data = hydrateStoreData(JSON.parse(readFileSync(path, 'utf8')));
      this.loadedMtime = statSync(path).mtimeMs;
    } else {
      this.data = structuredClone(EMPTY);
      this.loadedMtime = 0;
      this.baseline = structuredClone(this.data);
      this.persist();
      return;
    }
    this.baseline = structuredClone(this.data);
  }

  get snapshot(): StoreData {
    return this.data;
  }

  /** Pull in rows another process wrote. Safe to call before mutating. */
  reloadIfStale(): void {
    if (!existsSync(this.path)) return;
    if (statSync(this.path).mtimeMs <= this.loadedMtime) return;
    withStoreLock(this.path, () => this.mergeFromDiskUnlocked());
  }

  private mergeFromDiskUnlocked(): void {
    if (!existsSync(this.path)) return;
    const mtime = statSync(this.path).mtimeMs;
    if (mtime <= this.loadedMtime) return;
    const disk = hydrateStoreData(JSON.parse(readFileSync(this.path, 'utf8')));
    this.data = mergeStoreData(this.baseline, this.data, disk);
    this.loadedMtime = mtime;
    this.baseline = structuredClone(disk);
  }

  persist(opts?: { replace?: boolean }): void {
    withStoreLock(this.path, () => {
      if (!opts?.replace) this.mergeFromDiskUnlocked();
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmp, this.path);
      this.loadedMtime = statSync(this.path).mtimeMs;
      this.baseline = structuredClone(this.data);
    });
  }

  close(): void {
    this.persist();
  }
}

/** Control-plane DB handle (JsonStore; sqlite/postgres backends subclass JsonStore). */
export type YskDatabase = JsonStore;
