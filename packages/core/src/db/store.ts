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
  created_at: string;
  updated_at: string;
}

export interface StoreSession {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface StoreProject {
  id: string;
  name: string;
  domain?: string;
  linux_user: string;
  linux_group: string;
  home_dir: string;
  runtime: 'node' | 'php' | 'static';
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
  cron_jobs: Array<Record<string, unknown>>;
}

const EMPTY: StoreData = {
  version: 2,
  users: [],
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
  cron_jobs: [],
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
      this.data.sessions = this.data.sessions ?? [];
      this.data.projects = this.data.projects ?? [];
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
      this.data.cron_jobs = this.data.cron_jobs ?? [];
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
