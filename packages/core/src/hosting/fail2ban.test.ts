import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyFail2ban } from './system-apply.js';

describe('applyFail2ban', () => {
  it('writes jail.local and refuses install without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2b-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await applyFail2ban({ dataDir: dir, host, apply: true });
      expect(existsSync(r.written[0])).toBe(true);
      expect(readFileSync(r.written[0], 'utf8')).toContain('[sshd]');
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).toBe(true);
      expect(r.notes.join(' ')).toMatch(/YSK_EXECUTE|root/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan-only apply=false is ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2b2-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await applyFail2ban({ dataDir: dir, host, apply: false });
      expect(r.ok).toBe(true);
      expect(r.commandResults).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
