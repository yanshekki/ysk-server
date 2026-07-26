import type { SystemRole } from '@ysk/shared';
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
        'username' | 'roles' | 'locale' | 'package_id' | 'suspended' | 'password_hash' | 'password_salt'
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
    patch: { totp_secret?: string | null; totp_enabled?: boolean },
  ): UserRow | undefined {
    const u = this.db.snapshot.users.find((x) => x.id === id);
    if (!u) return undefined;
    if (patch.totp_secret === null) {
      delete u.totp_secret;
    } else if (patch.totp_secret !== undefined) {
      u.totp_secret = patch.totp_secret;
    }
    if (patch.totp_enabled !== undefined) u.totp_enabled = patch.totp_enabled;
    u.updated_at = new Date().toISOString();
    this.db.persist();
    return { ...u };
  }
}
