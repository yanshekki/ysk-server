import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyPublicFileServer } from './public-files.js';

describe('applyPublicFileServer', () => {
  it('creates public root and nginx conf without root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pub-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPublicFileServer({
      dataDir: dir,
      host,
      serverName: 'files.example.com',
      quotaMb: 256,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(r.publicRoot)).toBe(true);
    expect(existsSync(r.nginxPath)).toBe(true);
    expect(readFileSync(r.nginxPath, 'utf8')).toContain('autoindex on');
    expect(r.nginxReloaded).toBe(false);
    expect(r.requiresExecute).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
