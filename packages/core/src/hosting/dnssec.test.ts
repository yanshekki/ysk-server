import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateDnssecKeys, listDnssecMaterial } from './dnssec.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 1,
      argv: [],
      dryRun: false,
    }),
  };
}

describe('dnssec', () => {
  it('writes material notes without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnssec-'));
    try {
      const r = await generateDnssecKeys({
        dataDir: dir,
        zone: 'Example.COM.',
        host: host(false),
      });
      expect(r.ok).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.written.length).toBeGreaterThan(0);
      const list = listDnssecMaterial(dir, 'example.com');
      expect(list.files.length).toBeGreaterThan(0);
      expect(existsSync(list.files[0]!)).toBe(true);
      expect(listDnssecMaterial(dir, 'none.example').files).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
