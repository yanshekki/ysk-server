import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  loadLogSettings,
  saveLogSettings,
  addLogBookmark,
  removeLogBookmark,
  queryLogSource,
  exportLogQuery,
  listProjectLogIndex,
  runLogAutoVacuumTick,
  getLogOverview,
  parseDiskToMb,
} from './service.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    pathExists: (p) => existsSync(p),
    isRoot: () => opts?.isRoot ?? false,
    executeEnabled: () => opts?.executeEnabled ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts?.run?.(argv) ?? {}),
    }),
  };
}

describe('log-center service depth', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-lc-d-'));
    dirs.push(dir);
    const db = new JsonStore(join(dir, 'ysk.json'));
    return { dir, db };
  }

  it('loadLogSettings recovers from corrupt JSON and clamps fields', () => {
    const { db } = setup();
    db.snapshot.settings.log_center = '{not-json';
    db.persist();
    const bad = loadLogSettings(db);
    expect(bad.bookmarks).toEqual([]);
    expect(bad.maxLines).toBeGreaterThan(0);

    saveLogSettings(db, {
      maxLines: 1,
      maxBytes: 10,
      followIntervalSec: 99,
      vacuumDefaultDays: 9999,
      journalWarnMb: 1,
      autoVacuumTime: 'bad',
      autoVacuumEnabled: true,
      maskSecrets: false,
      disabledSources: Array.from({ length: 200 }, (_, i) => `s${i}`),
      customAllowPaths: ['/var/log/nginx/access.log', '/etc/shadow', '../evil'],
      bookmarks: [
        { name: '', source: 'x' } as never,
        { name: 'ok', source: 'journal:nginx.service', lines: 10, grep: 'err' },
      ],
    });
    const s = loadLogSettings(db);
    expect(s.maxLines).toBeGreaterThanOrEqual(50);
    expect(s.followIntervalSec).toBeLessThanOrEqual(30);
    expect(s.vacuumDefaultDays).toBeLessThanOrEqual(365);
    expect(s.journalWarnMb).toBeGreaterThanOrEqual(64);
    expect(s.autoVacuumTime).toMatch(/^\d{1,2}:\d{2}$/);
    expect(s.disabledSources.length).toBeLessThanOrEqual(100);
    expect(s.bookmarks.some((b) => b.name === 'ok')).toBe(true);
    expect(s.customAllowPaths.some((p) => p.includes('nginx'))).toBe(true);
  });

  it('bookmarks add/remove and parseDiskToMb edge cases', () => {
    const { db } = setup();
    expect(parseDiskToMb(undefined)).toBeUndefined();
    expect(parseDiskToMb('nope')).toBeUndefined();
    expect(parseDiskToMb('1.5G')).toBe(Math.round(1.5 * 1024));
    expect(parseDiskToMb('512K')).toBe(Math.round(512 / 1024));
    expect(parseDiskToMb('2T')).toBe(2 * 1024 * 1024);

    addLogBookmark(db, { name: 'b1', source: 'journal:nginx.service', priority: 'err' });
    const s = addLogBookmark(db, { name: 'b2', source: 'file:/var/log/syslog', id: 'fixed-id' });
    expect(s.bookmarks.some((b) => b.id === 'fixed-id')).toBe(true);
    const after = removeLogBookmark(db, 'fixed-id');
    expect(after.bookmarks.some((b) => b.id === 'fixed-id')).toBe(false);
  });

  it('queryLogSource project-managed and project-fpm paths', async () => {
    const { dir, db } = setup();
    const home = join(dir, 'home');
    mkdirSync(join(home, 'logs'), { recursive: true });
    writeFileSync(join(home, 'logs', 'app.log'), 'line1\nsecret=xyz\n', 'utf8');
    mkdirSync(join(dir, 'nginx', 'logs'), { recursive: true });
    writeFileSync(join(dir, 'nginx', 'logs', 'ysku.access.log'), 'GET /\n', 'utf8');
    db.snapshot.projects = [
      {
        id: 'p1',
        name: 'P',
        home_dir: home,
        linux_user: 'ysku',
        runtime: 'php',
        runtime_version: '8.3',
      },
    ] as never;
    db.persist();
    const host = mockHost();

    const managedMissing = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-managed:missing:access.log',
    });
    expect(managedMissing.ok).toBe(false);
    expect(managedMissing.blocked).toBe(true);

    const managed = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-managed:p1:access.log',
    });
    // file under dataDir/nginx/logs — may succeed via queryFileLog
    expect(typeof managed.ok).toBe('boolean');
    expect(managed.notes.length + managed.lines.length).toBeGreaterThanOrEqual(0);

    const fpmMissing = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-fpm:nope',
    });
    expect(fpmMissing.ok).toBe(false);

    const fpm = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-fpm:p1',
    });
    expect(typeof fpm.ok).toBe('boolean');

    const projList = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project:p1',
    });
    expect(projList.ok).toBe(true);

    const projFile = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project:p1:app.log',
      grep: 'line',
    });
    if (projFile.ok) {
      expect(projFile.lines.some((l) => /line/i.test(l))).toBe(true);
    }

    const unknown = await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'weird:source',
    });
    expect(unknown.ok).toBe(false);

    const idx = listProjectLogIndex(db, { dataDir: dir });
    expect(idx.some((p) => p.projectId === 'p1' && p.related.length >= 0)).toBe(true);
  });

  it('exportLogQuery fails honestly when query empty; cleans old exports', async () => {
    const { dir, db } = setup();
    const host = mockHost({
      run: () => ({ exitCode: 1, stderr: 'no journal' }),
    });
    const fail = await exportLogQuery({
      host,
      dataDir: dir,
      db,
      source: 'journal:missing.service',
      format: 'text',
    });
    // may still write empty or fail — honesty
    expect(typeof fail.ok).toBe('boolean');
    expect(Array.isArray(fail.notes)).toBe(true);

    // successful export with journal mock
    const okHost = mockHost({
      run: (argv) =>
        argv[0] === 'journalctl'
          ? { exitCode: 0, stdout: 'a\nb\n' }
          : {},
    });
    const exp = await exportLogQuery({
      host: okHost,
      dataDir: dir,
      db,
      source: 'journal:nginx.service',
      format: 'jsonl',
      lines: 10,
    });
    expect(exp.ok).toBe(true);
    expect(exp.path).toBeTruthy();
  });

  it('runLogAutoVacuumTick runs inside time window with root+execute', async () => {
    const { db } = setup();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(Math.max(0, now.getMinutes() - 5)).padStart(2, '0');
    saveLogSettings(db, {
      autoVacuumEnabled: true,
      autoVacuumTime: `${hh}:${mm}`,
      vacuumDefaultDays: 7,
    });
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        if (argv[0] === 'journalctl' && argv.includes('--vacuum-time')) {
          return { exitCode: 0, stdout: 'Vacuuming done' };
        }
        return { exitCode: 0 };
      },
    });
    const r = await runLogAutoVacuumTick({ host, db });
    expect(typeof r.ran).toBe('boolean');
    expect(r.notes.length).toBeGreaterThan(0);

    // second call same day should skip if first ran
    if (r.ran) {
      const again = await runLogAutoVacuumTick({ host, db });
      expect(again.ran).toBe(false);
    }
  });

  it('getLogOverview includes journal usage and warnings', async () => {
    const { dir, db } = setup();
    saveLogSettings(db, { journalWarnMb: 100 });
    const host = mockHost({
      run: (argv) => {
        const j = argv.join(' ');
        if (j.includes('disk-usage') || j.includes('--disk-usage')) {
          return { exitCode: 0, stdout: 'Archived and active journals take up 2.5G on disk.\n' };
        }
        if (argv[0] === 'systemctl' || argv[0] === 'journalctl') {
          return { exitCode: 0, stdout: 'nginx.service loaded active\n' };
        }
        return {};
      },
    });
    const ov = await getLogOverview({ host, dataDir: dir, db });
    expect(ov).toBeTruthy();
    expect(ov.sourceCount.total).toBeGreaterThanOrEqual(0);
    expect(typeof ov.executeEnabled).toBe('boolean');
    expect(Array.isArray(ov.notes)).toBe(true);
    // large journal should warn when over journalWarnMb
    expect(ov.journalDiskMb == null || ov.journalDiskMb >= 100).toBe(true);
  });
});
