import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { applyMailTlsPaths } from './mail-tls-apply.js';

function host(opts: { root?: boolean; exec?: boolean; pathExists?: (p: string) => boolean; run?: (a: string[]) => RunResult }): HostExecutor {
  return {
    executeEnabled: () => opts.exec !== false,
    isRoot: () => opts.root !== false,
    pathExists: opts.pathExists ?? (() => false),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) =>
      opts.run?.(argv) ?? { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false },
  };
}

describe('applyMailTlsPaths', () => {
  it('blocks without execute/root', async () => {
    const r = await applyMailTlsPaths({ host: host({ exec: false }), domain: 'ex.test' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('fails when cert missing', async () => {
    const r = await applyMailTlsPaths({ host: host({}), domain: 'ex.test' });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
  });
});
