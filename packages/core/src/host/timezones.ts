/**
 * Host timezone list for identity UI (select, not free-text).
 * Source: timedatectl list-timezones (read-only on executor policy).
 */

import type { HostExecutor } from './executor.js';

/** Used when timedatectl is missing or fails — still a select, not free text. */
export const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Vilnius',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

const TZ_RE = /^[A-Za-z0-9_+./-]+$/;

export function isValidTimezoneId(tz: string): boolean {
  const t = tz.trim();
  return t.length > 0 && t.length <= 64 && TZ_RE.test(t) && !t.includes('..');
}

/**
 * List IANA timezones available on the host (via timedatectl).
 * Falls back to a curated list when the command fails.
 */
export async function listHostTimezones(host: HostExecutor): Promise<{
  timezones: string[];
  source: 'timedatectl' | 'fallback';
}> {
  try {
    const r = await host.runCommand(['timedatectl', 'list-timezones'], { timeoutMs: 20_000 });
    if (r.exitCode === 0) {
      const timezones = r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => isValidTimezoneId(l));
      if (timezones.length > 0) {
        return { timezones, source: 'timedatectl' };
      }
    }
  } catch {
    /* fallback */
  }
  return { timezones: [...FALLBACK_TIMEZONES], source: 'fallback' };
}

/** Ensure current zone appears in options even if list is stale/partial. */
export function mergeTimezoneOptions(list: string[], current?: string | null): string[] {
  const set = new Set(list);
  const cur = current?.trim();
  if (cur && isValidTimezoneId(cur)) set.add(cur);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
