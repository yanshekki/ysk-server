/**
 * SSH public keys for SFTP/FTP account jail users (managed under dataDir).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonStore } from '../db/store.js';

export type SftpKeyRecord = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
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

export function addSftpKey(
  db: JsonStore,
  dataDir: string,
  input: { username: string; publicKey: string; comment?: string },
): { ok: boolean; key?: SftpKeyRecord; notes: string[]; written: string[] } {
  const username = input.username.trim().toLowerCase();
  const publicKey = input.publicKey.trim();
  if (!username || !publicKey.startsWith('ssh-')) {
    return { ok: false, notes: ['需要 username 與 ssh- 開頭公鑰'], written: [] };
  }
  const key: SftpKeyRecord = {
    id: randomUUID(),
    username,
    publicKey,
    comment: input.comment,
    created_at: new Date().toISOString(),
  };
  const all = listSftpKeys(db);
  all.unshift(key);
  db.snapshot.settings[KEY] = JSON.stringify(all);
  db.persist();

  const dir = join(dataDir, 'ftps', 'ssh', username);
  mkdirSync(dir, { recursive: true });
  const auth = join(dir, 'authorized_keys');
  appendFileSync(auth, publicKey + '\n', 'utf8');
  return {
    ok: true,
    key,
    notes: [`已儲存公鑰 · 管理檔 ${auth}`, '需系統 sshd Match/User 設定才會真正生效'],
    written: [auth],
  };
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
  // rewrite authorized_keys for user
  const dir = join(dataDir, 'ftps', 'ssh', found.username);
  const auth = join(dir, 'authorized_keys');
  const lines = next.filter((k) => k.username === found.username).map((k) => k.publicKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(auth, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return { ok: true, notes: [`已刪除 key · 重寫 ${auth}`] };
}

export function readSftpAuthorizedKeysFile(dataDir: string, username: string): string {
  const auth = join(dataDir, 'ftps', 'ssh', username, 'authorized_keys');
  if (!existsSync(auth)) return '';
  return readFileSync(auth, 'utf8');
}
