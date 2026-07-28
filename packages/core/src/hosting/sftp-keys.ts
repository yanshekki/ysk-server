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
    return { ok: false, notes: ['需要 username 與 ssh- 開頭公鑰'], written: [] };
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
  notes.push(`管理檔 ${managedAuth}`);

  if (homeDir) {
    const projAuth = rewriteProjectAuthorizedKeys(
      homeDir,
      all.filter((k) => k.homeDir === homeDir || k.projectId === projectId),
      projectId,
    );
    written.push(projAuth);
    notes.push(`專案 home 公鑰：${projAuth}`);
  } else {
    notes.push('未綁專案 home — 僅寫入控制面 ftps/ssh；需 sshd Match 才生效');
  }

  notes.push(
    homeDir && linuxUser
      ? `登入目標用戶 ${linuxUser}（專案隔離 home）；請對 .ssh 執行 chown（API 會嘗試）`
      : '需系統 sshd Match/User 設定才會真正生效',
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
    return ['SFTP .ssh chown 需 root + YSK_EXECUTE'];
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
    ? [`已 chown ${linuxUser} → ${sshDir}`]
    : [`chown .ssh 失敗：${(r.stderr || r.stdout).slice(0, 120)}`];
}

export function removeSftpKey(
  db: JsonStore,
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[] } {
  const all = listSftpKeys(db);
  const found = all.find((k) => k.id === id);
  if (!found) return { ok: false, notes: ['找不到 key'] };
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
  return { ok: true, notes: [`已刪除 key · 重寫 authorized_keys`] };
}

export function readSftpAuthorizedKeysFile(dataDir: string, username: string): string {
  const auth = join(dataDir, 'ftps', 'ssh', username, 'authorized_keys');
  if (!existsSync(auth)) return '';
  return readFileSync(auth, 'utf8');
}
