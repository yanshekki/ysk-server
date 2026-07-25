import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyNodeHosting } from './node-apply.js';

describe('applyNodeHosting', () => {
  it('writes env, unit, and entry under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-node-'));
    const home = join(dir, 'projects', 'ysk_demo');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyNodeHosting({
      dataDir: dir,
      projectId: 'p1',
      projectName: 'Demo',
      linuxUser: 'ysk_demo',
      homeDir: home,
      nodeVersion: '20',
      host,
    });
    expect(existsSync(r.envPath)).toBe(true);
    expect(existsSync(r.unitPath)).toBe(true);
    expect(readFileSync(r.unitPath, 'utf8')).toContain('User=ysk_demo');
    expect(existsSync(join(home, 'app', 'server.js'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
