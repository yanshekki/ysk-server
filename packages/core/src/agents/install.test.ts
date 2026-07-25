import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyAgentInstall } from './install.js';

describe('applyAgentInstall', () => {
  it('writes managed artifacts without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-agent-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await applyAgentInstall({
        dataDir: dir,
        kind: 'openclaw',
        host,
        execute: true,
      });
      expect(r.written.length).toBeGreaterThan(0);
      expect(existsSync(r.written[0])).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).toBe(true);
      expect(r.kind).toBe('openclaw');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan-only execute=false is ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-agent2-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await applyAgentInstall({
        dataDir: dir,
        kind: 'hermes',
        host,
        execute: false,
      });
      expect(r.ok).toBe(true);
      expect(r.commandResults).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
