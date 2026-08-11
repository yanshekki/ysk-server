import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { switchRuntimeDefault, uninstallRuntimeVersion } from './runtime-probe.js';

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
  it('switches java when jvm binary exists (script path)', async () => {
    const r = await switchRuntimeDefault({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return { exitCode: 0, stdout: 'YSK_JAVA_ACTIVE=21\nopenjdk version 21\n' };
        }
        return {};
      }),
      kind: 'java',
      version: '21',
    });
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /21|YSK_JAVA/i.test(n))).toBe(true);
  });

  it('switches node symlink when installed under ysk path', async () => {
    const r = await switchRuntimeDefault({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return {
            exitCode: 0,
            stdout: 'YSK_NODE_ACTIVE=20\nv20.18.0\n',
          };
        }
        return {};
      }),
      kind: 'node',
      version: '20',
    });
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /20|YSK_NODE/i.test(n))).toBe(true);
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

describe('uninstallRuntimeVersion', () => {
  it('uninstalls java openjdk packages', async () => {
    const r = await uninstallRuntimeVersion({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return { exitCode: 0, stdout: 'YSK_JAVA_REMOVED=21\n' };
        }
        return {};
      }),
      kind: 'java',
      version: '21',
    });
    expect(r.ok).toBe(true);
  });

  it('uninstalls php version packages', async () => {
    const r = await uninstallRuntimeVersion({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return { exitCode: 0, stdout: 'YSK_PHP_REMOVED=8.2\n' };
        }
        return {};
      }),
      kind: 'php',
      version: '8.2',
    });
    expect(r.ok).toBe(true);
  });

  it('blocks without execute', async () => {
    const r = await uninstallRuntimeVersion({
      host: mockHost(() => ({}), { execute: false }),
      kind: 'node',
      version: '20',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('removes managed node dir', async () => {
    const r = await uninstallRuntimeVersion({
      host: mockHost((argv) => {
        if (argv[0] === 'bash') {
          return {
            exitCode: 0,
            stdout: 'YSK_NODE_REMOVED=20\nYSK_REMOVED_PATH=/usr/local/ysk/node/20\n',
          };
        }
        return {};
      }),
      kind: 'node',
      version: '20',
    });
    expect(r.ok).toBe(true);
    expect(r.removedPath).toMatch(/node\/20/);
  });
});
