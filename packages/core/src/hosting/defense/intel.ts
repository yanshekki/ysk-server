import { tl } from '@ysk-server/shared';
/**
 * Defense intel — top IPs, vhosts with rate-limit markers, richer log sources.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAccessLogSuspects } from './auto-ban.js';
import { extractIpsFromText, isPrivateOrLocalIp, isValidIp, normalizeIp } from '../../net/ip.js';

export type TopIpRow = {
  ip: string;
  hits: number;
  s429: number;
  scan: number;
  score: number;
};

export type VhostDefenseRow = {
  name: string;
  path: string;
  hasDefenseMarker: boolean;
  bytes: number;
};

function scoreFrom(hits: number, s429: number, scan: number): number {
  let s = 0;
  if (hits >= 200) s += 35;
  else if (hits >= 100) s += 25;
  else if (hits >= 50) s += 15;
  else if (hits >= 20) s += 8;
  if (s429 >= 50) s += 40;
  else if (s429 >= 20) s += 28;
  else if (s429 >= 8) s += 15;
  if (scan >= 20) s += 30;
  else if (scan >= 8) s += 18;
  else if (scan >= 3) s += 10;
  return Math.min(100, s);
}

function readLogChunks(dataDir: string): string {
  const chunks: string[] = [];
  for (const dir of [join(dataDir, 'nginx', 'logs'), '/var/log/nginx']) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir).filter((n) => n.includes('access')).slice(0, 10)) {
        const p = join(dir, f);
        try {
          if (!statSync(p).isFile()) continue;
          const buf = readFileSync(p);
          chunks.push(buf.slice(Math.max(0, buf.length - 200_000)).toString('utf8'));
        } catch {
          /* */
        }
      }
    } catch {
      /* */
    }
  }
  for (const p of ['/var/log/nginx/access.log', '/var/log/auth.log', '/var/log/secure']) {
    if (!existsSync(p)) continue;
    try {
      const buf = readFileSync(p);
      chunks.push(buf.slice(Math.max(0, buf.length - 120_000)).toString('utf8'));
    } catch {
      /* */
    }
  }
  return chunks.join('\n');
}

/** Parse sshd/auth failures into IP hit map extras (IPv4 + IPv6). */
export function parseAuthFailIps(content: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of content.split('\n')) {
    if (!/Failed password|Invalid user|authentication failure|Connection closed by/i.test(line))
      continue;
    // Prefer "from <ip>" then fall back to any public IP on the line
    const fromM =
      line.match(/\bfrom\s+(\S+)/i) ||
      line.match(/\brhost=(\S+)/i);
    let ip: string | null = null;
    if (fromM) {
      const cand = fromM[1].replace(/[\[\],;]+$/g, '');
      ip = normalizeIp(cand);
    }
    if (!ip) {
      ip = extractIpsFromText(line).find((x) => !isPrivateOrLocalIp(x)) ?? null;
    }
    if (!ip || !isValidIp(ip) || isPrivateOrLocalIp(ip)) continue;
    map.set(ip, (map.get(ip) ?? 0) + 1);
  }
  return map;
}

export function collectTopIps(dataDir: string, limit = 30): {
  items: TopIpRow[];
  notes: string[];
} {
  const notes: string[] = [];
  const content = readLogChunks(dataDir);
  if (!content.trim()) {
    return { items: [], notes: [tl('notes.auto.n1097')] };
  }
  const fromAccess = parseAccessLogSuspects(content);
  const fromAuth = parseAuthFailIps(content);
  if (fromAuth.size) notes.push(tl('notes.auto.t0528', { v0: (fromAuth.size) }));

  const merged = new Map<string, { hits: number; s429: number; scan: number }>();
  for (const [ip, a] of fromAccess) {
    merged.set(ip, { hits: a.hits, s429: a.s429, scan: a.scan });
  }
  for (const [ip, n] of fromAuth) {
    const cur = merged.get(ip) ?? { hits: 0, s429: 0, scan: 0 };
    cur.hits += n;
    cur.scan += Math.min(n, 20); // treat auth fails as scan-ish pressure
    merged.set(ip, cur);
  }

  const items: TopIpRow[] = [...merged.entries()]
    .map(([ip, a]) => ({
      ip,
      hits: a.hits,
      s429: a.s429,
      scan: a.scan,
      score: scoreFrom(a.hits, a.s429, a.scan),
    }))
    .sort((x, y) => y.score - x.score || y.hits - x.hits)
    .slice(0, limit);

  notes.push(tl('notes.auto.t0529', { v0: (items.length) }));
  return { items, notes };
}

/** List managed nginx confs and whether YSK_DEFENSE marker is present. */
export function listVhostDefenseMarkers(dataDir: string): {
  items: VhostDefenseRow[];
  withLimit: number;
  total: number;
} {
  const dir = join(dataDir, 'nginx', 'conf.d');
  const items: VhostDefenseRow[] = [];
  if (!existsSync(dir)) return { items: [], withLimit: 0, total: 0 };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.conf'))) {
    if (name.startsWith('00-ysk-defense')) continue;
    const path = join(dir, name);
    try {
      const raw = readFileSync(path, 'utf8');
      const bytes = Buffer.byteLength(raw);
      const hasDefenseMarker = raw.includes('BEGIN YSK_DEFENSE');
      items.push({ name, path, hasDefenseMarker, bytes });
    } catch {
      /* */
    }
  }
  const withLimit = items.filter((i) => i.hasDefenseMarker).length;
  return { items: items.slice(0, 100), withLimit, total: items.length };
}
