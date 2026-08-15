import { tl } from 'ysk-server-shared';
/**
 * Managed service settings for Redis / MySQL / MariaDB / PostgreSQL.
 * Panel save + apply (conf write + restart when permitted).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { probeRedisService } from './redis-browser.js';
import { probeDbEngine, type DbEngineKind } from './db-engine.js';
import { HostSoftwareProbe } from './software-probe/index.js';

export type DbServiceEngine = 'redis' | 'mysql' | 'mariadb' | 'postgres';

export interface RedisServiceSettings {
  port: number;
  bind: string;
  /** Logical DB count (indexes 0 .. databases-1) */
  databases: number;
  maxmemory: string;
  maxmemoryPolicy: string;
  requirepass: string;
  appendonly: boolean;
  protectedMode: boolean;
  timeout: number;
}

export interface SqlServiceSettings {
  port: number;
  bindAddress: string;
  maxConnections: number;
  characterSetServer?: string;
}

export interface PostgresServiceSettings {
  port: number;
  listenAddresses: string;
  maxConnections: number;
}

export const DEFAULT_REDIS: RedisServiceSettings = {
  port: 6379,
  bind: '127.0.0.1',
  databases: 16,
  maxmemory: '0',
  maxmemoryPolicy: 'noeviction',
  requirepass: '',
  appendonly: false,
  protectedMode: true,
  timeout: 0 };

export const DEFAULT_MYSQL: SqlServiceSettings = {
  port: 3306,
  bindAddress: '127.0.0.1',
  maxConnections: 151,
  characterSetServer: 'utf8mb4' };

export const DEFAULT_POSTGRES: PostgresServiceSettings = {
  port: 5432,
  listenAddresses: 'localhost',
  maxConnections: 100 };

function settingsKey(engine: DbServiceEngine): string {
  return `${engine}_service_settings`;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

export function loadRedisSettings(db: JsonStore): RedisServiceSettings {
  return loadJson(db, 'redis', DEFAULT_REDIS, (p) => ({
    ...DEFAULT_REDIS,
    ...p,
    port: clampInt(p.port, 1, 65535, 6379),
    databases: clampInt(p.databases, 1, 256, 16),
    timeout: clampInt(p.timeout, 0, 86400, 0),
    bind: String(p.bind ?? '127.0.0.1').slice(0, 120),
    maxmemory: String(p.maxmemory ?? '0').slice(0, 32),
    maxmemoryPolicy: String(p.maxmemoryPolicy ?? 'noeviction').slice(0, 40),
    requirepass: String(p.requirepass ?? '').slice(0, 200),
    appendonly: Boolean(p.appendonly),
    protectedMode: p.protectedMode !== false }));
}

export function saveRedisSettings(db: JsonStore, patch: Partial<RedisServiceSettings>): RedisServiceSettings {
  const next = loadRedisSettings(db);
  Object.assign(next, patch);
  next.port = clampInt(next.port, 1, 65535, 6379);
  next.databases = clampInt(next.databases, 1, 256, 16);
  next.timeout = clampInt(next.timeout, 0, 86400, 0);
  db.snapshot.settings[settingsKey('redis')] = JSON.stringify(next);
  db.persist();
  return next;
}

export function loadSqlSettings(db: JsonStore, engine: 'mysql' | 'mariadb'): SqlServiceSettings {
  return loadJson(db, engine, DEFAULT_MYSQL, (p) => ({
    ...DEFAULT_MYSQL,
    ...p,
    port: clampInt(p.port, 1, 65535, 3306),
    maxConnections: clampInt(p.maxConnections, 1, 100000, 151),
    bindAddress: String(p.bindAddress ?? '127.0.0.1').slice(0, 120),
    characterSetServer: String(p.characterSetServer ?? 'utf8mb4').slice(0, 32) }));
}

export function saveSqlSettings(
  db: JsonStore,
  engine: 'mysql' | 'mariadb',
  patch: Partial<SqlServiceSettings>,
): SqlServiceSettings {
  const next = loadSqlSettings(db, engine);
  Object.assign(next, patch);
  next.port = clampInt(next.port, 1, 65535, 3306);
  next.maxConnections = clampInt(next.maxConnections, 1, 100000, 151);
  db.snapshot.settings[settingsKey(engine)] = JSON.stringify(next);
  db.persist();
  return next;
}

export function loadPostgresSettings(db: JsonStore): PostgresServiceSettings {
  return loadJson(db, 'postgres', DEFAULT_POSTGRES, (p) => ({
    ...DEFAULT_POSTGRES,
    ...p,
    port: clampInt(p.port, 1, 65535, 5432),
    maxConnections: clampInt(p.maxConnections, 1, 100000, 100),
    listenAddresses: String(p.listenAddresses ?? 'localhost').slice(0, 120) }));
}

export function savePostgresSettings(
  db: JsonStore,
  patch: Partial<PostgresServiceSettings>,
): PostgresServiceSettings {
  const next = loadPostgresSettings(db);
  Object.assign(next, patch);
  next.port = clampInt(next.port, 1, 65535, 5432);
  next.maxConnections = clampInt(next.maxConnections, 1, 100000, 100);
  db.snapshot.settings[settingsKey('postgres')] = JSON.stringify(next);
  db.persist();
  return next;
}

function loadJson<T>(
  db: JsonStore,
  engine: DbServiceEngine,
  defaults: T,
  normalize: (p: Partial<T>) => T,
): T {
  const raw = db.snapshot.settings?.[settingsKey(engine)];
  if (!raw) return { ...defaults };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalize(parsed as Partial<T>);
  } catch {
    return { ...defaults };
  }
}

export function renderRedisConf(s: RedisServiceSettings): string {
  const lines = [
    '# Generated by YSK Server — edit via admin panel',
    `port ${s.port}`,
    `bind ${s.bind}`,
    `databases ${s.databases}`,
    `timeout ${s.timeout}`,
    `protected-mode ${s.protectedMode ? 'yes' : 'no'}`,
    `appendonly ${s.appendonly ? 'yes' : 'no'}`,
    `maxmemory-policy ${s.maxmemoryPolicy}`,
  ];
  if (s.maxmemory && s.maxmemory !== '0') {
    lines.push(`maxmemory ${s.maxmemory}`);
  } else {
    lines.push('maxmemory 0');
  }
  if (s.requirepass) {
    lines.push(`requirepass ${s.requirepass}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderMysqlConf(s: SqlServiceSettings, engine: 'mysql' | 'mariadb'): string {
  return [
    `# Generated by YSK Server (${engine})`,
    '[mysqld]',
    `port = ${s.port}`,
    `bind-address = ${s.bindAddress}`,
    `max_connections = ${s.maxConnections}`,
    s.characterSetServer ? `character-set-server = ${s.characterSetServer}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderPostgresConf(s: PostgresServiceSettings): string {
  return [
    '# Generated by YSK Server',
    `port = ${s.port}`,
    `listen_addresses = '${s.listenAddresses}'`,
    `max_connections = ${s.maxConnections}`,
    '',
  ].join('\n');
}

export type ServiceApplyResult = {
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  written: string[];
  settings: unknown;
};

export async function applyRedisServiceConfig(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  settings?: Partial<RedisServiceSettings>;
  restart?: boolean;
}): Promise<ServiceApplyResult> {
  const settings = input.settings
    ? saveRedisSettings(input.db, input.settings)
    : loadRedisSettings(input.db);
  const dir = join(input.dataDir, 'redis');
  mkdirSync(dir, { recursive: true });
  const confPath = join(dir, 'redis.ysk.conf');
  writeFileSync(confPath, renderRedisConf(settings), 'utf8');
  const written = [confPath];
  const notes = [tl('notes.tpl.wroteSettings', { path: confPath }), tl('notes.auto.t0228', { v0: (settings.databases), v1: (settings.databases - 1) })];

  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    const reason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    notes.push(blockMessage);
    notes.push(tl('notes.auto.n1367'));
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage,
      notes,
      written,
      settings };
  }

  // Copy snippet + CONFIG SET; ok requires real system effect
  const confDir = existsSync('/etc/redis') ? '/etc/redis' : '/etc';
  const dest = join(confDir, 'ysk-redis.conf');
  const cp = await input.host.runCommand(['cp', confPath, dest], { timeoutMs: 10_000 });
  const confInstalled = cp.exitCode === 0;
  if (confInstalled) notes.push(tl('notes.auto.t0229', { v0: (dest) }));
  else notes.push(tl('notes.auto.t0230', { v0: ((cp.stderr || cp.stdout).slice(0, 200)) }));

  // Runtime CONFIG SET where possible
  const cfg = await input.host.runCommand(
    ['redis-cli', 'CONFIG', 'SET', 'databases', String(settings.databases)],
    { timeoutMs: 10_000 },
  );
  const cfgOk = cfg.exitCode === 0 && cfg.stdout.trim().toUpperCase() === 'OK';
  if (cfgOk) {
    notes.push(tl('notes.auto.n0741'));
  } else {
    notes.push(tl('notes.auto.n0086'));
  }
  if (settings.maxmemory && settings.maxmemory !== '0') {
    await input.host.runCommand(
      ['redis-cli', 'CONFIG', 'SET', 'maxmemory', settings.maxmemory],
      { timeoutMs: 10_000 },
    );
  }
  await input.host.runCommand(
    ['redis-cli', 'CONFIG', 'SET', 'maxmemory-policy', settings.maxmemoryPolicy],
    { timeoutMs: 10_000 },
  );

  let restartOk = true;
  if (input.restart !== false) {
    const r = await input.host.runCommand(['systemctl', 'restart', 'redis-server'], {
      timeoutMs: 60_000 });
    restartOk = r.exitCode === 0;
    notes.push(restartOk ? tl('notes.auto.n0805') : tl('notes.tpl.restartFailed', { detail: r.stderr }));
  }

  // Success if conf installed OR runtime CONFIG worked, and restart not failed
  const applied = confInstalled || cfgOk;
  if (!applied) notes.push(tl('notes.auto.n0957'));

  return {
    ok: applied && restartOk,
    executed: true,
    notes,
    written,
    settings };
}

export async function applySqlServiceConfig(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  engine: 'mysql' | 'mariadb';
  settings?: Partial<SqlServiceSettings>;
  restart?: boolean;
}): Promise<ServiceApplyResult> {
  const settings = input.settings
    ? saveSqlSettings(input.db, input.engine, input.settings)
    : loadSqlSettings(input.db, input.engine);
  const dir = join(input.dataDir, input.engine);
  mkdirSync(dir, { recursive: true });
  const confPath = join(dir, 'ysk.cnf');
  writeFileSync(confPath, renderMysqlConf(settings, input.engine), 'utf8');
  const written = [confPath];
  const notes = [tl('notes.email.wrotePath', { path: confPath })];
  const unit = input.engine === 'mysql' ? 'mysql' : 'mariadb';

  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    const reason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    notes.push(blockMessage);
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage,
      notes,
      written,
      settings };
  }

  const confD =
    input.engine === 'mysql' ? '/etc/mysql/mysql.conf.d' : '/etc/mysql/mariadb.conf.d';
  mkdirSync(confD, { recursive: true });
  const dest = join(confD, '99-ysk.cnf');
  const cp = await input.host.runCommand(['cp', confPath, dest], { timeoutMs: 10_000 });
  if (cp.exitCode !== 0) {
    notes.push(tl('notes.auto.t0231', { v0: (cp.stderr || cp.stdout) }));
    return {
      ok: false,
      executed: true,
      notes,
      written,
      settings };
  }
  notes.push(tl('notes.software.installedSpec', { title: dest }));
  let restartOk = true;
  if (input.restart !== false) {
    const r = await input.host.runCommand(['systemctl', 'restart', unit], { timeoutMs: 120_000 });
    restartOk = r.exitCode === 0;
    notes.push(restartOk ? tl('notes.auto.t0232', { v0: (unit) }) : tl('notes.tpl.restartFailed', { detail: r.stderr }));
  }
  return { ok: restartOk, executed: true, notes, written, settings };
}

export async function applyPostgresServiceConfig(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  settings?: Partial<PostgresServiceSettings>;
  restart?: boolean;
}): Promise<ServiceApplyResult> {
  const settings = input.settings
    ? savePostgresSettings(input.db, input.settings)
    : loadPostgresSettings(input.db);
  const dir = join(input.dataDir, 'postgres');
  mkdirSync(dir, { recursive: true });
  const confPath = join(dir, 'ysk-postgresql.conf');
  writeFileSync(confPath, renderPostgresConf(settings), 'utf8');
  const written = [confPath];
  const notes = [tl('notes.email.wrotePath', { path: confPath }), tl('notes.tpl.pgIncludeHint')];

  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    const reason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    notes.push(blockMessage);
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage,
      notes,
      written,
      settings };
  }

  // Install drop-in into first existing conf.d (Debian/Ubuntu layout)
  const confCandidates = [
    '/etc/postgresql',
  ];
  let installed = false;
  for (const base of confCandidates) {
    if (!existsSync(base)) continue;
    // Find */main/conf.d or similar
    const find = await input.host.runCommand(
      [
        'bash',
        '-c',
        `find ${JSON.stringify(base)} -type d -name conf.d 2>/dev/null | head -3`,
      ],
      { timeoutMs: 10_000 },
    );
    const dirs = find.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const d of dirs) {
      const dest = join(d, '99-ysk.conf');
      const cp = await input.host.runCommand(['cp', confPath, dest], { timeoutMs: 10_000 });
      if (cp.exitCode === 0) {
        notes.push(tl('notes.software.installedSpec', { title: dest }));
        installed = true;
      } else {
        notes.push(tl('notes.auto.t0233', { v0: (dest), v1: (cp.stderr || cp.stdout) }));
      }
    }
  }
  if (!installed) {
    notes.push(
      tl('notes.auto.n0958'),
    );
  }
  let restartOk = true;
  if (input.restart !== false) {
    const r = await input.host.runCommand(['systemctl', 'restart', 'postgresql'], {
      timeoutMs: 120_000 });
    restartOk = r.exitCode === 0;
    notes.push(restartOk ? tl('notes.auto.n0804') : tl('notes.tpl.restartFailed', { detail: r.stderr }));
  }
  return {
    ok: installed && restartOk,
    executed: true,
    notes,
    written,
    settings };
}

/** Enrich redis probe with configured databases count */
export async function getRedisServiceView(input: {
  db: JsonStore;
  host: HostExecutor;
}): Promise<
  Awaited<ReturnType<typeof probeRedisService>> & {
    settings: RedisServiceSettings;
    configuredDatabases: number;
  }
> {
  const settings = loadRedisSettings(input.db);
  const status = await probeRedisService(input.host);
  let configuredDatabases = settings.databases;
  if (status.canRead) {
    const r = await input.host.runCommand(['redis-cli', 'CONFIG', 'GET', 'databases'], {
      timeoutMs: 5_000 });
    const lines = r.stdout.trim().split('\n');
    const n = Number(lines[lines.length - 1]);
    if (Number.isFinite(n) && n >= 1) configuredDatabases = n;
  }
  return { ...status, settings, configuredDatabases };
}

export async function getSqlServiceView(input: {
  db: JsonStore;
  host: HostExecutor;
  engine: 'mysql' | 'mariadb';
}): Promise<
  Awaited<ReturnType<typeof probeDbEngine>> & {
    settings: SqlServiceSettings;
    hostDatabases: string[];
  }
> {
  const settings = loadSqlSettings(input.db, input.engine);
  const status = await probeDbEngine(input.host, input.engine as DbEngineKind);
  let hostDatabases: string[] = [];
  if (status.serverInstalled && status.clientInstalled && status.active === 'active') {
    try {
      const { listUserDatabaseNames } = await import('./sql-engine-switch/preview.js');
      hostDatabases = await listUserDatabaseNames(input.host, input.engine);
    } catch {
      hostDatabases = [];
    }
  }
  return { ...status, settings, hostDatabases };
}

export async function getPostgresServiceView(input: {
  db: JsonStore;
  host: HostExecutor;
}): Promise<{
  settings: PostgresServiceSettings;
  serverInstalled: boolean;
  clientInstalled: boolean;
  active: string;
  executeEnabled: boolean;
  isRoot: boolean;
  version?: string;
  blockMessage?: string;
}> {
  const settings = loadPostgresSettings(input.db);
  const probe = new HostSoftwareProbe(input.host);
  const server = await probe.presence('postgresql');
  const client = await probe.presence('postgresql-client');
  const serverInstalled = server.installed;
  const clientInstalled = client.installed;
  const active =
    server.units?.[0]?.active ??
    (await input.host
      .runCommand(['systemctl', 'is-active', 'postgresql'], { timeoutMs: 5_000 })
      .then((r) => (r.stdout || r.stderr || 'unknown').trim().split('\n')[0] || 'unknown')
      .catch(() => 'unknown'));
  const ver = await probe.version(clientInstalled ? 'postgresql-client' : 'postgresql');
  const version = ver.version?.slice(0, 80);
  const executeEnabled = input.host.executeEnabled();
  const isRoot = input.host.isRoot();
  let blockMessage: string | undefined;
  if (!serverInstalled) blockMessage = tl('notes.auto.n0158');
  else if (active !== 'active') blockMessage = tl('notes.auto.n0160');
  else if (!executeEnabled) blockMessage = tl('notes.auto.n1309');
  return {
    settings,
    serverInstalled,
    clientInstalled,
    active: serverInstalled ? active : 'not_installed',
    executeEnabled,
    isRoot,
    version,
    blockMessage };
}

// silence unused
void readFileSync;
