/**
 * Lightweight web access stats from managed nginx access logs (honest sample).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
      ? [`已解析最近 ${lines.length} 行`]
      : ['無可用 access log 行（或格式不符）'],
  };
}

export async function collectProjectWebStats(input: {
  host: HostExecutor;
  dataDir: string;
  projectId: string;
  homeDir: string;
  linuxUser: string;
}): Promise<WebStatsSummary> {
  const candidates = [
    join(input.homeDir, 'logs', 'access.log'),
    join(input.homeDir, 'log', 'access.log'),
    join(input.dataDir, 'nginx', 'logs', `${input.linuxUser}.access.log`),
    `/var/log/nginx/${input.linuxUser}.access.log`,
    '/var/log/nginx/access.log',
  ];
  let logPath: string | undefined;
  let content = '';
  for (const p of candidates) {
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
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `tail -n 2000 /var/log/nginx/access.log 2>/dev/null || true`,
      ],
      { timeoutMs: 10_000 },
    );
    if (r.stdout.trim()) {
      logPath = '/var/log/nginx/access.log';
      content = r.stdout;
    }
  }

  const summary = parseAccessLogTail(content);
  summary.projectId = input.projectId;
  summary.logPath = logPath;
  if (!logPath) {
    summary.notes = [
      '找不到專案 access log — 請確認 nginx access_log 路徑或日誌檔存在',
      '狀態：無資料（非假統計）',
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
