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

  count(): number {
    return this.db.snapshot.users.length;
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
