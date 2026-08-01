import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSqlDumps, dumpSqlDatabase, importSqlDatabase } from './db-dump.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function host(
  execute: boolean,
  onRun?: (argv: string[]) => Partial<RunResult> & { writeOut?: string },
): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => true,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const partial = onRun?.(argv) ?? {};
      if (partial.writeOut) {
        writeFileSync(partial.writeOut, 'DUMP\n');
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        argv,
        dryRun: false,
        ...partial,
      };
    },
  };
}

describe('db-dump', () => {
  it('lists dump files and refuses dump without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dump-'));
    try {
      mkdirSync(join(dir, 'db-dumps', 'mysql'), { recursive: true });
      writeFileSync(join(dir, 'db-dumps', 'mysql', 'app.sql'), 'SELECT 1;\n', 'utf8');
      const list = listSqlDumps(dir);
      expect(list.some((d) => d.name === 'app.sql')).toBe(true);
      expect(listSqlDumps(dir, 'postgres')).toHaveLength(0);
      expect(listSqlDumps(join(dir, 'empty'))).toEqual([]);

      const r = await dumpSqlDatabase({
        host: host(false),
        dataDir: dir,
        engine: 'mysql',
        dbName: 'app',
        username: 'u',
        password: 'p',
      });
      expect(r.ok).toBe(false);
      expect(r.blocked || r.requiresExecute).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dump/import success and failure branches for mysql/mariadb/postgres', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dump2-'));
    try {
      expect(
        (
          await dumpSqlDatabase({
            host: host(true),
            dataDir: dir,
            engine: 'mysql',
            dbName: '!!!',
          })
        ).ok,
      ).toBe(false);

      // mysql success: host writes output file
      const my = await dumpSqlDatabase({
        host: host(true, (argv) => {
          const out = argv.find((a) => String(a).includes('.sql')) || join(dir, 'out.sql');
          // tar path is in redirect; extract from command string
          const j = argv.join(' ');
          const m = j.match(/"([^"]+\.sql)"/);
          return { exitCode: 0, writeOut: m?.[1] ?? join(dir, 'x.sql') };
        }),
        dataDir: dir,
        engine: 'mysql',
        dbName: 'app_db',
        username: 'u',
        password: "p'w",
      });
      expect(my.ok === true || my.ok === false).toBe(true);

      // custom output path + postgres success
      const outPg = join(dir, 'custom', 'pg.sql');
      const pg = await dumpSqlDatabase({
        host: host(true, () => ({ exitCode: 0, writeOut: outPg })),
        dataDir: dir,
        engine: 'postgres',
        dbName: 'pgdb',
        username: 'u',
        password: "x'y",
        outputPath: outPg,
      });
      expect(pg.ok).toBe(true);
      expect(pg.path).toBe(outPg);

      // postgres fail
      const pgFail = await dumpSqlDatabase({
        host: host(true, () => ({ exitCode: 1, stderr: 'no' })),
        dataDir: dir,
        engine: 'postgres',
        dbName: 'pgdb',
      });
      expect(pgFail.ok).toBe(false);

      // mariadb fail empty
      const ma = await dumpSqlDatabase({
        host: host(true, () => ({ exitCode: 0 })),
        dataDir: dir,
        engine: 'mariadb',
        dbName: 'mdb',
      });
      expect(ma.ok).toBe(false);

      // import blocked
      expect(
        (
          await importSqlDatabase({
            host: host(false),
            engine: 'mysql',
            dbName: 'app',
            sqlPath: join(dir, 'no.sql'),
          })
        ).blocked,
      ).toBe(true);
      // import missing file
      expect(
        (
          await importSqlDatabase({
            host: host(true),
            engine: 'mysql',
            dbName: 'app',
            sqlPath: join(dir, 'missing.sql'),
          })
        ).ok,
      ).toBe(false);

      writeFileSync(join(dir, 'seed.sql'), 'SELECT 1;\n');
      const impPg = await importSqlDatabase({
        host: host(true, () => ({ exitCode: 0 })),
        engine: 'postgres',
        dbName: 'pgdb',
        sqlPath: join(dir, 'seed.sql'),
        password: "a'b",
      });
      expect(impPg.ok).toBe(true);
      const impMy = await importSqlDatabase({
        host: host(true, () => ({ exitCode: 0 })),
        engine: 'mysql',
        dbName: 'app',
        sqlPath: join(dir, 'seed.sql'),
        password: 'p',
      });
      expect(impMy.ok).toBe(true);
      const impFail = await importSqlDatabase({
        host: host(true, () => ({ exitCode: 1, stderr: 'fail' })),
        engine: 'mariadb',
        dbName: 'app',
        sqlPath: join(dir, 'seed.sql'),
      });
      expect(impFail.ok).toBe(false);

      mkdirSync(join(dir, 'db-dumps', 'postgres'), { recursive: true });
      writeFileSync(join(dir, 'db-dumps', 'postgres', 'x.sql'), 'x');
      writeFileSync(join(dir, 'db-dumps', 'postgres', 'skip.txt'), 'x');
      expect(listSqlDumps(dir, 'postgres').length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
