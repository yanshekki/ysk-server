import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyWebmail } from './webmail-apply.js';

describe('webmail-apply', () => {
  it('writes Roundcube config skeleton and nginx conf (plan mode)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyWebmail({
      dataDir: dir,
      host,
      domain: 'webmail.example.com',
      download: false,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('plan');
    expect(existsSync(r.configPath)).toBe(true);
    expect(readFileSync(r.configPath, 'utf8')).toContain('default_host');
    expect(existsSync(r.webRoot)).toBe(true);
    expect(r.written.some((p) => p.includes('install-roundcube.sh'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses download without YSK_EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyWebmail({
      dataDir: dir,
      host,
      domain: 'webmail.deny.test',
      download: true,
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('refused');
    expect(r.requiresExecute).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
