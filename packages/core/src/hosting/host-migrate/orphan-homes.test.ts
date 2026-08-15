import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { parseOrphanProjectHome, removeOrphanProjectHome } from './orphan-homes.js';

const ID = '11111111-2222-4333-a444-555555555555';

describe('orphan project homes', () => {
  it('parses only /home/ysk-server-<uuid>', () => {
    expect(parseOrphanProjectHome(`/home/ysk-server-${ID}`)?.projectId).toBe(ID);
    expect(parseOrphanProjectHome('/home/ysk-server-not-uuid')).toBeUndefined();
    expect(parseOrphanProjectHome('/tmp/ysk-server-' + ID)).toBeUndefined();
  });

  it('refuses mismatch confirm and store-owned homes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-orphan-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const r = await removeOrphanProjectHome({
        host: {
          executeEnabled: () => false,
          isRoot: () => true,
          pathExists: () => true,
          readFile: async () => '',
          listDir: async () => [],
          writeFile: async () => undefined,
          deletePath: async () => undefined,
          mkdirp: async () => undefined,
          sysInfo: async () => ({}),
          serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
          runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        },
        db,
        path: `/home/ysk-server-${ID}`,
        confirmPath: '/home/other',
      });
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).not.toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is plan-only without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-orphan-e-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const home = `/home/ysk-server-${ID}`;
      const r = await removeOrphanProjectHome({
        host: {
          executeEnabled: () => false,
          isRoot: () => true,
          pathExists: () => true,
          readFile: async () => '',
          listDir: async () => [],
          writeFile: async () => undefined,
          deletePath: async () => undefined,
          mkdirp: async () => undefined,
          sysInfo: async () => ({}),
          serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
          runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        },
        db,
        path: home,
        confirmPath: home,
      });
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
