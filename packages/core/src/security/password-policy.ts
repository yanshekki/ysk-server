/**
 * Bootstrap / panel password policy — weak & default detection.
 * Used by setup, login flags, readiness.
 */

/** Well-known insecure bootstrap passwords (never allow in production without override). */
export const WEAK_PASSWORDS = new Set(
  [
    'admin',
    'password',
    'password1',
    '12345678',
    '123456789',
    'ysk',
    'ysk-server',
    'changeme',
    'default',
    'root',
    'toor',
    'passw0rd',
    'admin123',
    'admin1234',
  ].map((s) => s.toLowerCase()),
);

export type PasswordPolicyResult = {
  ok: boolean;
  weak: boolean;
  tooShort: boolean;
  reasons: string[];
};

/** Minimum length for panel passwords */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate a candidate panel password (setup / change).
 * Returns ok=false when weak or too short.
 */
export function assessPassword(password: string): PasswordPolicyResult {
  const reasons: string[] = [];
  const p = password ?? '';
  const tooShort = p.length < MIN_PASSWORD_LENGTH;
  if (tooShort) reasons.push(`min_length_${MIN_PASSWORD_LENGTH}`);
  const weak = WEAK_PASSWORDS.has(p.toLowerCase()) || p.length > 0 && /^[0-9]+$/.test(p);
  if (WEAK_PASSWORDS.has(p.toLowerCase())) reasons.push('known_weak');
  if (/^[0-9]+$/.test(p) && p.length > 0) reasons.push('digits_only');
  return {
    ok: !tooShort && !weak,
    weak: weak || tooShort,
    tooShort,
    reasons,
  };
}

/** True if password is the classic bootstrap default. */
export function isBootstrapDefaultPassword(password: string): boolean {
  return (password ?? '').toLowerCase() === 'admin';
}
