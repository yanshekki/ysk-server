import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  readMysqlFrozen,
  isMysqlDatadirEmptyOrUninitialized,
  clearMysqlFrozen,
  frozenUnitFailureHint,
} from './mysql-frozen.js';

function mockHost(opts: {
  frozen?: boolean;
  frozenContent?: string;
  datadirEmpty?: boolean;
}): HostExecutor {
  let frozen = opts.frozen ?? Boolean(opts.frozenContent);
  const content =
    opts.frozenContent ??
    (frozen
      ? 'This MySQL installation has entered frozen mode.\nfrozen-mode/downgrade'
      : '');

  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('__FROZEN_PRESENT__') || s.includes('FROZEN_ABSENT') || s.includes('/etc/mysql/FROZEN')) {
        if (s.includes('rm -f') || s.includes('CLEAR_OK') || s.includes('CLEAR_FAIL')) {
          if (s.includes('rm -f')) frozen = false;
          return {
            stdout: frozen ? 'CLEAR_FAIL\n' : 'CLEAR_OK\n',
            stderr: '',
            exitCode: frozen ? 1 : 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('journalctl')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (frozen) {
          return {
            stdout: `__FROZEN_PRESENT__\n${content}\n`,
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return {
          stdout: '__FROZEN_ABSENT__\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('/var/lib/mysql') || s.includes('has_data') || s.includes('empty')) {
        return {
          stdout: opts.datadirEmpty === false ? 'has_data\n' : 'empty\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('mysql-frozen', () => {
  it('readMysqlFrozen detects freeze content', async () => {
    const host = mockHost({
      frozen: true,
      frozenContent: 'MySQL has been frozen.\nfrozen-mode/downgrade',
    });
    const info = await readMysqlFrozen(host);
    expect(info.frozen).toBe(true);
    expect(info.content).toMatch(/frozen/i);
    expect(info.modeHint).toBe('downgrade');
  });

  it('readMysqlFrozen when absent', async () => {
    const host = mockHost({ frozen: false });
    const info = await readMysqlFrozen(host);
    expect(info.frozen).toBe(false);
  });

  it('isMysqlDatadirEmptyOrUninitialized', async () => {
    const empty = mockHost({ datadirEmpty: true });
    expect(await isMysqlDatadirEmptyOrUninitialized(empty)).toBe(true);
    const full = mockHost({ datadirEmpty: false });
    expect(await isMysqlDatadirEmptyOrUninitialized(full)).toBe(false);
  });

  it('clearMysqlFrozen removes marker', async () => {
    const host = mockHost({ frozen: true });
    const r = await clearMysqlFrozen(host);
    expect(r.ok).toBe(true);
  });

  it('frozenUnitFailureHint for mysql unit', async () => {
    const host = mockHost({
      frozen: true,
      frozenContent: 'MySQL has been frozen to prevent damage.\nfrozen-mode/downgrade',
    });
    const hint = await frozenUnitFailureHint(host, 'mysql');
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/FROZEN|凍結|冻结/i);
  });
});
