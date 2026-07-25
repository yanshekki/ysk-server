import type { YskDatabase } from '../db/database.js';
import type { StoreSession } from '../db/store.js';

export type SessionRow = StoreSession;

export class SessionRepository {
  constructor(private readonly db: YskDatabase) {}

  insert(session: SessionRow): void {
    this.db.snapshot.sessions.push({ ...session });
    this.db.persist();
  }

  find(token: string): SessionRow | undefined {
    return this.db.snapshot.sessions.find((s) => s.token === token);
  }

  delete(token: string): void {
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => s.token !== token);
    this.db.persist();
  }

  deleteExpired(nowIso: string): void {
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => s.expires_at >= nowIso);
    this.db.persist();
  }
}
