import { describe, expect, it } from 'vitest';
import { applyPackageUpdate, applyPackageUpdateBatch } from './package-apply.js';
import { adviseUpdate } from './advisor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import type { UpdateItemDto } from '@ysk/shared';

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => RunResult;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) =>
      opts.run?.(argv) ?? {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      },
  };
}

const baseItem: UpdateItemDto = {
  packageName: 'curl',
  currentVersion: '1.0',
  candidateVersion: '1.1',
  risk: 'low',
  advice: 'update',
  cves: [],
  requiresApproval: false,
  summary: 'curl 1.0 → 1.1',
};

describe('applyPackageUpdate', () => {
  it('blocks high-risk without confirm', async () => {
    const r = await applyPackageUpdate({
      host: mockHost({}),
      item: { ...baseItem, requiresApproval: true, risk: 'high' },
    });
    expect(r.blocked).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('blocks without execute or root', async () => {
    const noExec = await applyPackageUpdate({
      host: mockHost({ execute: false }),
      item: baseItem,
    });
    expect(noExec.blocked).toBe(true);
    const noRoot = await applyPackageUpdate({
      host: mockHost({ root: false }),
      item: baseItem,
    });
    expect(noRoot.blocked).toBe(true);
  });

  it('rejects bad package name and applies valid', async () => {
    const bad = await applyPackageUpdate({
      host: mockHost({}),
      item: { ...baseItem, packageName: 'curl;rm' },
    });
    expect(bad.ok).toBe(false);
    expect(bad.notes.some((n) => /不合法/.test(n))).toBe(true);

    const ok = await applyPackageUpdate({
      host: mockHost({}),
      item: baseItem,
      confirmHighRisk: true,
    });
    expect(ok.applied).toBe(true);
    expect(ok.ok).toBe(true);
  });

  it('blocks when candidate missing or equals current', async () => {
    const same = await applyPackageUpdate({
      host: mockHost({}),
      item: { ...baseItem, candidateVersion: '1.0' },
    });
    expect(same.ok).toBe(false);
    expect(same.blocked).toBe(true);

    const missing = await applyPackageUpdate({
      host: mockHost({}),
      item: { ...baseItem, candidateVersion: '' },
    });
    expect(missing.ok).toBe(false);
    expect(missing.blocked).toBe(true);
  });

  it('applyPackageUpdateBatch applies multiple packages sequentially', async () => {
    const host = mockHost({});
    const batch = await applyPackageUpdateBatch({
      host,
      confirmHighRisk: true,
      items: [
        {
          packageName: 'curl',
          currentVersion: '1.0',
          candidateVersion: '1.1',
        },
        {
          packageName: 'wget',
          currentVersion: '2.0',
          candidateVersion: '2.1',
        },
      ],
      toItem: (row) =>
        adviseUpdate({
          packageName: row.packageName,
          currentVersion: row.currentVersion,
          candidateVersion: row.candidateVersion,
        }),
    });
    expect(batch.results).toHaveLength(2);
    expect(batch.appliedCount).toBeGreaterThanOrEqual(0);
    expect(batch.appliedCount + batch.failedCount).toBe(2);
  });
});
