/** Semver-ish tag compare for client images. */

export function parseVersionParts(tag: string): { major: number; minor: number; patch: number } {
  const m = String(tag).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

export function tagIsNewer(current: string, next: string): boolean {
  const a = parseVersionParts(current);
  const b = parseVersionParts(next);
  if (b.major !== a.major) return b.major > a.major;
  if (b.minor !== a.minor) return b.minor > a.minor;
  return b.patch > a.patch;
}

export function tagIsBreaking(current: string, next: string): boolean {
  return parseVersionParts(next).major > parseVersionParts(current).major;
}
