import { tl } from '@ysk-server/shared';
/**
 * After any write into a project home, restore ownership to project linux user.
 */

import { resolve as pathResolve } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { pathUnderRoot } from '../host/executor.js';
import { shellQuote } from './project-user-run.js';

export interface ProjectOwnerRef {
  linuxUser: string;
  linuxGroup?: string;
  homeDir: string;
}

/**
 * chown one absolute path (file or dir) to project user when root+execute.
 */
export async function chownProjectPath(
  host: HostExecutor,
  owner: ProjectOwnerRef,
  absPath: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1255')],
    };
  }
  const u = owner.linuxUser?.trim();
  if (!u) return { ok: false, notes: [tl('notes.auto.n1080')] };
  const g = (owner.linuxGroup || u).trim();
  // Boundary-safe: must resolve under project home (no /home/u/../root)
  const home = pathResolve(owner.homeDir);
  const target = pathResolve(absPath.startsWith('/') ? absPath : pathResolve(home, absPath));
  if (!pathUnderRoot(home, target)) {
    return {
      ok: false,
      notes: [tl('notes.tpl.chownFailed', { detail: 'path outside project home' })],
    };
  }
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `chown -R ${shellQuote(u)}:${shellQuote(g)} ${shellQuote(target)} 2>&1`,
    ],
    { timeoutMs: 60_000 },
  );
  if (r.exitCode === 0) {
    notes.push(`chown ${u}:${g} → ${target}`);
    return { ok: true, notes };
  }
  return {
    ok: false,
    notes: [tl('notes.tpl.chownFailed', { detail: (r.stderr || r.stdout || '').slice(0, 160) })],
  };
}

/**
 * chown entire project home tree.
 */
export async function chownProjectTree(
  host: HostExecutor,
  owner: ProjectOwnerRef,
): Promise<{ ok: boolean; notes: string[] }> {
  return chownProjectPath(host, owner, owner.homeDir);
}
