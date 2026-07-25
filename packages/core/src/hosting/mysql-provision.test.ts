import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { provisionMysqlDatabase } from './mysql-provision.js';

describe('provisionMysqlDatabase', () => {
  it('refuses with ok=false when EXECUTE disabled (never fake success)', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await provisionMysqlDatabase({
      dbName: 'appdb',
      username: 'appuser',
      password: 'longpassword1',
      hostExec: host,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(r.sql.length).toBeGreaterThan(0);
    expect(r.notes.join(' ')).toMatch(/NOT provisioned|YSK_EXECUTE/i);
  });

  it('rejects short password', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await provisionMysqlDatabase({
      dbName: 'appdb',
      username: 'appuser',
      password: 'short',
      hostExec: host,
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/password/i);
  });
});
