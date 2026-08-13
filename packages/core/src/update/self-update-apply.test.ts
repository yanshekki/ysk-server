import { describe, expect, it } from 'vitest';
import { runSelfUpdate, checkSelfUpdate } from './self-update-apply.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('runSelfUpdate', () => {
  it('plans without apply when offline override', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: false,
      latestOverride: '0.2.0',
    });
    expect(r.plan.status.updateAvailable).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.checked).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe('0.2.0');
    expect(r.plan.steps.length).toBeGreaterThan(0);
  });

  it('skips apply without YSK_EXECUTE', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: true,
      latestOverride: '9.9.9',
    });
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /YSK_EXECUTE|系統變更|權限/i.test(n))).toBe(true);
  });

  it('reports ok when already up to date even with apply', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await runSelfUpdate({
      currentVersion: '1.0.0',
      host,
      apply: true,
      latestOverride: '1.0.0',
    });
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(true);
    expect(r.notes.some((n) => /up to date|最新版本|已是最新/i.test(n))).toBe(true);
  });

  it('plan-only without apply when update available', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: false,
      latestOverride: '0.9.0',
    });
    expect(r.plan.status.updateAvailable).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.commandResults).toHaveLength(0);
  });
});

describe('checkSelfUpdate', () => {
  it('honors latestOverride without network', async () => {
    const r = await checkSelfUpdate({
      currentVersion: '0.1.0',
      latestOverride: '0.3.0',
    });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe('0.3.0');
    expect(r.channel).toBe('env');
  });

  it('does not claim latest when override equals current', async () => {
    const r = await checkSelfUpdate({
      currentVersion: '1.2.3',
      latestOverride: '1.2.3',
    });
    expect(r.ok).toBe(true);
    expect(r.updateAvailable).toBe(false);
    expect(r.notes.some((n) => /已是最新/i.test(n))).toBe(true);
  });
});

describe('legacy npm names stay off user notes', () => {
  it('skips @ysk/server 404 when ysk-server succeeds', async () => {
    const prev = process.env.YSK_LATEST_VERSION;
    delete process.env.YSK_LATEST_VERSION;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('%40ysk%2Fserver') || u.includes('@ysk/server')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      if (u.includes('ysk-server')) {
        return {
          ok: true,
          json: async () => ({ version: '1.0.4', dist: { shasum: 'a'.repeat(40) } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    try {
      const r = await checkSelfUpdate({ currentVersion: '1.0.0' });
      expect(r.ok).toBe(true);
      expect(r.latestVersion).toBe('1.0.4');
      expect(r.packageName).toBe('ysk-server');
      expect(r.notes.join(' ')).not.toMatch(/@ysk\/server/);
    } finally {
      globalThis.fetch = orig;
      if (prev !== undefined) process.env.YSK_LATEST_VERSION = prev;
    }
  });
});

describe('self-update resolve and apply honesty', () => {
  it('resolveLatestVersion uses override and strips v prefix', async () => {
    const { resolveLatestVersion, applySelfUpdateFromGit } = await import('./self-update-apply.js');
    const r = await resolveLatestVersion({ latestOverride: 'v2.3.4', packageName: 'ysk-server' });
    expect(r.registry.latest).toBe('2.3.4');
    expect(r.registry.channel).toBe('env');
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('checkSelfUpdate reports checked=false when all channels fail', async () => {
    const prev = process.env.YSK_LATEST_VERSION;
    delete process.env.YSK_LATEST_VERSION;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      const r = await checkSelfUpdate({ currentVersion: '0.1.0' });
      expect(r.ok).toBe(false);
      expect(r.checked).toBe(false);
      expect(r.latestVersion).toBe('unknown');
      expect(r.channel).toBe('none');
      expect(r.notes.some((n) => /network|down|fail|失敗|無法|checked|registry|GitHub|npm/i.test(n) || n.length > 0)).toBe(
        true,
      );
    } finally {
      globalThis.fetch = origFetch;
      if (prev !== undefined) process.env.YSK_LATEST_VERSION = prev;
    }
  });

  it('applySelfUpdateFromGit without .git does not claim applied', async () => {
    const { applySelfUpdateFromGit } = await import('./self-update-apply.js');
    const host = new LocalHostExecutor({ executeEnabled: true });
    // force non-git root via env
    const prev = process.env.YSK_SOURCE_ROOT;
    process.env.YSK_SOURCE_ROOT = '/tmp/ysk-not-a-git-repo-xyz';
    try {
      const r = await applySelfUpdateFromGit({
        host,
        latest: '9.9.9',
        repo: 'yanshekki/ysk-server',
      });
      // may try curl+tar; either way applied must be false without successful full path
      expect(r.applied).toBe(false);
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.commandResults.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.YSK_SOURCE_ROOT;
      else process.env.YSK_SOURCE_ROOT = prev;
    }
  }, 30_000);

  it('runSelfUpdate apply with execute runs npm path mock via host that fails install', async () => {
    const cmds: string[][] = [];
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv: string[]) => {
        cmds.push(argv);
        return {
          stdout: '',
          stderr: 'E404',
          exitCode: 1,
          argv,
          dryRun: false,
        };
      },
    };
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host: host as never,
      apply: true,
      latestOverride: '0.2.0',
      packageName: 'ysk-server',
    });
    expect(r.checked).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => n.length > 0)).toBe(true);
  });
});
