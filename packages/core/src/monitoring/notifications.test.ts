import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { LocalHostExecutor } from '../host/executor.js';
import { collectNotifications } from './notifications.js';
import type { YskDatabase } from '../db/database.js';

describe('collectNotifications', () => {
  it('surfaces pending approvals and EXECUTE warn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-notif-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.approvals = [
        {
          id: 'a1',
          action: 'tool.dangerous',
          status: 'pending',
          risk: 'high',
          requested_by: 'admin',
          created_at: new Date().toISOString(),
          payload: {},
        },
      ];
      store.persist();
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await collectNotifications({
        db: store as unknown as YskDatabase,
        host,
        dataDir: dir,
        executeEnabled: false,
      });
      expect(r.counts.warn + r.counts.critical).toBeGreaterThan(0);
      expect(r.items.some((i) => i.id === 'exec-disabled')).toBe(true);
      expect(r.items.some((i) => i.id === 'approvals-pending')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
