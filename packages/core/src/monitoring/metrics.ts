/**
 * Host metrics snapshot for dashboard / predictive thresholds.
 * Disk mounts and process lists use real host commands (honest, no fake rows).
 */

import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import fs from 'node:fs';
import type { HostExecutor } from '../host/executor.js';

export interface DiskMount {
  filesystem: string;
  size: number;
  used: number;
  avail: number;
  usedRatio: number;
  mount: string;
}

export interface MetricsSnapshot {
  at: string;
  loadavg: number[];
  cpuCount: number;
  memory: { total: number; free: number; usedRatio: number; available?: number };
  uptimeSec: number;
  disk?: { path: string; free: number; total: number; usedRatio: number };
  /** Multi-mount from `df -P -B1` when host provided */
  diskMounts?: DiskMount[];
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

  let available: number | undefined;
  if (existsSync('/proc/meminfo')) {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const m = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (m) available = Number(m[1]) * 1024;
    } catch {
      /* ignore */
    }
  }

  let disk: MetricsSnapshot['disk'];
  try {
    const statfs = (
      fs as unknown as {
        statfsSync?: (p: string) => { blocks: number; bsize: number; bfree: number };
      }
    ).statfsSync;
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

  return {
    at: new Date().toISOString(),
    loadavg: load,
    cpuCount: cpus().length,
    memory: { total, free, usedRatio, available },
    uptimeSec: uptime(),
    disk,
    alerts,
  };
}

/**
 * Parse `df -P -B1` output into mounts.
 * Skips tmpfs/devtmpfs/squashfs by default.
 */
export function parseDfOutput(
  stdout: string,
  opts?: { includePseudo?: boolean },
): DiskMount[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const out: DiskMount[] = [];
  for (const line of lines.slice(1)) {
    // Filesystem 1024-blocks Used Available Capacity Mounted on
    // With -B1: size in bytes
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const mount = parts.slice(5).join(' ');
    const filesystem = parts[0];
    const size = Number(parts[1]);
    const used = Number(parts[2]);
    const avail = Number(parts[3]);
    if (!Number.isFinite(size) || size <= 0) continue;
    const fsLow = filesystem.toLowerCase();
    if (
      !opts?.includePseudo &&
      (fsLow.includes('tmpfs') ||
        fsLow.includes('devtmpfs') ||
        fsLow.includes('squashfs') ||
        fsLow === 'overlay' ||
        mount.startsWith('/snap'))
    ) {
      continue;
    }
    const usedRatio = size > 0 ? used / size : 0;
    out.push({
      filesystem,
      size,
      used,
      avail: Number.isFinite(avail) ? avail : Math.max(0, size - used),
      usedRatio,
      mount,
    });
  }
  return out;
}

/** Real multi-disk via df on host */
export async function collectDiskMounts(
  host: HostExecutor,
  opts?: { includePseudo?: boolean },
): Promise<{ mounts: DiskMount[]; notes: string[] }> {
  const notes: string[] = [];
  const r = await host.runCommand(['df', '-P', '-B1'], { timeoutMs: 8_000 });
  if (r.exitCode !== 0) {
    notes.push(`df 失敗：${(r.stderr || r.stdout).slice(0, 160)}`);
    return { mounts: [], notes };
  }
  const mounts = parseDfOutput(r.stdout, opts);
  if (!mounts.length) notes.push('df 無可用 mount（或全被過濾）');
  return { mounts, notes };
}

/**
 * Full metrics with multi-disk when host available.
 */
export async function collectMetricsDeep(
  host: HostExecutor,
  diskPath = '/',
): Promise<MetricsSnapshot & { notes?: string[] }> {
  const base = collectMetrics(diskPath);
  const { mounts, notes } = await collectDiskMounts(host);
  const alerts = [...base.alerts];
  for (const m of mounts) {
    if (m.usedRatio > 0.9 && m.mount === '/') {
      if (!alerts.includes('disk_high')) alerts.push('disk_high');
    }
  }
  // Prefer root mount from df for primary disk if present
  const root = mounts.find((m) => m.mount === diskPath || m.mount === '/');
  const disk = root
    ? {
        path: root.mount,
        free: root.avail,
        total: root.size,
        usedRatio: root.usedRatio,
      }
    : base.disk;

  return {
    ...base,
    disk,
    diskMounts: mounts,
    alerts,
    notes: notes.length ? notes : undefined,
  };
}
