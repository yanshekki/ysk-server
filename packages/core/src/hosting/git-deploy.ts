/**
 * Git-based project deploy: clone/pull into project app directory.
 * Works without root; only needs `git` on PATH.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { YSK_SCAFFOLD_MARKER } from './app-templates.js';
import { classifyGitError } from './git-errors.js';
import { blockingDirtyFiles, parsePorcelain } from './git-control.js';
import { binPresent } from './software-probe/index.js';

export interface GitDeployResult {
  ok: boolean;
  action: 'clone' | 'pull' | 'none';
  repoDir: string;
  commit?: string;
  branch?: string;
  notes: string[];
  stdout?: string;
  stderr?: string;
  errorCode?: string;
}

export function assertGitUrl(url: string): void {
  const u = url.trim();
  const remoteOk =
    u.startsWith('https://') ||
    u.startsWith('http://') ||
    u.startsWith('git@') ||
    u.startsWith('file://') ||
    u.startsWith('ssh://');
  // Absolute local path (bare repo / monorepo mirror) — no `..` segments
  const localPathOk = u.startsWith('/') && !u.includes('//') && !/(^|\/)\.\.(\/|$)/.test(u);
  const ok =
    u.length > 0 &&
    u.length <= 512 &&
    (remoteOk || localPathOk) &&
    !/\s/.test(u) &&
    !(remoteOk && u.includes('..'));
  if (!ok) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0109'), { httpStatus: 400, details: { url } });
  }
}

/**
 * True when app dir looks like a YSK 佔位 skeleton (safe to wipe before git clone).
 * Prefers `.ysk-scaffold` marker; falls back to legacy node stub / YSK file headers.
 */
export function isYskScaffoldAppDir(repoDir: string, entries: string[]): boolean {
  if (entries.includes(YSK_SCAFFOLD_MARKER) || entries.includes('.ysk-scaffold')) {
    return true;
  }
  const noise = new Set([
    'server.js',
    '.env',
    'logs',
    'tmp',
    'node_modules',
    'public',
    'venv',
    'target',
    '__pycache__',
    '.ysk-scaffold',
  ]);
  if (entries.length > 0 && entries.every((e) => noise.has(e))) {
    return true;
  }
  // Content markers from app-templates (python / go / rust / node / django)
  const probeRel = [
    'server.js',
    'main.py',
    'app.py',
    'manage.py',
    'main.go',
    'go.mod',
    'Cargo.toml',
    join('src', 'main.rs'),
  ];
  for (const rel of probeRel) {
    const p = join(repoDir, rel);
    if (!existsSync(p)) continue;
    try {
      const head = readFileSync(p, 'utf8').slice(0, 240);
      if (/\bYSK\b/i.test(head) && /(node-starter|python-|go-http|rust-|Django|scaffold)/i.test(head)) {
        return true;
      }
    } catch {
      /* ignore unreadable */
    }
  }
  return false;
}

/**
 * Clone repo into targetDir if empty, else git pull.
 * targetDir is typically project home/app or home/src.
 */
export async function gitSync(input: {
  host: HostExecutor;
  gitUrl: string;
  targetDir: string;
  branch?: string;
  depth?: number;
  env?: Record<string, string>;
}): Promise<GitDeployResult> {
  assertGitUrl(input.gitUrl);
  const notes: string[] = [];
  const repoDir = input.targetDir;
  mkdirSync(repoDir, { recursive: true });

  if (!(await binPresent(input.host, 'git'))) {
    return {
      ok: false,
      action: 'none',
      repoDir,
      notes: [tl('notes.auto.n0300')],
    };
  }

  const isRepo = existsSync(join(repoDir, '.git'));
  if (!isRepo) {
    // If directory has files but no .git, wipe only YSK scaffolds / legacy stubs
    const entries = await input.host.listDir(repoDir).catch(() => [] as string[]);
    const nonEmpty = entries.filter((e) => e !== '.' && e !== '..');
    if (nonEmpty.length > 0) {
      if (isYskScaffoldAppDir(repoDir, nonEmpty)) {
        for (const e of nonEmpty) {
          rmSync(join(repoDir, e), { recursive: true, force: true });
        }
        notes.push(tl('notes.auto.n0238'));
      } else {
        return {
          ok: false,
          action: 'none',
          repoDir,
          notes: [
            tl('notes.auto.t0345', { v0: (repoDir) }),
          ],
        };
      }
    }

    const args = ['git', 'clone'];
    if (input.depth && input.depth > 0) {
      args.push('--depth', String(input.depth));
    }
    if (input.branch) {
      args.push('--branch', input.branch);
    }
    args.push(input.gitUrl, repoDir);
    const r = await input.host.runCommand(args, { timeoutMs: 120_000, env: input.env });
    if (r.exitCode !== 0) {
      const errorCode = classifyGitError(r.stderr || '', r.stdout || '');
      return {
        ok: false,
        action: 'clone',
        repoDir,
        errorCode,
        notes: [...notes, tl(`notes.git.${errorCode.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`), (r.stderr || r.stdout || '').slice(0, 400)],
        stdout: r.stdout,
        stderr: r.stderr,
      };
    }
    notes.push(tl('notes.auto.t0346', { v0: (input.gitUrl), v1: (repoDir) }));
  } else {
    const origin = await input.host.runCommand(
      ['git', '-C', repoDir, 'remote', 'get-url', 'origin'],
      { timeoutMs: 10_000 },
    );
    const currentRemote = (origin.stdout || '').trim();
    const nextRemote = input.gitUrl.trim();
    if (currentRemote && currentRemote !== nextRemote) {
      const setUrl = await input.host.runCommand(
        ['git', '-C', repoDir, 'remote', 'set-url', 'origin', nextRemote],
        { timeoutMs: 10_000 },
      );
      if (setUrl.exitCode === 0) {
        notes.push(`git remote set-url origin ${nextRemote}`);
      } else {
        notes.push(`git remote set-url: ${setUrl.stderr || setUrl.stdout}`);
      }
    }
    const porcelain = await input.host.runCommand(
      ['git', '-C', repoDir, 'status', '--porcelain'],
      { timeoutMs: 15_000 },
    );
    const dirty = blockingDirtyFiles(parsePorcelain(porcelain.stdout || ''));
    if (dirty.length) {
      return {
        ok: false,
        action: 'none',
        repoDir,
        errorCode: 'dirty',
        notes: [tl('notes.git.dirty', { count: dirty.length }), dirty.slice(0, 8).join(', ')],
      };
    }
    if (input.branch) {
      await input.host.runCommand(['git', '-C', repoDir, 'fetch', 'origin', input.branch], {
        timeoutMs: 60_000,
        env: input.env,
      });
      const co = await input.host.runCommand(
        ['git', '-C', repoDir, 'checkout', input.branch],
        { timeoutMs: 30_000, env: input.env },
      );
      if (co.exitCode !== 0) {
        const errorCode = classifyGitError(co.stderr || '', co.stdout || '');
        notes.push(`checkout ${input.branch}: ${co.stderr}`);
        if (errorCode === 'dirty' || errorCode === 'missing-ref' || errorCode === 'shallow') {
          return {
            ok: false,
            action: 'pull',
            repoDir,
            errorCode,
            notes,
            stderr: co.stderr,
          };
        }
      }
    }
    const r = await input.host.runCommand(['git', '-C', repoDir, 'pull', '--ff-only'], {
      timeoutMs: 120_000,
      env: input.env,
    });
    if (r.exitCode !== 0) {
      const errorCode = classifyGitError(r.stderr || '', r.stdout || '');
      return {
        ok: false,
        action: 'pull',
        repoDir,
        errorCode,
        notes: [
          ...notes,
          tl(`notes.git.${errorCode.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`),
          (r.stderr || r.stdout || '').slice(0, 400),
        ],
        stdout: r.stdout,
        stderr: r.stderr,
      };
    }
    notes.push(tl('notes.auto.t0347', { v0: (repoDir) }));
  }

  const rev = await input.host.runCommand(['git', '-C', repoDir, 'rev-parse', 'HEAD'], {
    timeoutMs: 10_000,
  });
  const br = await input.host.runCommand(
    ['git', '-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
    { timeoutMs: 10_000 },
  );
  return {
    ok: true,
    action: isRepo ? 'pull' : 'clone',
    repoDir,
    commit: rev.exitCode === 0 ? rev.stdout.trim() : undefined,
    branch: br.exitCode === 0 ? br.stdout.trim() : input.branch,
    notes,
    stdout: rev.stdout,
  };
}
