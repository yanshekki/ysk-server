/**
 * Disk usage for the validators data root + per-instance dirs.
 * Read-only host commands (df / du) — no EXECUTE required.
 */
import { existsSync } from 'node:fs';
import {
  validatorDiskTone,
  type ValidatorDiskInstance,
  type ValidatorDiskReport,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { listValidatorInstances, validatorsRoot } from './store.js';

export type DfBytesRow = {
  filesystem: string;
  fstype: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usePct: number;
  mount: string;
};

/** Parse `df -B1 -T` (1-byte blocks). Exported for tests. */
export function parseDfBytes(stdout: string): DfBytesRow[] {
  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const rows: DfBytesRow[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const fstype = parts[1] ?? '';
    if (fstype === 'tmpfs' || fstype === 'devtmpfs' || fstype === 'squashfs' || fstype === 'overlay') {
      continue;
    }
    const mount = parts.slice(6).join(' ');
    const totalBytes = Number(parts[2]);
    const usedBytes = Number(parts[3]);
    const availBytes = Number(parts[4]);
    const usePct = Number(String(parts[5] ?? '').replace('%', ''));
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue;
    rows.push({
      filesystem: parts[0] ?? '',
      fstype,
      totalBytes,
      usedBytes: Number.isFinite(usedBytes) ? usedBytes : 0,
      availBytes: Number.isFinite(availBytes) ? availBytes : 0,
      usePct: Number.isFinite(usePct) ? usePct : 0,
      mount,
    });
  }
  return rows;
}

export function pickMountForPath(rows: DfBytesRow[], absPath: string): DfBytesRow | undefined {
  const path = absPath.endsWith('/') && absPath !== '/' ? absPath.slice(0, -1) : absPath;
  let best: DfBytesRow | undefined;
  for (const row of rows) {
    const m = row.mount === '/' ? '/' : row.mount.replace(/\/+$/, '');
    if (path === m || path.startsWith(`${m}/`) || m === '/') {
      if (!best || row.mount.length > best.mount.length) best = row;
    }
  }
  return best;
}

export function parseDuBytes(stdout: string): number {
  const first = stdout.trim().split(/\s+/)[0];
  const n = Number(first);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function collectValidatorDisk(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<ValidatorDiskReport> {
  const rootPath = validatorsRoot(input.dataDir);
  const notes: string[] = [];
  let rows: DfBytesRow[] = [];
  try {
    const df = await input.host.runCommand(['df', '-B1', '-T', '-x', 'tmpfs', '-x', 'devtmpfs'], {
      timeoutMs: 8_000,
    });
    if (df.exitCode === 0) rows = parseDfBytes(df.stdout);
    else notes.push('df failed; disk totals unavailable');
  } catch {
    notes.push('df unavailable; disk totals missing');
  }

  const mount = pickMountForPath(rows, rootPath);
  const instancesMeta = listValidatorInstances(input.dataDir);
  const instances: ValidatorDiskInstance[] = [];
  for (const inst of instancesMeta) {
    const dataPath = inst.dataPath;
    let usedBytes = 0;
    if (existsSync(dataPath)) {
      try {
        const du = await input.host.runCommand(['du', '-sb', dataPath], { timeoutMs: 15_000 });
        if (du.exitCode === 0) usedBytes = parseDuBytes(du.stdout);
        else notes.push(`du failed for ${inst.id}`);
      } catch {
        notes.push(`du unavailable for ${inst.id}`);
      }
    }
    instances.push({ id: inst.id, dataPath, usedBytes });
  }

  const usePct = mount ? mount.usePct : null;
  return {
    rootPath,
    totalBytes: mount?.totalBytes ?? null,
    usedBytes: mount?.usedBytes ?? null,
    availBytes: mount?.availBytes ?? null,
    usePct,
    tone: validatorDiskTone(usePct),
    instances,
    notes,
  };
}
