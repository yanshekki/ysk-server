import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { switchRuntimeDefault } from './runtime-probe.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  run: (argv: string[]) => Partial<RunResult>,
  opts?: { execute?: boolean; root?: boolean },
): HostExecutor {
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => opts?.root ?? true,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...run(argv) }),
  };
}

describe('switchRuntimeDefault', () => {
  it('refuses non go/rust', async () => {
    const r = await switchRuntimeDefault({
      host: mockHost(() => ({})),
      kind: 'node',
      version: '20',
    });
    expect(r.ok).toBe(false);
  });

  it('blocks without execute', async () => {
    const r = await switchRuntimeDefault({
      host: mockHost(() => ({}), { execute: false, root: true }),
      kind: 'go',
      version: '1.22',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('runs go switch script when root+execute', async () => {
    const r = await switchRuntimeDefault({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return { exitCode: 0, stdout: 'YSK_GO_ACTIVE=1.22\ngo version go1.22.12 linux/amd64\n' };
        }
        return {};
      }),
      kind: 'go',
      version: '1.22',
    });
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /1\.22|YSK_GO_ACTIVE/i.test(n))).toBe(true);
  });
});
