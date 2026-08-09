import { createHash, timingSafeEqual } from 'node:crypto';
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

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function publicIdFromPlain(token: string): string {
  return token.slice(0, 12);
}

function publicIdOf(s: StoreSession): string {
  if (s.token_prefix) return s.token_prefix;
  if (s.token) return s.token.slice(0, 12);
  if (s.token_hash) return s.token_hash.slice(0, 12);
  return 'unknown';
}

function hashEquals(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export class SessionRepository {
  constructor(private readonly db: YskDatabase) {}

  /**
   * Insert session. Prefer storing only hash + prefix (plaintext never persisted).
   * Callers pass the plaintext token once; we hash it.
   */
  insert(session: SessionRow & { token: string }): void {
    const plain = session.token;
    const token_hash = session.token_hash ?? hashSessionToken(plain);
    const token_prefix = session.token_prefix ?? publicIdFromPlain(plain);
    const row: StoreSession = {
      user_id: session.user_id,
      expires_at: session.expires_at,
      created_at: session.created_at,
      last_seen_at: session.last_seen_at,
      user_agent: session.user_agent,
      ip: session.ip,
      label: session.label,
      token_hash,
      token_prefix,
      // Do not persist plaintext token
    };
    this.db.snapshot.sessions.push(row);
    this.db.persist();
  }

  find(token: string): SessionRow | undefined {
    if (!token) return undefined;
    const h = hashSessionToken(token);
    for (const s of this.db.snapshot.sessions) {
      if (s.token_hash && hashEquals(s.token_hash, h)) {
        return { ...s };
      }
      // Legacy plaintext sessions: match then migrate to hash
      if (s.token && s.token === token) {
        s.token_hash = h;
        s.token_prefix = publicIdFromPlain(token);
        delete (s as { token?: string }).token;
        this.db.persist();
        return { ...s };
      }
    }
    return undefined;
  }

  /** Prefix id for revoke without exposing full token */
  idOf(token: string): string {
    return publicIdFromPlain(token);
  }

  findByIdPrefix(userId: string, idPrefix: string): SessionRow | undefined {
    return this.db.snapshot.sessions.find(
      (s) => s.user_id === userId && publicIdOf(s).startsWith(idPrefix),
    );
  }

  listByUser(userId: string): SessionRow[] {
    return this.db.snapshot.sessions
      .filter((s) => s.user_id === userId)
      .map((s) => ({ ...s }));
  }

  listPublic(userId: string, currentToken?: string): SessionPublic[] {
    const currentHash = currentToken ? hashSessionToken(currentToken) : undefined;
    return this.listByUser(userId).map((s) => ({
      id: publicIdOf(s),
      created_at: s.created_at,
      expires_at: s.expires_at,
      last_seen_at: s.last_seen_at ?? s.created_at,
      user_agent: s.user_agent,
      ip: s.ip,
      current: currentHash
        ? Boolean(s.token_hash && hashEquals(s.token_hash, currentHash))
        : false,
    }));
  }

  touch(token: string, nowIso: string): void {
    const h = hashSessionToken(token);
    const s = this.db.snapshot.sessions.find(
      (row) =>
        (row.token_hash && hashEquals(row.token_hash, h)) ||
        (row.token && row.token === token),
    );
    if (!s) return;
    s.last_seen_at = nowIso;
    this.db.persist();
  }

  delete(token: string): void {
    const h = hashSessionToken(token);
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter(
      (s) =>
        !(s.token_hash && hashEquals(s.token_hash, h)) &&
        !(s.token && s.token === token),
    );
    this.db.persist();
  }

  deleteByIdPrefix(userId: string, idPrefix: string): boolean {
    const before = this.db.snapshot.sessions.length;
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter(
      (s) => !(s.user_id === userId && publicIdOf(s).startsWith(idPrefix)),
    );
    this.db.persist();
    return this.db.snapshot.sessions.length < before;
  }

  deleteOthers(userId: string, keepToken: string): number {
    const keepHash = hashSessionToken(keepToken);
    const before = this.db.snapshot.sessions.length;
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => {
      if (s.user_id !== userId) return true;
      if (s.token_hash && hashEquals(s.token_hash, keepHash)) return true;
      if (s.token && s.token === keepToken) return true;
      return false;
    });
    this.db.persist();
    return before - this.db.snapshot.sessions.length;
  }

  deleteExpired(nowIso: string): void {
    this.db.snapshot.sessions = this.db.snapshot.sessions.filter((s) => s.expires_at >= nowIso);
    this.db.persist();
  }
}
