/**
 * Host timezone SSOT for panel clocks. Do not change the host zone here —
 * only render times in the zone System already reports.
 */
const STORAGE_KEY = 'ysk.hostTimeZone';
const TZ_ID = /^[A-Za-z0-9_+./-]{1,64}$/;

function readStoredHostTimeZone(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const next = String(sessionStorage.getItem(STORAGE_KEY) ?? '').trim();
    return TZ_ID.test(next) ? next : null;
  } catch {
    return null;
  }
}

function writeStoredHostTimeZone(tz: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (tz) sessionStorage.setItem(STORAGE_KEY, tz);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / SSR */
  }
}

let hostTimeZone: string | null = readStoredHostTimeZone();

export function getHostTimeZone(): string | null {
  return hostTimeZone;
}

export function setHostTimeZone(tz: string | null | undefined): void {
  const next = String(tz ?? '').trim();
  hostTimeZone = next && TZ_ID.test(next) ? next : null;
  writeStoredHostTimeZone(hostTimeZone);
}

export function hostTimeZoneOpts(extra?: { withOffset?: boolean }): {
  timeZone?: string;
  withOffset?: boolean;
} {
  return {
    ...(hostTimeZone ? { timeZone: hostTimeZone } : {}),
    withOffset: extra?.withOffset ?? true,
  };
}
