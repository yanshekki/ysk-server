/**
 * Professional DB service console: lifecycle + categorized settings + live values.
 */

import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import {
  catalogForEngine,
  CATEGORY_META,
  type ServiceEngine,
  type SettingCategoryId,
  type SettingDef,
} from './service-catalog/index.js';
import { installSoftware } from './software-install.js';

export type LifecycleAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';

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

export interface ServiceConsoleDto {
  engine: ServiceEngine;
  title: string;
  version?: string;
  unit: string;
  active: string;
  activeLabel: string;
  enabled?: string;
  installed: boolean;
  executeEnabled: boolean;
  isRoot: boolean;
  canLifecycle: boolean;
  blockMessage?: string;
  metrics: Record<string, string>;
  categories: ConsoleCategory[];
  live: Record<string, string>;
}

const ENGINE_META: Record<
  ServiceEngine,
  { title: string; unit: string; installIds: string[] }
> = {
  mysql: { title: 'MySQL', unit: 'mysql', installIds: ['mysql-server', 'mysql-client'] },
  mariadb: { title: 'MariaDB', unit: 'mariadb', installIds: ['mariadb-server', 'mysql-client'] },
  postgres: { title: 'PostgreSQL', unit: 'postgresql', installIds: ['postgresql', 'postgresql-client'] },
  redis: { title: 'Redis', unit: 'redis-server', installIds: ['redis-server', 'redis-tools'] },
};

function activeLabel(active: string, installed: boolean): string {
  if (!installed || active === 'not_installed') return '未安裝';
  if (active === 'active') return '運行中';
  if (active === 'inactive' || active === 'failed') return '已停止';
  if (active === 'activating') return '啟動中';
  return active || '未知';
}

async function hasBin(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} 2>/dev/null || true`], {
    timeoutMs: 5_000,
  });
  return r.stdout.trim().length > 0;
}

async function unitState(host: HostExecutor, unit: string): Promise<{ active: string; enabled: string }> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return { active: 'unknown', enabled: 'unknown' };
  }
  const a = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  const e = await host.runCommand(['systemctl', 'is-enabled', unit], { timeoutMs: 5_000 });
  return {
    active: (a.stdout || a.stderr || 'unknown').trim().split('\n')[0] || 'unknown',
    enabled: (e.stdout || e.stderr || 'unknown').trim().split('\n')[0] || 'unknown',
  };
}

async function loadMysqlLive(
  host: HostExecutor,
  engine: 'mysql' | 'mariadb',
): Promise<{ version?: string; live: Record<string, string>; metrics: Record<string, string> }> {
  const live: Record<string, string> = {};
  const metrics: Record<string, string> = {};
  if (!(await hasBin(host, 'mysql'))) return { live, metrics };
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
  if (!(await hasBin(host, 'psql'))) return { live, metrics };
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
  if (!(await hasBin(host, 'redis-cli'))) return { live, metrics };
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
  let installed = false;
  if (engine === 'redis') installed = await hasBin(host, 'redis-server');
  else if (engine === 'postgres') installed = await hasBin(host, 'postgres');
  else if (engine === 'mysql') installed = (await hasBin(host, 'mysqld')) || (await hasBin(host, 'mysql'));
  else installed = (await hasBin(host, 'mariadbd')) || (await hasBin(host, 'mysqld'));

  let { active, enabled } = await unitState(host, meta.unit);
  if (engine === 'mysql' && active !== 'active') {
    const alt = await unitState(host, 'mysqld');
    if (alt.active === 'active') {
      active = alt.active;
      enabled = alt.enabled;
    }
  }
  if (!installed) active = 'not_installed';

  let version: string | undefined;
  let live: Record<string, string> = {};
  let metrics: Record<string, string> = {};

  if (engine === 'mysql' || engine === 'mariadb') {
    const r = await loadMysqlLive(host, engine);
    version = r.version;
    live = r.live;
    metrics = r.metrics;
  } else if (engine === 'postgres') {
    const r = await loadPostgresLive(host);
    version = r.version;
    live = r.live;
    metrics = r.metrics;
  } else {
    const r = await loadRedisLive(host);
    version = r.version;
    live = r.live;
    metrics = r.metrics;
  }

  const defs = catalogForEngine(engine, version);
  const byCat = new Map<SettingCategoryId, ConsoleSettingRow[]>();
  for (const d of defs) {
    const row: ConsoleSettingRow = {
      ...d,
      liveValue: live[d.key] ?? live[d.confKey ?? ''] ?? undefined,
      supported: true,
    };
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
      advanced: true,
    });
  }
  if (extra.length) {
    byCat.set('advanced', [...(byCat.get('advanced') ?? []), ...extra.slice(0, 80)]);
  }

  const categories: ConsoleCategory[] = Object.entries(CATEGORY_META)
    .sort((a, b) => a[1].order - b[1].order)
    .filter(([id]) => id !== 'overview' && id !== 'lifecycle')
    .map(([id, m]) => ({
      id: id as SettingCategoryId,
      label: m.label,
      description: m.description,
      settings: byCat.get(id as SettingCategoryId) ?? [],
    }))
    .filter((c) => c.settings.length > 0);

  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const canLifecycle = executeEnabled && isRoot;
  let blockMessage: string | undefined;
  if (!installed) blockMessage = `${meta.title} 尚未安裝`;
  else if (!executeEnabled) blockMessage = '可檢視設定；安裝／重啟／寫入系統設定需要系統變更權限';
  else if (!isRoot) blockMessage = '需要系統管理員權限才能變更服務';

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
    metrics,
    categories,
    live,
  };
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
    disable: ['systemctl', 'disable', meta.unit],
  };
  const argv = map[action];
  const r = await host.runCommand(argv, { timeoutMs: 120_000 });
  // Redis/MySQL may not support reload
  if (r.exitCode !== 0 && action === 'reload') {
    const r2 = await host.runCommand(['systemctl', 'restart', meta.unit], { timeoutMs: 120_000 });
    return {
      ok: r2.exitCode === 0,
      notes: r2.exitCode === 0 ? ['已重啟（重載不支援）'] : [`失敗：${r2.stderr || r.stderr}`],
    };
  }
  return {
    ok: r.exitCode === 0,
    notes: r.exitCode === 0 ? [`已執行 ${action}`] : [`失敗：${r.stderr || r.stdout}`],
  };
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
    if (!(await hasBin(host, 'redis-cli'))) {
      return {
        ok: false,
        notes: ['未安裝 redis-cli'],
        applied,
        needsRestart,
        blocked: true,
        blockMessage: '未安裝 redis-cli',
      };
    }
    for (const [k, v] of Object.entries(changes)) {
      const def = byKey.get(k);
      if (def?.applyMode === 'restart') {
        needsRestart.push(k);
        // still try CONFIG SET for redis many work at runtime
      }
      const r = await host.runCommand(['redis-cli', 'CONFIG', 'SET', k, v], { timeoutMs: 10_000 });
      if (r.exitCode === 0 && r.stdout.trim().toUpperCase() === 'OK') {
        applied.push(k);
      } else {
        notes.push(`${k}: ${r.stderr || r.stdout || '失敗'}`);
        if (def?.applyMode === 'restart') needsRestart.push(k);
      }
    }
    if (applied.length) {
      await host.runCommand(['redis-cli', 'CONFIG', 'REWRITE'], { timeoutMs: 10_000 });
      notes.push(`已套用 ${applied.length} 項`);
    }
    if (needsRestart.length && host.executeEnabled() && host.isRoot()) {
      await host.runCommand(['systemctl', 'restart', 'redis-server'], { timeoutMs: 60_000 });
      notes.push('已重啟 redis-server 以套用需重啟項目');
    } else if (needsRestart.length) {
      notes.push(`以下項目可能需重啟：${[...new Set(needsRestart)].join(', ')}`);
    }
    return { ok: applied.length > 0 || needsRestart.length === 0, notes, applied, needsRestart };
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    if (!(await hasBin(host, 'mysql'))) {
      return {
        ok: false,
        notes: ['未安裝 mysql 客戶端'],
        applied,
        needsRestart,
        blocked: true,
        blockMessage: '未安裝 mysql 客戶端',
      };
    }
    for (const [k, v] of Object.entries(changes)) {
      const def = byKey.get(k);
      if (def?.applyMode === 'restart') {
        needsRestart.push(k);
        continue;
      }
      const esc = v.replace(/'/g, "''");
      const r = await host.runCommand(
        ['mysql', '-e', `SET GLOBAL ${k} = '${esc}';`],
        { timeoutMs: 10_000 },
      );
      if (r.exitCode === 0) applied.push(k);
      else notes.push(`${k}: ${r.stderr || '失敗'}`);
    }
    notes.push(`即時套用 ${applied.length} 項`);
    if (needsRestart.length) {
      notes.push(`需重啟項（請用生命週期重啟）：${[...new Set(needsRestart)].join(', ')}`);
    }
    return { ok: true, notes, applied, needsRestart: [...new Set(needsRestart)] };
  }

  // postgres
  if (!(await hasBin(host, 'psql'))) {
    return {
      ok: false,
      notes: ['未安裝 psql'],
      applied,
      needsRestart,
      blocked: true,
      blockMessage: '未安裝 psql',
    };
  }
  for (const [k, v] of Object.entries(changes)) {
    const def = byKey.get(k);
    const esc = v.replace(/'/g, "''");
    const r = await host.runCommand(
      ['psql', '-c', `ALTER SYSTEM SET ${k} = '${esc}';`],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode === 0) {
      applied.push(k);
      if (def?.applyMode === 'restart') needsRestart.push(k);
    } else notes.push(`${k}: ${r.stderr || '失敗'}`);
  }
  if (applied.length) {
    await host.runCommand(['psql', '-c', 'SELECT pg_reload_conf();'], { timeoutMs: 10_000 });
    notes.push(`已 ALTER SYSTEM ${applied.length} 項並 reload`);
  }
  if (needsRestart.length) {
    notes.push(`部分參數需重啟後生效：${[...new Set(needsRestart)].join(', ')}`);
  }
  return { ok: applied.length > 0, notes, applied, needsRestart: [...new Set(needsRestart)] };
}

export async function installServiceEngine(
  host: HostExecutor,
  engine: ServiceEngine,
  dataDir?: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; blockMessage?: string }> {
  const ids = ENGINE_META[engine].installIds;
  const notes: string[] = [];
  let blocked = false;
  let blockMessage: string | undefined;
  for (const id of ids) {
    const r = await installSoftware({ host, id, dataDir, enableUnits: true });
    notes.push(...r.notes);
    if (r.blocked) {
      blocked = true;
      blockMessage = r.blockMessage;
    }
  }
  return { ok: !blocked, notes, blocked, blockMessage };
}
