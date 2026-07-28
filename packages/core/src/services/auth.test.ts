import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthService } from './auth.js';
import { evaluateProtection, EMERGENCY_PLAYBOOKS } from './protection.js';
import { openDatabase, closeDatabase } from '../db/database.js';
import { UserRepository } from '../repositories/user-repo.js';
import { SessionRepository } from '../repositories/session-repo.js';
import { AuditRepository } from '../repositories/audit-repo.js';
import { createApiKey } from '../security/api-keys.js';

describe('auth + protection (persistent)', () => {
  it('logs in and authenticates tokens across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const dbPath = join(dir, 't.sqlite');
    const db = openDatabase(dbPath);
    const auth = new AuthService(
      new UserRepository(db),
      new SessionRepository(db),
      new AuditRepository(db),
    );
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    const login = auth.login({ username: 'admin', password: 'secret' });
    expect(login.token).toBeTruthy();
    expect(auth.authenticate(login.token).username).toBe('admin');
    closeDatabase(db);

    const db2 = openDatabase(dbPath);
    const auth2 = new AuthService(new UserRepository(db2), new SessionRepository(db2));
    expect(auth2.authenticate(login.token).username).toBe('admin');
    auth2.logout(login.token);
    expect(() => auth2.authenticate(login.token)).toThrow();
    closeDatabase(db2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('authenticates API access keys as the owning user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apikey-'));
    const dbPath = join(dir, 't.json');
    const db = openDatabase(dbPath);
    const users = new UserRepository(db);
    const auth = new AuthService(users, new SessionRepository(db), new AuditRepository(db), db);
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    const admin = users.findByUsername('admin')!;
    const { token } = createApiKey(db, { name: 'ci', userId: admin.id });
    expect(token.startsWith('ysk_')).toBe(true);
    expect(auth.authenticate(token).username).toBe('admin');
    expect(() => auth.authenticate('ysk_invalid_token_xxxxxxxxxxxx')).toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('evaluates offline and ddos protection modes', () => {
    expect(evaluateProtection({ networkReachable: false }).mode).toBe('offline');
    expect(evaluateProtection({ networkReachable: true, ddosSuspected: true }).mode).toBe(
      'ddos-protection',
    );
    expect(evaluateProtection({ networkReachable: true }).mode).toBe('normal');
    expect(EMERGENCY_PLAYBOOKS).toContain('local-llm-ops-only');
  });
});
