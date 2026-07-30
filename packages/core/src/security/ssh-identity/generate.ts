/**
 * Generate / parse OpenSSH key material via ssh-keygen (Linux control plane).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SshIdentityAlgorithm } from './types.js';

export type GeneratedKeyPair = {
  algorithm: SshIdentityAlgorithm;
  privateKey: string;
  publicKey: string;
  fingerprintSha256: string;
};

function runSshKeygen(args: string[], opts?: { input?: string }): {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const r = spawnSync('ssh-keygen', args, {
    encoding: 'utf8',
    input: opts?.input,
    timeout: 30_000,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status,
  };
}

export function fingerprintFromPublicKey(publicKey: string): string {
  const r = runSshKeygen(['-lf', '-', '-E', 'sha256'], { input: publicKey.trim() + '\n' });
  if (!r.ok) {
    throw new Error(`ssh-keygen -lf failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
  }
  // e.g. "256 SHA256:xxxx comment (ED25519)"
  const m = r.stdout.trim().match(/SHA256:[A-Za-z0-9+/=]+/);
  if (!m) throw new Error(`Cannot parse fingerprint from: ${r.stdout.slice(0, 120)}`);
  return m[0];
}

export function publicKeyFromPrivate(privateKey: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-ssh-'));
  const keyPath = join(dir, 'id');
  try {
    writeFileSync(keyPath, privateKey.endsWith('\n') ? privateKey : privateKey + '\n', {
      mode: 0o600,
    });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* ignore */
    }
    const r = runSshKeygen(['-y', '-f', keyPath]);
    if (!r.ok) {
      throw new Error(`ssh-keygen -y failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
    }
    return r.stdout.trim();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function generateSshKeyPair(input: {
  algorithm?: SshIdentityAlgorithm;
  comment?: string;
}): GeneratedKeyPair {
  const algorithm = input.algorithm ?? 'ed25519';
  const dir = mkdtempSync(join(tmpdir(), 'ysk-ssh-gen-'));
  const keyPath = join(dir, 'id');
  try {
    const args =
      algorithm === 'rsa-4096'
        ? ['-t', 'rsa', '-b', '4096', '-f', keyPath, '-N', '', '-q']
        : ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q'];
    if (input.comment) {
      args.push('-C', input.comment);
    }
    const r = runSshKeygen(args);
    if (!r.ok) {
      throw new Error(`ssh-keygen generate failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
    }
    const privateKey = readFileSync(keyPath, 'utf8');
    const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
    const fingerprintSha256 = fingerprintFromPublicKey(publicKey);
    return { algorithm, privateKey, publicKey, fingerprintSha256 };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function parseImportedPrivateKey(privateKeyRaw: string): GeneratedKeyPair {
  const privateKey = privateKeyRaw.trim() + (privateKeyRaw.endsWith('\n') ? '' : '\n');
  if (
    !privateKey.includes('PRIVATE KEY') &&
    !privateKey.includes('OPENSSH PRIVATE KEY')
  ) {
    throw new Error('Expected OpenSSH/PEM private key (BEGIN … PRIVATE KEY)');
  }
  const publicKey = publicKeyFromPrivate(privateKey);
  const fingerprintSha256 = fingerprintFromPublicKey(publicKey);
  const algorithm: SshIdentityAlgorithm = publicKey.startsWith('ssh-rsa')
    ? 'rsa-4096'
    : 'ed25519';
  return { algorithm, privateKey, publicKey, fingerprintSha256 };
}
