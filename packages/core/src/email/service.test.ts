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
    expect(mb.notes.some((n) => /YSK_EXECUTE|System user|系統用戶|系統變更|useradd|權限/i.test(n))).toBe(
      true,
    );
    expect(svc.listMailboxes(created.domain.id)).toHaveLength(1);
    expect(svc.listMailboxes(created.domain.id)[0].has_password).toBe(true);

    await expect(
      svc.createMailbox(created.domain.id, { localPart: 'info', actor: 'admin' }),
    ).rejects.toThrow(/already exists|已存在/i);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('EmailService aliases flags and honesty', () => {
  it('getDnsBundle + markApplyStatus + duplicate domain throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mail2-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({ domain: 'a.test', serverIp: '1.2.3.4', actor: 'a' });
    expect(() => svc.create({ domain: 'a.test', serverIp: '1.2.3.4', actor: 'a' })).toThrow();
    expect(() => svc.get('nope')).toThrow();
    const bundle = svc.getDnsBundle(created.domain.id);
    expect(bundle.records.length).toBeGreaterThan(0);
    expect(bundle.health.score).toBeLessThanOrEqual(100);
    svc.markApplyStatus(created.domain.id, { ok: true, notes: ['applied'] });
    expect(svc.get(created.domain.id).domain).toBe('a.test');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('createAlias catchall forward delete and list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-alias-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({ domain: 'alias.test', serverIp: '10.0.0.2', actor: 'a' });
    const alias = svc.createAlias(created.domain.id, {
      type: 'alias',
      localPart: 'sales',
      destinations: ['inbox@alias.test'],
      actor: 'a',
    });
    expect(alias.ok).toBe(true);
    expect(alias.written.some((p) => p.includes('virtual_alias'))).toBe(true);
    const catchall = svc.createAlias(created.domain.id, {
      type: 'catchall',
      destinations: ['catch@alias.test'],
      actor: 'a',
    });
    expect(catchall.alias.source).toBe('@alias.test');
    expect(svc.listAliases(created.domain.id)).toHaveLength(2);
    expect(() =>
      svc.createAlias(created.domain.id, {
        type: 'alias',
        localPart: 'sales',
        destinations: ['x@y.z'],
        actor: 'a',
      }),
    ).toThrow();
    expect(() =>
      svc.createAlias(created.domain.id, { type: 'alias', localPart: 'x', destinations: [], actor: 'a' }),
    ).toThrow();
    const del = svc.deleteAlias(created.domain.id, String(alias.alias.id), 'a');
    expect(del.ok).toBe(true);
    expect(svc.listAliases(created.domain.id)).toHaveLength(1);
    expect(() => svc.deleteAlias(created.domain.id, 'missing', 'a')).toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateDomainMailFlags writes sieve/suspend without system apply', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-flags-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({ domain: 'flags.test', serverIp: '10.0.0.3', actor: 'a' });
    await svc.createMailbox(created.domain.id, {
      localPart: 'user',
      password: 'pw-long-enough',
      actor: 'a',
    });
    const flags = await svc.updateDomainMailFlags(
      created.domain.id,
      {
        catchallAddress: 'user@flags.test',
        autoreplyEnabled: true,
        autoreplySubject: 'OOO',
        autoreplyBody: 'back soon',
        rateLimitPerHour: 100,
        antispam: true,
        suspended: true,
        applySystem: false,
      },
      'a',
    );
    expect(flags.ok).toBe(true);
    expect(flags.apply_status).toBe('written');
    expect(flags.written.length).toBeGreaterThan(0);
    expect(flags.notes.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'email', 'flags.test', 'SUSPENDED.flag'))).toBe(true);
    expect(existsSync(join(dir, 'email', 'flags.test', 'sieve', 'vacation.sieve'))).toBe(true);
    // applySystem without execute → blocked/partial honesty
    const sys = await svc.updateDomainMailFlags(
      created.domain.id,
      { suspended: false, applySystem: true },
      'a',
    );
    expect(sys.notes.length).toBeGreaterThan(0);
    expect(['written', 'applied', 'partial', 'blocked']).toContain(sys.apply_status);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('testSend refuses without YSK_EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-send-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({ domain: 'send.test', serverIp: '10.0.0.4', actor: 'a' });
    const r = await svc.testSend(
      created.domain.id,
      { from: 'a@send.test', to: 'b@example.com', subject: 'hi' },
      'a',
    );
    expect(r.ok).toBe(false);
    expect(r.plan).toBeTruthy();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('createMailbox rejects bad localPart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mbad-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new EmailService(db, host, undefined, dir);
    const created = svc.create({ domain: 'bad.test', serverIp: '10.0.0.5', actor: 'a' });
    await expect(
      svc.createMailbox(created.domain.id, { localPart: 'BAD SPACE', actor: 'a' }),
    ).rejects.toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
