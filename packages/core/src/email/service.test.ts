import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
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

    expect(() => svc.deleteDomain(created.domain.id, 'admin', { confirmName: 'wrong' })).toThrow();
    const del = svc.deleteDomain(created.domain.id, 'admin', {
      confirmName: 'example.com',
      removeData: true,
    });
    expect(del.ok).toBe(true);
    expect(del.domain).toBe('example.com');
    expect(svc.list()).toHaveLength(0);

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

    const mbId = String(mb.mailbox.id);
    const updated = await svc.updateMailbox(created.domain.id, mbId, {
      actor: 'admin',
      password: 'newsecretpass99',
      status: 'disabled',
    });
    expect(updated.ok).toBe(true);
    expect(updated.mailbox.status).toBe('disabled');
    expect(updated.mailbox.has_password).toBe(true);
    const passwdPath = join(dir, 'email', 'mail.test', 'dovecot', 'passwd');
    expect(existsSync(passwdPath)).toBe(true);
    const passwdBody = readFileSync(passwdPath, 'utf8');
    expect(passwdBody).toContain('info@mail.test:*:');

    const reenabled = await svc.updateMailbox(created.domain.id, mbId, {
      actor: 'admin',
      status: 'active',
    });
    expect(reenabled.ok).toBe(true);
    expect(reenabled.mailbox.status).toBe('active');
    const passwdActive = readFileSync(passwdPath, 'utf8');
    expect(passwdActive.includes('SHA512-CRYPT') || passwdActive.includes('scrypt$')).toBe(true);

    await expect(
      svc.updateMailbox(created.domain.id, mbId, { actor: 'admin' }),
    ).rejects.toThrow();
    await expect(
      svc.updateMailbox(created.domain.id, 'missing-id', {
        actor: 'admin',
        status: 'active',
      }),
    ).rejects.toThrow();

    await expect(
      svc.createMailbox(created.domain.id, { localPart: 'info', actor: 'admin' }),
    ).rejects.toThrow(/already exists|已存在/i);

    const del = svc.deleteDomain(created.domain.id, 'admin', {
      confirmName: 'mail.test',
      removeData: true,
    });
    expect(del.ok).toBe(true);
    expect(del.removedMailboxes).toBe(1);
    expect(svc.listMailboxes()).toHaveLength(0);
    expect(existsSync(join(dir, 'email', 'mail.test'))).toBe(false);

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

  it('mailbox/alias branch edges: short password, list all, catchall clear, no dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mail-br-'));
    try {
      const db = openDatabase(join(dir, 'ysk.json'));
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      // no dataDir → maildir notes path
      const bare = new EmailService(db, host, undefined);
      const created = bare.create({
        domain: 'br.example.com',
        serverIp: '203.0.113.50',
        serverIpv6: '2001:db8::50',
        mailHostname: 'mx.br.example.com',
        actor: 'admin',
      });
      const mb = await bare.createMailbox(created.domain.id, {
        localPart: 'user1',
        password: 'short',
        actor: 'admin',
      });
      expect(mb.notes.some((n) => n.length > 0)).toBe(true);
      expect(bare.listMailboxes().length).toBe(1);
      expect(bare.listMailboxes(created.domain.id).length).toBe(1);

      // with dataDir for alias maps
      const svc = new EmailService(db, host, undefined, dir);
      expect(() =>
        svc.createAlias(created.domain.id, {
          type: 'alias',
          localPart: 'sales',
          destinations: [],
          actor: 'a',
        }),
      ).toThrow();
      expect(() =>
        svc.createAlias(created.domain.id, {
          type: 'alias',
          localPart: 'BAD PART',
          destinations: ['x@y.com'],
          actor: 'a',
        }),
      ).toThrow();
      const alias = svc.createAlias(created.domain.id, {
        type: 'alias',
        localPart: 'sales',
        destinations: ['  dest@example.com  '],
        actor: 'a',
      });
      expect(alias.ok).toBe(true);
      expect(() =>
        svc.createAlias(created.domain.id, {
          type: 'alias',
          localPart: 'sales',
          destinations: ['dest@example.com'],
          actor: 'a',
        }),
      ).toThrow();
      expect(svc.listAliases(created.domain.id).length).toBe(1);
      expect(() => svc.deleteAlias(created.domain.id, 'nope', 'a')).toThrow();
      expect(svc.deleteAlias(created.domain.id, String(alias.alias.id), 'a').ok).toBe(true);

      // catchall create + update existing + clear
      await svc.updateDomainMailFlags(
        created.domain.id,
        { catchallAddress: 'catch@br.example.com', applySystem: false },
        'a',
      );
      await svc.updateDomainMailFlags(
        created.domain.id,
        { catchallAddress: 'other@br.example.com', applySystem: false },
        'a',
      );
      await svc.updateDomainMailFlags(
        created.domain.id,
        {
          catchallAddress: null,
          autoreplyEnabled: false,
          autoreplySubject: 's',
          autoreplyBody: 'b',
          rateLimitPerHour: null,
          antispam: false,
          suspended: false,
          applySystem: false,
        },
        'a',
      );
      // not found domain flags
      await expect(
        svc.updateDomainMailFlags('missing', { suspended: true }, 'a'),
      ).rejects.toThrow();

      // short password with provisionSystem blocked path
      const mb2 = await svc.createMailbox(created.domain.id, {
        localPart: 'user2',
        password: 'password123',
        actor: 'admin',
        provisionSystem: true,
      });
      expect(mb2.ok).toBe(true);
      expect(mb2.mailbox.status).toMatch(/managed/);

      closeDatabase(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
