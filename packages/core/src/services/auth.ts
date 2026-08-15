/**
 * Persistent auth: scrypt password hashing + sessions + TOTP 2FA (hardened).
 * - Login rate limit / lockout
 * - TOTP at-rest encryption (when dataDir set)
 * - Anti-replay (last step)
 * - Recovery codes (hashed)
 * - Step-up verification for sensitive ops
 */

import type { AuthLoginRequest, AuthLoginResponse, UserDto } from 'ysk-server-shared';
import { ErrorCodes, yskError, tl, normalizeLocale } from 'ysk-server-shared';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { UserRepository } from '../repositories/user-repo.js';
import type { SessionRepository } from '../repositories/session-repo.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { JsonStore } from '../db/store.js';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  matchTotpStep,
} from '../security/totp.js';
import { verifyApiKey, verifyApiKeyDetailed } from '../security/api-keys.js';
import {
  checkRateLimit,
  clearRateLimit,
  recordRateLimitFailure,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  encryptTotpSecret,
  ensureEncryptedTotpSecret,
  markTotpStepUp,
  hasRecentTotpStepUp,
  createRememberDeviceToken,
  verifyRememberDeviceToken,
} from '../security/mfa/index.js';
import { assessPassword, isBootstrapDefaultPassword } from '../security/password-policy.js';

const SCRYPT_KEYLEN = 64;
/** Absolute max session lifetime */
export const SESSION_ABS_MS = 24 * 60 * 60 * 1000;
/** Idle timeout — no activity */
export const SESSION_IDLE_MS = 4 * 60 * 60 * 1000;

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit?: AuditRepository,
    /** When set, Bearer ysk_* API keys authenticate as the owning user */
    private readonly db?: JsonStore,
    /** Enables secret encryption + optional rate-limit persist */
    private readonly dataDir?: string,
  ) {}

  /** settings key: security.require_admin_totp = "1" */
  isAdminTotpRequired(): boolean {
    const v = this.db?.snapshot.settings?.['security.require_admin_totp'];
    return v === '1' || v === 'true' || v === 'yes';
  }

  setAdminTotpRequired(on: boolean, actor?: string): void {
    if (!this.db) return;
    this.db.snapshot.settings['security.require_admin_totp'] = on ? '1' : '0';
    this.db.persist();
    this.audit?.append({
      actor: actor ?? 'system',
      action: 'auth.require_admin_totp',
      detail: { on },
      ok: true,
    });
  }

  /** settings key: security.require_user_totp = "1" — all panel users */
  isUserTotpRequired(): boolean {
    const v = this.db?.snapshot.settings?.['security.require_user_totp'];
    return v === '1' || v === 'true' || v === 'yes';
  }

  setUserTotpRequired(on: boolean, actor?: string): void {
    if (!this.db) return;
    this.db.snapshot.settings['security.require_user_totp'] = on ? '1' : '0';
    this.db.persist();
    this.audit?.append({
      actor: actor ?? 'system',
      action: 'auth.require_user_totp',
      detail: { on },
      ok: true,
    });
  }

  /** True when policy says this user must enroll TOTP. */
  userMustEnrollTotp(user: {
    roles: string[];
    totp_enabled?: boolean;
    totpEnabled?: boolean;
  }): boolean {
    const enabled = Boolean(user.totp_enabled ?? user.totpEnabled);
    if (enabled) return false;
    if (this.isUserTotpRequired()) return true;
    return this.isAdminTotpRequired() && user.roles.includes('admin');
  }

  /**
   * Bootstrap admin if no users exist (called by setup).
   */
  ensureAdmin(username: string, password: string, locale = 'zh-HK'): UserDto {
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
    const weak = !assessPassword(password).ok || isBootstrapDefaultPassword(password);
    const user = {
      id: randomBytes(8).toString('hex'),
      username,
      password_hash: passwordHash,
      password_salt: salt,
      roles: ['admin'] as const,
      locale,
      must_change_password: weak || undefined,
      created_at: now,
      updated_at: now,
    };
    this.users.insert({ ...user, roles: ['admin'] });
    this.audit?.append({
      actor: 'system',
      action: 'auth.ensureAdmin',
      resource: username,
      detail: { created: true, mustChangePassword: weak },
      ok: true,
    });
    return {
      id: user.id,
      username,
      roles: ['admin'],
      locale,
      mustChangePassword: weak || undefined,
    };
  }

  login(
    req: AuthLoginRequest & {
      totp?: string;
      recoveryCode?: string;
      /** skip TOTP if valid remember-device token */
      deviceToken?: string;
      /** after successful 2FA, issue device token */
      rememberDevice?: boolean;
    },
    meta?: { ip?: string; userAgent?: string },
  ): AuthLoginResponse & { deviceToken?: string; deviceExpiresAt?: string } {
    if (!req.username || !req.password) {
      throw yskError(ErrorCodes.VALIDATION, {
        httpStatus: 400,
        messageKey: 'errors.auth.needCredentials',
      });
    }
    const rlId = `${meta?.ip ?? 'local'}:${req.username}`;
    const locked = checkRateLimit('login', rlId);
    if (!locked.ok) {
      this.audit?.append({
        actor: req.username,
        action: 'auth.login',
        detail: { ok: false, reason: 'rate_limit', retryAfterSec: locked.retryAfterSec },
        ok: false,
      });
      throw yskError(ErrorCodes.RATE_LIMITED, {
        httpStatus: 429,
        messageKey: 'errors.auth.rateLimited',
        details: { retryAfterSec: locked.retryAfterSec, locked: true },
      });
    }

    const user = this.users.findByUsername(req.username);
    if (!user || !verifyPassword(req.password, user.password_salt, user.password_hash)) {
      const fail = recordRateLimitFailure('login', rlId);
      this.audit?.append({
        actor: req.username,
        action: 'auth.login',
        detail: { ok: false, failures: fail.failures, locked: fail.locked },
        ok: false,
      });
      throw yskError(ErrorCodes.UNAUTHORIZED, {
        httpStatus: 401,
        messageKey: 'errors.auth.badCredentials',
        details: fail.locked
          ? { locked: true, retryAfterSec: fail.retryAfterSec }
          : undefined,
      });
    }
    if (user.suspended) {
      throw yskError(ErrorCodes.FORBIDDEN, { httpStatus: 403, messageKey: 'errors.auth.accountSuspended' });
    }

    const mustEnrollTotp = this.userMustEnrollTotp(user);

    // Strict: refuse admin session until 2FA enabled (break-glass: clear setting in dataDir)
    const strict =
      this.db?.snapshot.settings?.['security.require_admin_totp_strict'] === '1';
    if (mustEnrollTotp && strict) {
      this.audit?.append({
        actor: user.username,
        action: 'auth.login',
        detail: { ok: false, reason: 'admin_totp_required_strict' },
        ok: false,
      });
      throw yskError(ErrorCodes.FORBIDDEN, {
        httpStatus: 403,
        messageKey: 'errors.auth.adminTotpStrict',
        details: { requireAdminTotp: true, needsTotpEnroll: true, strict: true },
      });
    }

    if (user.totp_enabled && user.totp_secret) {
      const secret = this.resolveTotpSecret(user.id, user.totp_secret);
      let okSecond = false;
      // Remember-device skip TOTP
      if (
        req.deviceToken &&
        this.dataDir &&
        this.db &&
        verifyRememberDeviceToken({
          dataDir: this.dataDir,
          db: this.db,
          userId: user.id,
          token: req.deviceToken,
        })
      ) {
        okSecond = true;
      } else if (req.recoveryCode?.trim()) {
        const hashes = user.totp_recovery_hashes ?? [];
        const cons = consumeRecoveryCode(hashes, req.recoveryCode);
        if (cons.ok) {
          this.users.updateTotp(user.id, { totp_recovery_hashes: cons.remaining });
          okSecond = true;
          this.audit?.append({
            actor: user.username,
            action: 'auth.login.recovery',
            detail: { remaining: cons.remaining.length },
            ok: true,
          });
        }
      } else if (req.totp) {
        const step = matchTotpStep(secret, req.totp);
        if (step != null) {
          if (user.totp_last_step != null && step <= user.totp_last_step) {
            recordRateLimitFailure('login', rlId);
            throw yskError(ErrorCodes.UNAUTHORIZED, {
              httpStatus: 401,
              messageKey: 'errors.auth.totpReplay',
              details: { needsTotp: true, replay: true },
            });
          }
          this.users.updateTotp(user.id, { totp_last_step: step });
          okSecond = true;
        }
      }
      if (!okSecond) {
        const fail = recordRateLimitFailure('login', rlId);
        this.audit?.append({
          actor: user.username,
          action: 'auth.login',
          detail: { ok: false, reason: 'totp', locked: fail.locked },
          ok: false,
        });
        throw yskError(ErrorCodes.TOTP_REQUIRED, {
          httpStatus: 401,
          messageKey: 'errors.auth.totpRequired',
          details: {
            needsTotp: true,
            ...(fail.locked
              ? { locked: true, retryAfterSec: fail.retryAfterSec }
              : {}),
          },
        });
      }
      markTotpStepUp(user.id);
    }

    clearRateLimit('login', rlId);
    this.sessions.deleteExpired(new Date().toISOString());
    const now = Date.now();
    const token = randomBytes(24).toString('hex');
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + SESSION_ABS_MS).toISOString();
    this.sessions.insert({
      token,
      user_id: user.id,
      expires_at: expiresAt,
      created_at: createdAt,
      last_seen_at: createdAt,
      ip: meta?.ip,
      user_agent: meta?.userAgent?.slice(0, 200),
    });
    this.audit?.append({
      actor: user.username,
      action: 'auth.login',
      detail: { ok: true, totp: Boolean(user.totp_enabled) },
      ok: true,
    });
    let deviceToken: string | undefined;
    let deviceExpiresAt: string | undefined;
    if (
      req.rememberDevice &&
      user.totp_enabled &&
      this.dataDir &&
      this.db &&
      (req.totp || req.recoveryCode)
    ) {
      const dev = createRememberDeviceToken({
        dataDir: this.dataDir,
        db: this.db,
        userId: user.id,
        userAgent: meta?.userAgent,
        ip: meta?.ip,
      });
      deviceToken = dev.token;
      deviceExpiresAt = dev.expiresAt;
    }
    // Detect bootstrap/weak password still in use (known weak list + flag)
    const passwordStillWeak =
      Boolean(user.must_change_password) ||
      isBootstrapDefaultPassword(req.password) ||
      !assessPassword(req.password).ok;
    if (passwordStillWeak && !user.must_change_password) {
      this.users.update(user.id, { must_change_password: true });
    }

    return {
      token,
      user: {
        ...toDto(user),
        mustChangePassword: passwordStillWeak || undefined,
      },
      expiresAt,
      ...(deviceToken ? { deviceToken, deviceExpiresAt } : {}),
      ...(passwordStillWeak
        ? {
            mustChangePassword: true as const,
            message:
              'Change the default/weak password before treating this host as production.',
          }
        : {}),
      ...(mustEnrollTotp
        ? { mustEnrollTotp: true as const, message: tl('errors.auth.mustEnrollTotp') }
        : {}),
    };
  }

  /**
   * Begin 2FA enrollment — requires password re-entry or recent step-up.
   */
  beginTotp(
    userId: string,
    opts?: { password?: string; totp?: string },
  ): { secret: string; otpauthUrl: string; enabled: boolean } {
    const user = this.users.findById(userId);
    if (!user) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    // Re-auth: password OR valid totp/step-up when already has 2FA
    const pwOk =
      Boolean(opts?.password) &&
      verifyPassword(opts!.password!, user.password_salt, user.password_hash);
    if (!pwOk) {
      if (user.totp_enabled && opts?.totp) {
        this.assertTotpOrRecovery(userId, opts.totp);
        markTotpStepUp(userId);
      } else if (!hasRecentTotpStepUp(userId)) {
        throw yskError(ErrorCodes.FORBIDDEN, {
          httpStatus: 403,
          messageKey: 'errors.auth.totpSetupNeedReauth',
          details: { needsReauth: true },
        });
      }
    }
    const secret = generateTotpSecret();
    const stored = this.dataDir
      ? encryptTotpSecret(this.dataDir, userId, secret)
      : secret;
    this.users.updateTotp(userId, {
      totp_secret: stored,
      totp_enabled: false,
      totp_last_step: null,
      totp_recovery_hashes: null,
    });
    return {
      secret,
      otpauthUrl: buildOtpAuthUrl({ secret, username: user.username }),
      enabled: false,
    };
  }

  listSessions(userId: string, currentToken?: string) {
    return this.sessions.listPublic(userId, currentToken);
  }

  revokeSession(userId: string, sessionIdPrefix: string): boolean {
    const ok = this.sessions.deleteByIdPrefix(userId, sessionIdPrefix);
    if (ok) {
      const user = this.users.findById(userId);
      this.audit?.append({
        actor: user?.username ?? userId,
        action: 'auth.session.revoke',
        detail: { id: sessionIdPrefix },
        ok: true,
      });
    }
    return ok;
  }

  revokeOtherSessions(userId: string, keepToken: string): number {
    const n = this.sessions.deleteOthers(userId, keepToken);
    const user = this.users.findById(userId);
    this.audit?.append({
      actor: user?.username ?? userId,
      action: 'auth.session.revoke_others',
      detail: { count: n },
      ok: true,
    });
    return n;
  }

  /**
   * Confirm enrollment with a valid code → enable 2FA.
   * Returns one-time recovery codes (plaintext once).
   */
  confirmTotp(
    userId: string,
    code: string,
  ): { enabled: boolean; recoveryCodes: string[] } {
    const user = this.users.findById(userId);
    if (!user?.totp_secret) {
      throw yskError(ErrorCodes.VALIDATION, { httpStatus: 400, messageKey: 'errors.auth.totpBeginFirst' });
    }
    const secret = this.resolveTotpSecret(userId, user.totp_secret);
    const step = matchTotpStep(secret, code);
    if (step == null) {
      throw yskError(ErrorCodes.VALIDATION, { httpStatus: 400, messageKey: 'errors.auth.totpInvalid' });
    }
    const recoveryCodes = generateRecoveryCodes(10);
    const hashes = recoveryCodes.map(hashRecoveryCode);
    this.users.updateTotp(userId, {
      totp_enabled: true,
      totp_last_step: step,
      totp_recovery_hashes: hashes,
    });
    markTotpStepUp(userId);
    this.audit?.append({
      actor: user.username,
      action: 'auth.totp.enable',
      detail: { recoveryCount: recoveryCodes.length },
      ok: true,
    });
    return { enabled: true, recoveryCodes };
  }

  disableTotp(userId: string, code: string): { enabled: boolean } {
    const user = this.users.findById(userId);
    if (!user) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    if (user.totp_enabled && user.totp_secret) {
      this.assertTotpOrRecovery(userId, code);
    }
    this.users.updateTotp(userId, {
      totp_secret: null,
      totp_enabled: false,
      totp_last_step: null,
      totp_recovery_hashes: null,
    });
    this.audit?.append({
      actor: user.username,
      action: 'auth.totp.disable',
      detail: {},
      ok: true,
    });
    return { enabled: false };
  }

  /**
   * Admin clears another user's 2FA (per-user secret only — never shared).
   * Actor must already have step-up (caller enforces totp on request).
   */
  adminClearUserTotp(
    actorUserId: string,
    targetUserId: string,
  ): { cleared: boolean; username: string } {
    const actor = this.users.findById(actorUserId);
    const target = this.users.findById(targetUserId);
    if (!actor || !target) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    const had =
      Boolean(target.totp_enabled) ||
      Boolean(target.totp_secret) ||
      (target.totp_recovery_hashes?.length ?? 0) > 0;
    this.users.updateTotp(targetUserId, {
      totp_secret: null,
      totp_enabled: false,
      totp_last_step: null,
      totp_recovery_hashes: null,
    });
    this.audit?.append({
      actor: actor.username,
      action: 'users.totp.clear',
      resource: target.username,
      detail: { targetId: targetUserId, had2fa: had },
      ok: true,
    });
    return { cleared: had, username: target.username };
  }

  /** Public security summary for a user (no secrets). */
  userSecuritySummary(userId: string): {
    totpEnabled: boolean;
    totpEnrolled: boolean;
    recoveryRemaining: number;
    sessionCount: number;
  } {
    const st = this.totpStatus(userId);
    const sessions = this.sessions.listPublic(userId);
    return {
      totpEnabled: st.enabled,
      totpEnrolled: st.enrolled,
      recoveryRemaining: st.recoveryRemaining,
      sessionCount: sessions.length,
    };
  }

  totpStatus(userId: string): {
    enabled: boolean;
    enrolled: boolean;
    recoveryRemaining: number;
  } {
    const user = this.users.findById(userId);
    if (!user) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    return {
      enabled: Boolean(user.totp_enabled),
      enrolled: Boolean(user.totp_secret),
      recoveryRemaining: (user.totp_recovery_hashes ?? []).length,
    };
  }

  /**
   * Verify TOTP (or recovery) for step-up; marks recent step-up window.
   */
  verifyStepUp(userId: string, code: string): { ok: true } {
    this.assertTotpOrRecovery(userId, code);
    markTotpStepUp(userId);
    return { ok: true };
  }

  /** Throw unless recent step-up or valid code provided. */
  requireStepUp(userId: string, code?: string): void {
    if (hasRecentTotpStepUp(userId)) return;
    if (code?.trim()) {
      this.assertTotpOrRecovery(userId, code);
      markTotpStepUp(userId);
      return;
    }
    const user = this.users.findById(userId);
    if (!user?.totp_enabled) return; // no 2FA → no step-up gate
    throw yskError(ErrorCodes.FORBIDDEN, {
      messageKey: 'errors.auth.stepUpRequired',
      httpStatus: 403,
      details: { needsStepUp: true },
    });
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


  /**
   * Self-service password change. Clears must_change_password on success.
   */
  changeOwnPassword(userId: string, currentPassword: string, nextPassword: string): UserDto {
    const user = this.users.findById(userId);
    if (!user) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      throw yskError(ErrorCodes.UNAUTHORIZED, {
        httpStatus: 401,
        messageKey: 'errors.auth.badCredentials',
      });
    }
    const policy = assessPassword(nextPassword);
    if (!policy.ok || isBootstrapDefaultPassword(nextPassword)) {
      throw yskError(ErrorCodes.VALIDATION, {
        httpStatus: 400,
        messageKey: 'errors.auth.needCredentials',
        details: { reasons: policy.reasons },
      });
    }
    const salt = randomBytes(16).toString('hex');
    const password_hash = hashPassword(nextPassword, salt);
    const updated = this.users.update(userId, {
      password_hash,
      password_salt: salt,
      must_change_password: false,
    });
    if (!updated) {
      throw yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404, messageKey: 'errors.auth.userNotFound' });
    }
    this.audit?.append({
      actor: user.username,
      action: 'auth.password.change',
      detail: { self: true },
      ok: true,
    });
    return toDto(updated);
  }

  /**
   * Authenticate + optional API-key read-only flag (for HTTP mutation gate).
   */
  authenticateDetailed(token: string | undefined): {
    user: UserDto;
    apiKeyReadOnly?: boolean;
    viaApiKey?: boolean;
  } {
    if (!token) {
      throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.missingCredential' });
    }
    if (this.db && token.startsWith('ysk_')) {
      const detailed = verifyApiKeyDetailed(this.db, token);
      if (!detailed) {
        throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.apiKeyInvalid' });
      }
      const user = this.users.findById(detailed.userId);
      if (!user) {
        throw yskError(ErrorCodes.UNAUTHORIZED, {
          messageKey: 'errors.auth.apiKeyUserMissing',
          httpStatus: 401,
        });
      }
      if (user.suspended) {
        throw yskError(ErrorCodes.FORBIDDEN, { httpStatus: 403, messageKey: 'errors.auth.accountSuspended' });
      }
      return {
        user: toDto(user),
        apiKeyReadOnly: detailed.readOnly,
        viaApiKey: true,
      };
    }
    return { user: this.authenticate(token), viaApiKey: false };
  }

  authenticate(token: string | undefined): UserDto {
    if (!token) {
      throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.missingCredential' });
    }
    // API access keys (ysk_…) — hash lookup, no session cookie
    if (this.db && token.startsWith('ysk_')) {
      const userId = verifyApiKey(this.db, token);
      if (userId) {
        const user = this.users.findById(userId);
        if (!user) {
          throw yskError(ErrorCodes.UNAUTHORIZED, {
          messageKey: 'errors.auth.apiKeyUserMissing',
            httpStatus: 401,
          });
        }
        if (user.suspended) {
          throw yskError(ErrorCodes.FORBIDDEN, { httpStatus: 403, messageKey: 'errors.auth.accountSuspended' });
        }
        return toDto(user);
      }
      throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.apiKeyInvalid' });
    }
    const session = this.sessions.find(token);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    if (!session || session.expires_at < nowIso) {
      if (session) this.sessions.delete(token);
      throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.sessionExpired' });
    }
    // Idle timeout
    const last = Date.parse(session.last_seen_at ?? session.created_at);
    if (Number.isFinite(last) && now - last > SESSION_IDLE_MS) {
      this.sessions.delete(token);
      throw yskError(ErrorCodes.UNAUTHORIZED, {
        messageKey: 'errors.auth.sessionIdle',
        httpStatus: 401,
        details: { idleTimeout: true },
      });
    }
    // Touch at most every 60s to reduce writes
    const lastSeen = Date.parse(session.last_seen_at ?? '0');
    if (!Number.isFinite(lastSeen) || now - lastSeen > 60_000) {
      this.sessions.touch(token, nowIso);
    }
    const user = this.users.findById(session.user_id);
    if (!user) {
      throw yskError(ErrorCodes.UNAUTHORIZED, { httpStatus: 401, messageKey: 'errors.auth.userNotFound' });
    }
    return toDto(user);
  }


  /** Persist UI locale for the signed-in user (self-service). */
  setOwnLocale(userId: string, locale: string): UserDto {
    const code = normalizeLocale(locale);
    const u = this.users.update(userId, { locale: code });
    if (!u) {
      throw yskError(ErrorCodes.NOT_FOUND, {
        httpStatus: 404,
        messageKey: 'errors.auth.userNotFound',
      });
    }
    return toDto(u);
  }

  private resolveTotpSecret(userId: string, stored: string): string {
    if (!this.dataDir) {
      // migrate path unavailable — accept plain
      return stored.startsWith('yskenc:')
        ? (() => {
            throw yskError(ErrorCodes.INTERNAL, {
              httpStatus: 500,
              messageKey: 'errors.auth.totpSecretNoDataDir',
            });
          })()
        : stored;
    }
    const { secret, migrated } = ensureEncryptedTotpSecret(this.dataDir, userId, stored);
    if (migrated) {
      this.users.updateTotp(userId, { totp_secret: migrated });
    }
    return secret;
  }

  private assertTotpOrRecovery(userId: string, code: string): void {
    const user = this.users.findById(userId);
    if (!user?.totp_secret) {
      throw yskError(ErrorCodes.VALIDATION, { httpStatus: 400, messageKey: 'errors.auth.totpNotEnabled' });
    }
    const secret = this.resolveTotpSecret(userId, user.totp_secret);
    // recovery code format has dashes
    if (code.includes('-') || code.length > 8) {
      const cons = consumeRecoveryCode(user.totp_recovery_hashes ?? [], code);
      if (cons.ok) {
        this.users.updateTotp(userId, { totp_recovery_hashes: cons.remaining });
        return;
      }
    }
    const step = matchTotpStep(secret, code);
    if (step == null) {
      throw yskError(ErrorCodes.VALIDATION, { httpStatus: 400, messageKey: 'errors.auth.totpInvalid' });
    }
    if (user.totp_last_step != null && step <= user.totp_last_step) {
      throw yskError(ErrorCodes.VALIDATION, {
        messageKey: 'errors.auth.totpReplay',
        httpStatus: 400,
      });
    }
    this.users.updateTotp(userId, { totp_last_step: step });
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
  must_change_password?: boolean;
  capability_grants?: UserDto['capabilityGrants'];
  capability_revokes?: UserDto['capabilityRevokes'];
}): UserDto {
  return {
    id: user.id,
    username: user.username,
    roles: [...user.roles],
    locale: user.locale,
    totpEnabled: Boolean(user.totp_enabled),
    mustChangePassword: Boolean(user.must_change_password) || undefined,
    capabilityGrants: user.capability_grants?.length ? [...user.capability_grants] : undefined,
    capabilityRevokes: user.capability_revokes?.length ? [...user.capability_revokes] : undefined,
  };
}
