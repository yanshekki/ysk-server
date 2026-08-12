import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { assertGitUrl, gitSync, isYskScaffoldAppDir } from './git-deploy.js';
import { scaffoldAppTemplate } from './app-templates.js';
import { YskError } from 'ysk-server-shared';

describe('assertGitUrl', () => {
  it('accepts https, git@, file://, and absolute local paths', () => {
    expect(() => assertGitUrl('https://github.com/org/repo.git')).not.toThrow();
    expect(() => assertGitUrl('git@github.com:org/repo.git')).not.toThrow();
    expect(() => assertGitUrl('file:///tmp/repo.git')).not.toThrow();
    expect(() => assertGitUrl('/var/git/app.git')).not.toThrow();
  });
  it('rejects empty, spaces, and path traversal on remotes', () => {
    expect(() => assertGitUrl('')).toThrow(YskError);
    expect(() => assertGitUrl('https://evil/../x')).toThrow(YskError);
    expect(() => assertGitUrl('not-a-url')).toThrow(YskError);
  });
});

describe('gitSync real local repos', () => {
  async function makeBareRepo(): Promise<{
    root: string;
    bare: string;
    work: string;
    host: LocalHostExecutor;
  }> {
    const root = mkdtempSync(join(tmpdir(), 'ysk-git-'));
    const work = join(root, 'work');
    const bare = join(root, 'remote.git');
    mkdirSync(work, { recursive: true });
    const host = new LocalHostExecutor({ allowedWriteRoots: [root], executeEnabled: true });
    const run = async (argv: string[], cwd?: string) => {
      const r = await host.runCommand(argv, { timeoutMs: 30_000, cwd });
      if (r.exitCode !== 0) throw new Error(`${argv.join(' ')}: ${r.stderr || r.stdout}`);
      return r;
    };
    await run(['git', 'init', '-b', 'main'], work);
    await run(['git', 'config', 'user.email', 'test@ysk.local'], work);
    await run(['git', 'config', 'user.name', 'ysk-test'], work);
    writeFileSync(join(work, 'hello.txt'), 'v1\n', 'utf8');
    await run(['git', 'add', '.'], work);
    await run(['git', 'commit', '-m', 'init'], work);
    await run(['git', 'clone', '--bare', work, bare]);
    return { root, bare, work, host };
  }

  it('clones into empty target', async () => {
    const { root, bare, host } = await makeBareRepo();
    const target = join(root, 'app');
    const cloned = await gitSync({
      host,
      gitUrl: bare,
      targetDir: target,
      branch: 'main',
    });
    expect(cloned.ok).toBe(true);
    expect(cloned.action).toBe('clone');
    expect(existsSync(join(target, 'hello.txt'))).toBe(true);
    expect(cloned.commit).toMatch(/^[0-9a-f]{7,40}$/);
    rmSync(root, { recursive: true, force: true });
  });

  it('clears stub app files then clones', async () => {
    const { root, bare, host } = await makeBareRepo();
    const target = join(root, 'app');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'server.js'), '// stub\n', 'utf8');
    const cloned = await gitSync({ host, gitUrl: bare, targetDir: target });
    expect(cloned.ok).toBe(true);
    expect(cloned.notes.some((n) => /佔位|scaffold|stub/i.test(n))).toBe(true);
    expect(existsSync(join(target, 'hello.txt'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('clears multi-runtime YSK scaffold (python) then clones', async () => {
    const { root, bare, host } = await makeBareRepo();
    const home = join(root, 'home-py');
    scaffoldAppTemplate({
      templateId: 'python-fastapi',
      homeDir: home,
      projectName: 'PyTpl',
    });
    const target = join(home, 'app');
    expect(existsSync(join(target, '.ysk-scaffold'))).toBe(true);
    expect(isYskScaffoldAppDir(target, ['main.py', 'requirements.txt', '.ysk-scaffold'])).toBe(
      true,
    );
    const cloned = await gitSync({ host, gitUrl: bare, targetDir: target });
    expect(cloned.ok).toBe(true);
    expect(existsSync(join(target, 'hello.txt'))).toBe(true);
    expect(existsSync(join(target, 'main.py'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('clears go scaffold via YSK header without marker', async () => {
    const { root, bare, host } = await makeBareRepo();
    const target = join(root, 'go-app');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'main.go'), '// YSK go-http — demo\npackage main\n', 'utf8');
    writeFileSync(join(target, 'go.mod'), 'module demo\n', 'utf8');
    const cloned = await gitSync({ host, gitUrl: bare, targetDir: target });
    expect(cloned.ok).toBe(true);
    expect(existsSync(join(target, 'hello.txt'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('pulls when already a git repo', async () => {
    const { root, bare, work, host } = await makeBareRepo();
    const target = join(root, 'app');
    const first = await gitSync({ host, gitUrl: bare, targetDir: target, branch: 'main' });
    expect(first.ok).toBe(true);

    // push a new commit to bare via work
    writeFileSync(join(work, 'hello.txt'), 'v2\n', 'utf8');
    await host.runCommand(['git', 'add', '.'], { cwd: work, timeoutMs: 15_000 });
    await host.runCommand(['git', 'commit', '-m', 'v2'], { cwd: work, timeoutMs: 15_000 });
    await host.runCommand(['git', 'push', bare, 'main'], { cwd: work, timeoutMs: 15_000 });

    const pulled = await gitSync({ host, gitUrl: bare, targetDir: target, branch: 'main' });
    expect(pulled.ok).toBe(true);
    expect(pulled.action).toBe('pull');
    expect(readFileSync(join(target, 'hello.txt'), 'utf8')).toBe('v2\n');
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses clone into non-empty non-stub directory', async () => {
    const { root, bare, host } = await makeBareRepo();
    const target = join(root, 'app');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'precious-data.bin'), 'keep', 'utf8');
    writeFileSync(join(target, 'another.txt'), 'x', 'utf8');
    writeFileSync(join(target, 'third.txt'), 'y', 'utf8');
    writeFileSync(join(target, 'fourth.txt'), 'z', 'utf8');
    const r = await gitSync({ host, gitUrl: bare, targetDir: target });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/拒絕 clone|refuse clone/i);
    expect(existsSync(join(target, 'precious-data.bin'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
