/**
 * Master-key bootstrap + AES-256-GCM for SSH private keys at rest.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;

export function secretsSshDir(dataDir: string): string {
  return join(dataDir, 'secrets', 'ssh');
}

export function masterKeyPath(dataDir: string): string {
  return join(secretsSshDir(dataDir), '.master.key');
}

/**
 * Resolve 32-byte master key.
 * Prefer YSK_SECRETS_KEY (base64 or hex or raw 32-byte string);
 * else load or create dataDir/secrets/ssh/.master.key.
 */
export function resolveMasterKey(dataDir: string): {
  key: Buffer;
  source: 'env' | 'file' | 'generated';
  path?: string;
} {
  const env = process.env.YSK_SECRETS_KEY?.trim();
  if (env) {
    const key = decodeKeyMaterial(env);
    if (key.length !== KEY_LEN) {
      throw new Error(
        `YSK_SECRETS_KEY must decode to ${KEY_LEN} bytes (got ${key.length}); use base64 or 64-char hex`,
      );
    }
    return { key, source: 'env' };
  }

  const dir = secretsSshDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = masterKeyPath(dataDir);
  if (existsSync(path)) {
    const raw = readFileSync(path);
    // file may be raw 32 bytes or base64 text
    let key: Buffer;
    if (raw.length === KEY_LEN) {
      key = raw;
    } else {
      key = decodeKeyMaterial(raw.toString('utf8').trim());
    }
    if (key.length !== KEY_LEN) {
      throw new Error(`Invalid master key file ${path}: expected ${KEY_LEN} bytes`);
    }
    return { key, source: 'file', path };
  }

  const key = randomBytes(KEY_LEN);
  writeFileSync(path, key, { mode: 0o400 });
  try {
    chmodSync(path, 0o400);
  } catch {
    /* ignore */
  }
  return { key, source: 'generated', path };
}

function decodeKeyMaterial(s: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, 'hex');
  }
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === KEY_LEN) return b;
  } catch {
    /* fall through */
  }
  // derive from passphrase-like string (stable, not ideal but usable in dev)
  if (s.length > 0 && s.length !== KEY_LEN) {
    return createHash('sha256').update(s).digest();
  }
  return Buffer.from(s, 'utf8');
}

/**
 * Encrypt plaintext private key. AAD binds ciphertext to identity id.
 * Format: base64(iv || authTag || ciphertext)
 */
export function encryptPrivateKey(
  masterKey: Buffer,
  identityId: string,
  privateKeyPem: string,
): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  cipher.setAAD(Buffer.from(identityId, 'utf8'));
  const enc = Buffer.concat([cipher.update(privateKeyPem, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptPrivateKey(
  masterKey: Buffer,
  identityId: string,
  privateKeyEnc: string,
): string {
  const buf = Buffer.from(privateKeyEnc, 'base64');
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error('Invalid privateKeyEnc blob');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAAD(Buffer.from(identityId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Constant-time compare for optional checks */
export function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
