import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { assertQuotaMb, checkProjectQuota, measureDirBytes } from './quota.js';
import { YskError } from 'ysk-server-shared';

describe('quota', () => {
  it('measures dir and checks soft quota', async () => {
    expect(() => assertQuotaMb(0)).toThrow(YskError);
    const dir = mkdtempSync(join(tmpdir(), 'ysk-quota-'));
    try {
      mkdirSync(join(dir, 'app'), { recursive: true });
      writeFileSync(join(dir, 'app', 'x.bin'), Buffer.alloc(2048));
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const m = await measureDirBytes(host, dir);
      expect(m.bytes).toBeGreaterThan(0);
      const st = await checkProjectQuota({
        host,
        projectId: 'p1',
        homeDir: dir,
        quotaMb: 1,
      });
      expect(st.usedMb).toBeGreaterThanOrEqual(0);
      expect(st.quotaMb).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
