/**
 * SSH 2FA registry under dataDir/secrets/ssh/ssh-2fa.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonStore } from '../../db/store.js';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  resolveMasterKey,
  secretsSshDir,
} from '../ssh-identity/crypto.js';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from '../totp.js';
import type { Ssh2faPublic, Ssh2faRecord, Ssh2faStatus } from './types.js';
import { toPublicSsh2fa } from './types.js';

function storePath(dataDir: string): string {
  return join(secretsSshDir(dataDir), 'ssh-2fa.json');
}

function loadAll(dataDir: string): Ssh2faRecord[] {
  const path = storePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: Ssh2faRecord[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function saveAll(dataDir: string, items: Ssh2faRecord[]): void {
  mkdirSync(secretsSshDir(dataDir), { recursive: true });
  const path = storePath(dataDir);
  writeFileSync(path, JSON.stringify({ items }, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function resolveBinding(
  db: JsonStore | undefined,
  input: { projectId?: string; linuxUser?: string; homeDir?: string },
): { projectId?: string; linuxUser: string; homeDir: string } | { error: string } {
  let projectId = input.projectId?.trim() || undefined;
  let linuxUser = input.linuxUser?.trim() || undefined;
  let homeDir = input.homeDir?.trim() || undefined;
  if (projectId && db) {
    const p = db.snapshot.projects.find((x) => x.id === projectId);
    if (!p) return { error: '找不到專案' };
    linuxUser = linuxUser || p.linux_user;
    homeDir = homeDir || p.home_dir;
  }
  if (!linuxUser) return { error: '需要 linuxUser 或 projectId' };
  if (!homeDir) {
    // best-effort default
    homeDir = `/home/${linuxUser}`;
  }
  return { projectId, linuxUser, homeDir };
}

export function listSsh2fa(dataDir: string, filter?: {
  projectId?: string;
  linuxUser?: string;
}): Ssh2faPublic[] {
  let items = loadAll(dataDir).filter((i) => i.status !== 'retired');
  if (filter?.projectId) items = items.filter((i) => i.projectId === filter.projectId);
  if (filter?.linuxUser) items = items.filter((i) => i.linuxUser === filter.linuxUser);
  return items.map(toPublicSsh2fa);
}

export function listSsh2faAll(dataDir: string): Ssh2faPublic[] {
  return loadAll(dataDir).map(toPublicSsh2fa);
}

export function getSsh2fa(dataDir: string, id: string): Ssh2faPublic | null {
  const row = loadAll(dataDir).find((i) => i.id === id);
  return row ? toPublicSsh2fa(row) : null;
}

export function getSsh2faInternal(dataDir: string, id: string): Ssh2faRecord | null {
  return loadAll(dataDir).find((i) => i.id === id) ?? null;
}

export type EnrollSsh2faResult = {
  ok: boolean;
  record?: Ssh2faPublic;
  /** one-time */
  secret?: string;
  otpauthUrl?: string;
  notes: string[];
};

/** Create enrollment with new secret (independent of panel). */
export function enrollSsh2fa(
  dataDir: string,
  input: {
    projectId?: string;
    linuxUser?: string;
    homeDir?: string;
    createdBy?: string;
    /** Advanced: use this raw secret instead of generating */
    secret?: string;
    fromPanel?: boolean;
  },
  db?: JsonStore,
): EnrollSsh2faResult {
  const binding = resolveBinding(db, input);
  if ('error' in binding) return { ok: false, notes: [binding.error] };

  const existing = loadAll(dataDir).find(
    (i) => i.linuxUser === binding.linuxUser && i.status !== 'retired',
  );
  if (existing) {
    return {
      ok: false,
      notes: [`用戶 ${binding.linuxUser} 已有 SSH 2FA（${existing.id}）。先 disable/retire。`],
      record: toPublicSsh2fa(existing),
    };
  }

  let master;
  try {
    master = resolveMasterKey(dataDir);
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'master key'] };
  }

  const secret = (input.secret?.trim() || generateTotpSecret()).replace(/\s/g, '');
  const id = randomUUID();
  const now = new Date().toISOString();
  const label = binding.linuxUser;
  const row: Ssh2faRecord = {
    id,
    linuxUser: binding.linuxUser,
    homeDir: binding.homeDir,
    projectId: binding.projectId,
    secretEnc: encryptPrivateKey(master.key, id, secret),
    status: 'enrolled',
    label,
    fromPanel: Boolean(input.fromPanel),
    notes: input.fromPanel
      ? ['進階：secret 來自 panel（與 operator 2FA 同源 — 風險自負）']
      : ['獨立 TOTP（與 panel operator 2FA 分開）'],
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const items = loadAll(dataDir);
  items.unshift(row);
  saveAll(dataDir, items);

  const notes = [...row.notes];
  if (master.source === 'generated') {
    notes.push(`已產生 secrets master key：${master.path ?? 'secrets/ssh/.master.key'}`);
  }

  return {
    ok: true,
    record: toPublicSsh2fa(row),
    secret,
    otpauthUrl: buildOtpAuthUrl({
      secret,
      username: label,
      issuer: 'YSK SSH',
    }),
    notes,
  };
}

export function confirmSsh2fa(
  dataDir: string,
  id: string,
  code: string,
): { ok: boolean; record?: Ssh2faPublic; notes: string[] } {
  const items = loadAll(dataDir);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return { ok: false, notes: ['找不到登記'] };
  const row = items[idx]!;
  try {
    const master = resolveMasterKey(dataDir);
    const secret = decryptPrivateKey(master.key, row.id, row.secretEnc);
    if (!verifyTotp(secret, code)) {
      return { ok: false, notes: ['驗證碼無效'] };
    }
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'decrypt failed'] };
  }
  items[idx] = {
    ...row,
    status: row.status === 'file_written' ? 'file_written' : 'confirmed',
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: [...row.notes, 'TOTP 確認成功'],
  };
  saveAll(dataDir, items);
  return { ok: true, record: toPublicSsh2fa(items[idx]!), notes: ['已確認'] };
}

export function revealSsh2faSecret(
  dataDir: string,
  id: string,
): { ok: boolean; secret?: string; otpauthUrl?: string; notes: string[] } {
  const row = getSsh2faInternal(dataDir, id);
  if (!row) return { ok: false, notes: ['找不到登記'] };
  try {
    const master = resolveMasterKey(dataDir);
    const secret = decryptPrivateKey(master.key, row.id, row.secretEnc);
    return {
      ok: true,
      secret,
      otpauthUrl: buildOtpAuthUrl({
        secret,
        username: row.label,
        issuer: 'YSK SSH',
      }),
      notes: ['secret revealed — audit recommended'],
    };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'decrypt failed'] };
  }
}

export function updateSsh2faStatus(
  dataDir: string,
  id: string,
  patch: Partial<
    Pick<Ssh2faRecord, 'status' | 'filePath' | 'writtenAt' | 'notes'>
  >,
): Ssh2faPublic | null {
  const items = loadAll(dataDir);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const prev = items[idx]!;
  items[idx] = {
    ...prev,
    ...patch,
    notes: patch.notes ?? prev.notes,
    updatedAt: new Date().toISOString(),
  };
  saveAll(dataDir, items);
  return toPublicSsh2fa(items[idx]!);
}

export function retireSsh2fa(
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[] } {
  const items = loadAll(dataDir);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return { ok: false, notes: ['找不到登記'] };
  items[idx] = {
    ...items[idx]!,
    status: 'retired' as Ssh2faStatus,
    updatedAt: new Date().toISOString(),
  };
  saveAll(dataDir, items);
  return { ok: true, notes: ['已退役（磁碟檔案未自動刪；可 uninstall）'] };
}
