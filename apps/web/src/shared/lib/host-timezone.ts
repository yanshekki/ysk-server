/**
 * Host timezone SSOT for panel clocks. Do not change the host zone here —
 * only render times in the zone System already reports.
 */
let hostTimeZone: string | null = null;

export function getHostTimeZone(): string | null {
  return hostTimeZone;
}

export function setHostTimeZone(tz: string | null | undefined): void {
  const next = String(tz ?? '').trim();
  hostTimeZone = next || null;
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
