/**
 * Launch Chromium as an ephemeral Linux user and expose CDP endpoint.
 */

import { createServer } from 'node:net';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { probeChrome } from './chrome-probe.js';
import { acceptedChromePathOrEmpty } from './chrome-path.js';

export type ChromeAsUserHandle = {
  username: string;
  homeDir: string;
  debugPort: number;
  cdpUrl: string;
  profileDir: string;
  pidHint?: string;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        s.close();
        reject(new Error('no port'));
        return;
      }
      const port = addr.port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

async function waitCdp(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Start headless Chrome as `username` with user-data-dir under their home.
 * Returns CDP URL for Playwright connectOverCDP.
 */
export async function launchChromeAsUser(input: {
  host: HostExecutor;
  username: string;
  homeDir: string;
  chromePath?: string;
  noSandbox?: boolean;
  userAgent?: string;
  /** Default true (silent). Set false when panel audio bridge is enabled. */
  muteAudio?: boolean;
}): Promise<
  | { ok: true; handle: ChromeAsUserHandle; notes: string[] }
  | { ok: false; notes: string[] }
> {
  const notes: string[] = [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      notes: ['launchChromeAsUser requires root + YSK_EXECUTE'],
    };
  }
  if (!input.username.startsWith('yskb_')) {
    return { ok: false, notes: ['username must be yskb_*'] };
  }

  const probe = probeChrome(true);
  const chrome = acceptedChromePathOrEmpty(input.chromePath) || probe.path;
  if (!chrome) {
    return { ok: false, notes: [probe.reason || 'Chrome not found'] };
  }

  const port = await freePort();
  const profileDir = join(input.homeDir, '.ysk-chrome-profile');
  const downloadsDir = join(input.homeDir, 'Downloads');

  await input.host.runCommand(
    [
      'bash',
      '-c',
      [
        `mkdir -p ${JSON.stringify(profileDir)} ${JSON.stringify(downloadsDir)}`,
        `chown -R ${input.username}:${input.username} ${JSON.stringify(input.homeDir)}`,
      ].join(' && '),
    ],
    { timeoutMs: 15_000 },
  );

  const args = [
    '--headless=new',
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--download-default-directory=${downloadsDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800',
  ];
  if (input.muteAudio !== false) {
    args.push('--mute-audio');
  }
  if (input.noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  if (input.userAgent) {
    args.push(`--user-agent=${input.userAgent}`);
  }

  // Detach chrome under ephemeral user (background)
  const cmd = [
    'bash',
    '-c',
    `runuser -u ${JSON.stringify(input.username)} -- ${JSON.stringify(chrome)} ${args
      .map((a) => JSON.stringify(a))
      .join(' ')} >/dev/null 2>&1 & echo $!`,
  ];
  const launched = await input.host.runCommand(cmd, { timeoutMs: 10_000 });
  if (launched.exitCode !== 0) {
    notes.push((launched.stderr || launched.stdout || 'runuser chrome failed').slice(0, 300));
    return { ok: false, notes };
  }
  const pidHint = (launched.stdout || '').trim().split('\n').pop();

  const ready = await waitCdp(port);
  if (!ready) {
    notes.push('CDP did not become ready in time');
    await input.host.runCommand(
      ['bash', '-c', `pkill -9 -u ${JSON.stringify(input.username)} || true`],
      { timeoutMs: 10_000 },
    );
    return { ok: false, notes };
  }

  notes.push(`chrome as ${input.username} on port ${port}`);
  return {
    ok: true,
    handle: {
      username: input.username,
      homeDir: input.homeDir,
      debugPort: port,
      cdpUrl: `http://127.0.0.1:${port}`,
      profileDir,
      pidHint,
    },
    notes,
  };
}
