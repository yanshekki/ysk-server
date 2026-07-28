import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { listResources } from './managed-resources.js';
import {
  createProjectFtpAccount,
  hashFtpPassword,
  isCryptPasswordHash,
  writeManagedFtpAccounts,
} from './ftps-service.js';

function listAccounts(db: ReturnType<typeof openDatabase>) {
  return listResources(db, 'ftp_accounts');
}

describe('FTPS project linux user alignment', () => {
  it('hashes password with crypt (no plaintext stored)', () => {
    const h = hashFtpPassword('password12345');
    expect(isCryptPasswordHash(h)).toBe(true);
  });

  it('stores linuxUser and writes guest_username in user_conf', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ftp-'));
    const home = join(dir, 'homes', 'ysk-server-id');
    const db = openDatabase(join(dir, 'db.json'));
    try {
      const created = createProjectFtpAccount(db, {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        projectHome: home,
        linuxUser: 'ysks_a1b2c3d4e5f6',
        linuxGroup: 'ysks_a1b2c3d4e5f6',
        password: 'password123',
        homeSubdir: 'root',
      });
      expect(created.ok).toBe(true);
      expect(created.account.linuxUser).toBe('ysks_a1b2c3d4e5f6');
      expect(String(created.account.username)).toMatch(/^p_/);
      expect(created.account.passwordHashed).toBe(true);
      // no plaintext in resource row
      const raw = listAccounts(db);
      expect(raw[0]?.password_plain).toBeFalsy();
      expect(String(raw[0]?.password_hash ?? '')).toMatch(/^\$/);

      const managed = writeManagedFtpAccounts({ db, dataDir: dir });
      expect(managed.accounts.length).toBeGreaterThanOrEqual(1);
      const confPath = join(dir, 'ftps', 'user_conf', String(created.account.username));
      expect(existsSync(confPath)).toBe(true);
      const body = readFileSync(confPath, 'utf8');
      expect(body).toContain('guest_username=ysks_a1b2c3d4e5f6');
      expect(body).toContain('local_root=');
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects create without linuxUser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ftp2-'));
    const db = openDatabase(join(dir, 'db.json'));
    try {
      const r = createProjectFtpAccount(db, {
        projectId: 'x',
        projectHome: dir,
        linuxUser: '',
        password: 'password123',
      });
      expect(r.ok).toBe(false);
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
