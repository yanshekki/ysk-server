import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSqlDumps, dumpSqlDatabase } from './db-dump.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean): HostExecutor {
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
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false }),
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
});
