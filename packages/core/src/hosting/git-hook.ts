/**
 * Inbound Git deploy hook — secret or HMAC, not a panel session.
 * Operator pastes the URL into GitHub / Gitea / GitLab themselves.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  resolveMasterKey,
} from '../security/ssh-identity/crypto.js';
import { gitSecretsDir } from './git-auth.js';

const HOOK_AAD = (projectId: string) => `git-hook:${projectId}`;

export type GitHookPublic = {
  enabled: boolean;
  hasSecret: boolean;
  path: string;
};

export type GitHookEvent = 'push' | 'ping' | 'other';

function hookSecretPath(dataDir: string, projectId: string): string {
  return join(gitSecretsDir(dataDir), `${projectId}.hook`);
}

export function gitHookPath(projectId: string): string {
  return `/api/v1/hooks/git/${projectId}`;
}

export function generateGitHookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hasGitHookSecret(dataDir: string, projectId: string): boolean {
  return existsSync(hookSecretPath(dataDir, projectId));
}

export function saveGitHookSecret(dataDir: string, projectId: string, secret: string): void {
  const t = secret.trim();
  if (t.length < 16 || t.length > 256) throw new Error('invalid hook secret');
  mkdirSync(gitSecretsDir(dataDir), { recursive: true, mode: 0o700 });
  try {
    chmodSync(gitSecretsDir(dataDir), 0o700);
  } catch {
    /* ignore */
  }
  const master = resolveMasterKey(dataDir);
  const blob = encryptPrivateKey(master.key, HOOK_AAD(projectId), t);
  const p = hookSecretPath(dataDir, projectId);
  writeFileSync(p, blob, { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
}

export function readGitHookSecret(dataDir: string, projectId: string): string | undefined {
  const p = hookSecretPath(dataDir, projectId);
  if (!existsSync(p)) return undefined;
  const master = resolveMasterKey(dataDir);
  return decryptPrivateKey(master.key, HOOK_AAD(projectId), readFileSync(p, 'utf8'));
}

export function clearGitHookSecret(dataDir: string, projectId: string): void {
  const p = hookSecretPath(dataDir, projectId);
  if (existsSync(p)) unlinkSync(p);
}

export function describeGitHook(
  dataDir: string,
  projectId: string,
  enabled?: boolean,
): GitHookPublic {
  return {
    enabled: Boolean(enabled && hasGitHookSecret(dataDir, projectId)),
    hasSecret: hasGitHookSecret(dataDir, projectId),
    path: gitHookPath(projectId),
  };
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return String(raw ?? '').trim();
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function hmacHex(secret: string, body: string, algo: 'sha256' | 'sha1'): string {
  return createHmac(algo, secret).update(body, 'utf8').digest('hex');
}

/** True when the request presents the project hook secret (plain header or HMAC). */
export function verifyGitHookAuth(
  headers: Record<string, string | string[] | undefined>,
  body: string,
  secret: string,
): boolean {
  if (!secret) return false;
  const plain =
    header(headers, 'x-ysk-git-hook') ||
    header(headers, 'x-gitlab-token') ||
    header(headers, 'x-gogs-signature');
  if (plain && safeEq(plain, secret)) return true;

  const hub256 = header(headers, 'x-hub-signature-256');
  if (hub256) {
    const m = hub256.match(/^sha256=([0-9a-f]+)$/i);
    if (m && safeEq(m[1]!.toLowerCase(), hmacHex(secret, body, 'sha256'))) return true;
  }
  const hub1 = header(headers, 'x-hub-signature');
  if (hub1) {
    const m = hub1.match(/^sha1=([0-9a-f]+)$/i);
    if (m && safeEq(m[1]!.toLowerCase(), hmacHex(secret, body, 'sha1'))) return true;
  }
  const gitea = header(headers, 'x-gitea-signature');
  if (gitea && /^[0-9a-f]+$/i.test(gitea)) {
    if (safeEq(gitea.toLowerCase(), hmacHex(secret, body, 'sha256'))) return true;
  }
  return false;
}

/** GitHub / Gitea / GitLab push payload `ref` (`refs/heads/main`). */
export function extractGitHookPushRef(body: string): string | undefined {
  try {
    const j = JSON.parse(body || '{}') as { ref?: unknown };
    const ref = String(j.ref ?? '').trim();
    return ref || undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when this push should sync the project.
 * No payload ref (curl / operator test) → allow.
 * SHA pin → ignore branch pushes (hook must not move the pin).
 */
export function hookPushMatchesTrackedRef(
  pushRef: string | undefined,
  tracked: string | undefined,
): boolean {
  if (!pushRef) return true;
  const t = (tracked ?? '').trim();
  if (!t) return true;
  if (/^[0-9a-f]{7,40}$/i.test(t)) return false;
  const short = pushRef.replace(/^refs\/(heads|tags)\//i, '');
  const want = t.replace(/^refs\/(heads|tags)\//i, '');
  return short.toLowerCase() === want.toLowerCase();
}

export function classifyGitHookEvent(
  headers: Record<string, string | string[] | undefined>,
  body: string,
): GitHookEvent {
  const ev = (
    header(headers, 'x-github-event') ||
    header(headers, 'x-gitea-event') ||
    header(headers, 'x-gitlab-event') ||
    header(headers, 'x-gogs-event')
  ).toLowerCase();
  if (ev === 'ping') return 'ping';
  if (ev === 'push' || ev === 'push hook') return 'push';
  if (ev) return 'other';
  // curl / no event header — treat as an operator test push
  try {
    const j = JSON.parse(body || '{}') as { zen?: string; hook_id?: unknown };
    if (j.zen || j.hook_id) return 'ping';
  } catch {
    /* empty body is a test push */
  }
  return 'push';
}

const lastFire = new Map<string, number>();

export function gitHookRateLimited(projectId: string, minMs = 5_000): boolean {
  const now = Date.now();
  const prev = lastFire.get(projectId) ?? 0;
  if (now - prev < minMs) return true;
  lastFire.set(projectId, now);
  return false;
}

/** Test-only */
export function resetGitHookRateLimit(): void {
  lastFire.clear();
}

export function isGitHookProjectId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id.trim(),
  );
}
