import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileManager, publicFilesRoot } from './manager.js';
import { YskError } from '@ysk/shared';

describe('FileManager sandbox', () => {
  it('lists, writes, reads, and blocks path escape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fm-'));
    const fm = new FileManager(dir);
    fm.mkdir('docs');
    fm.writeText('docs/hello.txt', 'hello ysk');
    const list = fm.list('docs');
    expect(list.some((e) => e.name === 'hello.txt')).toBe(true);
    expect(fm.readText('docs/hello.txt').content).toBe('hello ysk');
    expect(() => fm.readText('../etc/passwd')).toThrow(/sandbox|escape/i);
    fm.remove('docs/hello.txt');
    expect(fm.list('docs')).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
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
    expect(() => fm.remove('.')).toThrow(YskError);
    expect(fm.remove('missing-nope').deleted).toBe(false);
    const pub = publicFilesRoot(dir);
    expect(pub).toContain('files/public');
    rmSync(dir, { recursive: true, force: true });
  });
});
