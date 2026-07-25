import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileManager } from './manager.js';

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
});
