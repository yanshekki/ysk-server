/**
 * Provision / probe / remove Linux users for VNC accounts.
 */

import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { tl } from '@ysk-server/shared';

export type LinuxUserProbe = {
  exists: boolean;
  uid?: number;
  home?: string;
  shell?: string;
  notes: string[];
};

export async function probeLinuxUser(
  host: HostExecutor,
  linuxUser: string,
): Promise<LinuxUserProbe> {
  const notes: string[] = [];
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `getent passwd ${shellQuote(linuxUser)} 2>/dev/null || true`,
    ],
    { timeoutMs: 8_000 },
  );
  const line = r.stdout.trim().split('\n').find(Boolean);
  if (!line || !line.includes(':')) {
    return { exists: false, notes };
  }
  const parts = line.split(':');
  return {
    exists: true,
    uid: Number(parts[2]) || undefined,
    home: parts[5] || undefined,
    shell: parts[6] || undefined,
    notes,
  };
}

export async function ensureLinuxUser(
  host: HostExecutor,
  linuxUser: string,
): Promise<{
  ok: boolean;
  provisioned: boolean;
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  home?: string;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}> {
  const notes: string[] = [];
  const commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }> =
    [];
  const can = host.executeEnabled() && host.isRoot();
  if (!can) {
    notes.push(tl('notes.vnc.userWrittenOnly', { user: linuxUser }));
    return {
      ok: true,
      provisioned: false,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
      requiresRoot: !host.isRoot(),
      notes,
      commandResults,
    };
  }

  const existing = await probeLinuxUser(host, linuxUser);
  if (existing.exists) {
    notes.push(tl('notes.vnc.userExists', { user: linuxUser }));
    return {
      ok: true,
      provisioned: true,
      home: existing.home,
      notes,
      commandResults,
    };
  }

  const ua = await host.runCommand(
    [
      'useradd',
      '-m',
      '-s',
      '/bin/bash',
      '-c',
      'YSK VNC',
      linuxUser,
    ],
    { timeoutMs: 30_000 },
  );
  commandResults.push({
    argv: ['useradd', linuxUser],
    exitCode: ua.exitCode,
    stderr: ua.stderr,
  });
  if (ua.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.useraddFailed', {
        user: linuxUser,
        detail: (ua.stderr || ua.stdout || '').slice(0, 200),
      }),
    );
    return { ok: false, provisioned: false, notes, commandResults };
  }
  notes.push(tl('notes.vnc.userCreated', { user: linuxUser }));
  const again = await probeLinuxUser(host, linuxUser);
  return {
    ok: true,
    provisioned: true,
    home: again.home,
    notes,
    commandResults,
  };
}

export async function removeLinuxUser(
  host: HostExecutor,
  linuxUser: string,
  removeHome: boolean,
): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.userdelBlocked', { user: linuxUser }));
    return {
      ok: false,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
    };
  }
  const existing = await probeLinuxUser(host, linuxUser);
  if (!existing.exists) {
    notes.push(tl('notes.vnc.userAlreadyGone', { user: linuxUser }));
    return { ok: true, notes };
  }
  const args = removeHome
    ? ['userdel', '-r', linuxUser]
    : ['userdel', linuxUser];
  const r = await host.runCommand(args, { timeoutMs: 30_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.userdelFailed', {
        user: linuxUser,
        detail: (r.stderr || r.stdout || '').slice(0, 200),
      }),
    );
    return { ok: false, notes };
  }
  notes.push(tl('notes.vnc.userDeleted', { user: linuxUser }));
  return { ok: true, notes };
}
