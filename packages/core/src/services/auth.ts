/**
 * Persistent auth: scrypt password hashing + SQLite sessions + optional TOTP 2FA.
 */

import type { AuthLoginRequest, AuthLoginResponse, UserDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { UserRepository } from '../repositories/user-repo.js';
import type { SessionRepository } from '../repositories/session-repo.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotp,
} from '../security/totp.js';

const SCRYPT_KEYLEN = 64;

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit?: AuditRepository,
  ) {}

  /**
   * Bootstrap admin if no users exist (called by setup).
   */
  ensureAdmin(username: string, password: string, locale = 'zh-TW'): UserDto {
    const existing = this.users.findByUsername(username);
    if (existing) return toDto(existing);
    if (this.users.count() > 0 && !existing) {
      // admin username may differ; only create if zero users
    }
    if (this.users.count() > 0) {
      const first = this.users.findByUsername(username);
      if (first) return toDto(first);
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const now = new Date().toISOString();
    const user = {
      id: randomBytes(8).toString('hex'),
      username,
      password_hash: passwordHash,
      password_salt: salt,
      roles: ['admin'] as const,
      locale,
      created_at: now,
      updated_at: now,
    };
    this.users.insert({ ...user, roles: ['admin'] });
    this.audit?.append({
      actor: 'system',
      action: 'auth.ensureAdmin',
      resource: username,
      detail: { created: true },
      ok: true,
    });
    return { id: user.id, username, roles: ['admin'], locale };
  }

  login(req: AuthLoginRequest & { totp?: string }): AuthLoginResponse {
    if (!req.username || !req.password) {
      throw new YskError(ErrorCodes.VALIDATION, 'username and password required', {
        httpStatus: 400,
      });
    }
    const user = this.users.findByUsername(req.username);
    if (!user || !verifyPassword(req.password, user.password_salt, user.password_hash)) {
      this.audit?.append({
        actor: req.username,
        action: 'auth.login',
        detail: { ok: false },
        ok: false,
      });
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid credentials', { httpStatus: 401 });
    }
    if (user.suspended) {
      throw new YskError(ErrorCodes.FORBIDDEN, '帳戶已暫停', { httpStatus: 403 });
    }
    if (user.totp_enabled && user.totp_secret) {
      if (!req.totp || !verifyTotp(user.totp_secret, req.totp)) {
        this.audit?.append({
          actor: user.username,
          action: 'auth.login',
          detail: { ok: false, reason: 'totp' },
          ok: false,
        });
        throw new YskError(ErrorCodes.UNAUTHORIZED, '需要有效的雙重驗證碼', {
          httpStatus: 401,
          details: { needsTotp: true },
        });
      }
    }
    this.sessions.deleteExpired(new Date().toISOString());
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.sessions.insert({
      token,
      user_id: user.id,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    this.audit?.append({
      actor: user.username,
      action: 'auth.login',
      detail: { ok: true, totp: Boolean(user.totp_enabled) },
      ok: true,
    });
    return {
      token,
      user: toDto(user),
      expiresAt,
    };
  }

  /** Begin 2FA enrollment — returns secret + otpauth URL (not yet enabled). */
  beginTotp(userId: string): { secret: string; otpauthUrl: string; enabled: boolean } {
    const user = this.users.findById(userId);
    if (!user) {
      throw new YskError(ErrorCodes.NOT_FOUND, 'User not found', { httpStatus: 404 });
    }
    const secret = generateTotpSecret();
    this.users.updateTotp(userId, { totp_secret: secret, totp_enabled: false });
    return {
      secret,
      otpauthUrl: buildOtpAuthUrl({ secret, username: user.username }),
      enabled: false,
    };
  }

  /** Confirm enrollment with a valid code → enable 2FA. */
  confirmTotp(userId: string, code: string): { enabled: boolean } {
    const user = this.users.findById(userId);
    if (!user?.totp_secret) {
      throw new YskError(ErrorCodes.VALIDATION, '請先開始設定 2FA', { httpStatus: 400 });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      throw new YskError(ErrorCodes.VALIDATION, '驗證碼無效', { httpStatus: 400 });
    }
    this.users.updateTotp(userId, { totp_enabled: true });
    this.audit?.append({
      actor: user.username,
      action: 'auth.totp.enable',
      detail: {},
      ok: true,
    });
    return { enabled: true };
  }

  disableTotp(userId: string, code: string): { enabled: boolean } {
    const user = this.users.findById(userId);
    if (!user) {
      throw new YskError(ErrorCodes.NOT_FOUND, 'User not found', { httpStatus: 404 });
    }
    if (user.totp_enabled && user.totp_secret) {
      if (!verifyTotp(user.totp_secret, code)) {
        throw new YskError(ErrorCodes.VALIDATION, '驗證碼無效', { httpStatus: 400 });
      }
    }
    this.users.updateTotp(userId, { totp_secret: null, totp_enabled: false });
    this.audit?.append({
      actor: user.username,
      action: 'auth.totp.disable',
      detail: {},
      ok: true,
    });
    return { enabled: false };
  }

  totpStatus(userId: string): { enabled: boolean; enrolled: boolean } {
    const user = this.users.findById(userId);
    if (!user) {
      throw new YskError(ErrorCodes.NOT_FOUND, 'User not found', { httpStatus: 404 });
    }
    return {
      enabled: Boolean(user.totp_enabled),
      enrolled: Boolean(user.totp_secret),
    };
  }

  logout(token: string | undefined): void {
    if (!token) return;
    const session = this.sessions.find(token);
    this.sessions.delete(token);
    if (session) {
      const user = this.users.findById(session.user_id);
      this.audit?.append({
        actor: user?.username ?? 'unknown',
        action: 'auth.logout',
        detail: {},
        ok: true,
      });
    }
  }

  authenticate(token: string | undefined): UserDto {
    if (!token) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Missing token', { httpStatus: 401 });
    }
    const session = this.sessions.find(token);
    if (!session || session.expires_at < new Date().toISOString()) {
      if (session) this.sessions.delete(token);
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired token', { httpStatus: 401 });
    }
    const user = this.users.findById(session.user_id);
    if (!user) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'User not found', { httpStatus: 401 });
    }
    return toDto(user);
  }
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function toDto(user: {
  id: string;
  username: string;
  roles: UserDto['roles'];
  locale: string;
  totp_enabled?: boolean;
}): UserDto {
  return {
    id: user.id,
    username: user.username,
    roles: [...user.roles],
    locale: user.locale,
    totpEnabled: Boolean(user.totp_enabled),
  };
}
