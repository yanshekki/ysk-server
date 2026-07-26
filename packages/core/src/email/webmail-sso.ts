/**
 * Webmail SSO — one-time panel tokens for Roundcube-style login handoff.
 * Does not claim Roundcube is configured; token is panel-issued for reverse-proxy auth.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { JsonStore } from '../db/store.js';

export type WebmailSsoToken = {
  id: string;
  tokenHash: string;
  email: string;
  domain: string;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
};

const KEY = 'webmail_sso_tokens';

function load(db: JsonStore): WebmailSsoToken[] {
  const raw = db.snapshot.settings?.[KEY];
  if (!raw) return [];
  try {
    return JSON.parse(raw) as WebmailSsoToken[];
  } catch {
    return [];
  }
}

function save(db: JsonStore, tokens: WebmailSsoToken[]): void {
  db.snapshot.settings[KEY] = JSON.stringify(tokens.slice(0, 200));
  db.persist();
}

export function issueWebmailSso(input: {
  db: JsonStore;
  email: string;
  domain: string;
  ttlMinutes?: number;
}): {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  loginUrl?: string;
  notes: string[];
} {
  const email = input.email.trim().toLowerCase();
  const domain = input.domain.trim().toLowerCase();
  if (!email.includes('@') || !domain) {
    return { ok: false, notes: ['需要有效 email 與 domain'] };
  }
  const plain = randomBytes(24).toString('base64url');
  const ttl = Math.min(Math.max(input.ttlMinutes ?? 5, 1), 60);
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  const row: WebmailSsoToken = {
    id: randomBytes(8).toString('hex'),
    tokenHash: createHash('sha256').update(plain).digest('hex'),
    email,
    domain,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  const all = load(input.db).filter((t) => !t.usedAt && t.expiresAt > new Date().toISOString());
  all.unshift(row);
  save(input.db, all);
  const loginUrl = `/webmail/sso?token=${encodeURIComponent(plain)}&email=${encodeURIComponent(email)}`;
  return {
    ok: true,
    token: plain,
    expiresAt,
    loginUrl,
    notes: [
      `已簽發一次性 SSO token（${ttl} 分鐘）`,
      '需 webmail 前端或 reverse proxy 認 token；未接 Roundcube 外掛前僅控制面可用',
      `loginUrl: ${loginUrl}`,
    ],
  };
}

export function consumeWebmailSso(
  db: JsonStore,
  token: string,
): { ok: boolean; email?: string; domain?: string; notes: string[] } {
  const hash = createHash('sha256').update(token).digest('hex');
  const all = load(db);
  const found = all.find((t) => t.tokenHash === hash);
  if (!found) return { ok: false, notes: ['無效 token'] };
  if (found.usedAt) return { ok: false, notes: ['token 已使用'] };
  if (found.expiresAt < new Date().toISOString()) {
    return { ok: false, notes: ['token 已過期'] };
  }
  found.usedAt = new Date().toISOString();
  save(db, all);
  return {
    ok: true,
    email: found.email,
    domain: found.domain,
    notes: ['SSO 已驗證（單次）'],
  };
}
