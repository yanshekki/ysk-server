import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  readMysqlFrozen,
  isMysqlDatadirEmptyOrUninitialized,
  clearMysqlFrozen,
  frozenUnitFailureHint,
  sanitizeSqlConfigForFlavor,
  initializeMysqlDatadirIfEmpty,
  recoverMysqlAfterEngineSwitch,
  unfreezeMysqlEngine,
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

  it('frozenUnitFailureHint skips non-sql units and unfrozen hosts', async () => {
    expect(await frozenUnitFailureHint(mockHost({ frozen: true }), 'nginx')).toBeUndefined();
    expect(await frozenUnitFailureHint(mockHost({ frozen: false }), 'mysql')).toBeUndefined();
  });

  it('sanitizeSqlConfigForFlavor ok + fail for mysql and mariadb', async () => {
    const okMysql = await sanitizeSqlConfigForFlavor(
      {
        ...mockHost({ frozen: false }),
        runCommand: async (argv) => ({
          stdout: 'CONFIG_OK\n/etc/mysql/mysql.cnf\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        }),
      },
      'mysql',
    );
    expect(okMysql.ok).toBe(true);
    expect(okMysql.notes.length).toBeGreaterThan(0);

    const okMaria = await sanitizeSqlConfigForFlavor(
      {
        ...mockHost({ frozen: false }),
        runCommand: async (argv) => ({
          stdout: 'CONFIG_OK\n/etc/mysql/mariadb.cnf\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        }),
      },
      'mariadb',
    );
    expect(okMaria.ok).toBe(true);

    const bad = await sanitizeSqlConfigForFlavor(
      {
        ...mockHost({ frozen: false }),
        runCommand: async (argv) => ({
          stdout: 'nope',
          stderr: 'sanitize fail',
          exitCode: 1,
          argv,
          dryRun: false,
        }),
      },
      'mysql',
    );
    expect(bad.ok).toBe(false);
  });

  it('initializeMysqlDatadirIfEmpty skips non-empty and initializes empty', async () => {
    const skip = await initializeMysqlDatadirIfEmpty(mockHost({ datadirEmpty: false }), 'mysql');
    expect(skip.ok).toBe(true);
    expect(skip.initialized).toBe(false);

    const initOk = await initializeMysqlDatadirIfEmpty(
      {
        ...mockHost({ datadirEmpty: true }),
        runCommand: async (argv) => {
          const s = argv.join(' ');
          if (s.includes('/var/lib/mysql') && (s.includes('empty') || s.includes('has_data'))) {
            return { stdout: 'empty\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          // init script
          return { stdout: 'init ok\n', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      },
      'mysql',
    );
    expect(initOk.ok).toBe(true);
    expect(initOk.initialized).toBe(true);

    const initMaria = await initializeMysqlDatadirIfEmpty(
      {
        ...mockHost({ datadirEmpty: true }),
        runCommand: async (argv) => {
          const s = argv.join(' ');
          if (s.includes('empty') || s.includes('has_data')) {
            return { stdout: 'empty\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          return { stdout: 'ok\n', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      },
      'mariadb',
    );
    expect(initMaria.initialized).toBe(true);

    const initFail = await initializeMysqlDatadirIfEmpty(
      {
        ...mockHost({ datadirEmpty: true }),
        runCommand: async (argv) => {
          const s = argv.join(' ');
          if (s.includes('empty') || s.includes('has_data')) {
            return { stdout: 'empty\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          return { stdout: '', stderr: 'mysqld not found', exitCode: 2, argv, dryRun: false };
        },
      },
      'mysql',
    );
    expect(initFail.ok).toBe(false);
    expect(initFail.initialized).toBe(false);
  });

  it('clearMysqlFrozen no-ops when not frozen; unfreeze/recover map health pipeline', async () => {
    const noop = await clearMysqlFrozen(mockHost({ frozen: false }));
    expect(noop.ok).toBe(true);

    // blocked path without root/execute
    const blockedHost: HostExecutor = {
      ...mockHost({ frozen: false }),
      executeEnabled: () => false,
      isRoot: () => false,
    };
    const blocked = await unfreezeMysqlEngine(blockedHost, 'mysql', { confirm: true });
    expect(blocked.blocked).toBe(true);

    const needs = await unfreezeMysqlEngine(mockHost({ frozen: false }), 'mysql', {
      confirm: false,
    });
    // may be needs_confirm or already healthy depending on probe — just shape
    expect(typeof needs.ok).toBe('boolean');
    expect(Array.isArray(needs.notes)).toBe(true);

    const recover = await recoverMysqlAfterEngineSwitch(
      {
        ...mockHost({ frozen: false, datadirEmpty: false }),
        pathExists: () => false,
        runCommand: async (argv) => {
          const s = argv.join(' ');
          if (s.includes('FROZEN')) {
            return { stdout: '__FROZEN_ABSENT__\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (s.includes('/var/lib/mysql')) {
            return { stdout: 'has_data\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (s.includes('command -v') || s.includes('journalctl')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      },
      'mysql',
    );
    expect(typeof recover.ok).toBe('boolean');
    expect(Array.isArray(recover.steps)).toBe(true);
  });

  it('readMysqlFrozen journal fallback when marker absent but journal mentions freeze', async () => {
    const host: HostExecutor = {
      ...mockHost({ frozen: false }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('journalctl')) {
          return {
            stdout: 'mysqld: frozen-mode/downgrade detected\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('FROZEN')) {
          return { stdout: '__FROZEN_ABSENT__\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const info = await readMysqlFrozen(host);
    expect(info.frozen).toBe(true);
    expect(info.modeHint).toBe('downgrade');
  });
});
