import {
  tl,
  type ServiceConsoleDto,
  type ServiceConsoleLifecycleAction,
} from 'ysk-server-shared';
/**
 * Professional DB service console: lifecycle + categorized settings + live values.
 */

import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import {
  catalogForEngine,
  CATEGORY_META,
  resolveCategoryMeta,
  type ServiceEngine,
  type SettingCategoryId,
  type SettingDef } from './service-catalog/index.js';
import { installSoftware } from './software-install.js';
import { HostSoftwareProbe, binPresent } from './software-probe/index.js';

/** @deprecated Prefer ServiceConsoleLifecycleAction from ysk-server-shared */
export type LifecycleAction = ServiceConsoleLifecycleAction;

export interface ConsoleSettingRow extends SettingDef {
  liveValue?: string;
  draftValue?: string;
  supported: boolean;
}

export interface ConsoleCategory {
  id: SettingCategoryId;
  label: string;
  description: string;
  settings: ConsoleSettingRow[];
}

/** Re-export shared SSOT (web + API). */
export type { ServiceConsoleDto };

const ENGINE_META: Record<
  ServiceEngine,
  { title: string; unit: string; installIds: string[] }
> = {
  mysql: { title: 'MySQL', unit: 'mysql', installIds: ['mysql-server', 'mysql-client'] },
  mariadb: { title: 'MariaDB', unit: 'mariadb', installIds: ['mariadb-server', 'mysql-client'] },
  postgres: { title: 'PostgreSQL', unit: 'postgresql', installIds: ['postgresql', 'postgresql-client'] },
  redis: { title: 'Redis', unit: 'redis-server', installIds: ['redis-server', 'redis-tools'] } };

function activeLabel(active: string, installed: boolean): string {
  if (!installed || active === 'not_installed') return tl('notes.notInstalled');
  if (active === 'active') return tl('notes.running');
  if (active === 'inactive' || active === 'failed') return tl('notes.stopped');
  if (active === 'activating') return tl('notes.auto.n0014');
  return active || tl('notes.unknown');
}

async function unitState(host: HostExecutor, unit: string): Promise<{ active: string; enabled: string }> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return { active: 'unknown', enabled: 'unknown' };
  }
  const a = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  const e = await host.runCommand(['systemctl', 'is-enabled', unit], { timeoutMs: 5_000 });
  return {
    active: (a.stdout || a.stderr || 'unknown').trim().split('\n')[0] || 'unknown',
    enabled: (e.stdout || e.stderr || 'unknown').trim().split('\n')[0] || 'unknown' };
}

async function loadMysqlLive(
  host: HostExecutor,
  engine: 'mysql' | 'mariadb',
): Promise<{ version?: string; live: Record<string, string>; metrics: Record<string, string> }> {
  const live: Record<string, string> = {};
  const metrics: Record<string, string> = {};
  if (!(await binPresent(host, 'mysql'))) return { live, metrics };
  const ver = await host.runCommand(['mysql', '--version'], { timeoutMs: 5_000 });
  const version = ver.stdout.trim();
  const vars = await host.runCommand(
    ['mysql', '-N', '-e', "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('port','bind_address','max_connections','max_connect_errors','wait_timeout','interactive_timeout','innodb_buffer_pool_size','innodb_log_file_size','innodb_flush_log_at_trx_commit','tmp_table_size','max_heap_table_size','table_open_cache','character_set_server','collation_server','slow_query_log','long_query_time','log_error','general_log','log_bin','binlog_format','binlog_expire_logs_seconds','expire_logs_days','require_secure_transport','default_authentication_plugin','skip_name_resolve','thread_handling')"],
    { timeoutMs: 15_000 },
  );
  for (const line of vars.stdout.split('\n')) {
    const parts = line.trim().split(/\t/);
    if (parts.length >= 2) live[parts[0]] = parts.slice(1).join('\t');
  }
  const st = await host.runCommand(
    ['mysql', '-N', '-e', "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Uptime','Questions')"],
    { timeoutMs: 10_000 },
  );
  for (const line of st.stdout.split('\n')) {
    const parts = line.trim().split(/\t/);
    if (parts.length >= 2) metrics[parts[0]] = parts[1];
  }
  void engine;
  return { version, live, metrics };
}

async function loadPostgresLive(
  host: HostExecutor,
): Promise<{ version?: string; live: Record<string, string>; metrics: Record<string, string> }> {
  const live: Record<string, string> = {};
  const metrics: Record<string, string> = {};
  if (!(await binPresent(host, 'psql'))) return { live, metrics };
  const ver = await host.runCommand(['psql', '--version'], { timeoutMs: 5_000 });
  const version = ver.stdout.trim();
  const keys = [
    'port',
    'listen_addresses',
    'max_connections',
    'password_encryption',
    'shared_buffers',
    'work_mem',
    'maintenance_work_mem',
    'effective_cache_size',
    'wal_level',
    'max_wal_size',
    'checkpoint_timeout',
    'archive_mode',
    'logging_collector',
    'log_min_duration_statement',
    'log_statement',
    'autovacuum',
    'autovacuum_max_workers',
    'ssl',
  ];
  for (const k of keys) {
    const r = await host.runCommand(
      ['psql', '-t', '-A', '-c', `SHOW ${k};`],
      { timeoutMs: 5_000 },
    );
    if (r.exitCode === 0 && r.stdout.trim()) live[k] = r.stdout.trim();
  }
  return { version, live, metrics };
}

async function loadRedisLive(
  host: HostExecutor,
): Promise<{ version?: string; live: Record<string, string>; metrics: Record<string, string> }> {
  const live: Record<string, string> = {};
  const metrics: Record<string, string> = {};
  if (!(await binPresent(host, 'redis-cli'))) return { live, metrics };
  const ping = await host.runCommand(['redis-cli', 'PING'], { timeoutMs: 5_000 });
  if (ping.stdout.trim().toUpperCase() !== 'PONG') return { live, metrics };
  const info = await host.runCommand(['redis-cli', 'INFO', 'server'], { timeoutMs: 5_000 });
  const vm = info.stdout.match(/redis_version:(.+)/);
  const version = vm ? `Redis ${vm[1].trim()}` : undefined;
  const keys = [
    'port',
    'bind',
    'protected-mode',
    'tcp-keepalive',
    'timeout',
    'databases',
    'maxclients',
    'maxmemory',
    'maxmemory-policy',
    'appendonly',
    'appendfsync',
    'save',
    'dir',
    'dbfilename',
    'requirepass',
    'loglevel',
    'logfile',
  ];
  for (const k of keys) {
    const r = await host.runCommand(['redis-cli', 'CONFIG', 'GET', k], { timeoutMs: 5_000 });
    const lines = r.stdout.trim().split('\n');
    if (lines.length >= 2) live[k] = lines[lines.length - 1];
  }
  const mem = await host.runCommand(['redis-cli', 'INFO', 'memory'], { timeoutMs: 5_000 });
  const um = mem.stdout.match(/used_memory_human:(.+)/);
  if (um) metrics.used_memory = um[1].trim();
  const cl = await host.runCommand(['redis-cli', 'INFO', 'clients'], { timeoutMs: 5_000 });
  const cc = cl.stdout.match(/connected_clients:(.+)/);
  if (cc) metrics.connected_clients = cc[1].trim();
  return { version, live, metrics };
}

export async function getServiceConsole(
  host: HostExecutor,
  engine: ServiceEngine,
  _db?: JsonStore,
): Promise<ServiceConsoleDto> {
  const meta = ENGINE_META[engine];
  // Unified presence (mysql vs mariadb exclusive) — same standard as db-engine / software catalog
  const probe = new HostSoftwareProbe(host);
  const { server } = await probe.presenceForEngine(engine);
  const installed = server.installed;
  const verInfo = await probe.version(
    engine === 'mysql'
      ? 'mysql-server'
      : engine === 'mariadb'
        ? 'mariadb-server'
        : engine === 'postgres'
          ? 'postgresql'
          : 'redis-server',
  );

  let { active, enabled } = await unitState(host, meta.unit);
  if (engine === 'mysql' && active !== 'active' && installed) {
    const alt = await unitState(host, 'mysqld');
    if (alt.active === 'active') {
      active = alt.active;
      enabled = alt.enabled;
    }
  }
  // Prefer unit state from presence when available
  if (server.units?.[0]?.active) {
    active = server.units[0].active ?? active;
    enabled = server.units[0].enabled ?? enabled;
  }
  if (!installed) active = 'not_installed';

  let version: string | undefined = verInfo.version;
  let live: Record<string, string> = {};
  let metrics: Record<string, string> = {};

  if (installed && (engine === 'mysql' || engine === 'mariadb')) {
    const r = await loadMysqlLive(host, engine);
    version = r.version || version;
    live = r.live;
    metrics = r.metrics;
  } else if (installed && engine === 'postgres') {
    const r = await loadPostgresLive(host);
    version = r.version || version;
    live = r.live;
    metrics = r.metrics;
  } else if (installed && engine === 'redis') {
    const r = await loadRedisLive(host);
    version = r.version || version;
    live = r.live;
    metrics = r.metrics;
  }

  const defs = catalogForEngine(engine, version);
  const byCat = new Map<SettingCategoryId, ConsoleSettingRow[]>();
  for (const d of defs) {
    const row: ConsoleSettingRow = {
      ...d,
      liveValue: live[d.key] ?? live[d.confKey ?? ''] ?? undefined,
      supported: true };
    const list = byCat.get(d.category) ?? [];
    list.push(row);
    byCat.set(d.category, list);
  }

  // Advanced: extra live keys not in catalog
  const known = new Set(defs.map((d) => d.key));
  const extra: ConsoleSettingRow[] = [];
  for (const [k, v] of Object.entries(live)) {
    if (known.has(k)) continue;
    extra.push({
      key: k,
      label: k,
      category: 'advanced',
      type: 'string',
      applyMode: engine === 'postgres' ? 'reload' : 'runtime',
      liveValue: v,
      supported: true,
      advanced: true });
  }
  if (extra.length) {
    byCat.set('advanced', [...(byCat.get('advanced') ?? []), ...extra.slice(0, 80)]);
  }

  const categories: ConsoleCategory[] = Object.entries(CATEGORY_META)
    .sort((a, b) => a[1].order - b[1].order)
    .filter(([id]) => id !== 'overview' && id !== 'lifecycle')
    .map(([id]) => {
      const m = resolveCategoryMeta(id as SettingCategoryId);
      return {
        id: id as SettingCategoryId,
        label: m.label,
        description: m.description,
        settings: byCat.get(id as SettingCategoryId) ?? [],
      };
    })
    .filter((c) => c.settings.length > 0);

  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const canLifecycle = executeEnabled && isRoot && installed;
  let blockMessage: string | undefined;
  if (!installed && server.blockedByExclusive) {
    const other =
      server.blockedByExclusive === 'mariadb-server'
        ? 'MariaDB'
        : server.blockedByExclusive === 'mysql-server'
          ? 'MySQL'
          : server.blockedByExclusive;
    blockMessage = tl('notes.auto.t0308', { v0: meta.title }) + ` (${other})`;
  } else if (!installed) blockMessage = tl('notes.auto.t0308', { v0: meta.title });
  else if (!executeEnabled) blockMessage = tl('notes.auto.n0613');
  else if (!isRoot) blockMessage = tl('notes.auto.n1583');

  return {
    engine,
    title: meta.title,
    version,
    unit: meta.unit,
    active,
    activeLabel: activeLabel(active, installed),
    enabled,
    installed,
    executeEnabled,
    isRoot,
    canLifecycle,
    blockMessage,
    blockedByExclusive: server.blockedByExclusive,
    metrics,
    categories,
    live };
}

export async function lifecycleService(
  host: HostExecutor,
  engine: ServiceEngine,
  action: LifecycleAction,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; blockMessage?: string }> {
  const meta = ENGINE_META[engine];
  if (!host.executeEnabled() || !host.isRoot()) {
    const reason: BlockReason = !host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return { ok: false, blocked: true, blockMessage, notes: [blockMessage] };
  }
  const map: Record<LifecycleAction, string[]> = {
    start: ['systemctl', 'start', meta.unit],
    stop: ['systemctl', 'stop', meta.unit],
    restart: ['systemctl', 'restart', meta.unit],
    reload: ['systemctl', 'reload', meta.unit],
    enable: ['systemctl', 'enable', meta.unit],
    disable: ['systemctl', 'disable', meta.unit] };
  const argv = map[action];
  let r = await host.runCommand(argv, { timeoutMs: 120_000 });
  // Redis/MySQL may not support reload
  if (r.exitCode !== 0 && action === 'reload') {
    const r2 = await host.runCommand(['systemctl', 'restart', meta.unit], { timeoutMs: 120_000 });
    return {
      ok: r2.exitCode === 0,
      notes: r2.exitCode === 0 ? [tl('notes.auto.n0807')] : [tl('notes.tpl.failedDetail', { detail: r2.stderr || r.stderr })] };
  }

  // MySQL/MariaDB start: FROZEN recovery when unit still down after start
  if (
    (action === 'start' || action === 'restart') &&
    (engine === 'mysql' || engine === 'mariadb') &&
    r.exitCode !== 0
  ) {
    try {
      const { recoverMysqlAfterEngineSwitch, frozenUnitFailureHint } = await import(
        './sql-engine-switch/mysql-frozen.js'
      );
      const notes: string[] = [];
      const frozenHint = await frozenUnitFailureHint(host, meta.unit);
      if (frozenHint) notes.push(frozenHint);
      const rec = await recoverMysqlAfterEngineSwitch(host, engine);
      notes.push(...rec.notes);
      r = await host.runCommand(['systemctl', 'start', meta.unit], { timeoutMs: 120_000 });
      if (r.exitCode === 0) {
        return { ok: true, notes: [...notes, tl('notes.auto.t0309', { v0: action })] };
      }
      return {
        ok: false,
        notes: [
          ...notes,
          tl('notes.tpl.failedDetail', { detail: r.stderr || r.stdout || meta.unit }),
        ],
      };
    } catch {
      /* fall through */
    }
  }

  return {
    ok: r.exitCode === 0,
    notes: r.exitCode === 0 ? [tl('notes.auto.t0309', { v0: (action) })] : [tl('notes.tpl.failedDetail', { detail: r.stderr || r.stdout })] };
}

export async function applyConsoleSettings(input: {
  host: HostExecutor;
  engine: ServiceEngine;
  changes: Record<string, string>;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  blockMessage?: string;
  applied: string[];
  needsRestart: string[];
}> {
  const { host, engine, changes } = input;
  const applied: string[] = [];
  const needsRestart: string[] = [];
  const notes: string[] = [];
  const defs = catalogForEngine(engine);
  const byKey = new Map(defs.map((d) => [d.key, d]));

  if (engine === 'redis') {
    if (!(await binPresent(host, 'redis-cli'))) {
      return {
        ok: false,
        notes: [tl('notes.redis.cliMissing')],
        applied,
        needsRestart,
        blocked: true,
        blockMessage: tl('notes.redis.cliMissing') };
    }
    for (const [k, v] of Object.entries(changes)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(k) || !byKey.has(k)) {
        notes.push(`${k}: rejected (not in catalog)`);
        continue;
      }
      const def = byKey.get(k);
      if (def?.applyMode === 'restart') {
        needsRestart.push(k);
        // still try CONFIG SET for redis many work at runtime
      }
      const r = await host.runCommand(['redis-cli', 'CONFIG', 'SET', k, v], { timeoutMs: 10_000 });
      if (r.exitCode === 0 && r.stdout.trim().toUpperCase() === 'OK') {
        applied.push(k);
      } else {
        notes.push(`${k}: ${r.stderr || r.stdout || tl('notes.failed')}`);
        if (def?.applyMode === 'restart') needsRestart.push(k);
      }
    }
    if (applied.length) {
      await host.runCommand(['redis-cli', 'CONFIG', 'REWRITE'], { timeoutMs: 10_000 });
      notes.push(tl('notes.auto.t0310', { v0: (applied.length) }));
    }
    if (needsRestart.length && host.executeEnabled() && host.isRoot()) {
      await host.runCommand(['systemctl', 'restart', 'redis-server'], { timeoutMs: 60_000 });
      notes.push(tl('notes.auto.n0806'));
    } else if (needsRestart.length) {
      notes.push(tl('notes.auto.t0311', { v0: ([...new Set(needsRestart)].join(', ')) }));
    }
    return { ok: applied.length > 0 || needsRestart.length === 0, notes, applied, needsRestart };
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    if (!(await binPresent(host, 'mysql'))) {
      return {
        ok: false,
        notes: [tl('notes.auto.n0015')],
        applied,
        needsRestart,
        blocked: true,
        blockMessage: tl('notes.auto.n0015') };
    }
    for (const [k, v] of Object.entries(changes)) {
      if (!/^[a-zA-Z0-9_.]+$/.test(k) || !byKey.has(k)) {
        notes.push(`${k}: rejected (not in catalog)`);
        continue;
      }
      const def = byKey.get(k)!;
      if (def.applyMode === 'restart') {
        needsRestart.push(k);
        continue;
      }
      const esc = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const r = await host.runCommand(
        ['mysql', '-e', `SET GLOBAL ${k} = '${esc}';`],
        { timeoutMs: 10_000 },
      );
      if (r.exitCode === 0) applied.push(k);
      else notes.push(`${k}: ${r.stderr || tl('notes.failed')}`);
    }
    notes.push(tl('notes.auto.t0312', { v0: (applied.length) }));
    if (needsRestart.length) {
      notes.push(tl('notes.auto.t0313', { v0: ([...new Set(needsRestart)].join(', ')) }));
    }
    return { ok: true, notes, applied, needsRestart: [...new Set(needsRestart)] };
  }

  // postgres
  if (!(await binPresent(host, 'psql'))) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0016')],
      applied,
      needsRestart,
      blocked: true,
      blockMessage: tl('notes.auto.n0016') };
  }
  for (const [k, v] of Object.entries(changes)) {
    if (!/^[a-zA-Z0-9_.]+$/.test(k) || !byKey.has(k)) {
      notes.push(`${k}: rejected (not in catalog)`);
      continue;
    }
    const def = byKey.get(k);
    const esc = v.replace(/'/g, "''");
    const r = await host.runCommand(
      ['psql', '-c', `ALTER SYSTEM SET ${k} = '${esc}';`],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode === 0) {
      applied.push(k);
      if (def?.applyMode === 'restart') needsRestart.push(k);
    } else notes.push(`${k}: ${r.stderr || tl('notes.failed')}`);
  }
  if (applied.length) {
    await host.runCommand(['psql', '-c', 'SELECT pg_reload_conf();'], { timeoutMs: 10_000 });
    notes.push(tl('notes.auto.t0314', { v0: (applied.length) }));
  }
  if (needsRestart.length) {
    notes.push(tl('notes.auto.t0315', { v0: ([...new Set(needsRestart)].join(', ')) }));
  }
  return { ok: applied.length > 0, notes, applied, needsRestart: [...new Set(needsRestart)] };
}

export async function installServiceEngine(
  host: HostExecutor,
  engine: ServiceEngine,
  dataDir?: string,
): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  blockMessage?: string;
  code?: string;
  switchTarget?: 'mysql' | 'mariadb';
  blockedByExclusive?: string;
}> {
  const ids = ENGINE_META[engine].installIds;
  const notes: string[] = [];
  let blocked = false;
  let blockMessage: string | undefined;
  let allOk = true;
  let code: string | undefined;
  let switchTarget: 'mysql' | 'mariadb' | undefined;
  let blockedByExclusive: string | undefined;
  for (const id of ids) {
    const r = await installSoftware({ host, id, dataDir, enableUnits: true });
    notes.push(...r.notes);
    if (r.blocked) {
      blocked = true;
      blockMessage = r.blockMessage;
    }
    if (!r.ok) allOk = false;
    if (r.code === 'needs_exclusive_switch') {
      code = r.code;
      switchTarget = r.switchTarget;
      blockedByExclusive = r.blockedByExclusive;
    }
  }
  return {
    ok: allOk && !blocked,
    notes,
    blocked,
    blockMessage,
    code,
    switchTarget,
    blockedByExclusive,
  };
}
