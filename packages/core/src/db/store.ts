/**
 * Durable JSON control-plane store (atomic writes).
 * Used instead of native better-sqlite3 when the environment cannot load it.
 * Provides real restart-safe persistence for users/sessions/projects/audit.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SystemRole, ApprovalStatus, RiskTier } from '@ysk/shared';

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
  created_at: string;
  updated_at: string;
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
  token: string;
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
  runtime: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
  runtime_version?: string;
  env: 'staging' | 'production';
  status: string;
  nginx_config_path?: string;
  os_provisioned: boolean;
  /** Listen port for app process (Node/PHP-FPM proxy target) */
  port?: number;
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
  last_health?: Record<string, unknown>;
  last_deploy_at?: string;
  /** Git remote for deploy */
  git_url?: string;
  git_branch?: string;
  git_commit?: string;
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
  /** Last deploy operator notes (short, newest first, max ~8) */
  last_deploy_notes?: string[];
  /**
   * Extra log scan dirs relative to home_dir (e.g. storage/logs, var/log).
   * Always also scans logs/ and log/.
   */
  log_extra_dirs?: string[];
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
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      this.data = { ...EMPTY, ...JSON.parse(readFileSync(path, 'utf8')) };
      // ensure arrays / maps
      this.data.users = this.data.users ?? [];
      this.data.packages = this.data.packages ?? [];
      this.data.sessions = this.data.sessions ?? [];
      this.data.projects = this.data.projects ?? [];
      this.data.backup_exclusions = this.data.backup_exclusions ?? [];
      this.data.approvals = this.data.approvals ?? [];
      this.data.audit_events = this.data.audit_events ?? [];
      this.data.settings = this.data.settings ?? {};
      this.data.agent_sessions = this.data.agent_sessions ?? [];
      this.data.agent_messages = this.data.agent_messages ?? [];
      this.data.email_domains = this.data.email_domains ?? [];
      this.data.ai_tasks = this.data.ai_tasks ?? [];
      this.data.playbook_runs = this.data.playbook_runs ?? [];
      this.data.update_jobs = this.data.update_jobs ?? [];
      this.data.dns_zones = this.data.dns_zones ?? [];
      this.data.firewall_rules = this.data.firewall_rules ?? [];
      this.data.certificates = this.data.certificates ?? [];
      this.data.mailboxes = this.data.mailboxes ?? [];
      this.data.email_aliases = this.data.email_aliases ?? [];
      this.data.cron_jobs = this.data.cron_jobs ?? [];
      this.data.nginx_sites = this.data.nginx_sites ?? [];
      this.data.ftp_accounts = this.data.ftp_accounts ?? [];
      this.data.mysql_databases = this.data.mysql_databases ?? [];
      this.data.mysql_users = this.data.mysql_users ?? [];
      this.data.postgres_databases = this.data.postgres_databases ?? [];
      this.data.postgres_users = this.data.postgres_users ?? [];
      this.data.redis_instances = this.data.redis_instances ?? [];
      this.data.dns_records = this.data.dns_records ?? [];
      this.data.file_shares = this.data.file_shares ?? [];
      this.data.file_favorites = this.data.file_favorites ?? [];
      this.data.api_keys = this.data.api_keys ?? [];
      this.data.version = this.data.version ?? EMPTY.version;
    } else {
      this.data = structuredClone(EMPTY);
      this.persist();
    }
  }

  get snapshot(): StoreData {
    return this.data;
  }

  persist(): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  close(): void {
    this.persist();
  }
}

/** @deprecated alias for callers expecting openDatabase */
export type YskDatabase = JsonStore;
