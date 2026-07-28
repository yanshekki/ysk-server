import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertLogPathAllowed,
  sanitizeUnit,
  clampLines,
  sanitizeGrep,
  sanitizeSince,
  queryFileLog,
  maskSecrets,
  tailFileLines,
  parseDiskToMb,
  extractIpFromLogLine,
  loadLogSettings,
  saveLogSettings,
  addLogBookmark,
  removeLogBookmark,
} from './index.js';
import { JsonStore } from '../../db/store.js';

describe('log-center security', () => {
  it('rejects path traversal and sensitive paths', () => {
    expect(assertLogPathAllowed('/etc/shadow').ok).toBe(false);
    expect(assertLogPathAllowed('/home/x/.ssh/id_rsa').ok).toBe(false);
    expect(sanitizeUnit('../evil')).toBeNull();
    expect(sanitizeUnit('nginx.service')).toBe('nginx.service');
    expect(sanitizeGrep('a'.repeat(500))?.length).toBe(200);
    expect(sanitizeSince('1h')).toBe('1 hour ago');
    expect(sanitizeSince('rm -rf')).toBeUndefined();
    expect(clampLines(10)).toBe(50);
    expect(clampLines(99999)).toBe(5000);
  });

  it('tails files and masks secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logc-'));
    try {
      const logDir = join(dir, 'nginx', 'logs');
      mkdirSync(logDir, { recursive: true });
      const p = join(logDir, 'access.log');
      writeFileSync(p, 'line1\npassword=supersecret\nline3\n', 'utf8');
      const { lines } = tailFileLines(p, 10, 1024);
      expect(lines.some((l) => l.includes('line3'))).toBe(true);
      expect(maskSecrets('password=supersecret')).toContain('***');
      const q = queryFileLog({ path: p, dataDir: dir, lines: 10, maskSecrets: true });
      expect(q.ok).toBe(true);
      expect(q.lines.join('\n')).not.toContain('supersecret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses disk usage and extracts IPs', () => {
    expect(parseDiskToMb('Archived and active journals take up 1.5G in the file system.')).toBe(
      Math.round(1.5 * 1024),
    );
    expect(parseDiskToMb('500M')).toBe(500);
    expect(parseDiskToMb('bogus')).toBeUndefined();
    expect(extractIpFromLogLine('Failed password for root from 203.0.113.10 port 22')).toBe(
      '203.0.113.10',
    );
    expect(extractIpFromLogLine('local 127.0.0.1 only')).toBeNull();
  });

  it('loads/saves settings and bookmarks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logc-set-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const s = saveLogSettings(db, {
        followIntervalSec: 5,
        autoVacuumEnabled: true,
        autoVacuumTime: '04:30',
        journalWarnMb: 2048,
        customAllowPaths: ['/var/log/nginx/access.log'],
      });
      expect(s.followIntervalSec).toBe(5);
      expect(s.autoVacuumEnabled).toBe(true);
      expect(s.autoVacuumTime).toBe('04:30');
      expect(s.journalWarnMb).toBe(2048);
      const withBm = addLogBookmark(db, {
        name: 'nginx errors',
        source: 'journal:nginx.service',
        priority: 'err',
        since: '1h',
      });
      expect(withBm.bookmarks.length).toBe(1);
      expect(withBm.bookmarks[0].name).toBe('nginx errors');
      const afterRm = removeLogBookmark(db, withBm.bookmarks[0].id);
      expect(afterRm.bookmarks.length).toBe(0);
      const re = loadLogSettings(db);
      expect(re.followIntervalSec).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
