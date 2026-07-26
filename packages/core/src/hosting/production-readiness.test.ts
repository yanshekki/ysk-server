import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { assessProductionReadiness } from './production-readiness.js';

describe('assessProductionReadiness', () => {
  it('reports degraded without EXECUTE/root and lists items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ready-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await assessProductionReadiness({ dataDir: dir, host, product: 'YSK' });
    expect(r.mode).toBe('degraded');
    expect(r.productionReady).toBe(false);
    expect(r.items.length).toBeGreaterThan(10);
    expect(r.score.total).toBe(r.items.length);
    expect(r.summary.some((s) => /YSK_EXECUTE|Mode/i.test(s))).toBe(true);
    expect(r.items.some((i) => i.id === 'control-plane')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
