import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { LocalHostExecutor } from '../host/executor.js';
import { EmailService } from './service.js';

describe('EmailService real keygen + persistence', () => {
  it('creates domain with RSA DKIM and MX/SPF/DKIM/DMARC records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mail-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({
      domain: 'example.com',
      serverIp: '203.0.113.10',
      actor: 'admin',
    });
    expect(created.domain.dkim_public_key.length).toBeGreaterThan(100);
    expect(created.records.some((r) => r.type === 'MX')).toBe(true);
    expect(created.records.some((r) => r.value.includes('v=spf1'))).toBe(true);
    expect(created.records.some((r) => r.name.includes('_domainkey'))).toBe(true);
    expect(created.records.some((r) => r.name === '_dmarc')).toBe(true);
    expect(created.externalTodos.some((t) => t.id === 'ptr')).toBe(true);
    expect(created.externalTodos.some((t) => t.id === 'port25')).toBe(true);
    expect(created.health.score).toBeLessThan(100);

    const updated = svc.updateChecks(
      created.domain.id,
      { dnsApplied: true, dmarcPresent: true, ptrOk: true, port25Open: true },
      'admin',
    );
    expect(updated.health.score).toBe(100);
    expect(svc.list()).toHaveLength(1);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('provisions Maildir + virtual map for mailbox', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mbox-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({
      domain: 'mail.test',
      serverIp: '10.0.0.1',
      actor: 'admin',
    });
    const mb = await svc.createMailbox(created.domain.id, {
      localPart: 'info',
      password: 'secretpass99',
      actor: 'admin',
      provisionSystem: true,
    });
    expect(mb.ok).toBe(true);
    expect(mb.mailbox.address).toBe('info@mail.test');
    expect(String(mb.mailbox.maildir)).toContain('Maildir');
    expect(existsSync(String(mb.mailbox.maildir))).toBe(true);
    expect(mb.written.some((p) => p.includes('virtual_mailbox'))).toBe(true);
    expect(mb.notes.some((n) => /YSK_EXECUTE|System user/i.test(n))).toBe(true);
    expect(svc.listMailboxes(created.domain.id)).toHaveLength(1);
    expect(svc.listMailboxes(created.domain.id)[0].has_password).toBe(true);

    await expect(
      svc.createMailbox(created.domain.id, { localPart: 'info', actor: 'admin' }),
    ).rejects.toThrow(/already exists/i);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
