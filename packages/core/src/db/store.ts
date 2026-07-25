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
}

const EMPTY: StoreData = {
  version: 1,
  users: [],
  sessions: [],
  projects: [],
  approvals: [],
  audit_events: [],
  settings: {},
  agent_sessions: [],
  agent_messages: [],
  email_domains: [],
};

export class JsonStore {
  private data: StoreData;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      this.data = { ...EMPTY, ...JSON.parse(readFileSync(path, 'utf8')) };
      // ensure arrays
      this.data.users = this.data.users ?? [];
      this.data.sessions = this.data.sessions ?? [];
      this.data.projects = this.data.projects ?? [];
      this.data.approvals = this.data.approvals ?? [];
      this.data.audit_events = this.data.audit_events ?? [];
      this.data.settings = this.data.settings ?? {};
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
