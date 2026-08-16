import { tl } from 'ysk-server-shared';
/**
 * Lightweight web access stats from managed nginx access logs (honest sample).
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export type WebStatsSummary = {
  projectId?: string;
  logPath?: string;
  linesRead: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  topPaths: Array<{ path: string; count: number }>;
  topStatus: Array<{ status: string; count: number }>;
  bytesHint: number;
  notes: string[];
};

/**
 * Parse last N lines of an access log (combined-ish).
 */
export function parseAccessLogTail(content: string, maxLines = 5000): WebStatsSummary {
  const lines = content.split('\n').filter(Boolean).slice(-maxLines);
  const pathCount = new Map<string, number>();
  const statusCount = new Map<string, number>();
  let s2 = 0,
    s3 = 0,
    s4 = 0,
    s5 = 0;
  let bytesHint = 0;

  for (const line of lines) {
    // common: ... "GET /path HTTP/1.1" 200 1234
    const m = line.match(/"(?:GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+([^\s?]+).*?"\s+(\d{3})\s+(\d+)/);
    if (!m) continue;
    const path = m[1].slice(0, 120);
    const status = m[2];
    const bytes = Number(m[3]) || 0;
    bytesHint += bytes;
    pathCount.set(path, (pathCount.get(path) ?? 0) + 1);
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    const code = Number(status);
    if (code >= 200 && code < 300) s2++;
    else if (code >= 300 && code < 400) s3++;
    else if (code >= 400 && code < 500) s4++;
    else if (code >= 500) s5++;
  }

  const topPaths = [...pathCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));
  const topStatus = [...statusCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([status, count]) => ({ status, count }));

  return {
    linesRead: lines.length,
    status2xx: s2,
    status3xx: s3,
    status4xx: s4,
    status5xx: s5,
    topPaths,
    topStatus,
    bytesHint,
    notes: lines.length
      ? [tl('notes.auto.t0260', { v0: (lines.length) })]
      : [tl('notes.auto.n1095')],
  };
}

export async function collectProjectWebStats(input: {
  host: HostExecutor;
  dataDir: string;
  projectId: string;
  homeDir: string;
  linuxUser: string;
}): Promise<WebStatsSummary> {
  // Project-local paths only via direct FS. System /var/log paths go through
  // host.runCommand so CI/sandbox hosts without nginx logs (or with unrelated
  // production logs) do not leak into unit isolation.
  const localCandidates = [
    join(input.homeDir, 'logs', 'access.log'),
    join(input.homeDir, 'log', 'access.log'),
    join(input.dataDir, 'nginx', 'logs', `${input.linuxUser}.access.log`),
  ];
  const hostCandidates = [
    `/var/log/nginx/${input.linuxUser}.access.log`,
  ];
  let logPath: string | undefined;
  let content = '';
  for (const p of localCandidates) {
    if (existsSync(p) && statSync(p).isFile()) {
      logPath = p;
      try {
        // read last ~256KB
        const buf = readFileSync(p);
        content = buf.slice(Math.max(0, buf.length - 256_000)).toString('utf8');
      } catch {
        content = '';
      }
      break;
    }
  }

  if (!logPath && input.host.executeEnabled()) {
    for (const p of hostCandidates) {
      const r = await input.host.runCommand(
        ['bash', '-c', `tail -n 2000 ${JSON.stringify(p)} 2>/dev/null || true`],
        { timeoutMs: 10_000 },
      );
      if (r.stdout.trim()) {
        logPath = p;
        content = r.stdout;
        break;
      }
    }
  }

  const summary = parseAccessLogTail(content);
  summary.projectId = input.projectId;
  summary.logPath = logPath;
  if (!logPath) {
    summary.notes = [
      tl('notes.auto.n0862'),
      tl('notes.auto.n1239'),
    ];
  }
  return summary;
}

/** List log-like files under dataDir/nginx/logs */
export function listManagedAccessLogs(
  dataDir: string,
): Array<{ name: string; path: string; bytes: number }> {
  const dir = join(dataDir, 'nginx', 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.includes('access'))
    .map((name) => {
      const path = join(dir, name);
      try {
        return { name, path, bytes: statSync(path).size };
      } catch {
        return { name, path, bytes: 0 };
      }
    });
}

export type DailyStatPoint = {
  day: string; // YYYY-MM-DD
  hits: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
};

/**
 * Merge current tail parse into rolling daily series under dataDir/stats/<projectId>.json
 */
export function recordProjectDailyStats(
  dataDir: string,
  projectId: string,
  summary: WebStatsSummary,
): { written: string; series: DailyStatPoint[] } {
  const dir = join(dataDir, 'stats');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${projectId}.json`);
  let series: DailyStatPoint[] = [];
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as
        | DailyStatPoint[]
        | { series?: DailyStatPoint[] };
      series = Array.isArray(raw) ? raw : (raw.series ?? []);
    }
  } catch {
    series = [];
  }
  const day = new Date().toISOString().slice(0, 10);
  const hits = summary.linesRead;
  const existing = series.find((s) => s.day === day);
  if (existing) {
    existing.hits = Math.max(existing.hits, hits);
    existing.status2xx = Math.max(existing.status2xx, summary.status2xx);
    existing.status4xx = Math.max(existing.status4xx, summary.status4xx);
    existing.status5xx = Math.max(existing.status5xx, summary.status5xx);
  } else {
    series.push({
      day,
      hits,
      status2xx: summary.status2xx,
      status4xx: summary.status4xx,
      status5xx: summary.status5xx,
    });
  }
  series = series.sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-60);
  writeFileSync(
    path,
    JSON.stringify({ projectId, series, updatedAt: new Date().toISOString() }, null, 2),
  );
  return { written: path, series };
}

export function readProjectDailyStats(
  dataDir: string,
  projectId: string,
): DailyStatPoint[] {
  const path = join(dataDir, 'stats', `${projectId}.json`);
  if (!existsSync(path)) return [];
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as { series?: DailyStatPoint[] };
    return j.series ?? [];
  } catch {
    return [];
  }
}
