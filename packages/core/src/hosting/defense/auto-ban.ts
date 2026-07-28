/**
 * Defense auto-ban policy, suspect IP list, batch ban, whitelist.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { fail2banBannedIps } from '../system-apply.js';
import type {
  AutoBanMode,
  AutoBanPolicy,
  BanMethod,
  SuspectIp,
} from './types.js';

const POLICY_KEY = 'defense_auto_ban';
const TIMELINE_KEY = 'defense_timeline';

const SCAN_PATH_RE =
  /(?:wp-admin|wp-login|\.env|phpmyadmin|\/\.git|xmlrpc\.php|cgi-bin|actuator|\/\.aws)/i;

export const DEFAULT_AUTO_BAN: AutoBanPolicy = {
  enabled: false,
  mode: 'soft',
  method: 'fail2ban',
  cooldownMinutes: 60,
  maxAutoBansPerHour: 40,
  whitelist: ['127.0.0.1', '::1'],
};

export function isValidIp(ip: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
  }
  if (ip.includes(':') && ip.length < 46) return true;
  return false;
}

function isPrivateOrLocal(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

/** Simple IPv4 CIDR or exact match. */
export function ipMatchesWhitelist(ip: string, whitelist: string[]): boolean {
  const trimmed = ip.trim();
  for (const w of whitelist) {
    const rule = w.trim();
    if (!rule) continue;
    if (rule === trimmed) return true;
    if (rule.includes('/')) {
      const [base, bitsStr] = rule.split('/');
      const bits = Number(bitsStr);
      if (!base || !Number.isFinite(bits) || bits < 0 || bits > 32) continue;
      if (!isValidIp(base) || !isValidIp(trimmed)) continue;
      if (ipv4InCidr(trimmed, base, bits)) return true;
    }
  }
  return false;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

function ipv4InCidr(ip: string, base: string, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function loadAutoBanPolicy(db: JsonStore): AutoBanPolicy {
  try {
    const raw = db.snapshot.settings?.[POLICY_KEY];
    if (!raw) return { ...DEFAULT_AUTO_BAN, whitelist: [...DEFAULT_AUTO_BAN.whitelist] };
    const p = JSON.parse(raw) as Partial<AutoBanPolicy>;
    return {
      enabled: Boolean(p.enabled),
      mode: p.mode === 'normal' || p.mode === 'aggressive' || p.mode === 'off' || p.mode === 'soft'
        ? p.mode
        : 'soft',
      method: p.method === 'ufw' || p.method === 'both' ? p.method : 'fail2ban',
      cooldownMinutes: Math.max(5, Math.min(24 * 60, Number(p.cooldownMinutes) || 60)),
      maxAutoBansPerHour: Math.max(1, Math.min(500, Number(p.maxAutoBansPerHour) || 40)),
      whitelist: Array.isArray(p.whitelist)
        ? p.whitelist.map(String).filter(Boolean).slice(0, 200)
        : [...DEFAULT_AUTO_BAN.whitelist],
      recentAutoBanAts: Array.isArray(p.recentAutoBanAts)
        ? p.recentAutoBanAts.map(String).slice(0, 500)
        : [],
      lastTickAt: p.lastTickAt,
      lastTickNotes: p.lastTickNotes,
      pausedReason: p.pausedReason,
    };
  } catch {
    return { ...DEFAULT_AUTO_BAN, whitelist: [...DEFAULT_AUTO_BAN.whitelist] };
  }
}

export function saveAutoBanPolicy(db: JsonStore, policy: AutoBanPolicy): AutoBanPolicy {
  const next: AutoBanPolicy = {
    ...policy,
    whitelist: (policy.whitelist ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 200),
    recentAutoBanAts: (policy.recentAutoBanAts ?? []).slice(0, 500),
  };
  db.snapshot.settings[POLICY_KEY] = JSON.stringify(next);
  db.persist();
  return next;
}

export function updateAutoBanPolicy(
  db: JsonStore,
  patch: Partial<AutoBanPolicy>,
): AutoBanPolicy {
  const cur = loadAutoBanPolicy(db);
  const next = saveAutoBanPolicy(db, {
    ...cur,
    ...patch,
    whitelist: patch.whitelist ?? cur.whitelist,
  });
  return next;
}

export function countAutoBansLastHour(policy: AutoBanPolicy): number {
  const cut = Date.now() - 3600_000;
  return (policy.recentAutoBanAts ?? []).filter((t) => new Date(t).getTime() >= cut).length;
}

function pushTimeline(
  db: JsonStore,
  entry: { at: string; kind: string; title: string; detail?: string },
): void {
  let list: Array<Record<string, unknown>> = [];
  try {
    const raw = db.snapshot.settings?.[TIMELINE_KEY];
    if (raw) list = JSON.parse(raw) as Array<Record<string, unknown>>;
  } catch {
    list = [];
  }
  list.unshift(entry);
  db.snapshot.settings[TIMELINE_KEY] = JSON.stringify(list.slice(0, 200));
  db.persist();
}

/** Thresholds by mode for auto-ban decision on suspect score/hits. */
export function modeThresholds(mode: AutoBanMode): {
  minScore: number;
  minHits: number;
  min429: number;
  minScan: number;
} {
  switch (mode) {
    case 'aggressive':
      return { minScore: 25, minHits: 30, min429: 15, minScan: 5 };
    case 'normal':
      return { minScore: 40, minHits: 60, min429: 30, minScan: 12 };
    case 'soft':
      return { minScore: 55, minHits: 100, min429: 50, minScan: 20 };
    default:
      return { minScore: 9999, minHits: 9999, min429: 9999, minScan: 9999 };
  }
}

/**
 * Suggested auto-ban mode when applying a defense preset.
 */
export function suggestedAutoBanForPreset(
  preset: 'daily' | 'hardened' | 'under_attack' | 'emergency',
): Partial<AutoBanPolicy> {
  switch (preset) {
    case 'daily':
      return { enabled: false, mode: 'soft', method: 'fail2ban' };
    case 'hardened':
      return { enabled: true, mode: 'normal', method: 'fail2ban' };
    case 'under_attack':
      return { enabled: true, mode: 'aggressive', method: 'fail2ban' };
    case 'emergency':
      return { enabled: true, mode: 'aggressive', method: 'both' };
  }
}

type Acc = {
  hits: number;
  s429: number;
  scan: number;
  reasons: Set<string>;
  sources: Set<string>;
  lastSeen: number;
};

function ensureAcc(map: Map<string, Acc>, ip: string): Acc {
  let a = map.get(ip);
  if (!a) {
    a = { hits: 0, s429: 0, scan: 0, reasons: new Set(), sources: new Set(), lastSeen: 0 };
    map.set(ip, a);
  }
  return a;
}

/** Parse nginx combined-ish logs for per-IP hits / 429 / scan paths. */
export function parseAccessLogSuspects(content: string, maxLines = 4000): Map<string, Acc> {
  const map = new Map<string, Acc>();
  const lines = content.split('\n').filter(Boolean).slice(-maxLines);
  const now = Date.now();
  for (const line of lines) {
    const ipM = line.match(/^(\d{1,3}(?:\.\d{1,3}){3}|[a-fA-F0-9:]+)\s/);
    if (!ipM) continue;
    const ip = ipM[1];
    if (!isValidIp(ip) || isPrivateOrLocal(ip)) continue;
    const a = ensureAcc(map, ip);
    a.hits += 1;
    a.lastSeen = now;
    a.sources.add('access_log');
    const st = line.match(/"\s+(\d{3})\s+/);
    if (st?.[1] === '429') {
      a.s429 += 1;
      a.reasons.add('HTTP 429');
    } else if (st && Number(st[1]) >= 400) {
      a.reasons.add(`HTTP ${st[1]}`);
    }
    const pathM = line.match(/"(?:GET|POST|HEAD|PUT|DELETE|OPTIONS)\s+([^\s"]+)/);
    if (pathM && SCAN_PATH_RE.test(pathM[1])) {
      a.scan += 1;
      a.reasons.add('掃描路徑');
    }
  }
  return map;
}

function readLogSnippets(dataDir: string): string {
  const chunks: string[] = [];
  const dirs = [
    join(dataDir, 'nginx', 'logs'),
    '/var/log/nginx',
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir)
        .filter((n) => n.includes('access'))
        .slice(0, 8);
      for (const f of files) {
        const p = join(dir, f);
        try {
          if (!statSync(p).isFile()) continue;
          const buf = readFileSync(p);
          chunks.push(buf.slice(Math.max(0, buf.length - 180_000)).toString('utf8'));
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }
  // also single common path
  for (const p of ['/var/log/nginx/access.log']) {
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p);
        chunks.push(buf.slice(Math.max(0, buf.length - 180_000)).toString('utf8'));
      } catch {
        /* */
      }
    }
  }
  return chunks.join('\n');
}

function scoreAcc(a: Acc): number {
  let s = 0;
  if (a.hits >= 200) s += 35;
  else if (a.hits >= 100) s += 25;
  else if (a.hits >= 50) s += 15;
  else if (a.hits >= 20) s += 8;
  if (a.s429 >= 50) s += 40;
  else if (a.s429 >= 20) s += 28;
  else if (a.s429 >= 8) s += 15;
  if (a.scan >= 20) s += 30;
  else if (a.scan >= 8) s += 18;
  else if (a.scan >= 3) s += 10;
  return Math.min(100, s);
}

/**
 * Build ranked suspect IP list for quick ban UI.
 */
export async function listSuspectIps(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
}): Promise<{ items: SuspectIp[]; notes: string[] }> {
  const notes: string[] = [];
  const map = new Map<string, Acc>();
  const policy = loadAutoBanPolicy(input.db);
  const banned = new Set<string>();

  try {
    const { listDefenseBans } = await import('./defense-service.js');
    const bans = await listDefenseBans({ host: input.host, db: input.db });
    for (const b of bans.items) banned.add(b.ip);
  } catch {
    notes.push('讀取已封禁清單失敗');
  }

  // Access + auth logs
  try {
    const content = readLogSnippets(input.dataDir);
    if (content.trim()) {
      const fromLog = parseAccessLogSuspects(content);
      for (const [ip, a] of fromLog) {
        const cur = ensureAcc(map, ip);
        cur.hits += a.hits;
        cur.s429 += a.s429;
        cur.scan += a.scan;
        a.reasons.forEach((r) => cur.reasons.add(r));
        a.sources.forEach((s) => cur.sources.add(s));
        cur.lastSeen = Math.max(cur.lastSeen, a.lastSeen);
      }
      notes.push('已掃描 nginx access log 樣本');
      // SSH / auth failures
      try {
        const { parseAuthFailIps } = await import('./intel.js');
        const authMap = parseAuthFailIps(content);
        for (const [ip, n] of authMap) {
          if (n < 3) continue;
          const cur = ensureAcc(map, ip);
          cur.hits += n;
          cur.scan += Math.min(n, 15);
          cur.reasons.add(`SSH 失敗×${n}`);
          cur.sources.add('auth_log');
          cur.lastSeen = Date.now();
        }
        if (authMap.size) notes.push(`auth 失敗來源 ${authMap.size} IP`);
      } catch {
        /* */
      }
    } else {
      notes.push('無可用 access log（仍可用手動 / 自動 ban）');
    }
  } catch {
    notes.push('access log 解析失敗');
  }

  // fail2ban currently banned → show as already banned for context (still list high activity)
  try {
    if (input.host.executeEnabled()) {
      const f = await fail2banBannedIps(input.host);
      for (const b of f.items ?? []) {
        banned.add(b.ip);
        const a = ensureAcc(map, b.ip);
        a.sources.add('fail2ban');
        a.reasons.add(`jail:${b.jail}`);
        a.hits = Math.max(a.hits, 1);
        a.lastSeen = Date.now();
      }
    }
  } catch {
    /* */
  }

  // Panel ban intents that are not system-banned yet — not suspects, skip

  // Built-in low-priority: nothing extra without network intel

  const items: SuspectIp[] = [];
  for (const [ip, a] of map) {
    const score = scoreAcc(a);
    if (score < 8 && a.hits < 15 && a.scan < 2) continue;
    const reasons = [...a.reasons];
    if (a.hits >= 20) reasons.unshift(`請求×${a.hits}`);
    if (a.s429) reasons.push(`429×${a.s429}`);
    if (a.scan) reasons.push(`掃描×${a.scan}`);
    items.push({
      ip,
      score,
      hits: a.hits,
      reasons: reasons.slice(0, 6),
      sources: [...a.sources],
      lastSeen: new Date(a.lastSeen || Date.now()).toISOString(),
      alreadyBanned: banned.has(ip),
      whitelisted: ipMatchesWhitelist(ip, policy.whitelist),
    });
  }

  items.sort((x, y) => y.score - x.score || y.hits - x.hits);
  return { items: items.slice(0, 80), notes };
}

export async function defenseBanBatch(input: {
  host: HostExecutor;
  db: JsonStore;
  ips: string[];
  reason?: string;
  method?: BanMethod;
  jail?: string;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  results: Array<{ ip: string; ok: boolean; notes: string[] }>;
  notes: string[];
}> {
  const ips = [...new Set(input.ips.map((i) => i.trim()).filter(isValidIp))].slice(0, 50);
  if (!ips.length) return { ok: false, results: [], notes: ['無有效 IP'] };
  const policy = loadAutoBanPolicy(input.db);
  const results: Array<{ ip: string; ok: boolean; notes: string[] }> = [];
  let anyBlocked = false;
  for (const ip of ips) {
    if (ipMatchesWhitelist(ip, policy.whitelist)) {
      results.push({ ip, ok: false, notes: ['白名單：略過'] });
      continue;
    }
    const { defenseBanIp } = await import('./defense-service.js');
    const r = await defenseBanIp({
      host: input.host,
      db: input.db,
      ip,
      reason: input.reason ?? '批量封禁',
      method: input.method ?? policy.method,
      jail: input.jail,
    });
    if (r.blocked) anyBlocked = true;
    results.push({ ip, ok: r.ok, notes: r.notes });
  }
  const okCount = results.filter((r) => r.ok).length;
  pushTimeline(input.db, {
    at: new Date().toISOString(),
    kind: 'ban_batch',
    title: `批量封禁 ${okCount}/${ips.length}`,
    detail: ips.slice(0, 8).join(', '),
  });
  return {
    ok: okCount > 0 || !anyBlocked,
    blocked: anyBlocked,
    results,
    notes: [
      `完成 ${results.length} 個 IP：成功 ${okCount}`,
      anyBlocked ? '部分或全部未套用到系統（需 YSK_EXECUTE）' : '',
    ].filter(Boolean),
  };
}

/**
 * One auto-ban scheduler tick. Fail-closed without EXECUTE.
 */
export async function runAutoBanTick(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
}): Promise<{
  ok: boolean;
  banned: string[];
  skipped: string[];
  notes: string[];
  policy: AutoBanPolicy;
}> {
  const policy = loadAutoBanPolicy(input.db);
  const notes: string[] = [];
  const banned: string[] = [];
  const skipped: string[] = [];

  if (!policy.enabled || policy.mode === 'off') {
    const next = saveAutoBanPolicy(input.db, {
      ...policy,
      lastTickAt: new Date().toISOString(),
      lastTickNotes: ['自動 ban 未開啟'],
      pausedReason: undefined,
    });
    return { ok: true, banned, skipped, notes: ['自動 ban 未開啟'], policy: next };
  }

  if (!input.host.executeEnabled()) {
    const next = saveAutoBanPolicy(input.db, {
      ...policy,
      lastTickAt: new Date().toISOString(),
      lastTickNotes: ['需 YSK_EXECUTE 才會真正 auto-ban'],
      pausedReason: 'no_execute',
    });
    return {
      ok: false,
      banned,
      skipped,
      notes: ['自動 ban 暫停：未開啟系統變更（YSK_EXECUTE）'],
      policy: next,
    };
  }

  const hourCount = countAutoBansLastHour(policy);
  if (hourCount >= policy.maxAutoBansPerHour) {
    const next = saveAutoBanPolicy(input.db, {
      ...policy,
      lastTickAt: new Date().toISOString(),
      lastTickNotes: [`熔斷：本小時已 auto-ban ${hourCount} 次`],
      pausedReason: 'circuit_breaker',
    });
    notes.push(`熔斷：本小時已達上限 ${policy.maxAutoBansPerHour}`);
    pushTimeline(input.db, {
      at: new Date().toISOString(),
      kind: 'auto_ban',
      title: '自動 ban 熔斷',
      detail: notes[0],
    });
    return { ok: false, banned, skipped, notes, policy: next };
  }

  let th = modeThresholds(policy.mode);
  try {
    const raw = input.db.snapshot.settings?.defense_auto_ban_custom_th;
    if (raw) {
      const c = JSON.parse(raw) as {
        minScore?: number;
        minHits?: number;
        min429?: number;
        minScan?: number;
      };
      th = {
        minScore: Number(c.minScore) || th.minScore,
        minHits: Number(c.minHits) || th.minHits,
        min429: Number(c.min429) || th.min429,
        minScan: Number(c.minScan) || th.minScan,
      };
    }
  } catch {
    /* use mode defaults */
  }
  const { items } = await listSuspectIps(input);
  const cooldownMs = policy.cooldownMinutes * 60_000;
  const recent = new Set(
    (policy.recentAutoBanAts ?? [])
      .filter((t) => Date.now() - new Date(t).getTime() < cooldownMs)
      .map(() => ''),
  );
  // track recent IPs separately
  let recentIpKey = 'defense_auto_ban_recent_ips';
  let recentIps: Record<string, string> = {};
  try {
    const raw = input.db.snapshot.settings?.[recentIpKey];
    if (raw) recentIps = JSON.parse(raw) as Record<string, string>;
  } catch {
    recentIps = {};
  }

  let remaining = policy.maxAutoBansPerHour - hourCount;
  const recentAts = [...(policy.recentAutoBanAts ?? [])];

  for (const s of items) {
    if (remaining <= 0) break;
    if (s.whitelisted || s.alreadyBanned) {
      skipped.push(s.ip);
      continue;
    }
    if (ipMatchesWhitelist(s.ip, policy.whitelist)) {
      skipped.push(s.ip);
      continue;
    }
    const last = recentIps[s.ip];
    if (last && Date.now() - new Date(last).getTime() < cooldownMs) {
      skipped.push(s.ip);
      continue;
    }
    const hit429 = s.reasons.some((r) => r.startsWith('429'));
    const hitScan = s.reasons.some((r) => r.includes('掃描'));
    const pass =
      s.score >= th.minScore ||
      s.hits >= th.minHits ||
      (hit429 && s.hits >= th.min429) ||
      (hitScan && s.hits >= th.minScan);
    if (!pass) {
      skipped.push(s.ip);
      continue;
    }

    const { defenseBanIp } = await import('./defense-service.js');
    const r = await defenseBanIp({
      host: input.host,
      db: input.db,
      ip: s.ip,
      reason: `auto-ban(${policy.mode}): ${s.reasons.slice(0, 2).join(', ')}`,
      method: policy.method,
    });
    if (r.ok) {
      banned.push(s.ip);
      remaining -= 1;
      const at = new Date().toISOString();
      recentAts.unshift(at);
      recentIps[s.ip] = at;
      notes.push(`auto-ban ${s.ip}`);
    } else {
      skipped.push(s.ip);
      notes.push(...r.notes.slice(0, 1));
    }
  }

  void recent; // silence if unused
  input.db.snapshot.settings[recentIpKey] = JSON.stringify(
    Object.fromEntries(
      Object.entries(recentIps)
        .filter(([, t]) => Date.now() - new Date(t).getTime() < 48 * 3600_000)
        .slice(0, 500),
    ),
  );

  const next = saveAutoBanPolicy(input.db, {
    ...policy,
    recentAutoBanAts: recentAts.slice(0, 200),
    lastTickAt: new Date().toISOString(),
    lastTickNotes: notes.slice(0, 12),
    pausedReason: undefined,
  });

  if (banned.length) {
    pushTimeline(input.db, {
      at: new Date().toISOString(),
      kind: 'auto_ban',
      title: `自動 ban ${banned.length} 個 IP`,
      detail: banned.slice(0, 10).join(', '),
    });
  }

  return {
    ok: true,
    banned,
    skipped: skipped.slice(0, 40),
    notes: notes.length ? notes : ['本輪無可 ban 對象'],
    policy: next,
  };
}

export function humanizeFirewall(active?: string, installed?: boolean, isRoot?: boolean): {
  short: string;
  tone: 'ok' | 'warn' | 'danger' | 'default';
  detail?: string;
} {
  if (!installed) return { short: '未安裝', tone: 'default', detail: '系統未偵測到 UFW' };
  const a = (active ?? '').toLowerCase();
  if (a.includes('need to be root') || a.includes('error')) {
    return {
      short: isRoot ? '讀取失敗' : '需 root',
      tone: 'warn',
      detail: '目前權限讀不到防火牆狀態（非攻擊）',
    };
  }
  if (a === 'active' || a.includes('active')) return { short: '運作中', tone: 'ok' };
  if (a === 'inactive') return { short: '已關閉', tone: 'warn', detail: 'UFW inactive' };
  return { short: active?.slice(0, 16) || '未知', tone: 'default' };
}

export function humanizeFail2ban(active?: string, installed?: boolean): {
  short: string;
  tone: 'ok' | 'warn' | 'danger' | 'default';
  detail?: string;
} {
  if (installed === false) return { short: '未安裝', tone: 'default' };
  if (active === 'active') return { short: '運作中', tone: 'ok' };
  if (active === 'inactive') return { short: '未運行', tone: 'warn', detail: '可到 fail2ban 頁啟動' };
  return { short: active || '未知', tone: 'default' };
}
