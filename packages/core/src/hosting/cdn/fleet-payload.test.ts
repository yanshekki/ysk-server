import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor } from '../../host/executor.js';
import {
  isCdnFleetPayload,
  runCdnFleetPayload,
  type CdnFleetApplyPayload,
} from './fleet-payload.js';

function mockHost(opts?: { nginx?: boolean }): HostExecutor {
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: (p) =>
      opts?.nginx !== false &&
      (p === '/usr/sbin/nginx' || p === '/usr/bin/nginx'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      if (argv[0] === 'nginx' && argv[1] === '-t') {
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (argv[0] === 'bash' && String(argv[2] || '').includes('reload')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('cdn fleet payload', () => {
  it('isCdnFleetPayload', () => {
    expect(isCdnFleetPayload({ op: 'cdn.edge.apply' })).toBe(true);
    expect(isCdnFleetPayload({ op: 'cdn.edge.purge' })).toBe(true);
    expect(isCdnFleetPayload({ op: 'other' })).toBe(false);
  });

  it('runCdnFleetPayload apply writes conf and reloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnpay-'));
    try {
      const payload: CdnFleetApplyPayload = {
        op: 'cdn.edge.apply',
        siteId: 's1',
        edgeNodeId: 'e1',
        confBasename: 'ysk-cdn-s1.conf',
        confContent: 'server { listen 80; }\n',
        remoteDir: dir,
        cacheDir: join(dir, 'cache'),
      };
      const r = await runCdnFleetPayload(mockHost({ nginx: true }), payload);
      expect(r.ok).toBe(true);
      expect(r.reloaded).toBe(true);
      expect(existsSync(join(dir, 'ysk-cdn-s1.conf'))).toBe(true);
      expect(readFileSync(join(dir, 'ysk-cdn-s1.conf'), 'utf8')).toContain('listen 80');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runCdnFleetPayload refuses empty conf', async () => {
    const r = await runCdnFleetPayload(mockHost(), {
      op: 'cdn.edge.apply',
      siteId: 's1',
      edgeNodeId: 'e1',
      confBasename: 'x.conf',
      confContent: '  ',
      remoteDir: '/tmp',
      cacheDir: '/tmp/c',
    });
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /empty/i.test(n))).toBe(true);
  });
});
