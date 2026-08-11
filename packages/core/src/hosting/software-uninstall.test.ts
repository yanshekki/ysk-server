import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  previewSoftwareUninstall,
  uninstallSoftware,
  resolveUninstallIds,
} from './software-uninstall.js';

function host(opts?: {
  exec?: boolean;
  root?: boolean;
  bins?: string[];
}): HostExecutor {
  const bins = new Set(opts?.bins ?? ['nginx', 'postfix']);
  return {
    executeEnabled: () => opts?.exec !== false,
    isRoot: () => opts?.root !== false,
    pathExists: (p) => bins.has(p.split('/').pop() || ''),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'active',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv): Promise<RunResult> => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        const name = s.match(/command -v (\S+)/)?.[1] ?? '';
        return {
          stdout: bins.has(name) ? `/usr/sbin/${name}\n` : '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: 'ok\n', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('software-uninstall', () => {
  it('resolves feature ids', () => {
    const ids = resolveUninstallIds({ feature: 'email' });
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(['postfix', 'dovecot', 'opendkim']));
  });

  it('preview lists targets and confirm phrase', async () => {
    const p = await previewSoftwareUninstall({
      host: host({ bins: ['nginx'] }),
      ids: ['nginx'],
      dataPolicy: 'keep',
    });
    expect(p.ok).toBe(true);
    expect(p.confirmPhrase).toBe('UNINSTALL');
    expect(p.targets[0]?.id).toBe('nginx');
    expect(p.summary.willStopServices).toBe(true);
  });

  it('refuses wrong confirm phrase', async () => {
    const r = await uninstallSoftware({
      host: host(),
      ids: ['nginx'],
      confirmPhrase: 'wrong',
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
  });

  it('blocks without execute', async () => {
    const r = await uninstallSoftware({
      host: host({ exec: false }),
      ids: ['nginx'],
      confirmPhrase: 'UNINSTALL',
    });
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
  });

  it('uninstalls with execute and correct phrase', async () => {
    const logs: string[] = [];
    const r = await uninstallSoftware({
      host: host({ bins: ['nginx'] }),
      ids: ['nginx'],
      dataPolicy: 'keep',
      confirmPhrase: 'UNINSTALL',
      onLog: (_s, line) => logs.push(line),
    });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(true);
    expect(logs.some((l) => l.includes('uninstall'))).toBe(true);
  });
});
