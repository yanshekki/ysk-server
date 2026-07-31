import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
  _resetRateLimitsForTests,
  persistRateLimits,
  loadRateLimits,
} from './rate-limit.js';

describe('rate-limit', () => {
  beforeEach(() => _resetRateLimitsForTests());

  it('allows until max failures then locks', () => {
    const cfg = { maxFailures: 3, windowMs: 60_000, lockMs: 30_000 };
    const t0 = 1_000_000;
    expect(checkRateLimit('login', 'alice', cfg, t0).ok).toBe(true);
    expect(recordRateLimitFailure('login', 'alice', cfg, t0).locked).toBe(false);
    expect(recordRateLimitFailure('login', 'alice', cfg, t0 + 1).locked).toBe(false);
    const locked = recordRateLimitFailure('login', 'alice', cfg, t0 + 2);
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterSec).toBe(30);
    const blocked = checkRateLimit('login', 'alice', cfg, t0 + 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('clears lock after lockMs elapses', () => {
    const cfg = { maxFailures: 1, windowMs: 60_000, lockMs: 1000 };
    const t0 = 2_000_000;
    recordRateLimitFailure('totp', 'bob', cfg, t0);
    expect(checkRateLimit('totp', 'bob', cfg, t0 + 10).ok).toBe(false);
    expect(checkRateLimit('totp', 'bob', cfg, t0 + 1001).ok).toBe(true);
  });

  it('clearRateLimit removes bucket', () => {
    const cfg = { maxFailures: 1, windowMs: 60_000, lockMs: 60_000 };
    recordRateLimitFailure('login', 'carol', cfg, 100);
    clearRateLimit('login', 'carol');
    expect(checkRateLimit('login', 'carol', cfg, 200).ok).toBe(true);
  });

  it('persist and load across process map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rl-'));
    const cfg = { maxFailures: 1, windowMs: 60_000, lockMs: 60_000 };
    const now = Date.now();
    recordRateLimitFailure('login', 'dave', cfg, now);
    persistRateLimits(dir);
    expect(existsSync(join(dir, 'secrets', 'rate-limits.json'))).toBe(true);
    _resetRateLimitsForTests();
    expect(checkRateLimit('login', 'dave', cfg, now + 1).ok).toBe(true);
    loadRateLimits(dir);
    expect(checkRateLimit('login', 'dave', cfg, now + 2).ok).toBe(false);
    const raw = JSON.parse(readFileSync(join(dir, 'secrets', 'rate-limits.json'), 'utf8'));
    expect(raw['login:dave']).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadRateLimits ignores missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rl-empty-'));
    expect(() => loadRateLimits(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
