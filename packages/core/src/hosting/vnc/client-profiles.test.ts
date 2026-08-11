import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createClientProfile,
  listClientProfilesPublic,
  updateClientProfile,
  deleteClientProfile,
} from './client-profiles.js';
import { LocalHostExecutor } from '../../host/executor.js';

describe('vnc client profiles', () => {
  it('CRUD without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-c-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const p = createClientProfile(dir, {
      name: 'office',
      host: '10.0.0.9',
      port: 5901,
      path: 'via_server', // legacy → server_proxy
    });
    expect(p.name).toBe('office');
    expect(p.path).toBe('server_proxy');
    expect(listClientProfilesPublic(dir)).toHaveLength(1);
    updateClientProfile(dir, p.id, { path: 'direct' }); // legacy → user_reachable
    expect(listClientProfilesPublic(dir)[0]!.path).toBe('user_reachable');
    const del = await deleteClientProfile({ host, dataDir: dir, id: p.id });
    expect(del.ok).toBe(true);
    expect(listClientProfilesPublic(dir)).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
