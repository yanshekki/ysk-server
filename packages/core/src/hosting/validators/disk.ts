/**
 * Disk usage for the validators data root + per-instance dirs.
 * Read-only host commands (df / du) — no EXECUTE required.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  tl,
  validatorDiskTone,
  type ValidatorDiskInstance,
  type ValidatorDiskLeftover,
  type ValidatorDiskReport,
} from 'ysk-server-shared';
import {
  appliedValidatorOp,
  blockedValidatorOp,
  type ValidatorOpsResult,
} from './honesty.js';
import type { HostExecutor } from '../../host/executor.js';
import { listValidatorInstances, validatorsRoot } from './store.js';

const RESERVED_ROOT_NAMES = new Set([
  'instances.json',
  'upgrade-offers.json',
  'remote-tags.json',
  'remote-releases.json',
  'settings.json',
]);

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

/** Parse `MemAvailable` kB from /proc/meminfo. */
export function parseMeminfoAvailableBytes(stdout: string): number | null {
  const m = /MemAvailable:\s+(\d+)/i.exec(stdout);
  if (!m) return null;
  const kb = Number(m[1]);
  if (!Number.isFinite(kb) || kb <= 0) return null;
  return kb * 1024;
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
  const instanceIds = new Set(instancesMeta.map((i) => i.id));
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

  let rootUsed = 0;
  if (existsSync(rootPath)) {
    try {
      const du = await input.host.runCommand(['du', '-sb', rootPath], { timeoutMs: 20_000 });
      if (du.exitCode === 0) rootUsed = parseDuBytes(du.stdout);
      else notes.push('du failed for validators root');
    } catch {
      notes.push('du unavailable for validators root');
    }
  }

  const leftovers: ValidatorDiskLeftover[] = [];
  if (existsSync(rootPath)) {
    try {
      for (const name of readdirSync(rootPath)) {
        if (RESERVED_ROOT_NAMES.has(name) || instanceIds.has(name)) continue;
        const abs = join(rootPath, name);
        try {
          if (!statSync(abs).isDirectory()) continue;
        } catch {
          continue;
        }
        let usedBytes = 0;
        try {
          const du = await input.host.runCommand(['du', '-sb', abs], { timeoutMs: 15_000 });
          if (du.exitCode === 0) usedBytes = parseDuBytes(du.stdout);
        } catch {
          /* size unknown */
        }
        leftovers.push({ name, path: abs, usedBytes });
      }
    } catch {
      notes.push('could not list leftover validator dirs');
    }
  }

  let memAvailableBytes: number | null = null;
  try {
    const mem = await input.host.runCommand(['cat', '/proc/meminfo'], { timeoutMs: 3_000 });
    if (mem.exitCode === 0) memAvailableBytes = parseMeminfoAvailableBytes(mem.stdout);
    else notes.push('meminfo failed; RAM totals unavailable');
  } catch {
    notes.push('meminfo unavailable; RAM totals missing');
  }

  const usePct = mount ? mount.usePct : null;
  return {
    rootPath,
    usedBytes: existsSync(rootPath) ? rootUsed : 0,
    leftoverBytes: leftovers.reduce((s, x) => s + x.usedBytes, 0),
    leftovers,
    fsUsedBytes: mount?.usedBytes ?? null,
    fsAvailBytes: mount?.availBytes ?? null,
    fsTotalBytes: mount?.totalBytes ?? null,
    fsUsePct: usePct,
    availBytes: mount?.availBytes ?? null,
    memAvailableBytes,
    totalBytes: mount?.totalBytes ?? null,
    usePct,
    tone: validatorDiskTone(usePct),
    instances,
    notes,
  };
}

export function isSafeValidatorLeftoverPath(dataDir: string, abs: string): boolean {
  const root = resolve(validatorsRoot(dataDir));
  const resolved = resolve(String(abs || ''));
  if (resolved === root || !resolved.startsWith(`${root}/`)) return false;
  const name = resolved.slice(root.length + 1);
  if (!name || name.includes('/') || name.includes('..')) return false;
  if (RESERVED_ROOT_NAMES.has(name)) return false;
  if (listValidatorInstances(dataDir).some((i) => i.id === name)) return false;
  return true;
}

export function removeValidatorLeftover(input: {
  dataDir: string;
  host: HostExecutor;
  path: string;
  confirm: string;
  execute: boolean;
}): ValidatorOpsResult {
  const name = basename(String(input.path || ''));
  if (!isSafeValidatorLeftoverPath(input.dataDir, input.path) || input.confirm !== name) {
    return blockedValidatorOp({
      reason: 'validation',
      notes: [tl('validators.errors.needConfirm')],
    });
  }
  if (!input.execute || !input.host.executeEnabled() || !input.host.isRoot()) {
    const reason =
      !input.host.executeEnabled() ? 'no_execute' : !input.host.isRoot() ? 'no_root' : 'validation';
    return blockedValidatorOp({
      reason,
      notes: [tl('validators.notes.dryDelete')],
    });
  }
  const abs = resolve(input.path);
  try {
    rmSync(abs, { recursive: true, force: true });
  } catch (e) {
    return blockedValidatorOp({
      reason: 'validation',
      notes: [e instanceof Error ? e.message : 'rm failed'],
    });
  }
  return appliedValidatorOp({
    written: [abs],
    notes: [tl('validators.notes.leftoverRemoved', { path: abs })],
  });
}
