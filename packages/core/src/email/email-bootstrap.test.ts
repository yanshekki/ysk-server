import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { LocalHostExecutor } from '../host/executor.js';
import { bootstrapEmailServer } from './email-bootstrap.js';

describe('bootstrapEmailServer', () => {
  it('creates domain, MTA configs, mailbox, passdb, webmail plan without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-eb-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await bootstrapEmailServer({
      dataDir: dir,
      db,
      host,
      domain: 'boot.example',
      serverIp: '203.0.113.20',
      actor: 'admin',
      adminLocalPart: 'postmaster',
      adminPassword: 'longpassword99',
      webmail: true,
      installPackages: false,
    });
    expect(r.domainId).toBeTruthy();
    expect(r.steps.find((s) => s.id === 'domain')?.ok).toBe(true);
    expect(r.steps.find((s) => s.id === 'mta-configs')?.ok).toBe(true);
    expect(r.steps.find((s) => s.id === 'mailbox')?.ok).toBe(true);
    expect(r.steps.find((s) => s.id === 'dovecot-passdb')?.ok).toBe(true);
    expect(r.steps.find((s) => s.id === 'webmail')?.ok).toBe(true);
    expect(r.externalTodos.length).toBeGreaterThan(0);
    expect(r.written.some((p) => p.includes('install-mta') || p.includes('postfix'))).toBe(true);
    expect(existsSync(join(dir, 'email', 'boot.example'))).toBe(true);

    // installPackages without EXECUTE should mark mta ok still for config-only (installPackages false above)
    const refused = await bootstrapEmailServer({
      dataDir: dir,
      db,
      host,
      domain: 'boot2.example',
      serverIp: '203.0.113.21',
      actor: 'admin',
      installPackages: true,
      webmail: false,
    });
    expect(refused.steps.find((s) => s.id === 'mta-configs')?.ok).toBe(false);
    expect(refused.requiresExecute).toBe(true);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
