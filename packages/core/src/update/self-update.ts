/**
 * Self-update: check, verify, migrate, rollback, audit.
 */

import type { SelfUpdateStatus } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface VersionInfo {
  current: string;
  latest: string;
  releaseNotes?: string;
  checksumSha256?: string;
}

export interface SelfUpdatePlan {
  status: SelfUpdateStatus;
  steps: string[];
  migrate: string[];
  rollback: string[];
  auditLog: Array<{ step: string; detail: string }>;
}

/**
 * Compare semver-ish versions: returns 1 if a>b, -1 if a<b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/**
 * Build self-update status and ordered plan.
 */
export function planSelfUpdate(info: VersionInfo, now = new Date()): SelfUpdatePlan {
  if (!info.current || !info.latest) {
    throw new YskError(ErrorCodes.VALIDATION, '需要目前版本與最新版本', {
      httpStatus: 400,
    });
  }
  const updateAvailable = compareVersions(info.latest, info.current) > 0;
  const status: SelfUpdateStatus = {
    currentVersion: info.current,
    latestVersion: info.latest,
    updateAvailable,
    lastCheckAt: now.toISOString(),
  };
  if (!updateAvailable) {
    return {
      status,
      steps: ['check', 'noop'],
      migrate: [],
      rollback: [],
      auditLog: [{ step: 'check', detail: 'Already up to date' }],
    };
  }
  const steps = [
    'check',
    'download',
    'verify-checksum',
    'backup-current',
    'replace-files',
    'run-migrations',
    'health-verify',
    'audit',
  ];
  const migrate = [
    `ysk-server migrate --from ${info.current} --to ${info.latest}`,
    'ysk-server healthcheck',
  ];
  const rollback = [
    'restore backup from dataDir/backups/self-update',
    `ysk-server migrate --from ${info.latest} --to ${info.current} --rollback`,
    'ysk-server healthcheck',
  ];
  return {
    status,
    steps,
    migrate,
    rollback,
    auditLog: [
      { step: 'check', detail: `Update available ${info.current} -> ${info.latest}` },
      {
        step: 'verify',
        detail: info.checksumSha256
          ? `Expect sha256 ${info.checksumSha256}`
          : 'Checksum not provided — verify via npm integrity',
      },
    ],
  };
}

/**
 * Verify a hex sha256 digest format (not the download itself).
 */
export function isValidSha256(hex: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hex);
}
