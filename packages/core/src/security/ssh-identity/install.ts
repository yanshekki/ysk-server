import { tl } from 'ysk-server-shared';
/**
 * Install / uninstall identity private keys to Linux user home or panel secrets path.
 * Honest: dry-run default; apply needs root + YSK_EXECUTE via HostExecutor.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../../hosting/project-user-run.js';
import { decryptPrivateKey, resolveMasterKey, secretsSshDir } from './crypto.js';
import {
  exportSshIdentityPrivate,
  getSshIdentityInternal,
  updateSshIdentityRecord } from './store.js';
import { toPublicIdentity, type SshIdentityPublic } from './types.js';

export type InstallSshIdentityResult = {
  ok: boolean;
  dryRun: boolean;
  applied: boolean;
  blocked: boolean;
  requiresRoot: boolean;
  requiresExecute: boolean;
  plannedPath?: string;
  plannedPublicPath?: string;
  identity?: SshIdentityPublic;
  notes: string[];
};

function defaultInstallPaths(
  dataDir: string,
  identity: NonNullable<ReturnType<typeof getSshIdentityInternal>>,
): { privatePath: string; publicPath: string; owner?: string } {
  if (identity.purpose === 'panel_outbound' || !identity.binding?.homeDir) {
    const dir = join(secretsSshDir(dataDir), 'keys', identity.id);
    return {
      privatePath: join(dir, 'id_ed25519'),
      publicPath: join(dir, 'id_ed25519.pub') };
  }
  const home = identity.binding.homeDir;
  const base =
    identity.algorithm === 'rsa-4096' ? 'id_rsa' : 'id_ed25519';
  return {
    privatePath: join(home, '.ssh', base),
    publicPath: join(home, '.ssh', `${base}.pub`),
    owner: identity.binding.linuxUser };
}

export async function installSshIdentity(input: {
  dataDir: string;
  id: string;
  apply?: boolean;
  host?: HostExecutor;
  isRoot?: boolean;
  executeEnabled?: boolean;
}): Promise<InstallSshIdentityResult> {
  const notes: string[] = [];
  const row = getSshIdentityInternal(input.dataDir, input.id);
  if (!row) {
    return {
      ok: false,
      dryRun: !input.apply,
      applied: false,
      blocked: false,
      requiresRoot: true,
      requiresExecute: true,
      notes: [tl('notes.ssh.identityNotFound')] };
  }

  const paths = defaultInstallPaths(input.dataDir, row);
  notes.push(`planned private: ${paths.privatePath} mode 0600`);
  notes.push(`planned public:  ${paths.publicPath} mode 0644`);
  if (paths.owner) notes.push(`owner: ${paths.owner}`);

  const apply = Boolean(input.apply);
  if (!apply) {
    notes.push('dry-run — pass apply/execute to write disk');
    return {
      ok: true,
      dryRun: true,
      applied: false,
      blocked: false,
      requiresRoot: true,
      requiresExecute: true,
      plannedPath: paths.privatePath,
      plannedPublicPath: paths.publicPath,
      identity: toPublicIdentity(row),
      notes };
  }

  const requiresRoot = true;
  const requiresExecute = true;
  if (!input.executeEnabled) {
    notes.push(tl('notes.auto.n0003'));
    const identity = updateSshIdentityRecord(input.dataDir, row.id, {
      lastVerifyNote: notes[notes.length - 1],
    });
    return {
      ok: false,
      dryRun: false,
      applied: false,
      blocked: true,
      requiresRoot,
      requiresExecute,
      plannedPath: paths.privatePath,
      plannedPublicPath: paths.publicPath,
      identity: identity ?? undefined,
      notes };
  }

  let privateKey: string;
  try {
    const master = resolveMasterKey(input.dataDir);
    privateKey = decryptPrivateKey(master.key, row.id, row.privateKeyEnc);
  } catch (e) {
    notes.push(e instanceof Error ? e.message : 'decrypt failed');
    const identity = updateSshIdentityRecord(input.dataDir, row.id, {
      lastVerifyNote: notes[notes.length - 1],
    });
    return {
      ok: false,
      dryRun: false,
      applied: false,
      blocked: false,
      requiresRoot,
      requiresExecute,
      identity: identity ?? undefined,
      notes };
  }

  // Write via process (panel dataDir) or host for user homes
  try {
    const sshDir = join(paths.privatePath, '..');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(paths.privatePath, privateKey.endsWith('\n') ? privateKey : privateKey + '\n', {
      mode: 0o600 });
    writeFileSync(
      paths.publicPath,
      row.publicKey.endsWith('\n') ? row.publicKey : row.publicKey + '\n',
      { mode: 0o644 },
    );
    try {
      chmodSync(sshDir, 0o700);
      chmodSync(paths.privatePath, 0o600);
      chmodSync(paths.publicPath, 0o644);
    } catch {
      /* ignore */
    }
  } catch (e) {
    notes.push(`write failed: ${e instanceof Error ? e.message : String(e)}`);
    const identity = updateSshIdentityRecord(input.dataDir, row.id, {
      lastVerifyNote: notes[notes.length - 1],
    });
    return {
      ok: false,
      dryRun: false,
      applied: false,
      blocked: false,
      requiresRoot,
      requiresExecute,
      plannedPath: paths.privatePath,
      plannedPublicPath: paths.publicPath,
      identity: identity ?? undefined,
      notes };
  }

  if (paths.owner && input.host) {
    const ch = await input.host.runCommand(
      [
        'bash',
        '-c',
        `chown -R ${shellQuote(paths.owner)}:${shellQuote(paths.owner)} ${shellQuote(join(paths.privatePath, '..'))} 2>&1 || true`,
      ],
      { timeoutMs: 10_000 },
    );
    if (ch.exitCode !== 0) {
      notes.push(tl('notes.auto.t0518', { v0: ((ch.stderr || ch.stdout).slice(0, 120)) }));
    } else {
      notes.push(`chown ${paths.owner} ok`);
    }
  } else if (paths.owner && !input.host) {
    notes.push(tl('notes.auto.n1059'));
  }

  const identity = updateSshIdentityRecord(input.dataDir, row.id, {
    install: {
      path: paths.privatePath,
      publicPath: paths.publicPath,
      installedAt: new Date().toISOString(),
      mode: '600' },
    status: 'installed' });

  notes.push('written to disk (installed ≠ remote ssh verified)');
  return {
    ok: true,
    dryRun: false,
    applied: true,
    blocked: false,
    requiresRoot,
    requiresExecute,
    plannedPath: paths.privatePath,
    plannedPublicPath: paths.publicPath,
    identity: identity ?? undefined,
    notes };
}

export async function uninstallSshIdentity(input: {
  dataDir: string;
  id: string;
  apply?: boolean;
  purgeFiles?: boolean;
}): Promise<InstallSshIdentityResult> {
  const notes: string[] = [];
  const row = getSshIdentityInternal(input.dataDir, input.id);
  if (!row) {
    return {
      ok: false,
      dryRun: !input.apply,
      applied: false,
      blocked: false,
      requiresRoot: false,
      requiresExecute: false,
      notes: [tl('notes.ssh.identityNotFound')] };
  }

  const path = row.install?.path;
  const pub = row.install?.publicPath;
  if (!path) {
    notes.push(tl('notes.auto.n1079'));
    if (input.apply) {
      updateSshIdentityRecord(input.dataDir, row.id, {
        install: undefined,
        status: 'stored' });
    }
    return {
      ok: true,
      dryRun: !input.apply,
      applied: Boolean(input.apply),
      blocked: false,
      requiresRoot: false,
      requiresExecute: false,
      notes };
  }

  notes.push(`will remove: ${path}`);
  if (pub) notes.push(`will remove: ${pub}`);

  if (!input.apply) {
    notes.push('dry-run');
    return {
      ok: true,
      dryRun: true,
      applied: false,
      blocked: false,
      requiresRoot: false,
      requiresExecute: false,
      plannedPath: path,
      plannedPublicPath: pub,
      notes };
  }

  if (input.purgeFiles !== false) {
    for (const p of [path, pub]) {
      if (p && existsSync(p)) {
        try {
          unlinkSync(p);
          notes.push(`removed ${p}`);
        } catch (e) {
          notes.push(`remove failed ${p}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  const identity = updateSshIdentityRecord(input.dataDir, row.id, {
    install: undefined,
    status: 'stored' });

  return {
    ok: true,
    dryRun: false,
    applied: true,
    blocked: false,
    requiresRoot: false,
    requiresExecute: false,
    identity: identity ?? undefined,
    notes };
}

/** Materialize private key to panel path for -i use (idempotent install for panel purpose). */
export function materializeIdentityKeyFile(
  dataDir: string,
  id: string,
): { ok: boolean; path?: string; notes: string[] } {
  const exp = exportSshIdentityPrivate(dataDir, id);
  if (!exp.ok || !exp.privateKey) {
    return { ok: false, notes: exp.notes };
  }
  const row = getSshIdentityInternal(dataDir, id);
  if (!row) return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };
  const paths = defaultInstallPaths(dataDir, row);
  mkdirSync(join(paths.privatePath, '..'), { recursive: true });
  writeFileSync(paths.privatePath, exp.privateKey.endsWith('\n') ? exp.privateKey : exp.privateKey + '\n', {
    mode: 0o600 });
  writeFileSync(
    paths.publicPath,
    row.publicKey.endsWith('\n') ? row.publicKey : row.publicKey + '\n',
    { mode: 0o644 },
  );
  try {
    chmodSync(paths.privatePath, 0o600);
  } catch {
    /* ignore */
  }
  return { ok: true, path: paths.privatePath, notes: [`materialized ${paths.privatePath}`] };
}

/** ssh/scp argv fragment: -i path -o IdentitiesOnly=yes -o BatchMode=yes */
export function buildSshIdentityArgs(privateKeyPath: string): string[] {
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
