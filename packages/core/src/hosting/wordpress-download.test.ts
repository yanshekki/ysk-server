import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { downloadWordpressCore } from './wordpress-download.js';

describe('downloadWordpressCore', () => {
  it('refuses without EXECUTE and writes plan note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wp-'));
    try {
      mkdirSync(join(dir, 'app'), { recursive: true });
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await downloadWordpressCore({ host, homeDir: dir });
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).toBe(true);
      expect(r.executed).toBe(false);
      expect(existsSync(join(dir, 'app', 'WORDPRESS_DOWNLOAD.txt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips when wp-settings.php already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wp2-'));
    try {
      const pub = join(dir, 'app', 'public');
      mkdirSync(pub, { recursive: true });
      writeFileSync(join(pub, 'wp-settings.php'), '<?php\n', 'utf8');
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
      const r = await downloadWordpressCore({ host, homeDir: dir });
      expect(r.ok).toBe(true);
      expect(r.executed).toBe(false);
      expect(r.hasWpSettings).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
