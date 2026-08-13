import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileManager, publicFilesRoot } from './manager.js';
import { YskError } from 'ysk-server-shared';

describe('FileManager sandbox', () => {
  it('lists, writes, reads, and blocks path escape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-'));
    const fm = new FileManager(dir);
    fm.mkdir('docs');
    fm.writeText('docs/hello.txt', 'hello ysk');
    const list = fm.list('docs');
    expect(list.some((e) => e.name === 'hello.txt')).toBe(true);
    expect(fm.readText('docs/hello.txt').content).toBe('hello ysk');
    expect(() => fm.readText('../etc/passwd')).toThrow(/沙箱|sandbox|escape|SANDBOX|pathOutside/i);
    expect(() => fm.readText('docs/../../etc/passwd')).toThrow();
    expect(() => fm.readText('x\0y')).toThrow();
    fm.remove('docs/hello.txt');
    expect(fm.list('docs')).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('blocks parent symlink escape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-sym-'));
    try {
      const fm = new FileManager(dir);
      symlinkSync(join(dir, '..'), join(dir, 'up'));
      expect(() => fm.writeText('up/ysk-fm-escape.txt', 'x')).toThrow(YskError);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
      throw e;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeBase64, stat, refuse root delete, publicFilesRoot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-'));
    const fm = new FileManager(dir);
    const b64 = Buffer.from('bin-data').toString('base64');
    const w = fm.writeBase64('bin/x.dat', b64);
    expect(w.bytes).toBe(8);
    const st = fm.stat('bin/x.dat');
    expect(st.type).toBe('file');
    expect(st.size).toBe(8);
    expect(st.mime).toBeTruthy();
    expect(() => fm.remove('.')).toThrow(YskError);
    expect(fm.remove('missing-nope').deleted).toBe(false);
    const pub = publicFilesRoot(dir);
    expect(pub).toContain('files/public');
    rmSync(dir, { recursive: true, force: true });
  });

  it('chmod and zip when zip available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-chmod-'));
    try {
      const fm = new FileManager(dir);
      writeFileSync(join(dir, 'a.txt'), 'hi', 'utf8');
      const m = fm.chmod('a.txt', '600');
      expect(m.mode).toBe('600');
      // zip may be missing on minimal CI — skip soft
      try {
        const z = fm.zip(['a.txt'], 'out.zip');
        expect(z.path).toBe('out.zip');
        expect(existsSync(join(dir, 'out.zip'))).toBe(true);
      } catch {
        /* zip binary optional */
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copy, move, trash restore, sort and search', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm2-'));
    const fm = new FileManager(dir);
    fm.writeText('a.txt', 'A');
    fm.writeText('b.txt', 'BB');
    fm.mkdir('sub');
    fm.copy('a.txt', 'sub/a-copy.txt');
    expect(fm.readText('sub/a-copy.txt').content).toBe('A');
    fm.move('b.txt', 'sub/b-moved.txt');
    expect(fm.list('.').some((e) => e.name === 'b.txt')).toBe(false);
    expect(fm.readText('sub/b-moved.txt').content).toBe('BB');

    const sorted = fm.list('sub', { sort: 'size', order: 'desc' });
    expect(sorted[0].name).toBe('b-moved.txt');

    const filtered = fm.list('sub', { q: 'copy' });
    expect(filtered).toHaveLength(1);

    const del = fm.remove('sub/a-copy.txt');
    expect(del.deleted).toBe(true);
    expect(del.trashId).toBeTruthy();
    const trash = fm.listTrash();
    expect(trash.length).toBeGreaterThan(0);
    fm.restoreTrash(del.trashId!);
    expect(existsSync(join(dir, 'sub/a-copy.txt'))).toBe(true);

    const usage = fm.usage();
    expect(usage.fileCount).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('write/copy/rename ifExists fail, rename, overwrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-if-'));
    try {
      const fm = new FileManager(dir);
      fm.writeText('a.txt', 'one');
      expect(() => fm.writeText('a.txt', 'two', { ifExists: 'fail' })).toThrow(YskError);
      const renamed = fm.writeText('a.txt', 'two', { ifExists: 'rename' });
      expect(renamed.path).toBe('a (1).txt');
      expect(fm.readText('a.txt').content).toBe('one');
      expect(fm.readText('a (1).txt').content).toBe('two');

      fm.writeText('a.txt', 'replaced', { ifExists: 'overwrite' });
      expect(fm.readText('a.txt').content).toBe('replaced');

      fm.mkdir('docs');
      expect(fm.mkdir('docs').path).toBe('docs');
      expect(() => fm.mkdir('docs', { ifExists: 'fail' })).toThrow(YskError);
      expect(fm.mkdir('docs', { ifExists: 'rename' }).path).toBe('docs (1)');
      fm.writeText('as-file', 'x');
      expect(fm.mkdir('as-file', { ifExists: 'overwrite' }).path).toBe('as-file');
      expect(fm.stat('as-file').type).toBe('dir');

      fm.writeText('b.txt', 'B');
      expect(() => fm.copy('b.txt', 'a.txt')).toThrow(YskError);
      const kept = fm.copy('b.txt', 'a.txt', { ifExists: 'rename' });
      expect(kept.to).toBe('a (2).txt');
      fm.copy('b.txt', 'a.txt', { ifExists: 'overwrite' });
      expect(fm.readText('a.txt').content).toBe('B');

      fm.writeText('c.txt', 'C');
      expect(() => fm.rename('c.txt', 'a.txt')).toThrow(YskError);
      const moved = fm.rename('c.txt', 'a.txt', { ifExists: 'rename' });
      expect(moved.to).toBe('a (3).txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
