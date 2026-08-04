import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  readMysqlFrozen,
  isMysqlDatadirEmptyOrUninitialized,
  clearMysqlFrozen,
  frozenUnitFailureHint,
} from './mysql-frozen.js';

function mockHost(opts: {
  frozenContent?: string | null;
  datadirEmpty?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
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
      if (opts.run) {
        const p = opts.run(argv);
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false, ...p };
      }
      const s = argv.join(' ');
      if (s.includes('/etc/mysql/FROZEN') && s.includes('cat')) {
        if (opts.frozenContent) {
          return {
            stdout: opts.frozenContent + '\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('echo yes') || (s.includes('FROZEN') && s.includes('[ -e'))) {
        if (opts.frozenContent) {
          return { stdout: 'yes\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('/var/lib/mysql') && s.includes('has_data')) {
        return {
          stdout: opts.datadirEmpty === false ? 'has_data\n' : 'empty\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('rm -f') && s.includes('FROZEN')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('mysql-frozen', () => {
  it('readMysqlFrozen detects freeze content', async () => {
    const host = mockHost({
      frozenContent: 'MySQL has been frozen to prevent damage.\nfrozen-mode/downgrade',
    });
    const info = await readMysqlFrozen(host);
    expect(info.frozen).toBe(true);
    expect(info.content).toMatch(/frozen/i);
    expect(info.modeHint).toBe('downgrade');
  });

  it('readMysqlFrozen when absent', async () => {
    const host = mockHost({ frozenContent: null });
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
    let frozen = true;
    const host = mockHost({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('rm -f') && s.includes('FROZEN')) {
          frozen = false;
          return { exitCode: 0 };
        }
        if (s.includes('echo yes') || (s.includes('[ -e') && s.includes('FROZEN'))) {
          return { stdout: frozen ? 'yes\n' : '', exitCode: 0 };
        }
        if (s.includes('cat') && s.includes('FROZEN')) {
          return {
            stdout: frozen ? 'frozen-mode/downgrade\n' : '',
            exitCode: 0,
          };
        }
        return { exitCode: 0 };
      },
    });
    const r = await clearMysqlFrozen(host);
    expect(r.ok).toBe(true);
    expect(frozen).toBe(false);
  });

  it('frozenUnitFailureHint for mysql unit', async () => {
    const host = mockHost({
      frozenContent: 'MySQL has been frozen to prevent damage to your system.\nfrozen-mode/downgrade',
    });
    const hint = await frozenUnitFailureHint(host, 'mysql');
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/FROZEN|凍結|冻结/i);
  });
});
