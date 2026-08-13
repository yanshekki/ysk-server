import { describe, expect, it } from 'vitest';
import { collectUpdateHub, summarizeHub } from './update-hub.js';
import { resolveApplyNpmPackage, CANONICAL_NPM_PACKAGE } from './self-update-apply.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const j = argv.join(' ');
      if (j.includes('apt list')) {
        return empty({
          stdout:
            'nginx/jammy-updates 1.24.0-2 amd64 [upgradable from: 1.18.0-6]\n',
        });
      }
      if (j.includes('dpkg-query')) {
        return empty({ stdout: 'curl\t7.81.0\t7.81.0\n' });
      }
      if (j.includes('apt-cache policy')) {
        return empty({
          stdout: 'Installed: 1.18.0-6\n  Candidate: 1.24.0-2\n',
        });
      }
      return empty();
    },
  } as HostExecutor;
}

describe('resolveApplyNpmPackage', () => {
  it('never applies legacy scoped names', () => {
    expect(resolveApplyNpmPackage('@ysk/server')).toBe(CANONICAL_NPM_PACKAGE);
    expect(resolveApplyNpmPackage('ysk-server')).toBe('ysk-server');
    expect(resolveApplyNpmPackage('yanshekki/ysk-server')).toBe(CANONICAL_NPM_PACKAGE);
  });
});

describe('collectUpdateHub', () => {
  it('includes panel + catalog rows and does not treat missing runtime as upgradable', async () => {
    const prev = process.env.YSK_LATEST_VERSION;
    process.env.YSK_LATEST_VERSION = '1.0.4';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch;
    try {
      const { entries } = await collectUpdateHub({
        host: mockHost(),
        dataDir: '/tmp/ysk-hub-test',
        currentPanelVersion: '1.0.0',
      });
      expect(entries.some((e) => e.group === 'panel' && e.packageName === 'ysk-server')).toBe(
        true,
      );
      expect(entries.some((e) => e.softwareId === 'nginx')).toBe(true);
      expect(entries.some((e) => e.softwareId === 'node' && e.applyPath !== 'apt')).toBe(true);
      const node = entries.find((e) => e.softwareId === 'node');
      if (node && !node.installed) expect(node.applyPath).toBe('none');
      const s = summarizeHub(entries);
      expect(s.badgeCount).toBeGreaterThanOrEqual(0);
    } finally {
      if (prev === undefined) delete process.env.YSK_LATEST_VERSION;
      else process.env.YSK_LATEST_VERSION = prev;
      globalThis.fetch = origFetch;
    }
  }, 20_000);
});
