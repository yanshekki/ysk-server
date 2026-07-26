/**
 * Managed Sieve filter scripts per mailbox (written under dataDir; not auto-active on Dovecot).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';

export type SieveScript = {
  mailbox: string;
  name: string;
  path: string;
  bytes: number;
  updatedAt: string;
};

function safeMailbox(m: string): string {
  const s = m.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) && !/^[a-z0-9._-]+$/.test(s)) {
    throw new YskError(ErrorCodes.VALIDATION, '郵箱 ID 無效', { httpStatus: 400 });
  }
  return s.replace(/[^a-z0-9._@+-]/gi, '_');
}

export function sieveDir(dataDir: string, mailbox: string): string {
  const dir = join(dataDir, 'email', 'sieve', safeMailbox(mailbox));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function listSieveScripts(dataDir: string, mailbox: string): SieveScript[] {
  const dir = sieveDir(dataDir, mailbox);
  const out: SieveScript[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.sieve')) continue;
    const path = join(dir, name);
    const st = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
    out.push({
      mailbox: safeMailbox(mailbox),
      name,
      path,
      bytes: st.length,
      updatedAt: new Date().toISOString(),
    });
  }
  return out;
}

export function writeSieveScript(input: {
  dataDir: string;
  mailbox: string;
  name?: string;
  content: string;
}): { ok: boolean; script: SieveScript; notes: string[] } {
  const name = (input.name ?? 'default.sieve').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name.endsWith('.sieve')) {
    throw new YskError(ErrorCodes.VALIDATION, '檔名須以 .sieve 結尾', { httpStatus: 400 });
  }
  const dir = sieveDir(input.dataDir, input.mailbox);
  const path = join(dir, name);
  writeFileSync(path, input.content, 'utf8');
  return {
    ok: true,
    script: {
      mailbox: safeMailbox(input.mailbox),
      name,
      path,
      bytes: Buffer.byteLength(input.content),
      updatedAt: new Date().toISOString(),
    },
    notes: [
      `已寫入 ${path}`,
      'written ≠ Dovecot Pigeonhole 已載入 — 需 ManageSieve 或 symlink 到 user sieve',
    ],
  };
}

export function readSieveScript(
  dataDir: string,
  mailbox: string,
  name: string,
): { content: string; path: string } {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  const path = join(sieveDir(dataDir, mailbox), safe);
  if (!existsSync(path)) {
    throw new YskError(ErrorCodes.NOT_FOUND, '找不到 Sieve 腳本', { httpStatus: 404 });
  }
  return { content: readFileSync(path, 'utf8'), path };
}

export function deleteSieveScript(
  dataDir: string,
  mailbox: string,
  name: string,
): { ok: boolean; notes: string[] } {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  const path = join(sieveDir(dataDir, mailbox), safe);
  if (!existsSync(path)) return { ok: false, notes: ['找不到'] };
  unlinkSync(path);
  return { ok: true, notes: [`已刪除 ${path}`] };
}

export const DEFAULT_SIEVE_TEMPLATE = `require ["fileinto", "vacation"];
# YSK managed sieve — edit carefully
# if header :contains "X-Spam-Flag" "YES" { fileinto "Junk"; stop; }
`;
