import { tl } from '@ysk/shared';
/**
 * Real Redis service probe + key browser via redis-cli.
 * Reads work without YSK_EXECUTE when redis is reachable.
 * Writes/deletes require executeEnabled.
 */

import type { HostExecutor } from '../host/executor.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { installSoftware } from './software-install.js';
import { probeEndpoint } from './db-client.js';

const SAFE_KEY = /^[\w.:@/+\-[\]{}|=,~-]{1,512}$/;
const SAFE_PATTERN = /^[\w.:@/+\-[\]{}|=,~*?-]{1,256}$/;

export interface RedisServiceStatus {
  serverInstalled: boolean;
  clientInstalled: boolean;
  unit: string;
  active: string;
  reachable: boolean;
  ping: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  canRead: boolean;
  canWrite: boolean;
  canInstall: boolean;
  version?: string;
  usedMemory?: string;
  connectedClients?: string;
  keyspace: Array<{ db: number; keys: number; expires?: number }>;
  /** CONFIG GET databases — logical DB count (0 .. n-1) */
  databases?: number;
  blockMessage?: string;
}

export interface RedisKeyListItem {
  key: string;
  type?: string;
  ttl?: number;
}

export interface RedisKeyView {
  key: string;
  type: string;
  ttl: number;
  value: string | Record<string, string> | string[] | Array<{ member: string; score: string }>;
  raw?: string;
}

function validateDb(db: number): number {
  const n = Number(db);
  if (!Number.isInteger(n) || n < 0 || n > 15) {
    throw new Error(tl('notes.auto.n0091'));
  }
  return n;
}

function validateKey(key: string): string {
  const k = key.trim();
  if (!k || !SAFE_KEY.test(k)) {
    throw new Error(tl('notes.auto.n1114'));
  }
  return k;
}

function validatePattern(pattern: string): string {
  const p = (pattern || '*').trim() || '*';
  if (!SAFE_PATTERN.test(p)) {
    throw new Error(tl('notes.auto.n1117'));
  }
  return p;
}

async function hasBin(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} 2>/dev/null || true`], {
    timeoutMs: 5_000 });
  return r.stdout.trim().length > 0;
}

async function unitActive(host: HostExecutor, unit: string): Promise<string> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return 'unknown';
  }
  const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || 'unknown').trim().split('\n')[0] || 'unknown';
}

async function redisCli(
  host: HostExecutor,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return host.runCommand(['redis-cli', ...args], { timeoutMs });
}

export async function probeRedisService(host: HostExecutor): Promise<RedisServiceStatus> {
  const clientInstalled = await hasBin(host, 'redis-cli');
  const serverInstalled =
    (await hasBin(host, 'redis-server')) || (await hasBin(host, 'redis-server'));
  let active = await unitActive(host, 'redis-server');
  if (active !== 'active') {
    const alt = await unitActive(host, 'redis');
    if (alt === 'active') active = alt;
  }

  const reach = await probeEndpoint('127.0.0.1', 6379, 2000);
  const reachable = reach.ok;
  let ping: string | null = null;
  let version: string | undefined;
  let usedMemory: string | undefined;
  let connectedClients: string | undefined;
  const keyspace: RedisServiceStatus['keyspace'] = [];

  let databases = 16;
  if (clientInstalled && reachable) {
    const p = await redisCli(host, ['PING'], 5_000);
    ping = p.stdout.trim() || null;
    const info = await redisCli(host, ['INFO', 'server'], 5_000);
    const mem = await redisCli(host, ['INFO', 'memory'], 5_000);
    const clients = await redisCli(host, ['INFO', 'clients'], 5_000);
    const ks = await redisCli(host, ['INFO', 'keyspace'], 5_000);
    const dbCfg = await redisCli(host, ['CONFIG', 'GET', 'databases'], 5_000);
    const dbLines = dbCfg.stdout.trim().split('\n');
    const dbN = Number(dbLines[dbLines.length - 1]);
    if (Number.isFinite(dbN) && dbN >= 1 && dbN <= 256) databases = dbN;
    const ver = info.stdout.match(/redis_version:(.+)/);
    if (ver) version = ver[1].trim();
    const um = mem.stdout.match(/used_memory_human:(.+)/);
    if (um) usedMemory = um[1].trim();
    const cc = clients.stdout.match(/connected_clients:(.+)/);
    if (cc) connectedClients = cc[1].trim();
    for (const line of ks.stdout.split('\n')) {
      // db0:keys=1,expires=0,avg_ttl=0
      const m = line.match(/^db(\d+):keys=(\d+)(?:,expires=(\d+))?/);
      if (m) {
        keyspace.push({
          db: Number(m[1]),
          keys: Number(m[2]),
          expires: m[3] != null ? Number(m[3]) : undefined });
      }
    }
  }

  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const canRead = clientInstalled && reachable && ping?.toUpperCase() === 'PONG';
  // Data-plane SET/DEL only needs a live Redis + redis-cli (not YSK_EXECUTE / root).
  // Package install / systemctl still require canInstall.
  const canWrite = canRead;
  const canInstall = executeEnabled && isRoot;

  let blockMessage: string | undefined;
  if (!serverInstalled && !canRead) {
    blockMessage = tl('notes.auto.n0172');
  } else if (!clientInstalled) {
    blockMessage = tl('notes.auto.n0955');
  } else if (!reachable) {
    blockMessage = tl('notes.auto.n1194');
  } else if (!executeEnabled) {
    blockMessage = tl('notes.auto.n1447');
  }

  return {
    serverInstalled: serverInstalled || canRead,
    clientInstalled,
    unit: 'redis-server',
    active: canRead ? (active === 'active' ? 'active' : 'active') : active,
    reachable,
    ping,
    executeEnabled,
    isRoot,
    canRead,
    canWrite,
    canInstall,
    version,
    usedMemory,
    connectedClients,
    keyspace,
    databases,
    blockMessage };
}

export async function installRedisService(input: {
  host: HostExecutor;
  dataDir?: string;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  status: RedisServiceStatus;
}> {
  const tools = await installSoftware({
    host: input.host,
    id: 'redis-tools',
    dataDir: input.dataDir,
    enableUnits: false });
  const server = await installSoftware({
    host: input.host,
    id: 'redis-server',
    dataDir: input.dataDir,
    enableUnits: true });
  const status = await probeRedisService(input.host);
  const blocked = Boolean(tools.blocked || server.blocked);
  return {
    ok: status.canRead && !blocked,
    blocked,
    blockMessage: tools.blockMessage ?? server.blockMessage,
    notes: [...tools.notes, ...server.notes],
    status };
}

export async function startRedisService(host: HostExecutor): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  status: RedisServiceStatus;
}> {
  if (!host.executeEnabled() || !host.isRoot()) {
    const reason: BlockReason = !host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return {
      ok: false,
      blocked: true,
      blockMessage,
      notes: [blockMessage],
      status: await probeRedisService(host) };
  }
  await host.runCommand(['systemctl', 'enable', '--now', 'redis-server'], { timeoutMs: 60_000 });
  const status = await probeRedisService(host);
  return {
    ok: status.canRead,
    notes: status.canRead ? [tl('notes.auto.n0175')] : [tl('notes.auto.n0173')],
    status };
}

export async function listRedisKeys(input: {
  host: HostExecutor;
  db?: number;
  pattern?: string;
  count?: number;
}): Promise<{ ok: boolean; keys: RedisKeyListItem[]; notes: string[]; blocked?: boolean; blockMessage?: string }> {
  const db = validateDb(input.db ?? 0);
  const pattern = validatePattern(input.pattern ?? '*');
  const count = Math.min(Math.max(Number(input.count) || 100, 1), 500);

  if (!(await hasBin(input.host, 'redis-cli'))) {
    return {
      ok: false,
      keys: [],
      notes: [tl('notes.redis.cliMissing')],
      blocked: true,
      blockMessage: tl('notes.redis.cliMissing') };
  }

  // --scan streams keys; use KEYS for small instances as fallback if scan empty issues
  const r = await redisCli(
    input.host,
    ['-n', String(db), '--scan', '--pattern', pattern, 'COUNT', String(count)],
    30_000,
  );
  let lines = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, count);

  if (!lines.length && r.exitCode !== 0) {
    const k = await redisCli(input.host, ['-n', String(db), 'KEYS', pattern], 15_000);
    lines = k.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, count);
  }

  const keys: RedisKeyListItem[] = [];
  for (const key of lines) {
    if (!SAFE_KEY.test(key) && !/^[\w.:@/+\-[\]{}|=,~-]+$/.test(key)) continue;
    const t = await redisCli(input.host, ['-n', String(db), 'TYPE', key], 5_000);
    const ttl = await redisCli(input.host, ['-n', String(db), 'TTL', key], 5_000);
    keys.push({
      key,
      type: t.stdout.trim() || 'unknown',
      ttl: Number(ttl.stdout.trim()) || -1 });
  }

  return { ok: true, keys, notes: [tl('notes.auto.t0110', { v0: (db), v1: (keys.length) })] };
}

export async function getRedisKey(input: {
  host: HostExecutor;
  db?: number;
  key: string;
}): Promise<{ ok: boolean; view?: RedisKeyView; notes: string[] }> {
  const db = validateDb(input.db ?? 0);
  const key = validateKey(input.key);
  const t = await redisCli(input.host, ['-n', String(db), 'TYPE', key], 5_000);
  const type = t.stdout.trim() || 'none';
  if (type === 'none') {
    return { ok: false, notes: [tl('notes.auto.n0313')] };
  }
  const ttlR = await redisCli(input.host, ['-n', String(db), 'TTL', key], 5_000);
  const ttl = Number(ttlR.stdout.trim()) || -1;

  let value: RedisKeyView['value'] = '';
  if (type === 'string') {
    const g = await redisCli(input.host, ['-n', String(db), 'GET', key], 10_000);
    value = g.stdout;
  } else if (type === 'hash') {
    const g = await redisCli(input.host, ['-n', String(db), 'HGETALL', key], 10_000);
    const parts = g.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    const obj: Record<string, string> = {};
    for (let i = 0; i < parts.length; i += 2) {
      obj[parts[i]] = parts[i + 1] ?? '';
    }
    value = obj;
  } else if (type === 'list') {
    const g = await redisCli(input.host, ['-n', String(db), 'LRANGE', key, '0', '99'], 10_000);
    value = g.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  } else if (type === 'set') {
    const g = await redisCli(input.host, ['-n', String(db), 'SMEMBERS', key], 10_000);
    value = g.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  } else if (type === 'zset') {
    const g = await redisCli(
      input.host,
      ['-n', String(db), 'ZRANGE', key, '0', '99', 'WITHSCORES'],
      10_000,
    );
    const parts = g.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    const arr: Array<{ member: string; score: string }> = [];
    for (let i = 0; i < parts.length; i += 2) {
      arr.push({ member: parts[i], score: parts[i + 1] ?? '0' });
    }
    value = arr;
  } else {
    value = tl('notes.auto.t0111', { v0: (type) });
  }

  return {
    ok: true,
    view: { key, type, ttl, value },
    notes: [] };
}

export async function setRedisString(input: {
  host: HostExecutor;
  db?: number;
  key: string;
  value: string;
  ttl?: number;
}): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
}> {
  // Local redis-cli data writes do not require YSK_EXECUTE (panel manages app data).
  if (!(await hasBin(input.host, 'redis-cli'))) {
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage: tl('notes.redis.cliMissing'),
      notes: [tl('notes.redis.cliMissing')] };
  }
  const db = validateDb(input.db ?? 0);
  const key = validateKey(input.key);
  const value = String(input.value ?? '');
  if (value.length > 256_000) {
    return { ok: false, executed: false, notes: [tl('notes.auto.n0460')] };
  }
  const args = ['-n', String(db), 'SET', key, value];
  if (input.ttl != null && input.ttl > 0) {
    args.push('EX', String(Math.floor(input.ttl)));
  }
  const r = await redisCli(input.host, args, 15_000);
  const ok = r.exitCode === 0 && r.stdout.trim().toUpperCase() === 'OK';
  return {
    ok,
    executed: true,
    notes: ok ? [tl('notes.auto.t0112', { v0: (key) })] : [tl('notes.auto.t0113', { v0: (r.stderr || r.stdout) })] };
}

export async function deleteRedisKey(input: {
  host: HostExecutor;
  db?: number;
  key: string;
}): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
}> {
  if (!(await hasBin(input.host, 'redis-cli'))) {
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage: tl('notes.redis.cliMissing'),
      notes: [tl('notes.redis.cliMissing')] };
  }
  const db = validateDb(input.db ?? 0);
  const key = validateKey(input.key);
  const r = await redisCli(input.host, ['-n', String(db), 'DEL', key], 10_000);
  const n = Number(r.stdout.trim());
  return {
    ok: r.exitCode === 0 && n >= 0,
    executed: true,
    notes: n > 0 ? [tl('notes.tpl.deleted', { name: key })] : [tl('notes.auto.t0114')] };
}
