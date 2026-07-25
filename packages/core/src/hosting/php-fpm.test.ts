import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyPhpFpmPool, renderPhpFpmPool } from './php-fpm.js';

describe('php-fpm', () => {
  it('renders pool and writes under dataDir', async () => {
    const conf = renderPhpFpmPool({
      poolName: 'ysk_demo',
      linuxUser: 'ysk_demo',
      phpVersion: '8.2',
    });
    expect(conf).toContain('[ysk_demo]');
    expect(conf).toContain('pm = ondemand');

    const dir = mkdtempSync(join(tmpdir(), 'ysk-fpm-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await applyPhpFpmPool({
        dataDir: dir,
        poolName: 'ysk_demo',
        linuxUser: 'ysk_demo',
        phpVersion: '8.2',
        host,
        enable: true,
      });
      expect(existsSync(r.poolPath)).toBe(true);
      expect(readFileSync(r.poolPath, 'utf8')).toContain('user = ysk_demo');
      expect(r.enabled).toBe(false);
      expect(r.ok).toBe(false); // enable requested but no EXECUTE/root
      expect(r.requiresExecute || r.requiresRoot).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
