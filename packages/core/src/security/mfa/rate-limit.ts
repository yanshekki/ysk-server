/**
 * Sliding-window failure counter + temporary lockout (login / TOTP).
 * In-memory; optional JSON file under dataDir for restart persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type RateLimitConfig = {
  /** max failures before lock */
  maxFailures?: number;
  /** window to count failures (ms) */
  windowMs?: number;
  /** lock duration after threshold (ms) */
  lockMs?: number;
};

const DEFAULTS: Required<RateLimitConfig> = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

type Bucket = {
  fails: number[];
  lockedUntil?: number;
};

const globalMap = new Map<string, Bucket>();

function keyOf(scope: string, id: string): string {
  return `${scope}:${id.toLowerCase()}`;
}

export function checkRateLimit(
  scope: string,
  id: string,
  cfg: RateLimitConfig = {},
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number; lockedUntil: number } {
  void cfg;
  const k = keyOf(scope, id);
  const b = globalMap.get(k) ?? { fails: [] };
  if (b.lockedUntil && b.lockedUntil > now) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000),
      lockedUntil: b.lockedUntil,
    };
  }
  if (b.lockedUntil && b.lockedUntil <= now) {
    b.lockedUntil = undefined;
    b.fails = [];
  }
  globalMap.set(k, b);
  return { ok: true };
}

export function recordRateLimitFailure(
  scope: string,
  id: string,
  cfg: RateLimitConfig = {},
  now = Date.now(),
): { locked: boolean; failures: number; retryAfterSec?: number } {
  const c = { ...DEFAULTS, ...cfg };
  const k = keyOf(scope, id);
  const b = globalMap.get(k) ?? { fails: [] };
  b.fails = b.fails.filter((t) => now - t < c.windowMs);
  b.fails.push(now);
  if (b.fails.length >= c.maxFailures) {
    b.lockedUntil = now + c.lockMs;
    b.fails = [];
    globalMap.set(k, b);
    return {
      locked: true,
      failures: c.maxFailures,
      retryAfterSec: Math.ceil(c.lockMs / 1000),
    };
  }
  globalMap.set(k, b);
  return { locked: false, failures: b.fails.length };
}

export function clearRateLimit(scope: string, id: string): void {
  globalMap.delete(keyOf(scope, id));
}

/** Test helper */
export function _resetRateLimitsForTests(): void {
  globalMap.clear();
}

export function persistRateLimits(dataDir: string): void {
  try {
    const dir = join(dataDir, 'secrets');
    mkdirSync(dir, { recursive: true });
    const obj: Record<string, Bucket> = {};
    for (const [k, v] of globalMap) obj[k] = v;
    writeFileSync(join(dir, 'rate-limits.json'), JSON.stringify(obj), 'utf8');
  } catch {
    /* ignore */
  }
}

export function loadRateLimits(dataDir: string): void {
  try {
    const path = join(dataDir, 'secrets', 'rate-limits.json');
    if (!existsSync(path)) return;
    const obj = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Bucket>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v.lockedUntil && v.lockedUntil < now && (!v.fails || v.fails.length === 0)) continue;
      globalMap.set(k, v);
    }
  } catch {
    /* ignore */
  }
}
