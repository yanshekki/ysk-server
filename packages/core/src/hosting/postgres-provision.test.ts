import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { provisionPostgresDatabase, renderPostgresProvisionSql } from './postgres-provision.js';

describe('postgres provision', () => {
  it('renders sql plan', () => {
    const sql = renderPostgresProvisionSql({
      dbName: 'appdb',
      username: 'appuser',
      password: 'longpassword1',
    });
    expect(sql.some((s) => s.includes('CREATE'))).toBe(true);
  });

  it('refuses without EXECUTE / psql', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await provisionPostgresDatabase({
      dbName: 'appdb',
      username: 'appuser',
      password: 'longpassword1',
      hostExec: host,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.notes.join(' ')).toMatch(
      /NOT provisioned|YSK_EXECUTE|psql|PostgreSQL|系統變更|未安裝|尚未建立|未開啟/i,
    );
  });

  it('uses postgres peer auth locally instead of TCP as root', async () => {
    const seen: string[][] = [];
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv: string[]) => {
        seen.push(argv);
        if (argv[0] === 'psql' || argv.includes('psql')) {
          return { stdout: 'CREATE ROLE', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await provisionPostgresDatabase({
      dbName: 'qa35_py',
      username: 'qa35_py',
      password: 'longpassword1',
      hostExec: host,
      execute: true,
    });
    const psql = seen.find((a) => a.includes('psql'));
    expect(psql).toBeTruthy();
    expect(psql).toContain('sudo');
    expect(psql).toContain('postgres');
    expect(psql?.includes('-h')).toBe(false);
    expect(r.executed).toBe(true);
  });

  it('rejects short password', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await provisionPostgresDatabase({
      dbName: 'appdb',
      username: 'appuser',
      password: 'short',
      hostExec: host,
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/password/i);
  });
});
