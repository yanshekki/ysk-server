/**
 * Encrypt panel TOTP secrets at rest (reuse SSH secrets master key).
 * Format: yskenc:v1:<base64(iv|tag|cipher)>
 */

import { encryptPrivateKey, decryptPrivateKey, resolveMasterKey } from '../ssh-identity/crypto.js';

const PREFIX = 'yskenc:v1:';

export function isEncryptedTotpSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function encryptTotpSecret(dataDir: string, userId: string, plain: string): string {
  const { key } = resolveMasterKey(dataDir);
  const blob = encryptPrivateKey(key, `totp:${userId}`, plain);
  return PREFIX + blob;
}

export function decryptTotpSecret(dataDir: string, userId: string, stored: string): string {
  if (!isEncryptedTotpSecret(stored)) return stored; // legacy plaintext
  const blob = stored.slice(PREFIX.length);
  const { key } = resolveMasterKey(dataDir);
  return decryptPrivateKey(key, `totp:${userId}`, blob);
}

/** Migrate plaintext → encrypted if needed */
export function ensureEncryptedTotpSecret(
  dataDir: string,
  userId: string,
  stored: string,
): { secret: string; migrated: string | null } {
  const plain = decryptTotpSecret(dataDir, userId, stored);
  if (isEncryptedTotpSecret(stored)) return { secret: plain, migrated: null };
  return { secret: plain, migrated: encryptTotpSecret(dataDir, userId, plain) };
}
