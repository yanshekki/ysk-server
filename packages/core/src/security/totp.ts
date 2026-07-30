/**
 * RFC 6238 TOTP (SHA-1, 30s, 6 digits) — no external deps.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  return base32Encode(buf);
}

export function buildOtpAuthUrl(opts: {
  secret: string;
  username: string;
  issuer?: string;
}): string {
  const issuer = opts.issuer ?? 'YSK Server';
  const label = encodeURIComponent(`${issuer}:${opts.username}`);
  const q = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Verify 6-digit code with ±1 step window. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  return matchTotpStep(secret, code, nowMs) != null;
}

/** Like verifyTotp but returns the matched time-step (for anti-replay). */
export function matchTotpStep(
  secret: string,
  code: string,
  nowMs = Date.now(),
): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = Math.floor(nowMs / 1000 / 30);
  for (const s of [step - 1, step, step + 1]) {
    const expected = generateTotpCode(secret, s);
    if (equalDigits(clean, expected)) return s;
  }
  return null;
}

export function generateTotpCode(secret: string, counter?: number): string {
  const step = counter ?? Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const otp = bin % 1_000_000;
  return String(otp).padStart(6, '0');
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function equalDigits(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}
