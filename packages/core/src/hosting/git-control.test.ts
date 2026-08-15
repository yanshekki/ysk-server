import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { classifyGitError } from './git-errors.js';
import {
  blockingDirtyFiles,
  gitCheckoutRef,
  gitLog,
  gitDiff,
  listGitRemoteRefs,
  parseGitLsRemote,
  parsePorcelain,
  probeGitStatus,
  restoreEnvFile,
} from './git-control.js';
import { gitSync } from './git-deploy.js';

describe('parseGitLsRemote', () => {
  it('reads default branch, heads, and tags; skips peeled tags', () => {
    const parsed = parseGitLsRemote(`
ref: refs/heads/main	HEAD
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	HEAD
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	refs/heads/main
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb	refs/heads/develop
cccccccccccccccccccccccccccccccccccccccc	refs/tags/v1.0.0
cccccccccccccccccccccccccccccccccccccccc	refs/tags/v1.0.0^{}
`);
    expect(parsed.defaultBranch).toBe('main');
    expect(parsed.branches).toEqual(['main', 'develop']);
    expect(parsed.tags).toEqual(['v1.0.0']);
  });

  it('empty stdout is empty lists', () => {
    expect(parseGitLsRemote('')).toEqual({ defaultBranch: undefined, branches: [], tags: [] });
  });
});

describe('classifyGitError', () => {
  it('maps common git failures', () => {
    expect(classifyGitError('Authentication failed for https://x')).toBe('auth');
    expect(classifyGitError('Permission denied (publickey).')).toBe('auth');
    expect(classifyGitError('Host key verification failed.')).toBe('hostkey');
    expect(
      classifyGitError('Your local changes to the following files would be overwritten'),
    ).toBe('dirty');
    expect(classifyGitError('Not possible to fast-forward')).toBe('diverged');
    expect(classifyGitError("couldn't find remote ref main")).toBe('missing-ref');
    expect(classifyGitError('fatal: not a git repository')).toBe('not-repo');
    expect(classifyGitError('Unable to create .git/index.lock')).toBe('lock');
    expect(classifyGitError('No space left on device')).toBe('disk');
  });
});

describe('porcelain + protected', () => {
  it('ignores .env in blocking dirty list', () => {
    const files = parsePorcelain(' M app.js\n M .env\n?? tmp.txt');
    expect(files).toContain('.env');
    expect(blockingDirtyFiles(files)).toEqual(['app.js', 'tmp.txt']);
  });
  it('rewrites .env from store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-env-'));
    const p = restoreEnvFile(dir, { A: '1', B: 'two' });
    expect(p).toBe(join(dir, '.env'));
    expect(readFileSync(p!, 'utf8')).toBe('A=1\nB=two\n');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('probe + dirty block', () => {
  async function makeRepo() {
    const root = mkdtempSync(join(tmpdir(), 'ysk-gctl-'));
    const work = join(root, 'work');
    const bare = join(root, 'remote.git');
    mkdirSync(work, { recursive: true });
    const host = new LocalHostExecutor({ allowedWriteRoots: [root], executeEnabled: true });
    const run = async (argv: string[], cwd?: string) => {
      const r = await host.runCommand(argv, { timeoutMs: 30_000, cwd });
      if (r.exitCode !== 0) throw new Error(`${argv.join(' ')}: ${r.stderr || r.stdout}`);
    };
    await run(['git', 'init', '-b', 'main'], work);
    await run(['git', 'config', 'user.email', 't@ysk.local'], work);
    await run(['git', 'config', 'user.name', 't'], work);
    writeFileSync(join(work, 'hello.txt'), 'v1\n');
    await run(['git', 'add', '.'], work);
    await run(['git', 'commit', '-m', 'init'], work);
    await run(['git', 'clone', '--bare', work, bare]);
    return { root, bare, work, host };
  }

  it('status and log after clone; dirty blocks pull', async () => {
    const { root, bare, host } = await makeRepo();
    const target = join(root, 'app');
    const cloned = await gitSync({ host, gitUrl: bare, targetDir: target, branch: 'main' });
    expect(cloned.ok).toBe(true);
    const st = await probeGitStatus({ host, appDir: target, storedUrl: bare });
    expect(st.isRepo).toBe(true);
    expect(st.dirty).toBe(false);
    const log = await gitLog({ host, appDir: target, limit: 5 });
    expect(log.ok).toBe(true);
    expect(log.items[0]?.subject).toMatch(/init/);
    writeFileSync(join(target, 'hello.txt'), 'local\n');
    const dirty = await probeGitStatus({ host, appDir: target });
    expect(dirty.dirty).toBe(true);
    const diff = await gitDiff({ host, appDir: target });
    expect(diff.ok).toBe(true);
    expect(diff.text).toMatch(/hello\.txt/);
    const pulled = await gitSync({ host, gitUrl: bare, targetDir: target, branch: 'main' });
    expect(pulled.ok).toBe(false);
    expect(pulled.errorCode).toBe('dirty');
    const co = await gitCheckoutRef({ host, appDir: target, ref: 'main' });
    expect(co.ok).toBe(false);
    expect(co.code).toBe('dirty');
    rmSync(root, { recursive: true, force: true });
  });

  it('ls-remote lists heads from a bare remote; empty URL is not a fake empty repo', async () => {
    const { root, bare, host } = await makeRepo();
    const empty = await listGitRemoteRefs({ host, gitUrl: '' });
    expect(empty.ok).toBe(false);
    expect(empty.branches).toEqual([]);
    const listed = await listGitRemoteRefs({ host, gitUrl: bare });
    expect(listed.ok).toBe(true);
    expect(listed.branches).toContain('main');
    expect(listed.defaultBranch === undefined || listed.defaultBranch === 'main').toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
