/**
 * Project disk quota: metadata + real du measurement.
 */

import { existsSync } from 'node:fs';
import type { HostExecutor } from '../host/executor.js';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface QuotaStatus {
  projectId: string;
  homeDir: string;
  quotaMb: number | null;
  usedBytes: number;
  usedMb: number;
  withinQuota: boolean | null;
  notes: string[];
}

/**
 * Measure directory size via `du -sb` (fallback 0 if unavailable).
 */
export async function measureDirBytes(
  host: HostExecutor,
  dir: string,
): Promise<{ bytes: number; notes: string[] }> {
  if (!existsSync(dir)) {
    return { bytes: 0, notes: [`missing ${dir}`] };
  }
  const r = await host.runCommand(['du', '-sb', dir], { timeoutMs: 60_000 });
  if (r.exitCode !== 0) {
    // busybox / mac-like fallback
    const r2 = await host.runCommand(['bash', '-c', `du -sk "${dir}" | cut -f1`], {
      timeoutMs: 60_000,
    });
    const kb = Number(r2.stdout.trim());
    if (Number.isFinite(kb)) {
      return { bytes: kb * 1024, notes: ['used du -sk fallback'] };
    }
    return { bytes: 0, notes: [`du failed: ${r.stderr}`] };
  }
  const bytes = Number(r.stdout.trim().split(/\s+/)[0]);
  return {
    bytes: Number.isFinite(bytes) ? bytes : 0,
    notes: [],
  };
}

export async function checkProjectQuota(input: {
  host: HostExecutor;
  projectId: string;
  homeDir: string;
  quotaMb?: number | null;
}): Promise<QuotaStatus> {
  const { bytes, notes } = await measureDirBytes(input.host, input.homeDir);
  const usedMb = Math.round((bytes / (1024 * 1024)) * 100) / 100;
  const quotaMb = input.quotaMb ?? null;
  let withinQuota: boolean | null = null;
  if (quotaMb != null && quotaMb > 0) {
    withinQuota = usedMb <= quotaMb;
    if (!withinQuota) notes.push(`超出配額：${usedMb}MB > ${quotaMb}MB`);
  }
  return {
    projectId: input.projectId,
    homeDir: input.homeDir,
    quotaMb,
    usedBytes: bytes,
    usedMb,
    withinQuota,
    notes,
  };
}

export function assertQuotaMb(quotaMb: number): void {
  if (!Number.isFinite(quotaMb) || quotaMb < 1 || quotaMb > 1_000_000) {
    throw new YskError(ErrorCodes.VALIDATION, '配額須為 1–1000000 MiB', { httpStatus: 400 });
  }
}

/** Throw if project is over soft disk quota (hard enforce before deploy/write). */
export async function assertWithinQuota(input: {
  host: HostExecutor;
  projectId: string;
  homeDir: string;
  quotaMb?: number | null;
  action?: string;
}): Promise<void> {
  if (input.quotaMb == null || input.quotaMb <= 0) return;
  const st = await checkProjectQuota({
    host: input.host,
    projectId: input.projectId,
    homeDir: input.homeDir,
    quotaMb: input.quotaMb,
  });
  if (st.withinQuota === false) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `磁碟配額已超限（${st.usedMb} / ${st.quotaMb} MiB），無法${input.action ?? '繼續操作'}`,
      { httpStatus: 403 },
    );
  }
}
