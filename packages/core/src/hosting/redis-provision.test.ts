import { describe, expect, it } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { provisionRedisBinding } from './redis-provision.js';

describe('provisionRedisBinding', () => {
  it('refuses execute without EXECUTE / redis-cli', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await provisionRedisBinding({
      hostExec: host,
      projectId: 'p1',
      dbIndex: 2,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.plan.connectionHint?.db).toBe(2);
    expect(r.notes.join(' ')).toMatch(
      /NOT provisioned|YSK_EXECUTE|redis-cli|系統變更|尚未|Redis|權限/i,
    );
  });
});
