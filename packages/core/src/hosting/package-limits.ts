/**
 * Enforce hosting package quotas (projects / mailboxes / databases counts).
 */

import type { YskDatabase } from '../db/database.js';
import { ErrorCodes, YskError, tl } from '@ysk/shared';

/** Host-level totals (honest: not per-user isolation). */
export function hostPackageUsage(db: YskDatabase): {
  scope: 'host';
  projects: number;
  mailboxes: number;
  databases: number;
} {
  return {
    scope: 'host',
    projects: db.snapshot.projects?.length ?? 0,
    mailboxes: (db.snapshot.mailboxes ?? []).length,
    databases:
      (db.snapshot.mysql_databases ?? []).length +
      (db.snapshot.postgres_databases ?? []).length,
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
  const count = db.snapshot.projects.length;
  // Admin panel is single-tenant style: package limits apply to total sites for package holders
  if (pkg.max_projects > 0 && count >= pkg.max_projects) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0302', { v0: (pkg.max_projects), v1: (pkg.name) }),
      { httpStatus: 403 },
    );
  }
}

export function assertCanCreateMailbox(db: YskDatabase, actorUserId?: string): void {
  if (!actorUserId) return;
  const pkg = getUserPackage(db, actorUserId);
  if (!pkg || pkg.max_mailboxes <= 0) return;
  const count = (db.snapshot.mailboxes ?? []).length;
  if (count >= pkg.max_mailboxes) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0303', { v0: (pkg.max_mailboxes), v1: (pkg.name) }),
      { httpStatus: 403 },
    );
  }
}

export function assertCanCreateDatabase(db: YskDatabase, actorUserId?: string): void {
  if (!actorUserId) return;
  const pkg = getUserPackage(db, actorUserId);
  if (!pkg || pkg.max_databases <= 0) return;
  const count =
    (db.snapshot.mysql_databases ?? []).length + (db.snapshot.postgres_databases ?? []).length;
  if (count >= pkg.max_databases) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      tl('notes.auto.t0304', { v0: (pkg.max_databases), v1: (pkg.name) }),
      { httpStatus: 403 },
    );
  }
}
