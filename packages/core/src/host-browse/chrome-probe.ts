/**
 * Locate system Chrome/Chromium for host-browse browser engine.
 */

import { accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CANDIDATES = [
  process.env.YSK_HOST_BROWSE_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean) as string[];

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | null {
  try {
    const out = execFileSync('which', [cmd], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    return out && isExecutable(out) ? out : null;
  } catch {
    return null;
  }
}

export type ChromeProbe = {
  available: boolean;
  path: string | null;
  reason?: string;
};

let cached: ChromeProbe | null = null;

export function probeChrome(force = false): ChromeProbe {
  if (cached && !force) return cached;

  for (const p of CANDIDATES) {
    if (p && isExecutable(p)) {
      cached = { available: true, path: p };
      return cached;
    }
  }
  for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const p = which(cmd);
    if (p) {
      cached = { available: true, path: p };
      return cached;
    }
  }

  cached = {
    available: false,
    path: null,
    reason: 'No Chrome/Chromium found. Install google-chrome-stable or set YSK_HOST_BROWSE_CHROME.',
  };
  return cached;
}

export function clearChromeProbeCache(): void {
  cached = null;
}
