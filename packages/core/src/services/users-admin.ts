/**
 * Admin user + package management (panel multi-user foundation).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { SystemRole, UserDto } from '@ysk-server/shared';
import { ErrorCodes, YskError, tl} from '@ysk-server/shared';
import type { UserRepository } from '../repositories/user-repo.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { SessionRepository } from '../repositories/session-repo.js';
import type { YskDatabase } from '../db/database.js';
import type { StorePackage } from '../db/store.js';
import { hashPassword } from './auth.js';

export class UsersAdminService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly db: YskDatabase,
    private readonly audit?: AuditRepository,
  ) {}

  listUsers(): Array<UserDto & { packageId?: string; suspended?: boolean }> {
    return this.users.list().map((u) => ({
      id: u.id,
      username: u.username,
      roles: [...u.roles],
      locale: u.locale,
      totpEnabled: Boolean(u.totp_enabled),
      mustChangePassword: Boolean(u.must_change_password) || undefined,
      packageId: u.package_id,
      suspended: Boolean(u.suspended) }));
  }

  createUser(input: {
    username: string;
    password: string;
    roles?: SystemRole[];
    packageId?: string;
    locale?: string;
    actor: string;
  }): UserDto {
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1248'), {
        httpStatus: 400 });
    }
    if (input.password.length < 8) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.passwordMin8'), { httpStatus: 400 });
    }
    if (this.users.findByUsername(username)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0501', { v0: (username) }), { httpStatus: 409 });
    }
    const roles = (input.roles?.length ? input.roles : ['operator']) as SystemRole[];
    if (roles.includes('admin') === false && roles.length === 0) {
      roles.push('operator');
    }
    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      username,
      password_hash: hashPassword(input.password, salt),
      password_salt: salt,
      roles,
      locale: input.locale ?? 'zh-HK',
      package_id: input.packageId,
      suspended: false,
      created_at: now,
      updated_at: now };
    this.users.insert(user);
    this.audit?.append({
      actor: input.actor,
      action: 'users.create',
      resource: username,
      detail: { roles, packageId: input.packageId },
      ok: true });
    return {
      id: user.id,
      username,
      roles: [...roles],
      locale: user.locale,
      totpEnabled: false };
  }

  updateUser(
    id: string,
    patch: {
      roles?: SystemRole[];
      packageId?: string | null;
      suspended?: boolean;
      password?: string;
    },
    actor: string,
  ): UserDto {
    const existing = this.users.findById(id);
    if (!existing) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0002'), { httpStatus: 404 });
    }
    const upd: Parameters<UserRepository['update']>[1] = {};
    if (patch.roles) upd.roles = patch.roles;
    if (patch.packageId === null) upd.package_id = undefined;
    else if (patch.packageId !== undefined) upd.package_id = patch.packageId;
    if (patch.suspended !== undefined) upd.suspended = patch.suspended;
    if (patch.password) {
      if (patch.password.length < 8) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.passwordMin8'), { httpStatus: 400 });
      }
      const salt = randomBytes(16).toString('hex');
      upd.password_salt = salt;
      upd.password_hash = hashPassword(patch.password, salt);
      upd.must_change_password = false;
    }
    const u = this.users.update(id, upd);
    if (!u) throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0002'), { httpStatus: 404 });
    this.audit?.append({
      actor,
      action: 'users.update',
      resource: id,
      detail: { ...patch, password: patch.password ? '***' : undefined },
      ok: true });
    return {
      id: u.id,
      username: u.username,
      roles: [...u.roles],
      locale: u.locale,
      totpEnabled: Boolean(u.totp_enabled) };
  }

  deleteUser(id: string, actor: string): boolean {
    const u = this.users.findById(id);
    if (!u) return false;
    if (u.roles.includes('admin') && this.users.list().filter((x) => x.roles.includes('admin')).length <= 1) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0500'), { httpStatus: 400 });
    }
    const ok = this.users.delete(id);
    this.audit?.append({
      actor,
      action: 'users.delete',
      resource: id,
      detail: { username: u.username },
      ok });
    return ok;
  }

  /**
   * Impersonate: issue a short-lived session for target user.
   * Authorization is enforced at the route layer via `users.impersonate` capability
   * (factory default: admin only). This method assumes the caller is authorized.
   */
  impersonate(
    targetUserId: string,
    actor: { id: string; username: string; roles: SystemRole[] },
  ): { token: string; user: UserDto; expiresAt: string } {
    const target = this.users.findById(targetUserId);
    if (!target) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0002'), { httpStatus: 404 });
    }
    if (target.suspended) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1277'), { httpStatus: 400 });
    }
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    this.sessions.insert({
      token,
      user_id: target.id,
      expires_at: expiresAt,
      created_at: new Date().toISOString() });
    this.audit?.append({
      actor: actor.username,
      action: 'users.impersonate',
      resource: target.username,
      detail: { targetId: target.id },
      ok: true });
    return {
      token,
      expiresAt,
      user: {
        id: target.id,
        username: target.username,
        roles: [...target.roles],
        locale: target.locale,
        totpEnabled: Boolean(target.totp_enabled) } };
  }

  listPackages(): StorePackage[] {
    return (this.db.snapshot.packages ?? []).map((p) => ({ ...p }));
  }

  createPackage(
    input: {
      name: string;
      maxProjects?: number;
      maxMailboxes?: number;
      maxDatabases?: number;
      diskMb?: number;
      bandwidthMb?: number;
      allowSsh?: boolean;
      allowFtp?: boolean;
      notes?: string;
    },
    actor: string,
  ): StorePackage {
    const name = input.name.trim();
    if (!name) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1395'), { httpStatus: 400 });
    }
    const now = new Date().toISOString();
    const row: StorePackage = {
      id: randomUUID(),
      name,
      max_projects: input.maxProjects ?? 10,
      max_mailboxes: input.maxMailboxes ?? 50,
      max_databases: input.maxDatabases ?? 20,
      disk_mb: input.diskMb ?? 10240,
      bandwidth_mb: input.bandwidthMb ?? 0,
      allow_ssh: input.allowSsh ?? false,
      allow_ftp: input.allowFtp ?? true,
      notes: input.notes,
      created_at: now,
      updated_at: now };
    if (!this.db.snapshot.packages) this.db.snapshot.packages = [];
    this.db.snapshot.packages.unshift(row);
    this.db.persist();
    this.audit?.append({
      actor,
      action: 'packages.create',
      resource: row.id,
      detail: { name },
      ok: true });
    return { ...row };
  }

  updatePackage(
    id: string,
    patch: Partial<
      Pick<
        StorePackage,
        | 'name'
        | 'max_projects'
        | 'max_mailboxes'
        | 'max_databases'
        | 'disk_mb'
        | 'bandwidth_mb'
        | 'allow_ssh'
        | 'allow_ftp'
        | 'notes'
      >
    >,
    actor: string,
  ): StorePackage {
    const p = (this.db.snapshot.packages ?? []).find((x) => x.id === id);
    if (!p) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0863'), { httpStatus: 404 });
    }
    Object.assign(p, patch, { updated_at: new Date().toISOString() });
    this.db.persist();
    this.audit?.append({
      actor,
      action: 'packages.update',
      resource: id,
      detail: patch,
      ok: true });
    return { ...p };
  }

  deletePackage(id: string, actor: string): boolean {
    const subscribers = this.users.list().filter((u) => u.package_id === id).length;
    if (subscribers > 0) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1395'), {
        httpStatus: 400,
        details: { reason: 'package_has_subscribers', subscribers },
      });
    }
    const before = (this.db.snapshot.packages ?? []).length;
    this.db.snapshot.packages = (this.db.snapshot.packages ?? []).filter((p) => p.id !== id);
    this.db.persist();
    const ok = (this.db.snapshot.packages ?? []).length < before;
    this.audit?.append({
      actor,
      action: 'packages.delete',
      resource: id,
      detail: { ok },
      ok });
    return ok;
  }
}
