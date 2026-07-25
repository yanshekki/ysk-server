/**
 * Git-based project deploy: clone/pull into project app directory.
 * Works without root; only needs `git` on PATH.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';

export interface GitDeployResult {
  ok: boolean;
  action: 'clone' | 'pull' | 'none';
  repoDir: string;
  commit?: string;
  branch?: string;
  notes: string[];
  stdout?: string;
  stderr?: string;
}

export function assertGitUrl(url: string): void {
  const u = url.trim();
  const ok =
    u.length > 0 &&
    u.length <= 512 &&
    (u.startsWith('https://') || u.startsWith('http://') || u.startsWith('git@')) &&
    !/\s/.test(u) &&
    !u.includes('..');
  if (!ok) {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid git URL', { httpStatus: 400, details: { url } });
  }
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
}): Promise<GitDeployResult> {
  assertGitUrl(input.gitUrl);
  const notes: string[] = [];
  const repoDir = input.targetDir;
  mkdirSync(repoDir, { recursive: true });

  const hasGit = await input.host.runCommand(['bash', '-c', 'command -v git || true'], {
    timeoutMs: 5_000,
  });
  if (!hasGit.stdout.trim()) {
    return {
      ok: false,
      action: 'none',
      repoDir,
      notes: ['git binary not found on PATH'],
    };
  }

  const isRepo = existsSync(join(repoDir, '.git'));
  if (!isRepo) {
    // If directory has files but no .git, clone into temp then we fail clearly
    const entries = await input.host.listDir(repoDir).catch(() => [] as string[]);
    const nonEmpty = entries.filter((e) => e !== '.' && e !== '..');
    if (nonEmpty.length > 0) {
      // wipe only if looks like our stub (server.js only) — otherwise refuse
      const onlyStub =
        nonEmpty.every((e) => ['server.js', '.env', 'logs', 'tmp', 'node_modules'].includes(e)) ||
        nonEmpty.length <= 3;
      if (onlyStub) {
        for (const e of nonEmpty) {
          rmSync(join(repoDir, e), { recursive: true, force: true });
        }
        notes.push('Cleared stub app files before clone');
      } else {
        return {
          ok: false,
          action: 'none',
          repoDir,
          notes: [
            `Target ${repoDir} is not empty and is not a git repo — refuse clone to avoid data loss`,
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
    const r = await input.host.runCommand(args, { timeoutMs: 120_000 });
    if (r.exitCode !== 0) {
      return {
        ok: false,
        action: 'clone',
        repoDir,
        notes: [...notes, `git clone failed: ${r.stderr || r.stdout}`],
        stdout: r.stdout,
        stderr: r.stderr,
      };
    }
    notes.push(`Cloned ${input.gitUrl} → ${repoDir}`);
  } else {
    if (input.branch) {
      await input.host.runCommand(['git', '-C', repoDir, 'fetch', 'origin', input.branch], {
        timeoutMs: 60_000,
      });
      const co = await input.host.runCommand(
        ['git', '-C', repoDir, 'checkout', input.branch],
        { timeoutMs: 30_000 },
      );
      if (co.exitCode !== 0) {
        notes.push(`checkout ${input.branch}: ${co.stderr}`);
      }
    }
    const r = await input.host.runCommand(['git', '-C', repoDir, 'pull', '--ff-only'], {
      timeoutMs: 120_000,
    });
    if (r.exitCode !== 0) {
      return {
        ok: false,
        action: 'pull',
        repoDir,
        notes: [...notes, `git pull failed: ${r.stderr || r.stdout}`],
        stdout: r.stdout,
        stderr: r.stderr,
      };
    }
    notes.push(`Pulled updates in ${repoDir}`);
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
