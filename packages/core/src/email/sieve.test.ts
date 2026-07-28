import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listSieveScripts,
  writeSieveScript,
  sieveDir,
} from './sieve.js';

describe('sieve', () => {
  it('writes and lists scripts under dataDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sieve-'));
    try {
      expect(() => writeSieveScript({ dataDir: dir, mailbox: '!!!', content: 'x' })).toThrow();
      const r = writeSieveScript({
        dataDir: dir,
        mailbox: 'user@example.com',
        name: 'default.sieve',
        content: 'require ["fileinto"];\n',
      });
      expect(r.ok).toBe(true);
      expect(existsSync(r.script.path)).toBe(true);
      const list = listSieveScripts(dir, 'user@example.com');
      expect(list.some((s) => s.name === 'default.sieve')).toBe(true);
      expect(sieveDir(dir, 'user@example.com')).toContain('sieve');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
