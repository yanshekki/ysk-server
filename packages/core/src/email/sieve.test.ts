import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listSieveScripts,
  writeSieveScript,
  sieveDir,
  readSieveScript,
  deleteSieveScript,
  DEFAULT_SIEVE_TEMPLATE,
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

  it('reads, rejects bad names, deletes, and exposes template', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sieve-'));
    try {
      expect(DEFAULT_SIEVE_TEMPLATE).toContain('fileinto');
      expect(() =>
        writeSieveScript({
          dataDir: dir,
          mailbox: 'a@b.co',
          name: 'noext',
          content: 'x',
        }),
      ).toThrow();

      writeSieveScript({
        dataDir: dir,
        mailbox: 'a@b.co',
        name: 'vacation.sieve',
        content: DEFAULT_SIEVE_TEMPLATE,
      });
      const got = readSieveScript(dir, 'a@b.co', 'vacation.sieve');
      expect(got.content).toContain('vacation');
      expect(() => readSieveScript(dir, 'a@b.co', 'missing.sieve')).toThrow();

      expect(deleteSieveScript(dir, 'a@b.co', 'missing.sieve').ok).toBe(false);
      expect(deleteSieveScript(dir, 'a@b.co', 'vacation.sieve').ok).toBe(true);
      expect(listSieveScripts(dir, 'a@b.co')).toHaveLength(0);

      // local-part only mailbox accepted
      const local = writeSieveScript({
        dataDir: dir,
        mailbox: 'postmaster',
        content: 'keep;\n',
      });
      expect(local.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
