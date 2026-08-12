/**
 * Shared helpers for managed resource routes (Wave S1).
 */
import {
  hashFtpPassword,
  isCryptPasswordHash,
  type CollectionKey,
} from '@yanshekki/core';

/** Never return secrets to the panel list/detail API. */
export function redactResourceSecrets(
  key: CollectionKey,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (key !== 'ftp_accounts' && key !== 'mysql_users' && key !== 'postgres_users') {
    return row;
  }
  const {
    password_plain: _pp,
    password: _p,
    password_hash: _ph,
    ...rest
  } = row;
  return {
    ...rest,
    passwordSet: Boolean(
      (typeof _ph === 'string' && _ph.length > 0) ||
        (typeof _pp === 'string' && _pp.length > 0) ||
        (typeof _p === 'string' && _p.length > 0),
    ),
  };
}

/** Hash FTP plaintext on write so plain is never stored long-term. */
export function normalizeFtpPasswordFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const plain = String(data.password_plain ?? data.password ?? '').trim();
  if (!plain) {
    const next = { ...data };
    delete next.password_plain;
    delete next.password;
    return next;
  }
  const hash = hashFtpPassword(plain);
  const next = { ...data };
  delete next.password_plain;
  delete next.password;
  if (isCryptPasswordHash(hash)) {
    next.password_hash = hash;
  } else {
    // keep plain only if hash failed (apply path will warn) — still avoid bare password key
    next.password_plain = plain;
  }
  return next;
}

export const RESOURCE_COLLECTIONS: Record<string, CollectionKey> = {
  'nginx/sites': 'nginx_sites',
  'ftp/accounts': 'ftp_accounts',
  'mysql/databases': 'mysql_databases',
  'mysql/users': 'mysql_users',
  'postgres/databases': 'postgres_databases',
  'postgres/users': 'postgres_users',
  'redis/instances': 'redis_instances',
  'dns/zones': 'dns_zones',
  'dns/records': 'dns_records',
  'ssl/certs': 'certificates',
};

export function parseResourceCollection(pathname: string): {
  key: CollectionKey | null;
  id: string | null;
  action: string | null;
  prefix: string | null;
} {
  // /api/v1/resources/<prefix...> or /api/v1/resources/<prefix...>/:id(/action)
  if (!pathname.startsWith('/api/v1/resources/')) {
    return { key: null, id: null, action: null, prefix: null };
  }
  const rest = pathname.slice('/api/v1/resources/'.length);
  const parts = rest.split('/').filter(Boolean);
  // try longest prefix match
  for (let len = Math.min(parts.length, 2); len >= 1; len--) {
    const prefix = parts.slice(0, len).join('/');
    if (RESOURCE_COLLECTIONS[prefix]) {
      const id = parts[len] ?? null;
      const action = parts[len + 1] ?? null;
      return { key: RESOURCE_COLLECTIONS[prefix], id, action, prefix };
    }
  }
  return { key: null, id: null, action: null, prefix: null };
}
