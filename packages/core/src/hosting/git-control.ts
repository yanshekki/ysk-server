/**
 * Project Git control: status, fetch, checkout, reset, log.
 * Deploy source on the host — not a developer Git client.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { classifyGitError, type GitErrorCode } from './git-errors.js';
import { binPresent } from './software-probe/index.js';

export const GIT_PROTECTED = ['.env'] as const;

export type GitCommitRow = {
  hash: string;
  subject: string;
  at?: string;
};

export type GitStatus = {
  ok: boolean;
  gitInstalled: boolean;
  isRepo: boolean;
  remoteUrl?: string;
  branch?: string;
  detached: boolean;
  commit?: string;
  commitSubject?: string;
  dirty: boolean;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  shallow: boolean;
  heads: string[];
  lastError?: { code: GitErrorCode; message: string };
  notes: string[];
};

export type GitOpResult = {
  ok: boolean;
  action: string;
  notes: string[];
  code?: GitErrorCode;
  stdout?: string;
  stderr?: string;
  commit?: string;
  branch?: string;
};

function gitArgv(repoDir: string, rest: string[]): string[] {
  // Root (or any other uid) reading a project-owned tree trips
  // "fatal: detected dubious ownership" unless this repo is trusted
  // for this invocation — do not require a global safe.directory.
  return ['git', '-c', `safe.directory=${repoDir}`, '-C', repoDir, ...rest];
}

export type GitAuthEnv = Record<string, string>;

async function git(
  host: HostExecutor,
  repoDir: string,
  rest: string[],
  timeoutMs = 30_000,
  env?: GitAuthEnv,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const r = await host.runCommand(gitArgv(repoDir, rest), { timeoutMs, env });
  return { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function failOp(action: string, code: GitErrorCode, extra?: string): GitOpResult {
  const notes = [tl(`notes.git.${camel(code)}`)];
  if (extra) notes.push(extra.slice(0, 400));
  return { ok: false, action, notes, code };
}

function camel(code: string): string {
  return code.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Paths that should not block pull (panel rewrites them after sync). */
export function isProtectedGitPath(rel: string): boolean {
  const n = rel.replace(/^\.\//, '').replace(/\\/g, '/');
  return GIT_PROTECTED.some((p) => n === p || n.endsWith(`/${p}`));
}

export function parsePorcelain(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

export function blockingDirtyFiles(files: string[]): string[] {
  return files.filter((f) => !isProtectedGitPath(f)).slice(0, 20);
}

export function restoreEnvFile(
  appDir: string,
  envVars: Record<string, string> | undefined,
): string | undefined {
  if (!envVars || !Object.keys(envVars).length) return undefined;
  const envPath = join(appDir, '.env');
  const lines = Object.entries(envVars)
    .filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`);
  writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
  return envPath;
}

export async function probeGitStatus(input: {
  host: HostExecutor;
  appDir: string;
  storedUrl?: string;
}): Promise<GitStatus> {
  const notes: string[] = [];
  const appDir = input.appDir;
  if (!(await binPresent(input.host, 'git'))) {
    return {
      ok: false,
      gitInstalled: false,
      isRepo: false,
      detached: false,
      dirty: false,
      dirtyFiles: [],
      ahead: 0,
      behind: 0,
      shallow: false,
      heads: [],
      lastError: { code: 'missing-bin', message: tl('notes.git.missingBin') },
      notes: [tl('notes.git.missingBin')],
    };
  }
  const isRepo = existsSync(join(appDir, '.git'));
  if (!isRepo) {
    return {
      ok: true,
      gitInstalled: true,
      isRepo: false,
      remoteUrl: input.storedUrl,
      detached: false,
      dirty: false,
      dirtyFiles: [],
      ahead: 0,
      behind: 0,
      shallow: false,
      heads: [],
      notes,
    };
  }

  const [remote, br, rev, subj, porcelain, upstream] = await Promise.all([
    git(input.host, appDir, ['remote', 'get-url', 'origin'], 10_000),
    git(input.host, appDir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10_000),
    git(input.host, appDir, ['rev-parse', 'HEAD'], 10_000),
    git(input.host, appDir, ['log', '-1', '--format=%s'], 10_000),
    git(input.host, appDir, ['status', '--porcelain'], 15_000),
    git(input.host, appDir, ['rev-parse', '--abbrev-ref', '@{upstream}'], 10_000),
  ]);

  const branch = br.exitCode === 0 ? br.stdout.trim() : undefined;
  const detached = !branch || branch === 'HEAD';
  const allDirty = parsePorcelain(porcelain.stdout);
  const dirtyFiles = blockingDirtyFiles(allDirty);
  let ahead = 0;
  let behind = 0;
  if (upstream.exitCode === 0 && upstream.stdout.trim()) {
    const cnt = await git(
      input.host,
      appDir,
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      15_000,
    );
    if (cnt.exitCode === 0) {
      const [a, b] = cnt.stdout.trim().split(/\s+/);
      ahead = Number(a) || 0;
      behind = Number(b) || 0;
    }
  }
  const headsRaw = await git(input.host, appDir, ['branch', '-r', '--format=%(refname:short)'], 15_000);
  const heads = headsRaw.exitCode === 0
    ? headsRaw.stdout
        .split('\n')
        .map((s) => s.trim().replace(/^origin\//, ''))
        .filter((s) => s && s !== 'HEAD' && !s.includes('->'))
        .slice(0, 40)
    : [];

  return {
    ok: true,
    gitInstalled: true,
    isRepo: true,
    remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() : input.storedUrl,
    branch: detached ? undefined : branch,
    detached,
    commit: rev.exitCode === 0 ? rev.stdout.trim() : undefined,
    commitSubject: subj.exitCode === 0 ? subj.stdout.trim() : undefined,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    ahead,
    behind,
    shallow: existsSync(join(appDir, '.git', 'shallow')),
    heads,
    notes,
  };
}

export async function gitLog(input: {
  host: HostExecutor;
  appDir: string;
  limit?: number;
}): Promise<{ ok: boolean; items: GitCommitRow[]; notes: string[] }> {
  if (!(await binPresent(input.host, 'git')) || !existsSync(join(input.appDir, '.git'))) {
    return { ok: false, items: [], notes: [tl('notes.git.notRepo')] };
  }
  const n = Math.min(50, Math.max(1, input.limit ?? 10));
  const r = await git(
    input.host,
    input.appDir,
    ['log', `-n${n}`, '--format=%H%x09%s%x09%cI'],
    15_000,
  );
  if (r.exitCode !== 0) {
    return { ok: false, items: [], notes: [r.stderr || tl('notes.git.unknown')] };
  }
  const items: GitCommitRow[] = r.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, at] = line.split('\t');
      return { hash: hash ?? '', subject: subject ?? '', at };
    })
    .filter((x) => x.hash);
  return { ok: true, items, notes: [] };
}

export async function gitDiff(input: {
  host: HostExecutor;
  appDir: string;
}): Promise<{ ok: boolean; text: string; notes: string[] }> {
  if (!(await binPresent(input.host, 'git')) || !existsSync(join(input.appDir, '.git'))) {
    return { ok: false, text: '', notes: [tl('notes.git.notRepo')] };
  }
  const r = await git(
    input.host,
    input.appDir,
    ['diff', '--stat', '--', '.', ':(exclude).env'],
    15_000,
  );
  if (r.exitCode !== 0) {
    return { ok: false, text: '', notes: [r.stderr || tl('notes.git.unknown')] };
  }
  const text = (r.stdout || '').trim();
  return {
    ok: true,
    text: text || tl('notes.git.diffEmpty'),
    notes: [],
  };
}

export async function gitFetch(input: {
  host: HostExecutor;
  appDir: string;
  unshallow?: boolean;
  env?: GitAuthEnv;
}): Promise<GitOpResult> {
  if (!(await binPresent(input.host, 'git'))) return failOp('fetch', 'missing-bin');
  if (!existsSync(join(input.appDir, '.git'))) return failOp('fetch', 'not-repo');
  const args = ['fetch', 'origin'];
  if (input.unshallow && existsSync(join(input.appDir, '.git', 'shallow'))) {
    args.push('--unshallow');
  }
  const r = await git(input.host, input.appDir, args, 120_000, input.env);
  if (r.exitCode !== 0) {
    const code = classifyGitError(r.stderr, r.stdout);
    return { ...failOp('fetch', code, r.stderr || r.stdout), stdout: r.stdout, stderr: r.stderr };
  }
  return { ok: true, action: 'fetch', notes: [tl('notes.git.fetchOk')] };
}

export async function gitCheckoutRef(input: {
  host: HostExecutor;
  appDir: string;
  ref: string;
  env?: GitAuthEnv;
}): Promise<GitOpResult> {
  if (!(await binPresent(input.host, 'git'))) return failOp('checkout', 'missing-bin');
  if (!existsSync(join(input.appDir, '.git'))) return failOp('checkout', 'not-repo');
  const ref = input.ref.trim();
  if (!ref || /\s/.test(ref) || ref.length > 200) {
    return failOp('checkout', 'missing-ref');
  }
  const st = await probeGitStatus({ host: input.host, appDir: input.appDir });
  if (st.dirty) {
    return {
      ok: false,
      action: 'checkout',
      code: 'dirty',
      notes: [tl('notes.git.dirty', { count: st.dirtyFiles.length })],
    };
  }
  const r = await git(input.host, input.appDir, ['checkout', '--force', ref], 30_000, input.env);
  if (r.exitCode !== 0) {
    const code = classifyGitError(r.stderr, r.stdout);
    return { ...failOp('checkout', code, r.stderr || r.stdout), stdout: r.stdout, stderr: r.stderr };
  }
  const rev = await git(input.host, input.appDir, ['rev-parse', 'HEAD'], 10_000);
  const br = await git(input.host, input.appDir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10_000);
  return {
    ok: true,
    action: 'checkout',
    notes: [tl('notes.git.checkoutOk', { ref })],
    commit: rev.exitCode === 0 ? rev.stdout.trim() : undefined,
    branch: br.exitCode === 0 ? br.stdout.trim() : ref,
  };
}

export async function gitResetHard(input: {
  host: HostExecutor;
  appDir: string;
  ref?: string;
  env?: GitAuthEnv;
}): Promise<GitOpResult> {
  if (!(await binPresent(input.host, 'git'))) return failOp('reset', 'missing-bin');
  if (!existsSync(join(input.appDir, '.git'))) return failOp('reset', 'not-repo');
  const target = (input.ref?.trim() || 'origin/HEAD').replace(/\s/g, '');
  const fetch = await gitFetch({ host: input.host, appDir: input.appDir, env: input.env });
  if (!fetch.ok) return { ...fetch, action: 'reset' };
  const r = await git(input.host, input.appDir, ['reset', '--hard', target], 30_000);
  if (r.exitCode !== 0) {
    const fallback = await git(
      input.host,
      input.appDir,
      ['reset', '--hard', `origin/${target.replace(/^origin\//, '')}`],
      30_000,
    );
    if (fallback.exitCode !== 0) {
      const code = classifyGitError(fallback.stderr || r.stderr, fallback.stdout);
      return { ...failOp('reset', code, fallback.stderr || r.stderr), stderr: fallback.stderr };
    }
  }
  const clean = await git(input.host, input.appDir, ['clean', '-fd', '-e', '.env'], 30_000);
  if (clean.exitCode !== 0) {
    return { ...failOp('reset', classifyGitError(clean.stderr), clean.stderr) };
  }
  const rev = await git(input.host, input.appDir, ['rev-parse', 'HEAD'], 10_000);
  const br = await git(input.host, input.appDir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10_000);
  return {
    ok: true,
    action: 'reset',
    notes: [tl('notes.git.resetOk', { ref: target })],
    commit: rev.exitCode === 0 ? rev.stdout.trim() : undefined,
    branch: br.exitCode === 0 ? br.stdout.trim() : undefined,
  };
}

export type ParsedGitRemoteRefs = {
  defaultBranch?: string;
  branches: string[];
  tags: string[];
};

/** Parse `git ls-remote --heads --tags --symref` stdout. */
export function parseGitLsRemote(stdout: string): ParsedGitRemoteRefs {
  const branches: string[] = [];
  const tags: string[] = [];
  let defaultBranch: string | undefined;
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const tab = t.indexOf('\t');
    if (tab < 0) continue;
    const left = t.slice(0, tab).trim();
    const name = t.slice(tab + 1).trim();
    if (name === 'HEAD' && /^ref:\s+/i.test(left)) {
      const m = /refs\/heads\/([^\s]+)/.exec(left);
      if (m?.[1]) defaultBranch = m[1];
      continue;
    }
    if (name.endsWith('^{}')) continue;
    if (name.startsWith('refs/heads/')) {
      const n = name.slice('refs/heads/'.length);
      if (n && !branches.includes(n)) branches.push(n);
    } else if (name.startsWith('refs/tags/')) {
      const n = name.slice('refs/tags/'.length);
      if (n && !tags.includes(n)) tags.push(n);
    }
  }
  return {
    defaultBranch,
    branches: branches.slice(0, 80),
    tags: tags.slice(0, 80),
  };
}

export async function listGitRemoteRefs(input: {
  host: HostExecutor;
  gitUrl: string;
  env?: GitAuthEnv;
}): Promise<{
  ok: boolean;
  defaultBranch?: string;
  branches: string[];
  tags: string[];
  notes: string[];
  code?: GitErrorCode;
}> {
  const url = input.gitUrl.trim();
  if (!url) {
    return { ok: false, branches: [], tags: [], notes: [tl('notes.git.refsNeedUrl')] };
  }
  if (!(await binPresent(input.host, 'git'))) {
    return {
      ok: false,
      branches: [],
      tags: [],
      notes: [tl('notes.git.missingBin')],
      code: 'missing-bin',
    };
  }
  const r = await input.host.runCommand(
    ['git', 'ls-remote', '--heads', '--tags', '--symref', '--', url],
    { timeoutMs: 25_000, env: input.env },
  );
  if (r.exitCode !== 0) {
    const code = classifyGitError(r.stderr, r.stdout);
    const extra = (r.stderr || r.stdout || '').trim().slice(0, 400);
    return {
      ok: false,
      branches: [],
      tags: [],
      notes: [tl(`notes.git.${camel(code)}`), extra].filter(Boolean),
      code,
    };
  }
  const parsed = parseGitLsRemote(r.stdout ?? '');
  const n = parsed.branches.length + parsed.tags.length;
  return {
    ok: true,
    ...parsed,
    notes: [
      n
        ? tl('notes.git.refsOk', { branches: parsed.branches.length, tags: parsed.tags.length })
        : tl('notes.git.refsEmpty'),
    ],
  };
}

export { classifyGitError, type GitErrorCode } from './git-errors.js';
