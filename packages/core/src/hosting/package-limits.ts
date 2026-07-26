/**
 * Enforce hosting package quotas (projects / mailboxes / databases counts).
 */

import type { YskDatabase } from '../db/database.js';
import { ErrorCodes, YskError } from '@ysk/shared';

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
      `已達方案專案上限 ${pkg.max_projects}（package: ${pkg.name}）`,
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
      `已達方案信箱上限 ${pkg.max_mailboxes}（package: ${pkg.name}）`,
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
      `已達方案資料庫上限 ${pkg.max_databases}（package: ${pkg.name}）`,
      { httpStatus: 403 },
    );
  }
}
