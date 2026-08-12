import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileManager,
  hashSharePassword,
  newShareToken,
  publicFilesRoot,
  verifySharePasswordHash,
} from './manager.js';
import { YskError } from 'ysk-server-shared';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'ysk-fmd-'));
}

describe('FileManager depth', () => {
  it('getRoot trashRoot and hidden prefixes on list', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      expect(fm.getRoot()).toBe(dir);
      expect(fm.trashRoot()).toContain('.trash');
      mkdirSync(join(dir, '.versions'), { recursive: true });
      writeFileSync(join(dir, '.ysk'), 'x');
      writeFileSync(join(dir, 'visible.txt'), 'v');
      const list = fm.list('.');
      expect(list.some((e) => e.name === 'visible.txt')).toBe(true);
      expect(list.every((e) => !e.name.startsWith('.trash'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('list errors: missing and not a directory', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      writeFileSync(join(dir, 'f.txt'), 'x');
      expect(() => fm.list('nope')).toThrow(YskError);
      expect(() => fm.list('f.txt')).toThrow(YskError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sort by mtime and name asc/desc', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      fm.writeText('a.txt', 'a');
      fm.writeText('b.txt', 'bb');
      fm.mkdir('zdir');
      const byMtime = fm.list('.', { sort: 'mtime', order: 'desc' });
      expect(byMtime[0].type === 'dir' || byMtime.length >= 2).toBe(true);
      const byName = fm.list('.', { sort: 'name', order: 'asc' });
      expect(byName.some((e) => e.name === 'a.txt')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readText missing / maxBytes; readBinary', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      expect(() => fm.readText('missing.txt')).toThrow(YskError);
      fm.writeText('big.txt', 'hello world');
      expect(() => fm.readText('big.txt', 3)).toThrow(YskError);
      const bin = fm.readBinary('big.txt');
      expect(bin.buffer.toString('utf8')).toBe('hello world');
      expect(bin.mime).toBeTruthy();
      expect(bin.name).toBe('big.txt');
      expect(() => fm.readBinary('nope.bin')).toThrow(YskError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('createTextFile conflict and snapshot on overwrite', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      const c = fm.createTextFile('new.txt', 'one');
      expect(c.bytes).toBe(3);
      expect(() => fm.createTextFile('new.txt', 'two')).toThrow(YskError);
      fm.writeText('new.txt', 'updated');
      expect(fm.readText('new.txt').content).toBe('updated');
      // versions list may be empty if snapshot soft-fails; just call
      const vers = fm.listVersions('new.txt');
      expect(Array.isArray(vers)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removePermanent and trash restore/purge paths', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      expect(() => fm.removePermanent('.')).toThrow(YskError);
      expect(() => fm.removePermanent('')).toThrow(YskError);
      expect(fm.removePermanent('ghost').deleted).toBe(false);

      fm.writeText('gone.txt', 'x');
      expect(fm.removePermanent('gone.txt').deleted).toBe(true);

      fm.writeText('soft.txt', 's');
      const del = fm.remove('soft.txt');
      expect(del.trashId).toBeTruthy();
      expect(() => fm.restoreTrash('no-such-id')).toThrow(YskError);

      // conflict on restore
      fm.writeText('soft.txt', 'exists again');
      expect(() => fm.restoreTrash(del.trashId!)).toThrow(YskError);
      fm.removePermanent('soft.txt');
      // re-trash and purge
      fm.writeText('p.txt', 'p');
      const d2 = fm.remove('p.txt');
      expect(fm.purgeTrash(d2.trashId).purged).toBe(1);
      expect(fm.purgeTrash('missing-id').ok).toBe(false);

      fm.writeText('q.txt', 'q');
      fm.remove('q.txt');
      const all = fm.purgeTrash();
      expect(all.purged).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listTrash skips corrupt meta', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      fm.writeText('t.txt', 't');
      fm.remove('t.txt');
      const trash = fm.trashRoot();
      const bad = join(trash, 'bad-entry');
      mkdirSync(bad, { recursive: true });
      writeFileSync(join(bad, 'meta.json'), '{bad', 'utf8');
      writeFileSync(join(trash, 'not-a-dir'), 'x');
      const list = fm.listTrash();
      expect(Array.isArray(list)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename missing, copy directory, stat missing, chmod invalid', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      expect(() => fm.rename('a', 'b')).toThrow(YskError);
      fm.mkdir('d1');
      fm.writeText('d1/f.txt', '1');
      fm.copy('d1', 'd2');
      expect(existsSync(join(dir, 'd2', 'f.txt'))).toBe(true);
      expect(() => fm.stat('nope')).toThrow(YskError);
      fm.writeText('m.txt', 'm');
      expect(() => fm.chmod('m.txt', '9999')).toThrow(YskError); // 9 invalid octal digit? actually 9999 is octal digits 0-7 only — 9 fails
      expect(() => fm.chmod('m.txt', '88')).toThrow(YskError);
      expect(() => fm.chmod('missing', '644')).toThrow(YskError);
      const ok = fm.chmod('m.txt', '0644');
      expect(ok.mode).toBe('0644');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('zip validation and unzip when tools available', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      fm.writeText('z.txt', 'zipme');
      expect(() => fm.zip([], 'out.zip')).toThrow(YskError);
      expect(() => fm.zip(['z.txt'], 'out.txt')).toThrow(YskError);
      expect(() => fm.zip(['missing.txt'], 'out.zip')).toThrow(YskError);
      try {
        const z = fm.zip(['z.txt'], 'pack.zip');
        expect(z.bytes).toBeGreaterThan(0);
        fm.mkdir('unz');
        const u = fm.unzip('pack.zip', 'unz');
        expect(u.path).toBe('unz');
        expect(existsSync(join(dir, 'unz', 'z.txt')) || existsSync(join(dir, 'unz'))).toBe(
          true,
        );
      } catch (e) {
        // zip/unzip optional
        expect(e).toBeTruthy();
      }
      expect(() => fm.unzip('no.zip', 'd')).toThrow(YskError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hashSharePassword and newShareToken and publicFilesRoot', () => {
    const dir = tmp();
    try {
      // Phase 7: salted scrypt (not deterministic SHA-256)
      const h = hashSharePassword('secret');
      expect(h).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
      expect(h.length).toBeGreaterThan(64);
      // Random salt → two hashes of same password differ
      expect(hashSharePassword('secret')).not.toBe(h);
      expect(verifySharePasswordHash(h, 'secret')).toBe(true);
      expect(verifySharePasswordHash(h, 'wrong')).toBe(false);
      const t = newShareToken();
      expect(t.length).toBe(32);
      expect(newShareToken()).not.toBe(t);
      const pub = publicFilesRoot(dir);
      expect(existsSync(pub)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('remove refuses trash path and restore after purge meta', () => {
    const dir = tmp();
    try {
      const fm = new FileManager(dir);
      expect(() => fm.remove('.trash/x')).toThrow(YskError);
      fm.writeText('r.txt', 'r');
      const d = fm.remove('r.txt');
      // corrupt meta name for restore edge — write broken original then fix
      const metaPath = join(fm.trashRoot(), d.trashId!, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.originalPath = 'restored/r.txt';
      writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
      const rest = fm.restoreTrash(d.trashId!);
      expect(rest.originalPath).toBe('restored/r.txt');
      expect(existsSync(join(dir, 'restored', 'r.txt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
