/**
 * Enforce hosting package quotas — **per-user** counts when resources are owned.
 * Host-wide totals remain for honesty / ops dashboards.
 */

import type { YskDatabase } from '../db/database.js';
import { ErrorCodes, YskError, tl } from '@yanshekki/shared';

export type PackageUsage = {
  scope: 'user' | 'host';
  userId?: string;
  projects: number;
  mailboxes: number;
  databases: number;
  /** Soft: sum of owned projects' quota_mb (0 = unlimited/unset) */
  diskQuotaAssignedMb: number;
};

/** Host-level totals (ops honesty — not isolation). */
export function hostPackageUsage(db: YskDatabase): PackageUsage {
  return {
    scope: 'host',
    projects: db.snapshot.projects?.length ?? 0,
    mailboxes: (db.snapshot.mailboxes ?? []).length,
    databases:
      (db.snapshot.mysql_databases ?? []).length +
      (db.snapshot.postgres_databases ?? []).length,
    diskQuotaAssignedMb: sumProjectQuotaMb(db.snapshot.projects ?? []),
  };
}

function ownerOf(row: Record<string, unknown> | undefined): string | undefined {
  if (!row) return undefined;
  const id =
    row.owner_user_id ??
    row.ownerUserId ??
    row.user_id ??
    row.userId ??
    row.created_by_user_id;
  return id != null && String(id) ? String(id) : undefined;
}

function sumProjectQuotaMb(
  projects: Array<{ quota_mb?: number; owner_user_id?: string }>,
  userId?: string,
): number {
  let n = 0;
  for (const p of projects) {
    if (userId && p.owner_user_id !== userId) continue;
    if (p.quota_mb != null && p.quota_mb > 0) n += p.quota_mb;
  }
  return n;
}

/**
 * Count resources owned by a panel user.
 * Unowned legacy rows do **not** count against the user (migrate by setting owner_user_id).
 */
export function userPackageUsage(db: YskDatabase, userId: string): PackageUsage {
  const projects = (db.snapshot.projects ?? []).filter(
    (p) => (p as { owner_user_id?: string }).owner_user_id === userId,
  );
  const mailboxes = (db.snapshot.mailboxes ?? []).filter(
    (m) => ownerOf(m as Record<string, unknown>) === userId,
  );
  const mysql = (db.snapshot.mysql_databases ?? []).filter(
    (d) => ownerOf(d as Record<string, unknown>) === userId,
  );
  const pg = (db.snapshot.postgres_databases ?? []).filter(
    (d) => ownerOf(d as Record<string, unknown>) === userId,
  );
  return {
    scope: 'user',
    userId,
    projects: projects.length,
    mailboxes: mailboxes.length,
    databases: mysql.length + pg.length,
    diskQuotaAssignedMb: sumProjectQuotaMb(
      db.snapshot.projects as Array<{ quota_mb?: number; owner_user_id?: string }>,
      userId,
    ),
  };
}

export function getUserPackage(db: YskDatabase, userId: string) {
  const u = db.snapshot.users.find((x) => x.id === userId);
  if (!u?.package_id) return null;
  return (db.snapshot.packages ?? []).find((p) => p.id === u.package_id) ?? null;
}

export function assertCanCreateProject(db: YskDatabase, actorUserId?: string): void {
  if (!actorUserId) return;
  const pkg = getUserPackage(db, actorUserId);
  if (!pkg) return;
  const usage = userPackageUsage(db, actorUserId);
  if (pkg.max_projects > 0 && usage.projects >= pkg.max_projects) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0302', { v0: pkg.max_projects, v1: pkg.name }),
      { httpStatus: 403, details: { scope: 'user', usage, packageId: pkg.id } },
    );
  }
  // Soft disk: assigned project quotas must not exceed package disk_mb
  if (pkg.disk_mb > 0 && usage.diskQuotaAssignedMb > pkg.disk_mb) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      `Package disk quota exceeded (${usage.diskQuotaAssignedMb} / ${pkg.disk_mb} MiB assigned)`,
      { httpStatus: 403, details: { scope: 'user', usage, packageId: pkg.id } },
    );
  }
}

export function assertCanCreateMailbox(db: YskDatabase, actorUserId?: string): void {
  if (!actorUserId) return;
  const pkg = getUserPackage(db, actorUserId);
  if (!pkg || pkg.max_mailboxes <= 0) return;
  const usage = userPackageUsage(db, actorUserId);
  if (usage.mailboxes >= pkg.max_mailboxes) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0303', { v0: pkg.max_mailboxes, v1: pkg.name }),
      { httpStatus: 403, details: { scope: 'user', usage, packageId: pkg.id } },
    );
  }
}

export function assertCanCreateDatabase(db: YskDatabase, actorUserId?: string): void {
  if (!actorUserId) return;
  const pkg = getUserPackage(db, actorUserId);
  if (!pkg || pkg.max_databases <= 0) return;
  const usage = userPackageUsage(db, actorUserId);
  if (usage.databases >= pkg.max_databases) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0304', { v0: pkg.max_databases, v1: pkg.name }),
      { httpStatus: 403, details: { scope: 'user', usage, packageId: pkg.id } },
    );
  }
}

/**
 * Assign owner_user_id on projects missing ownership (B3 / package quota).
 * Does not change linux users or homes.
 */
export function backfillProjectOwners(
  db: YskDatabase,
  ownerUserId: string,
  opts?: { onlyUnowned?: boolean; projectIds?: string[] },
): { updated: number; skipped: number; ownerUserId: string } {
  const onlyUnowned = opts?.onlyUnowned !== false;
  const filter = opts?.projectIds ? new Set(opts.projectIds) : null;
  let updated = 0;
  let skipped = 0;
  const user = db.snapshot.users.find((u) => u.id === ownerUserId);
  if (!user) {
    throw new YskError(ErrorCodes.NOT_FOUND, `user ${ownerUserId} not found`, {
      httpStatus: 404,
    });
  }
  for (const p of db.snapshot.projects ?? []) {
    if (filter && !filter.has(p.id)) continue;
    const hasOwner = Boolean((p as { owner_user_id?: string }).owner_user_id);
    if (onlyUnowned && hasOwner) {
      skipped++;
      continue;
    }
    (p as { owner_user_id?: string }).owner_user_id = ownerUserId;
    p.updated_at = new Date().toISOString();
    updated++;
  }
  if (updated) db.persist();
  return { updated, skipped, ownerUserId };
}
