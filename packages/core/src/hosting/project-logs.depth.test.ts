import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listProjectLogs,
  tailProjectLog,
  resolveProjectLogPath,
  listProjectRelatedLogSources,
  searchProjectLogs,
  normalizeExtraLogDirs,
  parseProjectLogSourceRest,
} from './project-logs.js';

describe('project-logs depth', () => {
  it('normalizeExtraLogDirs handles string, caps, and rejects bad entries', () => {
    const r = normalizeExtraLogDirs('storage/logs, var/log\n../etc, /abs, logs, log/app, bad name');
    expect(r.dirs).toContain('storage/logs');
    expect(r.dirs).toContain('var/log');
    expect(r.dirs).not.toContain('logs');
    expect(r.notes.length).toBeGreaterThan(0);

    const many = normalizeExtraLogDirs(
      Array.from({ length: 20 }, (_, i) => `d${i}/logs`),
    );
    expect(many.dirs.length).toBeLessThanOrEqual(12);

    expect(normalizeExtraLogDirs(null).dirs).toEqual([]);
    expect(normalizeExtraLogDirs(undefined).dirs).toEqual([]);
  });

  it('parseProjectLogSourceRest splits id and file', () => {
    expect(parseProjectLogSourceRest('abc')).toEqual({ projectId: 'abc', fileName: undefined });
    expect(parseProjectLogSourceRest('abc:app.log')).toEqual({
      projectId: 'abc',
      fileName: 'app.log',
    });
    expect(parseProjectLogSourceRest('abc:app/debug.log')).toEqual({
      projectId: 'abc',
      fileName: 'app/debug.log',
    });
    expect(parseProjectLogSourceRest('abc:')).toEqual({ projectId: 'abc', fileName: undefined });
  });

  it('lists compressed non-previewable and classifies kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pl-d-'));
    try {
      mkdirSync(join(dir, 'logs', 'nested'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'app.out.log'), 'a\n'.repeat(100), 'utf8');
      writeFileSync(join(dir, 'logs', 'app.out.log.gz'), 'binary', 'utf8');
      writeFileSync(join(dir, 'logs', 'app.out.log.1'), 'rotated\n', 'utf8');
      writeFileSync(join(dir, 'logs', 'nested', 'debug.log'), 'd\n', 'utf8');
      writeFileSync(join(dir, 'logs', 'other.txt'), 'x\n', 'utf8');

      const files = listProjectLogs(dir);
      expect(files.some((f) => f.name === 'app.out.log')).toBe(true);
      const gz = files.find((f) => f.name.endsWith('.gz'));
      if (gz) expect(gz.previewable).toBe(false);

      expect(() => tailProjectLog(dir, 'app.out.log.gz')).not.toThrow();
      const gzTail = tailProjectLog(dir, 'app.out.log.gz');
      expect(gzTail.ok).toBe(false);

      const grepped = tailProjectLog(dir, 'app.out.log', 50, 4096, { grep: 'a' });
      expect(grepped.ok).toBe(true);
      expect(grepped.matchedLines).toBeGreaterThan(0);

      const search = searchProjectLogs(dir, {
        grep: 'rotated',
        maxFiles: 5,
        maxLinesPerFile: 20,
      });
      expect(search.ok).toBe(true);
      expect(search.hits.length + search.files.length).toBeGreaterThan(0);

      const noGrep = searchProjectLogs(dir, {});
      expect(noGrep.hits).toEqual([]);
      expect(noGrep.files.length).toBeGreaterThan(0);

      const nameF = listProjectLogs(dir, { nameFilter: 'nested' });
      expect(nameF.every((f) => f.name.toLowerCase().includes('nested'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveProjectLogPath rejects escapes and missing; accepts extra dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pl-r-'));
    try {
      mkdirSync(join(dir, 'logs'), { recursive: true });
      mkdirSync(join(dir, 'storage', 'logs'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'a.log'), '1\n', 'utf8');
      writeFileSync(join(dir, 'storage', 'logs', 'b.log'), '2\n', 'utf8');

      expect(resolveProjectLogPath(dir, '../etc/passwd').ok).toBe(false);
      expect(resolveProjectLogPath(dir, 'missing.log').ok).toBe(false);
      expect(resolveProjectLogPath(dir, 'a.log').ok).toBe(true);
      expect(resolveProjectLogPath(dir, '~storage/logs/b.log', ['storage/logs']).ok).toBe(true);
      expect(resolveProjectLogPath('', 'a.log').ok).toBe(false);
      expect(listProjectLogs('')).toEqual([]);
      expect(listProjectLogs('/nonexistent-home-xyz')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listProjectRelatedLogSources for php and managed nginx', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-pl-rel-'));
    try {
      mkdirSync(join(dataDir, 'nginx', 'logs'), { recursive: true });
      writeFileSync(join(dataDir, 'nginx', 'logs', 'u1.access.log'), 'x\n', 'utf8');
      const rel = listProjectRelatedLogSources({
        projectId: 'p',
        linuxUser: 'u1',
        runtime: 'php',
        phpVersion: '8.2',
        dataDir,
      });
      expect(rel.some((r) => r.kind === 'journal')).toBe(true);
      expect(rel.some((r) => r.kind === 'managed-nginx')).toBe(true);
      expect(rel.some((r) => r.kind === 'php-fpm')).toBe(true);

      const badUser = listProjectRelatedLogSources({
        projectId: 'p',
        linuxUser: 'bad user!',
        runtime: 'node',
      });
      expect(badUser).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('walk handles unreadable dir and symlink within root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pl-w-'));
    try {
      mkdirSync(join(dir, 'logs', 'sub'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'ok.log'), '1\n', 'utf8');
      try {
        symlinkSync(join(dir, 'logs', 'ok.log'), join(dir, 'logs', 'link.log'));
      } catch {
        /* */
      }
      const files = listProjectLogs(dir);
      expect(files.some((f) => f.name === 'ok.log')).toBe(true);

      // unreadable nested dir (best-effort; may not work as root)
      try {
        chmodSync(join(dir, 'logs', 'sub'), 0o000);
        listProjectLogs(dir); // should not throw
        chmodSync(join(dir, 'logs', 'sub'), 0o755);
      } catch {
        try {
          chmodSync(join(dir, 'logs', 'sub'), 0o755);
        } catch {
          /* */
        }
      }
    } finally {
      try {
        chmodSync(join(dir, 'logs', 'sub'), 0o755);
      } catch {
        /* */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
