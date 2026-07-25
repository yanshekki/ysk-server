/**
 * Open durable control-plane database (JSON store — portable, no native deps).
 */

import { JsonStore, type YskDatabase } from './store.js';

/**
 * Open (or create) the control-plane database file.
 * Path conventionally ends with `.sqlite` or `.json`; both accepted.
 */
export function openDatabase(dbPath: string): YskDatabase {
  // Prefer .json for clarity when creating new; keep caller path for compatibility
  const path = dbPath.endsWith('.sqlite') ? dbPath.replace(/\.sqlite$/, '.json') : dbPath;
  return new JsonStore(path);
}

export function migrate(_db: YskDatabase): void {
  // schema is implicit in JsonStore
}

export function closeDatabase(db: YskDatabase): void {
  db.close();
}

export type { YskDatabase };
