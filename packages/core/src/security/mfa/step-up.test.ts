import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetStepUpForTests,
  clearTotpStepUp,
  hasRecentTotpStepUp,
  markTotpStepUp,
} from './step-up.js';

describe('step-up', () => {
  beforeEach(() => _resetStepUpForTests());

  it('is false until marked', () => {
    expect(hasRecentTotpStepUp('alice')).toBe(false);
  });

  it('returns true within default maxAge after mark', () => {
    const t0 = 1_700_000_000_000;
    markTotpStepUp('alice', t0);
    expect(hasRecentTotpStepUp('alice', 5 * 60_000, t0 + 1000)).toBe(true);
    expect(hasRecentTotpStepUp('alice', 5 * 60_000, t0 + 5 * 60_000)).toBe(true);
  });

  it('expires and deletes after maxAge', () => {
    const t0 = 2_000_000_000_000;
    markTotpStepUp('bob', t0);
    expect(hasRecentTotpStepUp('bob', 60_000, t0 + 60_001)).toBe(false);
    // already deleted — still false
    expect(hasRecentTotpStepUp('bob', 60_000, t0 + 60_002)).toBe(false);
  });

  it('isolates users and clear removes one user', () => {
    const t0 = 3_000_000_000_000;
    markTotpStepUp('a', t0);
    markTotpStepUp('b', t0);
    clearTotpStepUp('a');
    expect(hasRecentTotpStepUp('a', 60_000, t0 + 1)).toBe(false);
    expect(hasRecentTotpStepUp('b', 60_000, t0 + 1)).toBe(true);
  });

  it('re-mark refreshes timestamp', () => {
    const t0 = 4_000_000_000_000;
    markTotpStepUp('carol', t0);
    markTotpStepUp('carol', t0 + 50_000);
    expect(hasRecentTotpStepUp('carol', 60_000, t0 + 100_000)).toBe(true);
  });
});
