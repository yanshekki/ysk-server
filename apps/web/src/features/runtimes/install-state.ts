/**
 * Shared install-button logic for all language runtimes (Node/PHP/Python/Go/…).
 * - Disable install when the selected target version is already on the host
 * - Detect newer panel-supported versions that are not yet installed
 */

export type RuntimeInstallState = {
  /** Selected target version is present on host */
  selectedInstalled: boolean;
  /** Any supported version installed */
  anyInstalled: boolean;
  /** Versions from probe (or host string) that count as installed */
  installedVersions: string[];
  /** Supported versions strictly newer than the highest installed */
  newerAvailable: string[];
  /** Highest installed among supported (if any) */
  newestInstalled: string | null;
  /** Install primary button should be disabled */
  installDisabled: boolean;
};

/** Compare dotted/numeric runtime versions; `latest`/`stable` sort as highest. */
export function compareRuntimeVersions(a: string, b: string): number {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (na === nb) return 0;
  if (isRolling(na)) return 1;
  if (isRolling(nb)) return -1;
  const pa = na.split(/[.+_-]/).map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const pb = nb.split(/[.+_-]/).map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function normalizeToken(v: string): string {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .toLowerCase();
}

function isRolling(v: string): boolean {
  return v === 'latest' || v === 'stable' || v === 'nightly' || v === 'current';
}

/**
 * Does host report (e.g. v20.18.0 or PHP 8.2.12) satisfy panel target (20 / 8.2)?
 * Targets are panel majors/minors from the SegRadio list.
 */
export function hostSatisfiesTarget(hostReport: string | null | undefined, target: string): boolean {
  if (!hostReport || !target) return false;
  const h = normalizeToken(hostReport);
  const t = normalizeToken(target);
  if (!h || !t) return false;
  if (h === t) return true;
  // Exact prefix: 8.2 matches 8.2.12; 20 matches 20.18.0
  if (h === t || h.startsWith(`${t}.`) || h.startsWith(`${t}-`)) return true;
  // Major-only target against multi-part host (node 20 vs 20.18.0)
  if (!t.includes('.') && h.split(/[.+_-]/)[0] === t) return true;
  // PHP "8.2.12 (cli)" style
  const m = h.match(/(\d+(?:\.\d+){0,3})/);
  if (m) {
    const ver = m[1]!;
    if (ver === t || ver.startsWith(`${t}.`)) return true;
    if (!t.includes('.') && ver.split('.')[0] === t) return true;
  }
  return false;
}

/**
 * Build install UI state from probe + selected target.
 */
export function resolveRuntimeInstallState(input: {
  selectedVersion: string;
  /** Panel-supported version ids in display order */
  supportedVersions: string[];
  /** Probe items: version + available */
  probeItems?: Array<{ version?: string; available?: boolean; versionOutput?: string }>;
  /** Flattened list of installed version ids if already computed */
  availableVersions?: string[];
  /** Host default string e.g. hostNode v20.18.0 */
  hostDefault?: string | null;
}): RuntimeInstallState {
  const supported = (input.supportedVersions ?? []).map(String).filter(Boolean);
  const selected = String(input.selectedVersion ?? '');

  const fromProbe = new Set<string>();
  for (const v of input.availableVersions ?? []) {
    if (v) fromProbe.add(String(v));
  }
  for (const item of input.probeItems ?? []) {
    if (item.available && item.version != null) fromProbe.add(String(item.version));
  }
  // Map host default onto supported targets
  if (input.hostDefault) {
    for (const s of supported) {
      if (hostSatisfiesTarget(input.hostDefault, s)) fromProbe.add(s);
    }
  }

  // Keep only supported ids (stable order)
  const installedVersions = supported.filter((s) => {
    if (fromProbe.has(s)) return true;
    // host or versionOutput match
    for (const item of input.probeItems ?? []) {
      if (!item.available) continue;
      if (hostSatisfiesTarget(item.versionOutput, s)) return true;
      if (hostSatisfiesTarget(String(item.version ?? ''), s)) return true;
    }
    return hostSatisfiesTarget(input.hostDefault, s);
  });

  const selectedInstalled =
    installedVersions.includes(selected) ||
    hostSatisfiesTarget(input.hostDefault, selected) ||
    fromProbe.has(selected);

  const anyInstalled = installedVersions.length > 0 || Boolean(input.hostDefault?.trim());

  let newestInstalled: string | null = null;
  if (installedVersions.length) {
    newestInstalled = installedVersions.reduce((a, b) =>
      compareRuntimeVersions(a, b) >= 0 ? a : b,
    );
  }

  const newerAvailable = newestInstalled
    ? supported.filter(
        (s) =>
          compareRuntimeVersions(s, newestInstalled!) > 0 && !installedVersions.includes(s),
      )
    : [];

  return {
    selectedInstalled,
    anyInstalled,
    installedVersions,
    newerAvailable,
    newestInstalled,
    installDisabled: selectedInstalled,
  };
}

/** Label suffix for version chips: "20 ✓" when installed */
export function versionChipLabel(version: string, installed: string[]): string {
  return installed.includes(version) ? `${version} ✓` : version;
}
