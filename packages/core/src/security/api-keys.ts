/**
 * Operator API access keys — token shown once at create; store only hash.
 * Scopes: full | read (no-2fa-bypass read is still API key auth without session 2FA)
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { JsonStore } from '../db/store.js';

export type ApiKeyScope = 'full' | 'read';

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  /** When true, key is read-only and cannot call mutating routes (enforced at middleware) */
  readOnly: boolean;
  created_at: string;
  last_used_at?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapKey(k: Record<string, unknown>): ApiKeyPublic {
  const scope = (k.scope === 'read' ? 'read' : 'full') as ApiKeyScope;
  return {
    id: String(k.id),
    name: String(k.name ?? ''),
    prefix: String(k.prefix ?? ''),
    scope,
    readOnly: scope === 'read' || k.read_only === true,
    created_at: String(k.created_at ?? ''),
    last_used_at: k.last_used_at ? String(k.last_used_at) : undefined,
  };
}

export function listApiKeys(db: JsonStore): ApiKeyPublic[] {
  return (db.snapshot.api_keys ?? []).map((k) => mapKey(k as Record<string, unknown>));
}

export function createApiKey(
  db: JsonStore,
  input: { name: string; userId: string; scope?: ApiKeyScope },
): { key: ApiKeyPublic; token: string } {
  const name = input.name.trim() || 'api-key';
  const scope: ApiKeyScope = input.scope === 'read' ? 'read' : 'full';
  const raw = `ysk_${randomBytes(24).toString('base64url')}`;
  const prefix = raw.slice(0, 12);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    name,
    user_id: input.userId,
    prefix,
    token_hash: hashToken(raw),
    scope,
    read_only: scope === 'read',
    created_at: now,
  };
  if (!db.snapshot.api_keys) db.snapshot.api_keys = [];
  db.snapshot.api_keys.unshift(row);
  db.persist();
  return {
    key: mapKey(row as unknown as Record<string, unknown>),
    token: raw,
  };
}

export function deleteApiKey(db: JsonStore, id: string): boolean {
  const before = (db.snapshot.api_keys ?? []).length;
  db.snapshot.api_keys = (db.snapshot.api_keys ?? []).filter((k) => k.id !== id);
  db.persist();
  return (db.snapshot.api_keys ?? []).length < before;
}

export type VerifiedApiKey = {
  userId: string;
  scope: ApiKeyScope;
  readOnly: boolean;
  keyId: string;
};

/** Returns user_id + scope if token matches */
export function verifyApiKeyDetailed(
  db: JsonStore,
  token: string,
): VerifiedApiKey | null {
  if (!token.startsWith('ysk_')) return null;
  const h = hashToken(token);
  for (const k of db.snapshot.api_keys ?? []) {
    const stored = String(k.token_hash ?? '');
    try {
      const a = Buffer.from(h, 'hex');
      const b = Buffer.from(stored, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        k.last_used_at = new Date().toISOString();
        db.persist();
        const scope = k.scope === 'read' ? 'read' : 'full';
        return {
          userId: String(k.user_id ?? ''),
          scope: scope as ApiKeyScope,
          readOnly: scope === 'read' || k.read_only === true,
          keyId: String(k.id),
        };
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/** Returns user_id if token matches a key (legacy) */
export function verifyApiKey(db: JsonStore, token: string): string | null {
  return verifyApiKeyDetailed(db, token)?.userId ?? null;
}
