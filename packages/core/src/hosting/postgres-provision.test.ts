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
