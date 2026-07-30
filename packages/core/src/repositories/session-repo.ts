import type { YskDatabase } from '../db/database.js';
import type { StoreSession } from '../db/store.js';

export type SessionRow = StoreSession;

/** Public view — never return full token after create */
export type SessionPublic = {
  id: string;
  created_at: string;
  expires_at: string;
  last_seen_at?: string;
  user_agent?: string;
  ip?: string;
  current?: boolean;
};

export class SessionRepository {
  constructor(private readonly db: YskDatabase) {}

  insert(session: SessionRow): void {
    this.db.snapshot.sessions.push({ ...session });
    this.db.persist();
  }

  find(token: string): SessionRow | undefined {
    return this.db.snapshot.sessions.find((s) => s.token === token);
  }

  /** Prefix id for revoke without exposing full token */
  idOf(token: string): string {
    return token.slice(0, 12);
  }

  findByIdPrefix(userId: string, idPrefix: string): SessionRow | undefined {
    return this.db.snapshot.sessions.find(
      (s) => s.user_id === userId && s.token.startsWith(idPrefix),
    );
  }

  listByUser(userId: string): SessionRow[] {
    return this.db.snapshot.sessions
      .filter((s) => s.user_id === userId)
      .map((s) => ({ ...s }));
  }

  listPublic(userId: string, currentToken?: string): SessionPublic[] {
    return this.listByUser(userId).map((s) => ({
      id: this.idOf(s.token),
      created_at: s.created_at,
      expires_at: s.expires_at,
      last_seen_at: s.last_seen_at ?? s.created_at,
      user_agent: s.user_agent,
      ip: s.ip,
      current: currentToken ? s.token === currentToken : false,
    }));
  }

  touch(token: string, nowIso: string): void {
    const s = this.find(token);
    if (!s) return;
    s.last_seen_at = nowIso;
    this.db.persist();
  }

  delete(token: string): void {
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => s.token !== token);
    this.db.persist();
  }

  deleteByIdPrefix(userId: string, idPrefix: string): boolean {
    const before = this.db.snapshot.sessions.length;
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter(
      (s) => !(s.user_id === userId && s.token.startsWith(idPrefix)),
    );
    this.db.persist();
    return this.db.snapshot.sessions.length < before;
  }

  deleteOthers(userId: string, keepToken: string): number {
    const before = this.db.snapshot.sessions.length;
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter(
      (s) => s.user_id !== userId || s.token === keepToken,
    );
    this.db.persist();
    return before - this.db.snapshot.sessions.length;
  }

  deleteExpired(nowIso: string): void {
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => s.expires_at >= nowIso);
    this.db.persist();
  }
}
