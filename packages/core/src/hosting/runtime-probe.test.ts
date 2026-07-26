import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { planOrInstallRuntime, probeRuntimes } from './runtime-probe.js';

describe('runtime-probe', () => {
  it('probes host for supported node/php/python/go/rust versions', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await probeRuntimes(host);
    expect(r.node.length).toBeGreaterThanOrEqual(3);
    expect(r.php.length).toBeGreaterThanOrEqual(3);
    expect(r.python.length).toBeGreaterThanOrEqual(3);
    expect(r.go.length).toBeGreaterThanOrEqual(3);
    expect(r.rust.length).toBeGreaterThanOrEqual(1);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.node.every((n) => typeof n.available === 'boolean')).toBe(true);
  });

  it('writes install helper and refuses without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rt-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const plan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'node',
      version: '20',
      install: false,
    });
    expect(plan.ok).toBe(true);
    expect(existsSync(plan.written[0])).toBe(true);

    const refused = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'php',
      version: '8.2',
      install: true,
    });
    expect(refused.ok).toBe(false);
    expect(refused.notes.some((n) => /系統變更|YSK_EXECUTE|權限/i.test(n))).toBe(true);

    const goPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'go',
      version: '1.22',
      install: false,
    });
    expect(goPlan.written[0]).toMatch(/install\.sh$/);
    rmSync(dir, { recursive: true, force: true });
  });
});
