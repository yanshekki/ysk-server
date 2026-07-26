/**
 * Operator API access keys — token shown once at create; store only hash.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { JsonStore } from '../db/store.js';

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function listApiKeys(db: JsonStore): ApiKeyPublic[] {
  return (db.snapshot.api_keys ?? []).map((k) => ({
    id: String(k.id),
    name: String(k.name ?? ''),
    prefix: String(k.prefix ?? ''),
    created_at: String(k.created_at ?? ''),
    last_used_at: k.last_used_at ? String(k.last_used_at) : undefined,
  }));
}

export function createApiKey(
  db: JsonStore,
  input: { name: string; userId: string },
): { key: ApiKeyPublic; token: string } {
  const name = input.name.trim() || 'api-key';
  const raw = `ysk_${randomBytes(24).toString('base64url')}`;
  const prefix = raw.slice(0, 12);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    name,
    user_id: input.userId,
    prefix,
    token_hash: hashToken(raw),
    created_at: now,
  };
  if (!db.snapshot.api_keys) db.snapshot.api_keys = [];
  db.snapshot.api_keys.unshift(row);
  db.persist();
  return {
    key: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      created_at: row.created_at,
    },
    token: raw,
  };
}

export function deleteApiKey(db: JsonStore, id: string): boolean {
  const before = (db.snapshot.api_keys ?? []).length;
  db.snapshot.api_keys = (db.snapshot.api_keys ?? []).filter((k) => k.id !== id);
  db.persist();
  return (db.snapshot.api_keys ?? []).length < before;
}

/** Returns user_id if token matches a key */
export function verifyApiKey(db: JsonStore, token: string): string | null {
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
        return String(k.user_id ?? '');
      }
    } catch {
      /* continue */
    }
  }
  return null;
}
