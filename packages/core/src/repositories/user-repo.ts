import type { SystemRole } from 'ysk-server-shared';
import type { YskDatabase } from '../db/database.js';
import type { StoreUser } from '../db/store.js';

export type UserRow = StoreUser;

export class UserRepository {
  constructor(private readonly db: YskDatabase) {}

  findByUsername(username: string): UserRow | undefined {
    return this.db.snapshot.users.find((u) => u.username === username);
  }

  findById(id: string): UserRow | undefined {
    return this.db.snapshot.users.find((u) => u.id === id);
  }

  insert(user: UserRow): void {
    this.db.snapshot.users.push({
      ...user,
      roles: [...user.roles] as SystemRole[],
    });
    this.db.persist();
  }

  list(): UserRow[] {
    return this.db.snapshot.users.map((u) => ({ ...u }));
  }

  count(): number {
    return this.db.snapshot.users.length;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        UserRow,
        | 'username'
        | 'roles'
        | 'locale'
        | 'package_id'
        | 'suspended'
        | 'password_hash'
        | 'password_salt'
        | 'must_change_password'
        | 'capability_grants'
        | 'capability_revokes'
      >
    >,
  ): UserRow | undefined {
    const u = this.db.snapshot.users.find((x) => x.id === id);
    if (!u) return undefined;
    if (patch.username !== undefined) u.username = patch.username;
    if (patch.roles !== undefined) u.roles = [...patch.roles] as SystemRole[];
    if (patch.locale !== undefined) u.locale = patch.locale;
    if ('package_id' in patch) u.package_id = patch.package_id;
    if (patch.suspended !== undefined) u.suspended = patch.suspended;
    if (patch.password_hash !== undefined) u.password_hash = patch.password_hash;
    if (patch.password_salt !== undefined) u.password_salt = patch.password_salt;
    if (patch.must_change_password !== undefined) {
      if (patch.must_change_password) u.must_change_password = true;
      else delete u.must_change_password;
    }
    if ('capability_grants' in patch) {
      if (!patch.capability_grants?.length) {
        delete u.capability_grants;
      } else {
        u.capability_grants = [...patch.capability_grants];
      }
    }
    if ('capability_revokes' in patch) {
      if (!patch.capability_revokes?.length) {
        delete u.capability_revokes;
      } else {
        u.capability_revokes = [...patch.capability_revokes];
      }
    }
    u.updated_at = new Date().toISOString();
    this.db.persist();
    return { ...u };
  }

  delete(id: string): boolean {
    const before = this.db.snapshot.users.length;
    this.db.snapshot.users = this.db.snapshot.users.filter((u) => u.id !== id);
    this.db.persist();
    return this.db.snapshot.users.length < before;
  }

  updateTotp(
    id: string,
    patch: {
      totp_secret?: string | null;
      totp_enabled?: boolean;
      totp_last_step?: number | null;
      totp_recovery_hashes?: string[] | null;
    },
  ): UserRow | undefined {
    const u = this.db.snapshot.users.find((x) => x.id === id);
    if (!u) return undefined;
    if (patch.totp_secret === null) {
      delete u.totp_secret;
    } else if (patch.totp_secret !== undefined) {
      u.totp_secret = patch.totp_secret;
    }
    if (patch.totp_enabled !== undefined) u.totp_enabled = patch.totp_enabled;
    if (patch.totp_last_step === null) {
      delete u.totp_last_step;
    } else if (patch.totp_last_step !== undefined) {
      u.totp_last_step = patch.totp_last_step;
    }
    if (patch.totp_recovery_hashes === null) {
      delete u.totp_recovery_hashes;
    } else if (patch.totp_recovery_hashes !== undefined) {
      u.totp_recovery_hashes = [...patch.totp_recovery_hashes];
    }
    u.updated_at = new Date().toISOString();
    this.db.persist();
    return { ...u };
  }
}
