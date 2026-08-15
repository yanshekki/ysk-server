import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { collectValidatorDisk, parseDfBytes, parseDuBytes, pickMountForPath } from './disk.js';
import { buildValidatorInstance, upsertValidatorInstance } from './store.js';

function ok(stdout: string, argv: string[]): RunResult {
  return { stdout, stderr: '', exitCode: 0, argv, dryRun: false };
}

describe('validator disk helpers', () => {
  it('parses df -B1 -T and picks the longest mount', () => {
    const rows = parseDfBytes(
      [
        'Filesystem Type 1B-blocks Used Available Use% Mounted on',
        '/dev/sda1 ext4 100000000000 50000000000 50000000000 50% /',
        '/dev/sdb1 ext4 200000000000 180000000000 20000000000 90% /var/lib/ysk-server',
        'tmpfs tmpfs 1000 0 1000 0% /run',
      ].join('\n'),
    );
    expect(rows).toHaveLength(2);
    const picked = pickMountForPath(
      rows,
      '/var/lib/ysk-server/validators/eth-hoodi-1/data',
    );
    expect(picked?.mount).toBe('/var/lib/ysk-server');
    expect(picked?.usePct).toBe(90);
  });

  it('parses du -sb', () => {
    expect(parseDuBytes('12345\t/data')).toBe(12345);
    expect(parseDuBytes('bad')).toBe(0);
  });
});

describe('collectValidatorDisk', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('reports instance du and mount tone', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-val-disk-'));
    dirs.push(dataDir);
    const inst = buildValidatorInstance({
      dataDir,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
    });
    mkdirSync(inst.dataPath, { recursive: true });
    writeFileSync(join(inst.dataPath, 'x'), 'hello');
    upsertValidatorInstance(dataDir, inst);

    const host = {
      runCommand: async (argv: string[]) => {
        if (argv[0] === 'df') {
          return ok(
            [
              'Filesystem Type 1B-blocks Used Available Use% Mounted on',
              `/dev/sda1 ext4 1000 800 200 80% ${dataDir}`,
            ].join('\n'),
            argv,
          );
        }
        if (argv[0] === 'du') return ok('42\t' + inst.dataPath, argv);
        return { stdout: '', stderr: 'no', exitCode: 1, argv, dryRun: false };
      },
      executeEnabled: () => false,
      isRoot: () => false,
    } as unknown as HostExecutor;

    const report = await collectValidatorDisk({ dataDir, host });
    expect(report.tone).toBe('warn');
    expect(report.usePct).toBe(80);
    expect(report.instances).toEqual([
      { id: inst.id, dataPath: inst.dataPath, usedBytes: 42 },
    ]);
  });
});
