import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applySenderRatePolicyService,
  loadDomainRateMap,
  writeSenderRatePolicyDaemon,
} from './sender-rate-policy.js';
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

describe('sender-rate-policy', () => {
  it('loads rates and writes daemon files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-srate-'));
    try {
      const pol = join(dir, 'email', 'policy', 'a.com');
      mkdirSync(pol, { recursive: true });
      writeFileSync(join(pol, 'rate.cf'), '# c\na.com 120\n', 'utf8');
      const map = loadDomainRateMap(dir);
      expect(map['a.com']).toBe(120);
      const w = writeSenderRatePolicyDaemon(dir);
      expect(existsSync(w.scriptPath)).toBe(true);
      expect(existsSync(w.ratesPath)).toBe(true);
      expect(w.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocked without execute is ok:false (never ok+blocked)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-srate-b-'));
    try {
      const r = await applySenderRatePolicyService({
        dataDir: dir,
        host: host(false),
      });
      expect(r.blocked).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
