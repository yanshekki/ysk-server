import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMigrateTempKey,
  destroyLocalTempKey,
  readTempPublicKey,
} from './temp-key.js';
import { migrateJobDir } from './types.js';

describe('temp-key local lifecycle', () => {
  let dir: string;
  const jobId = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-tk-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('generates key under migrate job dir', () => {
    const r = createMigrateTempKey({ dataDir: dir, jobId });
    // ssh-keygen may be available on CI/dev host
    if (!r.ok) {
      // environment without ssh-keygen
      expect(r.notes.join(' ')).toMatch(/無法產生|ssh-keygen|failed/i);
      return;
    }
    expect(r.privateKeyPath).toBeTruthy();
    expect(existsSync(r.privateKeyPath)).toBe(true);
    expect(existsSync(join(migrateJobDir(dir, jobId), 'ssh', 'id_ed25519'))).toBe(
      true,
    );
    const pub = readTempPublicKey(dir, jobId);
    expect(pub?.startsWith('ssh-')).toBe(true);
    const del = destroyLocalTempKey(dir, jobId);
    expect(del.ok).toBe(true);
    expect(existsSync(join(migrateJobDir(dir, jobId), 'ssh'))).toBe(false);
  });
});
