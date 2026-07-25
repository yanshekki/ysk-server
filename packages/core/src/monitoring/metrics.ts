/**
 * Host metrics snapshot for dashboard / predictive thresholds.
 */

import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import fs from 'node:fs';

export interface MetricsSnapshot {
  at: string;
  loadavg: number[];
  cpuCount: number;
  memory: { total: number; free: number; usedRatio: number };
  uptimeSec: number;
  disk?: { path: string; free: number; total: number; usedRatio: number };
  alerts: string[];
}

export function collectMetrics(diskPath = '/'): MetricsSnapshot {
  const total = totalmem();
  const free = freemem();
  const usedRatio = total > 0 ? 1 - free / total : 0;
  const load = loadavg();
  const alerts: string[] = [];
  if (usedRatio > 0.9) alerts.push('memory_high');
  if (load[0] > cpus().length * 2) alerts.push('load_high');

  let disk: MetricsSnapshot['disk'];
  try {
    const statfs = (fs as unknown as { statfsSync?: (p: string) => { blocks: number; bsize: number; bfree: number } })
      .statfsSync;
    if (typeof statfs === 'function') {
      const s = statfs(diskPath);
      const dTotal = Number(s.blocks) * Number(s.bsize);
      const dFree = Number(s.bfree) * Number(s.bsize);
      const dUsed = dTotal > 0 ? 1 - dFree / dTotal : 0;
      disk = { path: diskPath, free: dFree, total: dTotal, usedRatio: dUsed };
      if (dUsed > 0.9) alerts.push('disk_high');
    }
  } catch {
    /* ignore */
  }

  // optional: read /proc/loadavg for consistency
  if (existsSync('/proc/loadavg')) {
    try {
      readFileSync('/proc/loadavg', 'utf8');
    } catch {
      /* ignore */
    }
  }

  return {
    at: new Date().toISOString(),
    loadavg: load,
    cpuCount: cpus().length,
    memory: { total, free, usedRatio },
    uptimeSec: uptime(),
    disk,
    alerts,
  };
}
