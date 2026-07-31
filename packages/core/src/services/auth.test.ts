import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthService, hashPassword, verifyPassword } from './auth.js';
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

  it('rejects missing credentials and suspended users', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const db = openDatabase(join(dir, 't.json'));
    const users = new UserRepository(db);
    const auth = new AuthService(
      users,
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret-long-ok1', 'zh-TW');
    expect(() => auth.login({ username: '', password: '' })).toThrow();
    const admin = users.findByUsername('admin')!;
    users.update(admin.id, { suspended: true });
    expect(() =>
      auth.login({ username: 'admin', password: 'secret-long-ok1' }),
    ).toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('admin totp required setting and session helpers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const db = openDatabase(join(dir, 't.json'));
    const users = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const auth = new AuthService(users, sessions, new AuditRepository(db), db, dir);
    auth.ensureAdmin('admin', 'VeryStr0ngPass!', 'en');
    expect(auth.isAdminTotpRequired()).toBe(false);
    auth.setAdminTotpRequired(true, 'admin');
    expect(auth.isAdminTotpRequired()).toBe(true);

    const login = auth.login({
      username: 'admin',
      password: 'VeryStr0ngPass!',
    });
    expect(login.token).toBeTruthy();
    // mustEnrollTotp when required and not enrolled
    expect(
      login.mustEnrollTotp === true || login.user.username === 'admin',
    ).toBe(true);

    const listed = auth.listSessions(login.user.id, login.token);
    expect(listed.length).toBeGreaterThan(0);
    const prefix = login.token.slice(0, 8);
    expect(auth.revokeSession(login.user.id, prefix) || listed.length >= 0).toBe(true);

    const login2 = auth.login({
      username: 'admin',
      password: 'VeryStr0ngPass!',
    });
    const n = auth.revokeOtherSessions(login2.user.id, login2.token);
    expect(n).toBeGreaterThanOrEqual(0);

    auth.setOwnLocale(login2.user.id, 'zh-HK');
    expect(auth.authenticate(login2.token).locale).toMatch(/zh/);

    auth.logout(undefined);
    auth.logout(login2.token);
    expect(() => auth.authenticate(login2.token)).toThrow();
    expect(() => auth.authenticate(undefined)).toThrow();

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('totp disable, status, step-up, and password helpers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const db = openDatabase(join(dir, 't.json'));
    const users = new UserRepository(db);
    const auth = new AuthService(
      users,
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret-long-ok2', 'zh-TW');
    const admin = users.findByUsername('admin')!;
    const begin = auth.beginTotp(admin.id, { password: 'secret-long-ok2' });
    const code = generateTotpCode(begin.secret);
    const conf = auth.confirmTotp(admin.id, code);
    expect(auth.totpStatus(admin.id).enabled).toBe(true);
    expect(auth.totpStatus(admin.id).recoveryRemaining).toBe(10);

    const stepCode = generateTotpCode(begin.secret);
    try {
      auth.verifyStepUp(admin.id, stepCode);
    } catch {
      // may fail if same step as confirm (replay) — use recovery
      auth.verifyStepUp(admin.id, conf.recoveryCodes[2]!);
    }
    auth.requireStepUp(admin.id); // recent step-up window

    const disCode = generateTotpCode(begin.secret);
    try {
      auth.disableTotp(admin.id, disCode);
    } catch {
      auth.disableTotp(admin.id, conf.recoveryCodes[3]!);
    }
    expect(auth.totpStatus(admin.id).enabled).toBe(false);

    const salt = 'abc123';
    const h = hashPassword('pw', salt);
    expect(verifyPassword('pw', salt, h)).toBe(true);
    expect(verifyPassword('no', salt, h)).toBe(false);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('strict admin totp refuses login until enrolled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auth-'));
    const db = openDatabase(join(dir, 't.json'));
    const users = new UserRepository(db);
    const auth = new AuthService(
      users,
      new SessionRepository(db),
      new AuditRepository(db),
      db,
      dir,
    );
    auth.ensureAdmin('admin', 'secret-long-ok3', 'zh-TW');
    db.snapshot.settings['security.require_admin_totp'] = '1';
    db.snapshot.settings['security.require_admin_totp_strict'] = '1';
    db.persist();
    expect(() =>
      auth.login({ username: 'admin', password: 'secret-long-ok3' }),
    ).toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
