import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyMailDomainPolicy,
  computeGlobalMessageRatePerHour,
  rebuildAggregatePolicyMaps,
} from './mail-policy.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean, root = true): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => root,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
  };
}

describe('mail-policy', () => {
  it('writes policy maps and computes global rate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-'));
    try {
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'Example.COM',
        rateLimitPerHour: 100,
        antispam: true,
        applySystem: false,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('written');
      expect(existsSync(join(dir, 'email', 'policy', 'example.com', 'rate.cf'))).toBe(true);

      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'b.test',
        rateLimitPerHour: 50,
        antispam: false,
      });
      expect(computeGlobalMessageRatePerHour(dir)).toBe(50);
      const agg = rebuildAggregatePolicyMaps(dir);
      expect(agg.written.length).toBeGreaterThan(0);

      const blocked = await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'c.test',
        rateLimitPerHour: 10,
        applySystem: true,
      });
      expect(blocked.blocked).toBe(true);
      expect(blocked.ok).toBe(false);
      expect(blocked.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults global rate when empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-empty-'));
    try {
      mkdirSync(join(dir, 'email', 'policy'), { recursive: true });
      expect(computeGlobalMessageRatePerHour(dir)).toBe(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
