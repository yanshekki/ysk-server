import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { LocalHostExecutor } from '../host/executor.js';
import { EmailService } from './service.js';
import { writeAllDovecotPassdbs, writeDovecotPassdb } from './dovecot-passdb.js';

describe('dovecot-passdb', () => {
  it('writes passwd-file after mailbox create', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dovecot-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const email = new EmailService(db, host, undefined, dir);
    const created = email.create({
      domain: 'passdb.test',
      serverIp: '10.1.1.1',
      actor: 'admin',
    });
    await email.createMailbox(created.domain.id, {
      localPart: 'hello',
      password: 'longpassword1',
      actor: 'admin',
    });

    const r = writeDovecotPassdb({
      dataDir: dir,
      db,
      domain: 'passdb.test',
      domainId: created.domain.id,
    });
    expect(r.ok).toBe(true);
    expect(r.mailboxCount).toBe(1);
    expect(existsSync(r.passwdPath)).toBe(true);
    const body = readFileSync(r.passwdPath, 'utf8');
    expect(body).toContain('hello@passdb.test');
    // SHA512-CRYPT when openssl available, else YSK-SCRYPT
    expect(body.includes('SHA512-CRYPT') || body.includes('scrypt$')).toBe(true);
    expect(existsSync(r.confSnippetPath)).toBe(true);

    const all = writeAllDovecotPassdbs({ dataDir: dir, db });
    expect(all.domains.length).toBeGreaterThanOrEqual(1);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
