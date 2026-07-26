/**
 * Password hashes for mailboxes / Dovecot passdb.
 * Prefer SHA512-CRYPT ({SHA512-CRYPT}) via openssl when available;
 * fall back to YSK scrypt for managed store without openssl.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PasswordHashScheme = 'SHA512-CRYPT' | 'YSK-SCRYPT';

export interface PasswordHashResult {
  scheme: PasswordHashScheme;
  /** Value to store in passwd-file (includes scheme prefix when Dovecot-compatible) */
  hash: string;
  notes: string[];
}

/**
 * Hash a mailbox password for Dovecot passwd-file.
 */
export async function hashMailboxPassword(password: string): Promise<PasswordHashResult> {
  const notes: string[] = [];
  if (!password || password.length < 8) {
    throw new Error('密碼至少需要 8 字元');
  }

  // openssl passwd -6 → $6$... SHA512-CRYPT
  try {
    const { stdout } = await execFileAsync(
      'openssl',
      ['passwd', '-6', password],
      { timeout: 5_000, maxBuffer: 1024 },
    );
    const h = stdout.trim();
    if (h.startsWith('$6$')) {
      notes.push('已用 SHA512-CRYPT 雜湊密碼（Dovecot）');
      return {
        scheme: 'SHA512-CRYPT',
        hash: `{SHA512-CRYPT}${h}`,
        notes,
      };
    }
  } catch {
    notes.push('openssl 不可用，改用 YSK-SCRYPT 雜湊');
  }

  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  notes.push('使用 YSK-SCRYPT 後備雜湊（生產環境建議改為 openssl 雜湊）');
  return {
    scheme: 'YSK-SCRYPT',
    hash: `scrypt$${salt}$${hash}`,
    notes,
  };
}

/**
 * Synchronous scrypt-only hash (tests / no child process).
 */
export function hashMailboxPasswordSync(password: string): PasswordHashResult {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return {
    scheme: 'YSK-SCRYPT',
    hash: `scrypt$${salt}$${hash}`,
    notes: ['YSK-SCRYPT (sync)'],
  };
}
