/**
 * SQLite schema migrations for YSK Server control plane.
 */

export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  roles TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-HK',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  linux_user TEXT NOT NULL,
  linux_group TEXT NOT NULL,
  home_dir TEXT NOT NULL,
  runtime TEXT NOT NULL,
  runtime_version TEXT,
  env TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'active',
  nginx_config_path TEXT,
  os_provisioned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  risk TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  detail TEXT NOT NULL,
  ok INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_domains (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  server_ip TEXT NOT NULL,
  mail_hostname TEXT NOT NULL,
  dkim_selector TEXT NOT NULL,
  dkim_public_key TEXT NOT NULL,
  dkim_private_key TEXT NOT NULL,
  dns_applied INTEGER NOT NULL DEFAULT 0,
  dmarc_present INTEGER NOT NULL DEFAULT 0,
  ptr_ok INTEGER NOT NULL DEFAULT 0,
  port25_open INTEGER,
  health_score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
`,
  },
  {
    // Product locale SSOT is zh-HK (香港書面語). zh-TW was a legacy default / browser alias only.
    version: 2,
    sql: `
UPDATE users SET locale = 'zh-HK' WHERE lower(replace(locale, '_', '-')) IN ('zh-tw', 'zh', 'zh-hant');
UPDATE settings SET value = replace(value, '"zh-TW"', '"zh-HK"') WHERE key = 'config' AND value LIKE '%zh-TW%';
`,
  },
];
