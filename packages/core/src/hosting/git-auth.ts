/**
 * Project Git auth: HTTPS token + SSH deploy key + known_hosts pin.
 * Tokens never go in the remote URL or GET responses.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  resolveMasterKey,
} from '../security/ssh-identity/crypto.js';
import {
  createSshIdentity,
  getSshIdentity,
  getSshIdentityInternal,
} from '../security/ssh-identity/store.js';
import { fingerprintFromPublicKey } from '../security/ssh-identity/generate.js';
import type { GitErrorCode } from './git-errors.js';

const TOKEN_AAD = (projectId: string) => `git-token:${projectId}`;

export type GitUrlScheme = 'https' | 'ssh' | 'file' | 'other';

export type GitAuthKind = 'none' | 'ssh' | 'https-token';

export type GitHostKeyLine = { type: string; fingerprint: string; raw: string };

export type GitAuthPublic = {
  kind: GitAuthKind;
  scheme: GitUrlScheme;
  host?: string;
  hasToken: boolean;
  publicKey?: string;
  fingerprint?: string;
  hostPinned: boolean;
  hostKeys?: GitHostKeyLine[];
};

export type GitAuthRuntime = {
  env?: Record<string, string>;
  blocked?: { code: GitErrorCode; message: string };
};

export function gitSecretsDir(dataDir: string): string {
  return join(dataDir, 'secrets', 'git');
}

function tokenPath(dataDir: string, projectId: string): string {
  return join(gitSecretsDir(dataDir), `${projectId}.tok`);
}

function keyPath(dataDir: string, projectId: string): string {
  return join(gitSecretsDir(dataDir), `${projectId}.key`);
}

function knownHostsPath(dataDir: string, projectId: string): string {
  return join(gitSecretsDir(dataDir), `${projectId}.known_hosts`);
}

function askpassPath(dataDir: string): string {
  return join(gitSecretsDir(dataDir), 'askpass.sh');
}

export function parseGitRemoteHost(url: string): { scheme: GitUrlScheme; host?: string } {
  const u = url.trim();
  if (!u) return { scheme: 'other' };
  if (u.startsWith('/') || u.startsWith('file://')) return { scheme: 'file' };
  if (u.startsWith('https://') || u.startsWith('http://')) {
    try {
      return { scheme: 'https', host: new URL(u).hostname || undefined };
    } catch {
      return { scheme: 'https' };
    }
  }
  if (u.startsWith('git@')) {
    const host = u.slice(4).split(/[:/]/)[0]?.trim();
    return { scheme: 'ssh', host: host || undefined };
  }
  if (u.startsWith('ssh://')) {
    try {
      return { scheme: 'ssh', host: new URL(u).hostname || undefined };
    } catch {
      return { scheme: 'ssh' };
    }
  }
  return { scheme: 'other' };
}

function ensureGitSecretsDir(dataDir: string): void {
  mkdirSync(gitSecretsDir(dataDir), { recursive: true, mode: 0o700 });
  try {
    chmodSync(gitSecretsDir(dataDir), 0o700);
  } catch {
    /* ignore */
  }
}

export function hasGitHttpsToken(dataDir: string, projectId: string): boolean {
  return existsSync(tokenPath(dataDir, projectId));
}

export function saveGitHttpsToken(dataDir: string, projectId: string, token: string): void {
  const t = token.trim();
  if (!t || t.length > 4096) {
    throw new Error('invalid token');
  }
  ensureGitSecretsDir(dataDir);
  const master = resolveMasterKey(dataDir);
  const blob = encryptPrivateKey(master.key, TOKEN_AAD(projectId), t);
  const p = tokenPath(dataDir, projectId);
  writeFileSync(p, blob, { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
}

export function readGitHttpsToken(dataDir: string, projectId: string): string | undefined {
  const p = tokenPath(dataDir, projectId);
  if (!existsSync(p)) return undefined;
  const master = resolveMasterKey(dataDir);
  return decryptPrivateKey(master.key, TOKEN_AAD(projectId), readFileSync(p, 'utf8'));
}

export function clearGitHttpsToken(dataDir: string, projectId: string): void {
  const p = tokenPath(dataDir, projectId);
  if (existsSync(p)) unlinkSync(p);
}

export function isGitHostPinned(dataDir: string, projectId: string, host?: string): boolean {
  if (!host) return false;
  const p = knownHostsPath(dataDir, projectId);
  if (!existsSync(p)) return false;
  const text = readFileSync(p, 'utf8');
  return text.split('\n').some((line) => {
    const first = line.trim().split(/\s+/)[0] ?? '';
    return first === host || first.split(',').includes(host);
  });
}

export function parseSshKeyscan(stdout: string): GitHostKeyLine[] {
  const out: GitHostKeyLine[] = [];
  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 3) continue;
    const type = parts[1]!;
    const key = parts[2]!;
    let fingerprint = type;
    try {
      fingerprint = fingerprintFromPublicKey(`${type} ${key}`);
    } catch {
      /* keep type */
    }
    out.push({ type, fingerprint, raw: s });
  }
  return out;
}

export async function scanGitHostKeys(
  hostExec: HostExecutor,
  host: string,
): Promise<GitHostKeyLine[]> {
  if (!host || /[\s;|&$`]/.test(host)) return [];
  const r = await hostExec.runCommand(['ssh-keyscan', '-T', '5', '-t', 'ed25519,rsa,ecdsa', host], {
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0 && !r.stdout) return [];
  return parseSshKeyscan(r.stdout || '');
}

export function pinGitHostKeys(
  dataDir: string,
  projectId: string,
  host: string,
  keys: GitHostKeyLine[],
): void {
  ensureGitSecretsDir(dataDir);
  const lines = keys.map((k) => k.raw).filter(Boolean);
  if (!lines.length) throw new Error('no host keys to pin');
  const p = knownHostsPath(dataDir, projectId);
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const kept = existing
    .split('\n')
    .filter((line) => {
      const first = line.trim().split(/\s+/)[0] ?? '';
      return first && first !== host && !first.split(',').includes(host);
    });
  writeFileSync(p, `${[...kept, ...lines].filter(Boolean).join('\n')}\n`, { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
}

export function clearGitHostPin(dataDir: string, projectId: string): void {
  const p = knownHostsPath(dataDir, projectId);
  if (existsSync(p)) unlinkSync(p);
}

export function materializeGitDeployKey(
  dataDir: string,
  projectId: string,
  identityId: string,
): string | undefined {
  const row = getSshIdentityInternal(dataDir, identityId);
  if (!row) return undefined;
  const master = resolveMasterKey(dataDir);
  const pem = decryptPrivateKey(master.key, identityId, row.privateKeyEnc);
  ensureGitSecretsDir(dataDir);
  const p = keyPath(dataDir, projectId);
  writeFileSync(p, pem.endsWith('\n') ? pem : `${pem}\n`, { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
  return p;
}

export function clearGitDeployKeyFile(dataDir: string, projectId: string): void {
  const p = keyPath(dataDir, projectId);
  if (existsSync(p)) unlinkSync(p);
}

export function ensureGitAskpass(dataDir: string): string {
  ensureGitSecretsDir(dataDir);
  const p = askpassPath(dataDir);
  const body = `#!/bin/sh
# YSK Server git askpass — token from env, never from argv
prompt=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
case "$prompt" in
  *username*) printf '%s\\n' "\${YSK_GIT_USERNAME:-git}" ;;
  *) printf '%s\\n' "\${YSK_GIT_TOKEN}" ;;
esac
`;
  writeFileSync(p, body, { mode: 0o700 });
  try {
    chmodSync(p, 0o700);
  } catch {
    /* ignore */
  }
  return p;
}

export function createProjectGitDeployKey(input: {
  dataDir: string;
  projectId: string;
  projectName?: string;
  actor?: string;
}): { ok: boolean; identityId?: string; publicKey?: string; fingerprint?: string; notes: string[] } {
  const created = createSshIdentity(input.dataDir, {
    name: `git-${(input.projectName || input.projectId).slice(0, 24)}`,
    comment: `ysk-git-${input.projectId.slice(0, 8)}`,
    algorithm: 'ed25519',
    purpose: 'panel_outbound',
    binding: { projectId: input.projectId },
    createdBy: input.actor,
  });
  if (!created.ok || !created.identity) {
    return { ok: false, notes: created.notes.length ? created.notes : [tl('notes.git.unknown')] };
  }
  try {
    materializeGitDeployKey(input.dataDir, input.projectId, created.identity.id);
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : tl('notes.git.unknown')],
    };
  }
  return {
    ok: true,
    identityId: created.identity.id,
    publicKey: created.identity.publicKey,
    fingerprint: created.identity.fingerprintSha256,
    notes: [tl('notes.git.deployKeyCreated'), ...created.notes],
  };
}

export function describeGitAuth(input: {
  dataDir: string;
  projectId: string;
  gitUrl?: string;
  authKind?: GitAuthKind;
  identityId?: string;
}): GitAuthPublic {
  const parsed = parseGitRemoteHost(input.gitUrl ?? '');
  const kind = input.authKind ?? 'none';
  const pub: GitAuthPublic = {
    kind,
    scheme: parsed.scheme,
    host: parsed.host,
    hasToken: hasGitHttpsToken(input.dataDir, input.projectId),
    hostPinned: isGitHostPinned(input.dataDir, input.projectId, parsed.host),
  };
  if (kind === 'ssh' && input.identityId) {
    const id = getSshIdentity(input.dataDir, input.identityId);
    if (id) {
      pub.publicKey = id.publicKey;
      pub.fingerprint = id.fingerprintSha256;
    }
  }
  return pub;
}

/**
 * Env for git clone/fetch/pull. SSH without a pinned host is blocked.
 */
export function resolveGitAuthRuntime(input: {
  dataDir: string;
  projectId: string;
  gitUrl: string;
  authKind?: GitAuthKind;
  identityId?: string;
}): GitAuthRuntime {
  const parsed = parseGitRemoteHost(input.gitUrl);
  if (parsed.scheme === 'file' || parsed.scheme === 'other' || !input.gitUrl.trim()) {
    return {};
  }
  if (parsed.scheme === 'ssh') {
    if (!parsed.host) {
      return { blocked: { code: 'hostkey', message: tl('notes.git.hostkey') } };
    }
    if (!isGitHostPinned(input.dataDir, input.projectId, parsed.host)) {
      return { blocked: { code: 'hostkey', message: tl('notes.git.needPinHost') } };
    }
    let identityFile = keyPath(input.dataDir, input.projectId);
    if (!existsSync(identityFile) && input.identityId) {
      identityFile = materializeGitDeployKey(input.dataDir, input.projectId, input.identityId) ?? '';
    }
    if (!identityFile || !existsSync(identityFile)) {
      return { blocked: { code: 'auth', message: tl('notes.git.auth') } };
    }
    const kh = knownHostsPath(input.dataDir, input.projectId);
    const ssh = [
      'ssh',
      '-i',
      identityFile,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      `UserKnownHostsFile=${kh}`,
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'BatchMode=yes',
    ].join(' ');
    return {
      env: {
        GIT_SSH_COMMAND: ssh,
        GIT_TERMINAL_PROMPT: '0',
      },
    };
  }
  // HTTPS
  const token = readGitHttpsToken(input.dataDir, input.projectId);
  if (!token) return {};
  const ask = ensureGitAskpass(input.dataDir);
  return {
    env: {
      GIT_ASKPASS: ask,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      YSK_GIT_TOKEN: token,
      YSK_GIT_USERNAME: 'git',
    },
  };
}
