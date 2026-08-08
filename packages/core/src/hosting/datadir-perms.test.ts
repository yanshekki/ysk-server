import { mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  hardenDataDirPerms,
  dataDirMode,
  dataDirNeedsHarden,
  DATADIR_HARDENED_MODE,
} from './datadir-perms.js';

describe('hardenDataDirPerms', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('chmods 755 → 750 and clears other bits', () => {
    const dir = join(tmpdir(), `ysk-dd-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    chmodSync(dir, 0o755);
    expect(dataDirNeedsHarden(dir)).toBe(true);
    const r = hardenDataDirPerms(dir);
    expect(r.ok).toBe(true);
    expect(dataDirMode(dir)).toBe(DATADIR_HARDENED_MODE);
    expect(dataDirNeedsHarden(dir)).toBe(false);
  });

  it('fails honestly on missing path', () => {
    const r = hardenDataDirPerms(join(tmpdir(), 'ysk-no-such-dir-xyz'));
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
