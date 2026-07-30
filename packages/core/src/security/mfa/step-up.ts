/**
 * Recent TOTP verification cache for step-up (sensitive ops).
 * In-memory per userId; TTL default 5 minutes.
 */

const recent = new Map<string, number>();

export function markTotpStepUp(userId: string, now = Date.now()): void {
  recent.set(userId, now);
}

export function hasRecentTotpStepUp(
  userId: string,
  maxAgeMs = 5 * 60_000,
  now = Date.now(),
): boolean {
  const t = recent.get(userId);
  if (t == null) return false;
  if (now - t > maxAgeMs) {
    recent.delete(userId);
    return false;
  }
  return true;
}

export function clearTotpStepUp(userId: string): void {
  recent.delete(userId);
}

export function _resetStepUpForTests(): void {
  recent.clear();
}
