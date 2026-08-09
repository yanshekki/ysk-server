/**
 * In-memory host-browse sessions (per process).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  HostBrowseHistoryEntry,
  HostBrowseMode,
  HostBrowsePolicy,
  HostBrowseSessionMeta,
} from './types.js';
import { HOST_BROWSE_DEFAULT_UA } from './types.js';
import { CookieJar } from './cookie-jar.js';

export type HostBrowseSession = {
  sessionId: string;
  userId: string;
  mode: HostBrowseMode;
  contentToken: string;
  userAgent: string;
  createdAt: number;
  lastAccessAt: number;
  jar: CookieJar;
  history: HostBrowseHistoryEntry[];
  historyIndex: number;
  currentUrl: string | null;
  /** Cached last content body for reload of same URL without re-nav (optional). */
  lastContent?: {
    url: string;
    status: number;
    contentType: string;
    body: Buffer;
    rewritten: boolean;
    warnings: string[];
  };
};

function newId(): string {
  return randomBytes(24).toString('base64url');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export class HostBrowseSessionStore {
  private sessions = new Map<string, HostBrowseSession>();
  private rate = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly policy: HostBrowsePolicy = {}) {}

  private idleTtl(): number {
    return this.policy.idleTtlMs ?? 30 * 60 * 1000;
  }

  private maxLife(): number {
    return this.policy.maxLifetimeMs ?? 4 * 60 * 60 * 1000;
  }

  private maxPerUser(): number {
    return this.policy.maxSessionsPerUser ?? 4;
  }

  private rateLimit(): number {
    return this.policy.rateLimitPerMinute ?? 60;
  }

  purgeExpired(now = Date.now()): void {
    for (const [id, s] of this.sessions) {
      if (
        now - s.lastAccessAt > this.idleTtl() ||
        now - s.createdAt > this.maxLife()
      ) {
        this.sessions.delete(id);
      }
    }
  }

  checkRate(userId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const cur = this.rate.get(userId);
    if (!cur || now - cur.windowStart >= windowMs) {
      this.rate.set(userId, { windowStart: now, count: 1 });
      return true;
    }
    if (cur.count >= this.rateLimit()) return false;
    cur.count += 1;
    return true;
  }

  create(userId: string, mode: HostBrowseMode): HostBrowseSession {
    this.purgeExpired();
    const existing = [...this.sessions.values()].filter((s) => s.userId === userId);
    if (existing.length >= this.maxPerUser()) {
      // Drop oldest
      existing.sort((a, b) => a.lastAccessAt - b.lastAccessAt);
      const drop = existing[0];
      if (drop) this.sessions.delete(drop.sessionId);
    }
    const now = Date.now();
    const session: HostBrowseSession = {
      sessionId: newId(),
      userId,
      mode,
      contentToken: newToken(),
      userAgent: this.policy.userAgent ?? HOST_BROWSE_DEFAULT_UA,
      createdAt: now,
      lastAccessAt: now,
      jar: new CookieJar(),
      history: [],
      historyIndex: -1,
      currentUrl: null,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string, userId: string): HostBrowseSession | null {
    this.purgeExpired();
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) return null;
    s.lastAccessAt = Date.now();
    return s;
  }

  /** Lookup by id only (content-token path validates token separately). */
  getById(sessionId: string): HostBrowseSession | null {
    this.purgeExpired();
    return this.sessions.get(sessionId) ?? null;
  }

  delete(sessionId: string, userId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  verifyContentToken(session: HostBrowseSession, token: string): boolean {
    if (!token || !session.contentToken) return false;
    const a = Buffer.from(session.contentToken);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  toMeta(s: HostBrowseSession): HostBrowseSessionMeta {
    const idle = this.idleTtl();
    const life = this.maxLife();
    const expIdle = s.lastAccessAt + idle;
    const expLife = s.createdAt + life;
    const expiresAt = Math.min(expIdle, expLife);
    return {
      sessionId: s.sessionId,
      userId: s.userId,
      mode: s.mode,
      contentToken: s.contentToken,
      userAgent: s.userAgent,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      lastAccessAt: new Date(s.lastAccessAt).toISOString(),
      cookieCount: s.jar.size,
      historyIndex: s.historyIndex,
      historyLength: s.history.length,
      currentUrl: s.currentUrl,
    };
  }

  pushHistory(s: HostBrowseSession, url: string, title?: string): void {
    // Truncate forward history
    if (s.historyIndex >= 0 && s.historyIndex < s.history.length - 1) {
      s.history = s.history.slice(0, s.historyIndex + 1);
    }
    s.history.push({
      url,
      title,
      at: new Date().toISOString(),
    });
    if (s.history.length > 100) {
      s.history = s.history.slice(-100);
    }
    s.historyIndex = s.history.length - 1;
    s.currentUrl = url;
  }
}
