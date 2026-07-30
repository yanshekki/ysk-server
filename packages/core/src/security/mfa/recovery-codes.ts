/**
 * One-time recovery codes — store only SHA-256 hashes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 8 groups of 4 hex → easy to type: abcd-ef01-...
    const raw = randomBytes(8).toString('hex');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  const norm = code.trim().toLowerCase().replace(/\s+/g, '');
  return createHash('sha256').update(norm).digest('hex');
}

export function consumeRecoveryCode(
  hashes: string[],
  code: string,
): { ok: boolean; remaining: string[] } {
  const h = hashRecoveryCode(code);
  const next: string[] = [];
  let ok = false;
  for (const stored of hashes) {
    try {
      const a = Buffer.from(stored, 'hex');
      const b = Buffer.from(h, 'hex');
      if (!ok && a.length === b.length && timingSafeEqual(a, b)) {
        ok = true;
        continue; // drop used
      }
    } catch {
      /* keep */
    }
    next.push(stored);
  }
  return { ok, remaining: next };
}
