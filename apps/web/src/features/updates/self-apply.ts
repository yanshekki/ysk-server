/**
 * Panel self-apply: treat connection drop after a successful overlay as restart, not failure.
 */

export function isPanelRestartDisconnect(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|load failed|err_connection|econnrefused|econnreset|network request failed|connection (reset|refused|closed)/i.test(
    m,
  );
}

export async function waitForPanelAfterRestart(input: {
  probe: () => Promise<{ currentVersion?: unknown; ok?: unknown }>;
  expectVersion?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<{ currentVersion?: unknown; ok?: unknown } | null> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = input.now ?? Date.now;
  const deadline = now() + (input.timeoutMs ?? 90_000);
  let delay = 800;
  while (now() < deadline) {
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.4), 4000);
    try {
      const self = await input.probe();
      const cur = String(self.currentVersion ?? '').trim();
      if (!cur || cur === '—') continue;
      if (input.expectVersion && cur !== input.expectVersion) continue;
      return self;
    } catch {
      /* panel still down */
    }
  }
  return null;
}
