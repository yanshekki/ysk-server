import { describe, expect, it } from 'vitest';
import { YskError } from 'ysk-server-shared';
import {
  acceptedChromePathOrEmpty,
  isSafeChromePath,
  sanitizeChromePathInput,
} from './chrome-path.js';
import { mergeHostBrowsePolicy } from './types.js';

describe('chrome path allowlist', () => {
  it('accepts packaged Chromium / Chrome locations', () => {
    expect(isSafeChromePath('/usr/bin/google-chrome-stable')).toBe(true);
    expect(isSafeChromePath('/usr/bin/chromium')).toBe(true);
    expect(isSafeChromePath('/snap/bin/chromium')).toBe(true);
    expect(isSafeChromePath('/opt/google/chrome/chrome')).toBe(true);
    expect(isSafeChromePath('/usr/lib/chromium/chromium')).toBe(true);
  });

  it('rejects home, tmp, dataDir, and non-browser basenames', () => {
    expect(isSafeChromePath('/tmp/google-chrome')).toBe(false);
    expect(isSafeChromePath('/home/ops/chromium')).toBe(false);
    expect(isSafeChromePath('/usr/bin/bash')).toBe(false);
    expect(isSafeChromePath('/usr/bin/../../../tmp/google-chrome')).toBe(false);
    expect(isSafeChromePath('google-chrome')).toBe(false);
    expect(isSafeChromePath('/usr/bin/google-chrome\n/tmp/x')).toBe(false);
  });

  it('sanitize throws on non-empty invalid; empty is unset', () => {
    expect(sanitizeChromePathInput('')).toBe('');
    expect(sanitizeChromePathInput('  ')).toBe('');
    expect(sanitizeChromePathInput('/usr/bin/chromium')).toBe('/usr/bin/chromium');
    expect(() => sanitizeChromePathInput('/tmp/evil')).toThrow(YskError);
  });

  it('merge drops a stored or env path that is not allowlisted', () => {
    const pol = mergeHostBrowsePolicy(
      {},
      { chromePath: '/tmp/google-chrome' },
      { YSK_HOST_BROWSE_CHROME: '/home/x/chromium' },
    );
    expect(pol.chromePath).toBeUndefined();
    const ok = mergeHostBrowsePolicy(
      {},
      { chromePath: '/usr/bin/google-chrome-stable' },
      {},
    );
    expect(ok.chromePath).toBe('/usr/bin/google-chrome-stable');
  });

  it('acceptedChromePathOrEmpty ignores junk', () => {
    expect(acceptedChromePathOrEmpty('/etc/passwd')).toBeUndefined();
    expect(acceptedChromePathOrEmpty('/usr/bin/chromium')).toBe(
      '/usr/bin/chromium',
    );
  });
});
