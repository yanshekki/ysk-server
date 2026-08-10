/**
 * Ephemeral Linux users for host-browse Chromium isolation.
 * Requires HostExecutor with root + YSK_EXECUTE.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export type EphemeralBrowseUser = {
  username: string;
  homeDir: string;
  createdAt: string;
};

function shortId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase() || 'x';
}

export function planBrowseUsername(panelUserId: string, sessionId: string): string {
  // Linux username max 32; keep deterministic prefix for cleanup greps
  const a = shortId(panelUserId).slice(0, 6);
  const b = shortId(sessionId).slice(0, 8);
  const r = randomBytes(2).toString('hex');
  return `yskb_${a}_${b}_${r}`.slice(0, 32);
}

/**
 * Create a nologin user with home under dataDir (not /home pollution when possible).
 */
export async function createEphemeralBrowseUser(input: {
  host: HostExecutor;
  dataDir: string;
  panelUserId: string;
  sessionId: string;
}): Promise<
  | { ok: true; user: EphemeralBrowseUser; notes: string[] }
  | { ok: false; blocked?: boolean; notes: string[]; requiresExecute?: boolean; requiresRoot?: boolean }
> {
  const notes: string[] = [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      notes: [
        'Ephemeral browse user requires root and YSK_EXECUTE=1',
      ],
    };
  }

  const username = planBrowseUsername(input.panelUserId, input.sessionId);
  const homeBase = join(input.dataDir, 'host-browse', 'homes');
  const homeDir = join(homeBase, username);

  // Ensure base dir
  await input.host.runCommand(['mkdir', '-p', homeBase], { timeoutMs: 10_000 });

  // useradd -M (no /home default) then create home under dataDir
  const add = await input.host.runCommand(
    [
      'useradd',
      '-M',
      '-s',
      '/usr/sbin/nologin',
      '-d',
      homeDir,
      username,
    ],
    { timeoutMs: 30_000 },
  );
  if (add.exitCode !== 0) {
    notes.push((add.stderr || add.stdout || 'useradd failed').slice(0, 300));
    return { ok: false, notes };
  }

  const mk = await input.host.runCommand(
    ['bash', '-c', `mkdir -p ${JSON.stringify(homeDir)} && chown ${username}:${username} ${JSON.stringify(homeDir)} && chmod 700 ${JSON.stringify(homeDir)}`],
    { timeoutMs: 15_000 },
  );
  if (mk.exitCode !== 0) {
    notes.push((mk.stderr || 'mkdir home failed').slice(0, 200));
    await destroyEphemeralBrowseUser({ host: input.host, username, homeDir });
    return { ok: false, notes };
  }

  notes.push(`created ${username}`);
  return {
    ok: true,
    user: {
      username,
      homeDir,
      createdAt: new Date().toISOString(),
    },
    notes,
  };
}

export async function destroyEphemeralBrowseUser(input: {
  host: HostExecutor;
  username: string;
  homeDir?: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      notes: ['destroy requires root + YSK_EXECUTE'],
    };
  }
  const u = input.username;
  if (!u.startsWith('yskb_')) {
    return { ok: false, notes: ['refusing to delete non-yskb_ user'] };
  }

  // Kill all processes for user
  await input.host.runCommand(['bash', '-c', `pkill -9 -u ${JSON.stringify(u)} || true`], {
    timeoutMs: 15_000,
  });
  await new Promise((r) => setTimeout(r, 300));

  const del = await input.host.runCommand(['userdel', '-r', u], { timeoutMs: 30_000 });
  if (del.exitCode !== 0) {
    notes.push((del.stderr || del.stdout || 'userdel failed').slice(0, 300));
    // try remove home manually
    if (input.homeDir) {
      await input.host.runCommand(
        ['bash', '-c', `rm -rf ${JSON.stringify(input.homeDir)}`],
        { timeoutMs: 30_000 },
      );
    }
    // userdel without -r
    await input.host.runCommand(['userdel', u], { timeoutMs: 15_000 });
    return { ok: false, notes };
  }
  notes.push(`removed ${u}`);
  return { ok: true, notes };
}
