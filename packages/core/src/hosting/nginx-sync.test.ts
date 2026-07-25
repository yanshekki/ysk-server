import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listManagedNginxConfs, syncNginxConfigs, writeManagedNginxConf } from './nginx-sync.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('nginx managed conf', () => {
  it('writes conf under dataDir and dry-run sync lists files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-'));
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeManagedNginxConf(dir, 'demo.conf', 'server { server_name demo.test; }\n');
    const files = listManagedNginxConfs(dir);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('demo.conf');

    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const result = await syncNginxConfigs({
      dataDir: dir,
      systemConfDir: join(dir, 'system-nginx'),
      host,
      dryRun: true,
    });
    expect(result.files).toContain('demo.conf');
    expect(result.copied).toHaveLength(0);
    expect(existsSync(join(dir, 'nginx', 'ysk-managed.conf'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
