import { describe, expect, it, afterEach } from 'vitest';
import {
  resolveLatestVersion,
  checkSelfUpdate,
  runSelfUpdate,
  applySelfUpdateFromGit,
  fetchNpmLatest,
  fetchGithubLatest,
  fetchGithubPackageJsonVersion,
} from './self-update-apply.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { YskError } from 'ysk-server-shared';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  opts: {
    execute?: boolean;
    run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>;
  } = {},
): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => opts.execute !== false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts.run ? await opts.run(argv) : {}),
    }),
  } as HostExecutor;
}

const origFetch = globalThis.fetch;
const envKeys = [
  'YSK_LATEST_VERSION',
  'YSK_NPM_PACKAGE',
  'YSK_SOURCE_ROOT',
  'YSK_GITHUB_REPO',
] as const;
const envSnap: Record<string, string | undefined> = {};

afterEach(() => {
  globalThis.fetch = origFetch;
  for (const k of envKeys) {
    if (envSnap[k] === undefined) delete process.env[k];
    else process.env[k] = envSnap[k];
    delete envSnap[k];
  }
});

function snapEnv() {
  for (const k of envKeys) {
    if (!(k in envSnap)) envSnap[k] = process.env[k];
  }
}

describe('self-update-apply depth', () => {
  it('resolveLatestVersion uses YSK_LATEST_VERSION env', async () => {
    snapEnv();
    process.env.YSK_LATEST_VERSION = 'v3.4.5';
    const r = await resolveLatestVersion();
    expect(r.registry.latest).toBe('3.4.5');
    expect(r.registry.channel).toBe('env');
  });

  it('fetchNpmLatest and github helpers with mock fetch', async () => {
    snapEnv();
    delete process.env.YSK_LATEST_VERSION;

    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('registry.npmjs.org')) {
        return {
          ok: true,
          json: async () => ({
            version: 'v1.2.3',
            dist: {
              tarball: 'https://example/t.tgz',
              shasum: 'a'.repeat(40),
            },
          }),
        } as Response;
      }
      if (u.includes('api.github.com')) {
        return {
          ok: true,
          json: async () => ({
            tag_name: 'v9.0.0',
            tarball_url: 'https://example/t',
          }),
        } as Response;
      }
      if (u.includes('raw.githubusercontent.com')) {
        return {
          ok: true,
          json: async () => ({ version: '0.9.1', name: 'ysk-server' }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const npm = await fetchNpmLatest('ysk-server');
    expect(npm.latest).toBe('1.2.3');
    expect(npm.channel).toBe('npm');

    const gh = await fetchGithubLatest('owner/repo');
    expect(gh.latest).toBe('9.0.0');

    const pj = await fetchGithubPackageJsonVersion('owner/repo', 'main');
    expect(pj.latest).toBe('0.9.1');
  });

  it('fetch helpers throw on HTTP/empty', async () => {
    globalThis.fetch = (async () =>
      ({ ok: false, status: 502, json: async () => ({}) }) as Response) as typeof fetch;
    await expect(fetchNpmLatest('x')).rejects.toBeInstanceOf(YskError);
    await expect(fetchGithubLatest('a/b')).rejects.toBeInstanceOf(YskError);

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({}),
      }) as Response) as typeof fetch;
    await expect(fetchNpmLatest('x')).rejects.toBeInstanceOf(YskError);
    await expect(fetchGithubLatest('a/b')).rejects.toBeInstanceOf(YskError);
    await expect(fetchGithubPackageJsonVersion('a/b')).rejects.toBeInstanceOf(YskError);
  });

  it('resolve falls through npm fail to github package.json', async () => {
    snapEnv();
    delete process.env.YSK_LATEST_VERSION;
    let n = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      n += 1;
      if (u.includes('registry.npmjs.org')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      if (u.includes('api.github.com')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      if (u.includes('raw.githubusercontent.com')) {
        return {
          ok: true,
          json: async () => ({ version: '2.0.0' }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const r = await resolveLatestVersion({ packageName: 'unlikely-pkg-xyz' });
    expect(r.registry.latest).toBe('2.0.0');
    expect(r.notes.length).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(1);
  });

  it('applySelfUpdateFromGit succeeds when git steps ok', async () => {
    snapEnv();
    process.env.YSK_SOURCE_ROOT = '/tmp/ysk-fake-src';
    const steps: string[] = [];
    const host = mockHost({
      execute: true,
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('.git') && j.includes('test -d')) {
          return { exitCode: 0, stdout: 'yes\n' };
        }
        steps.push(j);
        return { exitCode: 0, stdout: 'ok' };
      },
    });
    const r = await applySelfUpdateFromGit({
      host,
      latest: 'v1.0.0',
      repo: 'yanshekki/ysk-server',
    });
    expect(r.applied).toBe(true);
    expect(r.commandResults.length).toBeGreaterThan(1);
    expect(r.notes.some((n) => /fetch|ok|install|build/i.test(n))).toBe(true);
  });

  it('applySelfUpdateFromGit aborts on first failing git step', async () => {
    snapEnv();
    process.env.YSK_SOURCE_ROOT = '/tmp/ysk-fake-src2';
    const host = mockHost({
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('.git') && j.includes('test -d')) {
          return { exitCode: 0, stdout: 'yes' };
        }
        if (j.includes('git fetch')) {
          return { exitCode: 1, stderr: 'fetch failed' };
        }
        return { exitCode: 0 };
      },
    });
    const r = await applySelfUpdateFromGit({
      host,
      latest: '1.0.0',
      repo: 'o/r',
    });
    expect(r.applied).toBe(false);
    expect(r.notes.join(' ')).toMatch(/fetch/i);
  });

  it('runSelfUpdate npm success path overlays dest without npm install -g', async () => {
    snapEnv();
    delete process.env.YSK_LATEST_VERSION;
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'ysk-ovl-depth-'));
    const dest = join(root, 'dest');
    const unpacked = join(root, 'package');
    mkdirSync(join(unpacked, 'dist'), { recursive: true });
    mkdirSync(join(dest, 'dist'), { recursive: true });
    writeFileSync(join(unpacked, 'dist', 'cli.js'), 'export const cli = true;\n');
    writeFileSync(join(unpacked, 'dist', 'version.js'), "export const VERSION = '0.2.0';\n");
    writeFileSync(join(dest, 'dist', 'cli.js'), "export const VERSION = '0.1.0';\n");
    writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'ysk-server', version: '0.1.0' }));
    try {
      const host = mockHost({ execute: false });
      const r = await runSelfUpdate({
        currentVersion: '0.1.0',
        host,
        apply: true,
        latestOverride: '0.2.0',
        packageName: 'ysk-server',
        cliJsHint: join(dest, 'dist', 'cli.js'),
        unpackedDir: unpacked,
      });
      expect(r.checked).toBe(true);
      expect(r.applied).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.updateAvailable).toBe(false);
      expect(readFileSync(join(dest, 'dist', 'version.js'), 'utf8')).toContain('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runSelfUpdate github/env channel uses git apply when npm not preferred', async () => {
    snapEnv();
    process.env.YSK_SOURCE_ROOT = '/tmp/not-git-root-xyz';
    const host = mockHost({
      execute: true,
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('.git')) return { exitCode: 0, stdout: 'no' };
        // curl+tar fail
        return { exitCode: 1, stderr: 'curl fail' };
      },
    });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: true,
      latestOverride: '0.5.0',
    });
    expect(r.checked).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('checkSelfUpdate notes invalid shasum shape', async () => {
    snapEnv();
    delete process.env.YSK_LATEST_VERSION;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          version: '1.0.1',
          dist: { shasum: 'short', tarball: 't' },
        }),
      }) as Response) as typeof fetch;
    const r = await checkSelfUpdate({
      currentVersion: '1.0.0',
      packageName: 'ysk-server',
    });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(true);
  });
});
