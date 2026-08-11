/**
 * Shared install-button logic for all language runtimes (Node/PHP/Python/Go/…).
 * - Disable install when the selected target version is already on the host
 * - Detect newer panel-supported versions that are not yet installed
 */

export type RuntimeInstallState = {
  /** Selected target version is present on host */
  selectedInstalled: boolean;
  /** Selected is the active default (PATH / rustup default / go symlink) */
  selectedActive: boolean;
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
  /**
   * Selected is installed but not active — show "set host default".
   * Install stays disabled; switch re-points default without reinstall.
   */
  canSwitch: boolean;
};

/** Kinds that support panel-driven host default (symlink / rustup). */
export function supportsHostDefault(kind: string): boolean {
  return kind === 'go' || kind === 'rust' || kind === 'node' || kind === 'bun';
}

/** Kinds that support removing one managed version from the panel. */
export function supportsVersionUninstall(kind: string): boolean {
  return kind === 'go' || kind === 'rust' || kind === 'node' || kind === 'bun';
}

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
    .replace(/^go/i, '')
    .toLowerCase();
}

function isRolling(v: string): boolean {
  return v === 'latest' || v === 'stable' || v === 'nightly' || v === 'current';
}

/** Numeric components of first version-like token (8.1.12 → [8,1,12]). */
export function versionComponents(raw: string): number[] | null {
  const n = normalizeToken(raw);
  if (!n || isRolling(n)) return null;
  const m = n.match(/(\d+(?:[.+_-]\d+)*)/);
  if (!m?.[1]) return null;
  return m[1]
    .split(/[.+_-]/)
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));
}

/**
 * True when A and B are the same release line: longer is a patch of shorter.
 * 8.1 ↔ 8.1.12 ✓ · 8.1 ↔ 8.10 ✗ · 1.26 ↔ 1.26.5 ✓ · 1.2 ↔ 1.26 ✗ · 20 ↔ 20.18 ✓
 */
export function versionLineageMatch(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (isRolling(na) || isRolling(nb)) return na === nb;
  const ca = versionComponents(na);
  const cb = versionComponents(nb);
  if (!ca?.length || !cb?.length) return false;
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

/**
 * Does host report (e.g. v20.18.0 or PHP 8.2.12) satisfy panel target (20 / 8.2)?
 * Uses component lineage — not string prefix (avoids 8.10 matching 8.1).
 */
export function hostSatisfiesTarget(hostReport: string | null | undefined, target: string): boolean {
  if (!hostReport || !target) return false;
  const h = normalizeToken(hostReport);
  const t = normalizeToken(target);
  if (!h || !t) return false;
  if (h === t) return true;
  if (isRolling(t) || isRolling(h)) return h === t;
  // Prefer first version token in host string ("go version go1.26.5 …")
  const hostVer = h.match(/(\d+(?:[.+_-]\d+)*)/)?.[1] ?? h;
  return versionLineageMatch(hostVer, t);
}

/**
 * Build install UI state from probe + selected target.
 */
export function resolveRuntimeInstallState(input: {
  selectedVersion: string;
  /** Panel-supported version ids in display order */
  supportedVersions: string[];
  /** Probe items: version + available (+ optional active) */
  probeItems?: Array<{
    version?: string;
    available?: boolean;
    active?: boolean;
    versionOutput?: string;
  }>;
  /** Flattened list of installed version ids if already computed */
  availableVersions?: string[];
  /** Host default string e.g. hostNode v20.18.0 */
  hostDefault?: string | null;
  /**
   * When true (go/rust), hostDefault must not mark every pin installed —
   * only probe.available counts (multi-version model).
   */
  multiVersion?: boolean;
  /** Runtime kind — enables host-default switch CTA for node/bun/go/rust */
  kind?: string;
}): RuntimeInstallState {
  const supported = (input.supportedVersions ?? []).map(String).filter(Boolean);
  const selected = String(input.selectedVersion ?? '');
  const multi = Boolean(input.multiVersion);
  const hostDefaultSwitchable = supportsHostDefault(input.kind ?? '');

  const fromProbe = new Set<string>();
  for (const v of input.availableVersions ?? []) {
    if (v) fromProbe.add(String(v));
  }
  for (const item of input.probeItems ?? []) {
    if (item.available && item.version != null) fromProbe.add(String(item.version));
  }
  // Map host default onto supported targets (single-active runtimes only)
  if (input.hostDefault && !multi) {
    for (const s of supported) {
      if (hostSatisfiesTarget(input.hostDefault, s)) fromProbe.add(s);
    }
  }

  /** Match panel pin ↔ probe pin across full/minor (1.26.5 ↔ 1.26), not 8.1↔8.10. */
  const pinMatch = (a: string, b: string): boolean => versionLineageMatch(a, b);

  // Keep only supported ids (stable order)
  const installedVersions = supported.filter((s) => {
    if (fromProbe.has(s)) return true;
    if ([...fromProbe].some((p) => pinMatch(p, s))) return true;
    if (multi) {
      // multi-version: probe.available (allow minor↔patch)
      return (input.probeItems ?? []).some(
        (i) => i.available && pinMatch(String(i.version ?? ''), s),
      );
    }
    for (const item of input.probeItems ?? []) {
      if (!item.available) continue;
      if (hostSatisfiesTarget(item.versionOutput, s)) return true;
      if (pinMatch(String(item.version ?? ''), s)) return true;
    }
    return hostSatisfiesTarget(input.hostDefault, s);
  });

  const selectedInstalled =
    installedVersions.includes(selected) ||
    installedVersions.some((v) => pinMatch(v, selected)) ||
    (!multi && hostSatisfiesTarget(input.hostDefault, selected)) ||
    fromProbe.has(selected) ||
    [...fromProbe].some((p) => pinMatch(p, selected));

  const selectedActiveFromProbe = (input.probeItems ?? []).some(
    (i) =>
      i.available &&
      i.active &&
      pinMatch(String(i.version ?? ''), selected),
  );
  // Fallback: host PATH default matches selected (node/php/python often lack active flags)
  const selectedActive =
    selectedActiveFromProbe || hostSatisfiesTarget(input.hostDefault, selected);

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

  // Host-default switch when installed but not active (go/rust via multiVersion; node/bun via kind)
  const canSwitch =
    (hostDefaultSwitchable || multi) && selectedInstalled && !selectedActive;
  const installDisabled = selectedInstalled;

  return {
    selectedInstalled,
    selectedActive,
    anyInstalled,
    installedVersions,
    newerAvailable,
    newestInstalled,
    installDisabled,
    canSwitch,
  };
}

/** Label suffix for version chips: "20 ✓" when installed */
export function versionChipLabel(version: string, installed: string[]): string {
  return installed.includes(version) ? `${version} ✓` : version;
}
