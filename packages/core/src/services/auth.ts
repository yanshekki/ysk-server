/**
 * Basic auth service for Web UI (token-based MVP).
 */

import type { AuthLoginRequest, AuthLoginResponse, UserDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  roles: UserDto['roles'];
  locale: string;
}

export class AuthService {
  private readonly users = new Map<string, StoredUser>();
  private readonly tokens = new Map<string, { userId: string; expiresAt: number }>();

  /**
   * Bootstrap default admin (used by setup).
   */
  ensureAdmin(username: string, password: string, locale = 'zh-TW'): UserDto {
    const existing = [...this.users.values()].find((u) => u.username === username);
    if (existing) {
      return toDto(existing);
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const user: StoredUser = {
      id: randomBytes(8).toString('hex'),
      username,
      passwordHash,
      salt,
      roles: ['admin'],
      locale,
    };
    this.users.set(user.id, user);
    return toDto(user);
  }

  login(req: AuthLoginRequest): AuthLoginResponse {
    if (!req.username || !req.password) {
      throw new YskError(ErrorCodes.VALIDATION, 'username and password required', {
        httpStatus: 400,
      });
    }
    const user = [...this.users.values()].find((u) => u.username === req.username);
    if (!user || !verifyPassword(req.password, user.salt, user.passwordHash)) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid credentials', { httpStatus: 401 });
    }
    const token = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    this.tokens.set(token, { userId: user.id, expiresAt });
    return {
      token,
      user: toDto(user),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  authenticate(token: string | undefined): UserDto {
    if (!token) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Missing token', { httpStatus: 401 });
    }
    const session = this.tokens.get(token);
    if (!session || session.expiresAt < Date.now()) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired token', { httpStatus: 401 });
    }
    const user = this.users.get(session.userId);
    if (!user) {
      throw new YskError(ErrorCodes.UNAUTHORIZED, 'User not found', { httpStatus: 401 });
    }
    return toDto(user);
  }
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = hashPassword(password, salt);
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

function toDto(user: StoredUser): UserDto {
  return {
    id: user.id,
    username: user.username,
    roles: [...user.roles],
    locale: user.locale,
  };
}
