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
}
