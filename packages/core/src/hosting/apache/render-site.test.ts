import { describe, expect, it } from 'vitest';
import { renderApacheSite } from './render-site.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApacheSite, listApacheSites, applyApacheSite } from './service.js';
import { LocalHostExecutor } from '../../host/executor.js';

describe('apache', () => {
  it('renders proxy vhost', () => {
    const c = renderApacheSite({
      serverName: 'a.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:3000',
    });
    expect(c).toContain('ProxyPass');
    expect(c).toContain('a.example.com');
  });

  it('creates site without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const s = createApacheSite(dir, { serverName: 'b.test', kind: 'static', root: '/var/www' });
    expect(listApacheSites(dir)).toHaveLength(1);
    const r = await applyApacheSite({ dataDir: dir, host, id: s.id });
    expect(r.blocked).toBe(true);
    expect(r.site?.confPath).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });
});
