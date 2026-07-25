import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { AuditRepository } from './audit-repo.js';

describe('AuditRepository', () => {
  it('appends and lists events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-audit-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new AuditRepository(db);
    const e = repo.append({
      actor: 'admin',
      action: 'test.action',
      resource: 'r1',
      detail: { x: 1 },
      ok: true,
    });
    expect(e.id).toBeTruthy();
    expect(repo.listRecent().some((x) => x.id === e.id)).toBe(true);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
