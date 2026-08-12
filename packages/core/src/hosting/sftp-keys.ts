import { tl } from '@yanshekki/shared';
/**
 * SSH public keys for SFTP — managed copy under dataDir + optional project home .ssh
 * When projectId/homeDir/linuxUser provided, keys land in project isolation home.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import { shellQuote } from './project-user-run.js';

export type SftpKeyRecord = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
  /** When bound to a hosting project */
  projectId?: string;
  linuxUser?: string;
  homeDir?: string;
};

const KEY = 'sftp_authorized_keys';

export function listSftpKeys(db: JsonStore, username?: string): SftpKeyRecord[] {
  const raw = db.snapshot.settings?.[KEY];
  let all: SftpKeyRecord[] = [];
  try {
    all = raw ? (JSON.parse(raw) as SftpKeyRecord[]) : [];
  } catch {
    all = [];
  }
  if (username) return all.filter((k) => k.username === username);
  return all;
}

function rewriteManagedAuthorizedKeys(
  dataDir: string,
  username: string,
  keys: SftpKeyRecord[],
): string {
  const dir = join(dataDir, 'ftps', 'ssh', username);
  mkdirSync(dir, { recursive: true });
  const auth = join(dir, 'authorized_keys');
  const lines = keys.filter((k) => k.username === username).map((k) => k.publicKey);
  writeFileSync(auth, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  try {
    chmodSync(auth, 0o600);
    chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  return auth;
}

function rewriteProjectAuthorizedKeys(
  homeDir: string,
  keys: SftpKeyRecord[],
  projectId?: string,
): string {
  const sshDir = join(homeDir, '.ssh');
  mkdirSync(sshDir, { recursive: true });
  const auth = join(sshDir, 'authorized_keys');
  const lines = keys
    .filter((k) => (projectId ? k.projectId === projectId : k.homeDir === homeDir))
    .map((k) => k.publicKey);
  // Also include keys for same linuxUser without project filter if bound
  writeFileSync(auth, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  try {
    chmodSync(sshDir, 0o700);
    chmodSync(auth, 0o600);
  } catch {
    /* ignore */
  }
  return auth;
}

export function addSftpKey(
  db: JsonStore,
  dataDir: string,
  input: {
    username: string;
    publicKey: string;
    comment?: string;
    projectId?: string;
    linuxUser?: string;
    homeDir?: string;
  },
  host?: HostExecutor,
): { ok: boolean; key?: SftpKeyRecord; notes: string[]; written: string[] } {
  const username = input.username.trim().toLowerCase();
  const publicKey = input.publicKey.trim();
  if (!username || !publicKey.startsWith('ssh-')) {
    return { ok: false, notes: [tl('notes.auto.n1575')], written: [] };
  }

  // Resolve project binding
  let projectId = input.projectId?.trim();
  let linuxUser = input.linuxUser?.trim();
  let homeDir = input.homeDir?.trim();
  if (projectId && (!linuxUser || !homeDir)) {
    const p = db.snapshot.projects.find((x) => x.id === projectId);
    if (p) {
      linuxUser = linuxUser || p.linux_user;
      homeDir = homeDir || p.home_dir;
    }
  }
  // Username defaults to linuxUser for project keys
  const loginName = linuxUser || username;

  const key: SftpKeyRecord = {
    id: randomUUID(),
    username: loginName,
    publicKey,
    comment: input.comment,
    created_at: new Date().toISOString(),
    projectId,
    linuxUser,
    homeDir,
  };
  const all = listSftpKeys(db);
  all.unshift(key);
  db.snapshot.settings[KEY] = JSON.stringify(all);
  db.persist();

  const written: string[] = [];
  const notes: string[] = [];

  const managedAuth = rewriteManagedAuthorizedKeys(dataDir, loginName, all);
  written.push(managedAuth);
  notes.push(tl('notes.auto.t0414', { v0: (managedAuth) }));

  if (homeDir) {
    const projAuth = rewriteProjectAuthorizedKeys(
      homeDir,
      all.filter((k) => k.homeDir === homeDir || k.projectId === projectId),
      projectId,
    );
    written.push(projAuth);
    notes.push(tl('notes.auto.t0415', { v0: (projAuth) }));
  } else {
    notes.push(tl('notes.auto.n0972'));
  }

  notes.push(
    homeDir && linuxUser
      ? tl('notes.auto.t0416', { v0: (linuxUser) })
      : tl('notes.auto.n1554'),
  );

  void host; // chown via chownSftpProjectKeys after add (async)

  return {
    ok: true,
    key,
    notes,
    written,
  };
}

/** Sync chown helper used by HTTP after add */
export async function chownSftpProjectKeys(
  host: HostExecutor,
  homeDir: string,
  linuxUser: string,
): Promise<string[]> {
  if (!host.executeEnabled() || !host.isRoot()) {
    return [tl('notes.auto.n0180')];
  }
  const sshDir = join(homeDir, '.ssh');
  if (!existsSync(sshDir)) return [];
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `chown -R ${shellQuote(linuxUser)}:${shellQuote(linuxUser)} ${shellQuote(sshDir)} && chmod 700 ${shellQuote(sshDir)} && chmod 600 ${shellQuote(join(sshDir, 'authorized_keys'))} 2>/dev/null || true`,
    ],
    { timeoutMs: 15_000 },
  );
  return r.exitCode === 0
    ? [tl('notes.auto.t0417', { v0: (linuxUser), v1: (sshDir) })]
    : [tl('notes.auto.t0418', { v0: ((r.stderr || r.stdout).slice(0, 120)) })];
}

export function removeSftpKey(
  db: JsonStore,
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[] } {
  const all = listSftpKeys(db);
  const found = all.find((k) => k.id === id);
  if (!found) return { ok: false, notes: [tl('notes.auto.n0852')] };
  const next = all.filter((k) => k.id !== id);
  db.snapshot.settings[KEY] = JSON.stringify(next);
  db.persist();
  rewriteManagedAuthorizedKeys(dataDir, found.username, next);
  if (found.homeDir) {
    rewriteProjectAuthorizedKeys(
      found.homeDir,
      next.filter((k) => k.homeDir === found.homeDir || k.projectId === found.projectId),
      found.projectId,
    );
  }
  return { ok: true, notes: [tl('notes.auto.t0419')] };
}

export function readSftpAuthorizedKeysFile(dataDir: string, username: string): string {
  const auth = join(dataDir, 'ftps', 'ssh', username, 'authorized_keys');
  if (!existsSync(auth)) return '';
  return readFileSync(auth, 'utf8');
}
