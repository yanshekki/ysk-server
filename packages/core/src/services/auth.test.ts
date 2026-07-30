import { describe, expect, it, beforeEach } from 'vitest';
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
import { generateTotpCode } from '../security/totp.js';
import { _resetRateLimitsForTests } from '../security/mfa/rate-limit.js';

describe('auth + protection (persistent)', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('logs in and authenticates tokens across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const dbPath = join(dir, 't.sqlite');
    const db = openDatabase(dbPath);
    const auth = new AuthService(
      new UserRepository(db),
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    const login = auth.login({ username: 'admin', password: 'secret' });
    expect(login.token).toBeTruthy();
    expect(auth.authenticate(login.token).username).toBe('admin');
    closeDatabase(db);

    const db2 = openDatabase(dbPath);
    const auth2 = new AuthService(
      new UserRepository(db2),
      new SessionRepository(db2),
      undefined,
      db2,
      dir,
    );
    expect(auth2.authenticate(login.token).username).toBe('admin');
    auth2.logout(login.token);
    expect(() => auth2.authenticate(login.token)).toThrow();
    closeDatabase(db2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rate-limits repeated failed logins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rl-'));
    const db = openDatabase(join(dir, 't.json'));
    const auth = new AuthService(
      new UserRepository(db),
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    for (let i = 0; i < 5; i++) {
      try {
        auth.login({ username: 'admin', password: 'wrong' }, { ip: '1.2.3.4' });
      } catch {
        /* expected */
      }
    }
    expect(() =>
      auth.login({ username: 'admin', password: 'wrong' }, { ip: '1.2.3.4' }),
    ).toThrow(/過多|稍後/);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('enables totp with recovery codes and encrypted secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-totp-'));
    const db = openDatabase(join(dir, 't.json'));
    const users = new UserRepository(db);
    const auth = new AuthService(
      users,
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    const admin = users.findByUsername('admin')!;
    expect(() => auth.beginTotp(admin.id)).toThrow(/密碼/);
    const begin = auth.beginTotp(admin.id, { password: 'secret' });
    expect(begin.secret.length).toBeGreaterThan(10);
    const row = users.findById(admin.id)!;
    expect(row.totp_secret?.startsWith('yskenc:')).toBe(true);
    const code = generateTotpCode(begin.secret);
    const conf = auth.confirmTotp(admin.id, code);
    expect(conf.enabled).toBe(true);
    expect(conf.recoveryCodes.length).toBe(10);
    expect(() =>
      auth.login({ username: 'admin', password: 'secret' }, { ip: '9.9.9.9' }),
    ).toThrow();
    // Same TOTP step already used at confirm → recovery path for login
    const rec = conf.recoveryCodes[0]!;
    const login = auth.login(
      { username: 'admin', password: 'secret', recoveryCode: rec },
      { ip: '9.9.9.9' },
    );
    expect(login.token).toBeTruthy();
    auth.logout(login.token);
    // Anti-replay: same recovery cannot be reused
    expect(() =>
      auth.login(
        { username: 'admin', password: 'secret', recoveryCode: rec },
        { ip: '9.9.9.9' },
      ),
    ).toThrow();
    const login2 = auth.login(
      {
        username: 'admin',
        password: 'secret',
        recoveryCode: conf.recoveryCodes[1]!,
      },
      { ip: '9.9.9.9' },
    );
    expect(login2.token).toBeTruthy();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('authenticates API access keys as the owning user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apikey-'));
    const dbPath = join(dir, 't.json');
    const db = openDatabase(dbPath);
    const users = new UserRepository(db);
    const auth = new AuthService(users, new SessionRepository(db), new AuditRepository(db), db, dir);
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
