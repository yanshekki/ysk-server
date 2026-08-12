import { tl } from '@ysk-server/shared';
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
  /** One-time mailbox password for Roundcube auto-login (cleared after consume) */
  loginPassword?: string;
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
  /** Mailbox password for one-time Roundcube auto-login (not re-displayed) */
  password?: string;
  /**
   * Public webmail base URL, e.g. https://webmail.example.com
   * Token is appended as ?_ysk_sso= for Roundcube ysk_sso plugin.
   */
  webmailBaseUrl?: string;
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
    return { ok: false, notes: [tl('notes.auto.n1579')] };
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
    loginPassword: input.password || undefined,
  };
  const all = load(input.db).filter((t) => !t.usedAt && t.expiresAt > new Date().toISOString());
  all.unshift(row);
  save(input.db, all);
  const base = (input.webmailBaseUrl ?? '').trim().replace(/\/$/, '');
  const loginUrl = base
    ? `${base}/?_ysk_sso=${encodeURIComponent(plain)}`
    : `https://webmail.${domain}/?_ysk_sso=${encodeURIComponent(plain)}`;
  return {
    ok: true,
    token: plain,
    expiresAt,
    loginUrl,
    notes: [
      tl('notes.auto.t0061', { v0: (ttl) }),
      input.password
        ? tl('notes.auto.n0813')
        : tl('notes.auto.n0987'),
      `loginUrl: ${loginUrl}`,
    ],
  };
}

export function consumeWebmailSso(
  db: JsonStore,
  token: string,
): {
  ok: boolean;
  email?: string;
  domain?: string;
  /** One-time password for Roundcube $RCMAIL->login (cleared after this call) */
  password?: string;
  notes: string[];
} {
  const hash = createHash('sha256').update(token).digest('hex');
  const all = load(db);
  const found = all.find((t) => t.tokenHash === hash);
  if (!found) return { ok: false, notes: [tl('notes.auto.n1106')] };
  if (found.usedAt) return { ok: false, notes: [tl('notes.auto.n0446')] };
  if (found.expiresAt < new Date().toISOString()) {
    return { ok: false, notes: [tl('notes.auto.n0447')] };
  }
  found.usedAt = new Date().toISOString();
  const password = found.loginPassword;
  delete found.loginPassword;
  save(db, all);
  return {
    ok: true,
    email: found.email,
    domain: found.domain,
    password,
    notes: password
      ? [tl('notes.auto.n0188')]
      : [tl('notes.auto.n0189')],
  };
}
