/**
 * Open durable control-plane database.
 *
 * Backends (D4):
 * - json (default): atomic ysk.json
 * - sqlite: sql.js document blob (YSK_STORE=sqlite or path ends .sqlite)
 * - postgres: optional pg + YSK_DATABASE_URL
 *
 * All backends are JsonStore (or subclass) — same snapshot API.
 */

import type { YskDatabase } from './store.js';
import {
  openDocumentStoreSync,
  openDocumentStore,
  type OpenStoreOptions,
  type StoreBackendKind,
} from './document-store.js';

export type { StoreBackendKind, OpenStoreOptions };

/**
 * Open (or create) the control-plane database.
 * Env: YSK_STORE=json|sqlite|postgres · YSK_DATABASE_URL for postgres.
 */
export function openDatabase(dbPath: string, opts?: OpenStoreOptions): YskDatabase {
  const path = opts?.path ?? dbPath;
  return openDocumentStoreSync({ ...opts, path });
}

/** Async alias (same as sync for document backends). */
export async function openDatabaseAsync(
  dbPath: string,
  opts?: OpenStoreOptions,
): Promise<YskDatabase> {
  const path = opts?.path ?? dbPath;
  return openDocumentStore({ ...opts, path });
}

export function migrate(_db: YskDatabase): void {
  // Document backends need no SQL migrations; schema.ts reserved for relational mode
}

export function closeDatabase(db: YskDatabase): void {
  db.close();
}

export type { YskDatabase };
