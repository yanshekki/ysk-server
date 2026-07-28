import { describe, expect, it } from 'vitest';
import { getServiceMatrix, lifecycleServiceUnit } from './service-matrix.js';
import type { HostExecutor } from '../host/executor.js';

function host(opts: { execute?: boolean; root?: boolean }): HostExecutor {
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
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active')) {
        return { stdout: 'inactive\n', stderr: '', exitCode: 3, argv, dryRun: false };
      }
      if (s.includes('is-enabled')) {
        return { stdout: 'disabled\n', stderr: '', exitCode: 1, argv, dryRun: false };
      }
      if (s.includes('command -v')) {
        return { stdout: '/usr/bin/x\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('service-matrix', () => {
  it('builds matrix and blocks lifecycle without execute', async () => {
    const h = host({ execute: false, root: false });
    const m = await getServiceMatrix(h);
    expect(m.items.length).toBeGreaterThan(5);
    expect(m.executeEnabled).toBe(false);
    const life = await lifecycleServiceUnit(h, 'nginx.service', 'restart');
    expect(life.blocked || life.ok === false).toBe(true);
  });
});
