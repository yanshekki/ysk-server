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

  it('evaluates offline and ddos protection modes', () => {
    expect(evaluateProtection({ networkReachable: false }).mode).toBe('offline');
    expect(evaluateProtection({ networkReachable: true, ddosSuspected: true }).mode).toBe(
      'ddos-protection',
    );
    expect(evaluateProtection({ networkReachable: true }).mode).toBe('normal');
    expect(EMERGENCY_PLAYBOOKS).toContain('local-llm-ops-only');
  });
});
