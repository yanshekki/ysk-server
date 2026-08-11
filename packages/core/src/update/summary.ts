/**
 * Cached updates summary for nav badge + overview (lightweight, no apt).
 */

export type UpdatesScanSettings = {
  /** When false, background job is paused (manual scan still works). */
  enabled: boolean;
  /** Interval between automatic scans (ms). */
  intervalMs: number;
};

export type UpdatesSummary = {
  lastScanAt: string | null;
  nextScanAt: string | null;
  autoScanEnabled: boolean;
  intervalMs: number;
  packagesUpgradable: number;
  packagesHighRisk: number;
  panelUpdateAvailable: boolean;
  panelCurrent?: string;
  panelLatest?: string;
  badgeCount: number;
  /** True when last scan older than 2× interval (or never). */
  stale: boolean;
};

export const DEFAULT_UPDATES_SCAN: UpdatesScanSettings = {
  enabled: true,
  intervalMs: 24 * 60 * 60_000,
};

export const UPDATES_SCAN_INTERVAL_OPTIONS_MS = [
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
  48 * 60 * 60_000,
] as const;

export function normalizeUpdatesScanSettings(
  raw: unknown,
): UpdatesScanSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = o.enabled === false ? false : true;
  let intervalMs = Number(o.intervalMs ?? DEFAULT_UPDATES_SCAN.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
    intervalMs = DEFAULT_UPDATES_SCAN.intervalMs;
  }
  // Clamp to 6h–48h for UI presets; allow env override wider in scheduler if needed
  intervalMs = Math.max(6 * 60 * 60_000, Math.min(48 * 60 * 60_000, intervalMs));
  // Snap to nearest option when close
  const opts = UPDATES_SCAN_INTERVAL_OPTIONS_MS;
  let best = opts[2]!;
  let bestDiff = Infinity;
  for (const x of opts) {
    const d = Math.abs(x - intervalMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = x;
    }
  }
  if (bestDiff < 60_000) intervalMs = best;
  return { enabled, intervalMs };
}

export function buildUpdatesSummary(input: {
  lastInventory?: Record<string, unknown> | null;
  lastSelf?: Record<string, unknown> | null;
  scanSettings?: UpdatesScanSettings | null;
  /** From scheduler job if available */
  nextScanAt?: string | null;
  nowMs?: number;
}): UpdatesSummary {
  const scan = normalizeUpdatesScanSettings(input.scanSettings ?? null);
  const inv = input.lastInventory ?? null;
  const self = input.lastSelf ?? null;
  const now = input.nowMs ?? Date.now();

  const lastScanAt =
    inv?.at != null
      ? String(inv.at)
      : self?.lastCheckAt != null
        ? String(self.lastCheckAt)
        : null;

  const metaUp =
    inv?.meta && typeof inv.meta === 'object'
      ? Number((inv.meta as { upgradableCount?: number }).upgradableCount ?? 0)
      : 0;
  const packagesUpgradable = Math.max(
    0,
    Number(inv?.upgradable ?? metaUp ?? 0) || 0,
  );

  let packagesHighRisk = 0;
  const advice = Array.isArray(inv?.advice) ? (inv!.advice as Array<Record<string, unknown>>) : [];
  for (const a of advice) {
    const risk = String(a.risk ?? '');
    const cand = a.candidateVersion != null ? String(a.candidateVersion) : '';
    const cur = a.currentVersion != null ? String(a.currentVersion) : '';
    const up = Boolean(cand && cand !== cur);
    if (up && (risk === 'high' || risk === 'critical' || a.requiresApproval || a.needsApproval)) {
      packagesHighRisk += 1;
    }
  }

  const panelUpdateAvailable = Boolean(self?.updateAvailable);
  const panelCurrent =
    self?.currentVersion != null ? String(self.currentVersion) : undefined;
  const panelLatest =
    self?.latestVersion != null ? String(self.latestVersion) : undefined;

  const badgeCount = packagesUpgradable + (panelUpdateAvailable ? 1 : 0);

  let stale = true;
  if (lastScanAt) {
    const t = new Date(lastScanAt).getTime();
    if (Number.isFinite(t)) {
      stale = now - t > scan.intervalMs * 2;
    }
  }

  return {
    lastScanAt,
    nextScanAt: input.nextScanAt ?? null,
    autoScanEnabled: scan.enabled,
    intervalMs: scan.intervalMs,
    packagesUpgradable,
    packagesHighRisk,
    panelUpdateAvailable,
    panelCurrent,
    panelLatest,
    badgeCount,
    stale,
  };
}
