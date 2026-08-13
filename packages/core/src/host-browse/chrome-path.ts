/**
 * Allowlist Chrome/Chromium executablePath so panel settings cannot launch
 * an arbitrary binary as the control-plane user (no EXECUTE required).
 */

import { posix } from 'node:path';
import { ErrorCodes, YskError } from 'ysk-server-shared';

export const ALLOWED_CHROME_BASENAMES = new Set([
  'google-chrome',
  'google-chrome-stable',
  'google-chrome-beta',
  'google-chrome-unstable',
  'google-chrome-dev',
  'chromium',
  'chromium-browser',
  'chrome',
  'chrome-headless-shell',
]);

/** Prefixes of packaged / distro browsers (not home, tmp, or dataDir). */
export const ALLOWED_CHROME_PREFIXES = [
  '/usr/bin/',
  '/usr/lib/',
  '/usr/local/bin/',
  '/opt/google/chrome/',
  '/opt/google/chrome-beta/',
  '/opt/google/chrome-unstable/',
  '/opt/chromium.org/chromium/',
  '/opt/chromium/',
  '/snap/bin/',
  '/snap/chromium/',
  '/snap/google-chrome/',
] as const;

function normalizeAbs(raw: string): string {
  return posix.normalize(raw.trim());
}

export function isSafeChromePath(raw: string): boolean {
  const p = String(raw ?? '').trim();
  if (!p) return false;
  if (p.includes('\0') || /[\n\r]/.test(p)) return false;
  if (!p.startsWith('/')) return false;
  const norm = normalizeAbs(p);
  if (!norm.startsWith('/') || norm.includes('..')) return false;
  const base = posix.basename(norm);
  if (!base || base === '.' || base === '..') return false;
  if (!ALLOWED_CHROME_BASENAMES.has(base)) return false;
  return ALLOWED_CHROME_PREFIXES.some((pref) => {
    const dir = pref.endsWith('/') ? pref.slice(0, -1) : pref;
    return norm === dir || norm.startsWith(pref);
  });
}

/** Empty → unset. Non-empty invalid → throw (settings POST). */
export function sanitizeChromePathInput(raw: unknown): string {
  const p = String(raw ?? '').trim();
  if (!p) return '';
  if (!isSafeChromePath(p)) {
    throw new YskError(
      ErrorCodes.VALIDATION,
      'Chrome path is not an allowed browser binary',
      {
        httpStatus: 400,
        details: { field: 'chromePath', reason: 'not_allowlisted' },
      },
    );
  }
  return normalizeAbs(p);
}

/** Drop invalid env / stored override; launch falls back to probe. */
export function acceptedChromePathOrEmpty(
  raw: string | undefined | null,
): string | undefined {
  const p = String(raw ?? '').trim();
  if (!p) return undefined;
  return isSafeChromePath(p) ? normalizeAbs(p) : undefined;
}
