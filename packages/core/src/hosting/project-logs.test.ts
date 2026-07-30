import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
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
} from './project-logs.js';

describe('project logs', () => {
  it('lists and tails log files safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logs-'));
    try {
      mkdirSync(join(dir, 'logs'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'app.out.log'), 'a\nb\nc\nd\n', 'utf8');
      const files = listProjectLogs(dir);
      expect(files.some((f) => f.name === 'app.out.log')).toBe(true);
      const tail = tailProjectLog(dir, 'app.out.log', 50);
      expect(tail.ok).toBe(true);
      expect(tail.lines.join('\n')).toContain('d');
      expect(tail.lines.length).toBeGreaterThanOrEqual(4);
      expect(() => tailProjectLog(dir, '../etc/passwd')).toThrow();
      expect(resolveProjectLogPath(dir, '../etc/passwd').ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists nested logs and rejects symlink escape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logs-deep-'));
    try {
      mkdirSync(join(dir, 'logs', 'app'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'app', 'debug.log'), 'x\ny\nz\n', 'utf8');
      writeFileSync(join(dir, 'logs', 'app.err.log'), 'e1\ne2\n', 'utf8');
      mkdirSync(join(dir, 'log'), { recursive: true });
      writeFileSync(join(dir, 'log', 'access.log'), 'hit\n', 'utf8');

      const files = listProjectLogs(dir);
      expect(files.some((f) => f.name === 'app/debug.log')).toBe(true);
      expect(files.some((f) => f.name === 'app.err.log')).toBe(true);
      expect(files.some((f) => f.name === 'access.log')).toBe(true);

      const nested = tailProjectLog(dir, 'app/debug.log', 10);
      expect(nested.ok).toBe(true);
      expect(nested.lines.join('\n')).toContain('z');

      // symlink escape
      try {
        symlinkSync('/etc/passwd', join(dir, 'logs', 'evil.log'));
      } catch {
        /* platform may block */
      }
      const evil = resolveProjectLogPath(dir, 'evil.log');
      if (existsSync(join(dir, 'logs', 'evil.log'))) {
        if (evil.ok) {
          expect(evil.path.includes('passwd')).toBe(false);
        } else {
          expect(evil.ok).toBe(false);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists extra dirs and searches content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logs-extra-'));
    try {
      mkdirSync(join(dir, 'logs'), { recursive: true });
      mkdirSync(join(dir, 'storage', 'logs'), { recursive: true });
      writeFileSync(join(dir, 'logs', 'app.out.log'), 'ok\n', 'utf8');
      writeFileSync(
        join(dir, 'storage', 'logs', 'laravel.log'),
        'INFO hello\nERROR boom\nWARN x\n',
        'utf8',
      );
      const files = listProjectLogs(dir, { extraDirs: ['storage/logs'] });
      expect(files.some((f) => f.name === '~storage/logs/laravel.log')).toBe(
        true,
      );
      const nameF = listProjectLogs(dir, {
        extraDirs: ['storage/logs'],
        nameFilter: 'laravel',
      });
      expect(nameF).toHaveLength(1);
      const hit = searchProjectLogs(dir, {
        extraDirs: ['storage/logs'],
        grep: 'ERROR',
      });
      expect(hit.hits.some((h) => h.file.includes('laravel'))).toBe(true);
      const tail = tailProjectLog(dir, '~storage/logs/laravel.log', 50, undefined, {
        extraDirs: ['storage/logs'],
        grep: 'ERROR',
      });
      expect(tail.lines.some((l) => l.includes('ERROR'))).toBe(true);
      const bad = normalizeExtraLogDirs(['../etc', 'storage/logs', 'logs']);
      expect(bad.dirs).toEqual(['storage/logs']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists related journal + managed nginx sources', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-logs-rel-'));
    try {
      mkdirSync(join(dataDir, 'nginx', 'logs'), { recursive: true });
      writeFileSync(join(dataDir, 'nginx', 'logs', 'ysks_demo.access.log'), '1\n', 'utf8');
      const rel = listProjectRelatedLogSources({
        projectId: 'p1',
        linuxUser: 'ysks_demo',
        runtime: 'node',
        dataDir,
      });
      expect(rel.some((r) => r.source === 'journal:ysk-project-ysks_demo.service')).toBe(true);
      expect(rel.some((r) => r.kind === 'managed-nginx' && r.available)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
