import { tl } from 'ysk-server-shared';
/**
 * Identity ops: test connectivity, rotate, authorize-self (public → authorized_keys).
 * Outbound helpers for ssh/scp with -i.
 */

import { existsSync } from 'node:fs';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { addSftpKey, chownSftpProjectKeys } from '../../hosting/sftp-keys.js';
import { materializeIdentityKeyFile } from './install.js';
import {
  createSshIdentity,
  getSshIdentityInternal,
  listSshIdentities,
  updateSshIdentityRecord } from './store.js';
import { toPublicIdentity, type SshIdentityPublic } from './types.js';

export type TestSshIdentityResult = {
  ok: boolean;
  dryRun: boolean;
  applied: boolean;
  blocked: boolean;
  requiresExecute: boolean;
  target?: string;
  identity?: SshIdentityPublic;
  notes: string[];
  exitCode?: number;
};

/** Parse user@host[:port] or bare host (root@host). */
export function parseSshTarget(target: string): {
  user: string;
  host: string;
  port: number;
} | null {
  const t = target.trim();
  if (!t) return null;
  const m = t.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/);
  if (m) {
    return {
      user: m[1]!,
      host: m[2]!,
      port: m[3] ? Number(m[3]) : 22 };
  }
  if (/^[\w.-]+$/.test(t)) {
    return { user: 'root', host: t, port: 22 };
  }
  return null;
}

export function buildIdentityFileOpts(privateKeyPath: string): string[] {
  return [
    '-i',
    privateKeyPath,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
}

export function buildSshIdentityArgv(
  privateKeyPath: string,
  extra: {
    port?: number;
    userAtHost: string;
    remoteCommand?: string[];
    connectTimeout?: number;
  },
): string[] {
  const argv = ['ssh', ...buildIdentityFileOpts(privateKeyPath)];
  argv.push('-o', `ConnectTimeout=${extra.connectTimeout ?? 8}`);
  if (extra.port) {
    argv.push('-p', String(extra.port));
  }
  argv.push(extra.userAtHost);
  if (extra.remoteCommand?.length) {
    argv.push(...extra.remoteCommand);
  }
  return argv;
}

export function buildScpIdentityArgv(
  privateKeyPath: string,
  opts: {
    port?: number;
    localPath: string;
    remoteSpec: string;
  },
): string[] {
  return [
    'scp',
    ...buildIdentityFileOpts(privateKeyPath),
    '-P',
    String(opts.port ?? 22),
    opts.localPath,
    opts.remoteSpec,
  ];
}

/** Auth succeeded but the account has no SSH shell (nologin / SFTP-only). */
export function isSftpOnlyOrNologinMessage(text: string): boolean {
  return /this service allows sftp connections only|this account is currently not available|nologin|shell.*not available|sftp connections only/i.test(
    text,
  );
}

export function buildSftpIdentityArgv(
  privateKeyPath: string,
  opts: {
    port?: number;
    userAtHost: string;
  },
): string[] {
  return [
    'sftp',
    ...buildIdentityFileOpts(privateKeyPath),
    '-o',
    'ConnectTimeout=8',
    '-P',
    String(opts.port ?? 22),
    '-b',
    '-',
    opts.userAtHost,
  ];
}

export function sftpQuote(path: string): string {
  if (!/[\s'"\\]/.test(path)) return path;
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Quote a batch so bash `printf %s $'…'` emits real newlines.
 * JSON.stringify("pwd\n") is `"pwd\\n"`; `printf %s` then feeds sftp the
 * two-character command `pwd\n` → "Invalid command."
 */
export function bashAnsiCQuote(s: string): string {
  return `$'${s.replace(/\\/g, '\\\\').replace(/'/g, `\\'`).replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

export function sftpStdinArgv(sftpArgv: string[], batch: string): string[] {
  const body = batch.endsWith('\n') ? batch : `${batch}\n`;
  return [
    'bash',
    '-c',
    `printf %s ${bashAnsiCQuote(body)} | ${sftpArgv.map((a) => JSON.stringify(a)).join(' ')}`,
  ];
}

export function sftpMkdirBatch(remoteDir: string): string {
  const dir = remoteDir.replace(/\/+$/, '');
  if (!dir || dir === '.') return 'pwd\n';
  const parts = dir.split('/').filter(Boolean);
  const cmds: string[] = [];
  let acc = dir.startsWith('/') ? '' : '';
  for (const p of parts) {
    acc = dir.startsWith('/') ? `${acc}/${p}` : acc ? `${acc}/${p}` : p;
    cmds.push(`-mkdir ${sftpQuote(acc)}`);
  }
  return `${cmds.join('\n')}\n`;
}

export function sftpPutBatch(localPath: string, remoteDir: string): string {
  const base = localPath.split('/').pop() || 'archive';
  const dir = remoteDir.replace(/\/+$/, '') || '.';
  const dest = dir === '.' ? base : `${dir}/${base}`;
  return `put ${sftpQuote(localPath)} ${sftpQuote(dest)}\n`;
}

/**
 * Resolve private key path for outbound ssh/scp (-i).
 * Prefers install path; else materializes under dataDir/secrets/ssh/keys/{id}/.
 */
export function resolveIdentityKeyPath(
  dataDir: string,
  identityId: string,
): { ok: boolean; path?: string; notes: string[] } {
  const row = getSshIdentityInternal(dataDir, identityId);
  if (!row) return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };
  if (row.install?.path && existsSync(row.install.path)) {
    return {
      ok: true,
      path: row.install.path,
      notes: [`using install path ${row.install.path}`] };
  }
  return materializeIdentityKeyFile(dataDir, identityId);
}

export async function testSshIdentity(input: {
  dataDir: string;
  id: string;
  target: string;
  apply?: boolean;
  host?: HostExecutor;
  executeEnabled?: boolean;
}): Promise<TestSshIdentityResult> {
  const notes: string[] = [];
  const row = getSshIdentityInternal(input.dataDir, input.id);
  if (!row) {
    return {
      ok: false,
      dryRun: !input.apply,
      applied: false,
      blocked: false,
      requiresExecute: true,
      notes: [tl('notes.ssh.identityNotFound')] };
  }

  const parsed = parseSshTarget(input.target);
  if (!parsed) {
    return {
      ok: false,
      dryRun: !input.apply,
      applied: false,
      blocked: false,
      requiresExecute: false,
      notes: [tl('notes.auto.n0445')] };
  }

  const mat = resolveIdentityKeyPath(input.dataDir, input.id);
  if (!mat.ok || !mat.path) {
    return {
      ok: false,
      dryRun: !input.apply,
      applied: false,
      blocked: false,
      requiresExecute: false,
      identity: toPublicIdentity(row),
      notes: mat.notes };
  }

  const argv = buildSshIdentityArgv(mat.path, {
    port: parsed.port,
    userAtHost: `${parsed.user}@${parsed.host}`,
    remoteCommand: ['true'] });
  notes.push(`plan: ${argv.join(' ')}`);
  notes.push(tl('notes.auto.n0839'));

  if (!input.apply) {
    notes.push(tl('notes.auto.n0267'));
    return {
      ok: true,
      dryRun: true,
      applied: false,
      blocked: false,
      requiresExecute: true,
      target: `${parsed.user}@${parsed.host}:${parsed.port}`,
      identity: toPublicIdentity(row),
      notes };
  }

  if (!input.executeEnabled || !input.host) {
    notes.push(tl('notes.auto.n0230'));
    return {
      ok: false,
      dryRun: false,
      applied: false,
      blocked: true,
      requiresExecute: true,
      target: `${parsed.user}@${parsed.host}:${parsed.port}`,
      identity: toPublicIdentity(row),
      notes };
  }

  const r = await input.host.runCommand(argv, { timeoutMs: 20_000 });
  const errText = `${r.stderr || ''} ${r.stdout || ''}`;
  const nologin = r.exitCode !== 0 && isSftpOnlyOrNologinMessage(errText);
  let ok = r.exitCode === 0 || nologin;
  if (nologin) {
    const sftp = await input.host.runCommand(
      sftpStdinArgv(
        buildSftpIdentityArgv(mat.path, {
          port: parsed.port,
          userAtHost: `${parsed.user}@${parsed.host}`,
        }),
        'pwd\n',
      ),
      { timeoutMs: 20_000 },
    );
    if (sftp.exitCode === 0) {
      notes.push(tl('notes.ssh.keyOkSftp'));
    }
  }
  notes.push(
    r.exitCode === 0
      ? tl('notes.auto.n0434')
      : nologin
        ? tl('notes.ssh.keyOkNologin')
        : tl('notes.auto.t0519', { v0: errText.slice(0, 160) }),
  );

  const identity = updateSshIdentityRecord(input.dataDir, row.id, {
    status: ok ? 'verified' : 'error',
    lastVerifiedAt: new Date().toISOString(),
    lastVerifyNote: ok
      ? `ok ${parsed.user}@${parsed.host}`
      : notes[notes.length - 1] });

  return {
    ok,
    dryRun: false,
    applied: true,
    blocked: false,
    requiresExecute: false,
    target: `${parsed.user}@${parsed.host}:${parsed.port}`,
    identity: identity ?? undefined,
    notes,
    exitCode: r.exitCode };
}

export type RotateSshIdentityResult = {
  ok: boolean;
  oldIdentity?: SshIdentityPublic;
  newIdentity?: SshIdentityPublic;
  privateKey?: string;
  notes: string[];
};

/** Generate new key; mark old retired. Optionally reveal private once. */
export function rotateSshIdentity(input: {
  dataDir: string;
  id: string;
  revealPrivate?: boolean;
  db?: JsonStore;
}): RotateSshIdentityResult {
  const old = getSshIdentityInternal(input.dataDir, input.id);
  if (!old) return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };

  const notes: string[] = [`retire ${old.id} (${old.fingerprintSha256})`];
  updateSshIdentityRecord(input.dataDir, old.id, {
    status: 'retired',
    name: old.name.endsWith(' (retired)') ? old.name : `${old.name} (retired)` });

  const baseName = old.name.replace(/\s*\(retired\)\s*$/, '').trim() || old.name;
  const created = createSshIdentity(
    input.dataDir,
    {
      name: baseName,
      algorithm: old.algorithm,
      purpose: old.purpose,
      binding: old.binding,
      comment: old.comment ?? `rotated from ${old.fingerprintSha256}`,
      createdBy: old.createdBy,
      revealPrivate: input.revealPrivate },
    input.db,
  );

  if (!created.ok || !created.identity) {
    return {
      ok: false,
      oldIdentity: toPublicIdentity(old),
      notes: [...notes, ...(created.notes ?? ['create failed'])] };
  }
  notes.push(...created.notes);
  notes.push(`new ${created.identity.id} ${created.identity.fingerprintSha256}`);
  notes.push(tl('notes.auto.n1345'));

  return {
    ok: true,
    oldIdentity: listSshIdentities(input.dataDir).find((i) => i.id === old.id),
    newIdentity: created.identity,
    privateKey: created.privateKey,
    notes };
}

export type AuthorizeSelfResult = {
  ok: boolean;
  notes: string[];
  written?: string[];
  keyId?: string;
};

/** Append this identity's public key to binding user's authorized_keys. */
export async function authorizeSelfSshIdentity(input: {
  dataDir: string;
  db: JsonStore;
  id: string;
  host?: HostExecutor;
}): Promise<AuthorizeSelfResult> {
  const row = getSshIdentityInternal(input.dataDir, input.id);
  if (!row) return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };

  const linuxUser = row.binding?.linuxUser;
  const homeDir = row.binding?.homeDir;
  const projectId = row.binding?.projectId;
  if (!linuxUser && !projectId && !homeDir) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0305')] };
  }

  const r = addSftpKey(input.db, input.dataDir, {
    username: linuxUser || 'unknown',
    publicKey: row.publicKey,
    comment: `ysk-identity:${row.id.slice(0, 8)} ${row.name}`,
    projectId,
    linuxUser,
    homeDir });

  if (r.ok && homeDir && linuxUser && input.host) {
    const ch = await chownSftpProjectKeys(input.host, homeDir, linuxUser);
    r.notes.push(...ch);
  }

  return {
    ok: r.ok,
    notes: r.notes,
    written: r.written,
    keyId: r.key?.id };
}
