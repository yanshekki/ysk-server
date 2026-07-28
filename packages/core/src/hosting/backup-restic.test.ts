import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { LocalHostExecutor } from '../host/executor.js';
import {
  getResticSettings,
  resticBackupProject,
  setResticSettings,
} from './backup-restic.js';

describe('backup-restic honesty', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('disabled → skipped not fake success for operators', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await resticBackupProject({
      host,
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /未啟用/.test(n))).toBe(true);
  });

  it('enabled without password fails closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-pw-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    setResticSettings(store, { enabled: true, password: '' });
    // setRestic may keep empty — force raw
    store.snapshot.settings.restic_settings = JSON.stringify({
      enabled: true,
      repoPath: join(dir, 'repo'),
    });
    store.persist();
    expect(getResticSettings(store).enabled).toBe(true);
    expect(getResticSettings(store).password).toBeFalsy();

    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const r = await resticBackupProject({
      host,
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeFalsy();
    expect(r.notes.some((n) => /password/i.test(n))).toBe(true);
  });
});
