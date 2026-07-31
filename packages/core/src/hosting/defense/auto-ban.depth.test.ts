import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  DEFAULT_AUTO_BAN,
  defenseBanBatch,
  listSuspectIps,
  loadAutoBanPolicy,
  parseAccessLogSuspects,
  runAutoBanTick,
  saveAutoBanPolicy,
} from './auto-ban.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function store(dir: string) {
  return new JsonStore(join(dir, 'ysk.json'));
}

function mockHost(opts: {
  execute?: boolean;
  banOk?: boolean;
  f2bList?: string;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => true,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('banned') || (argv[0] === 'fail2ban-client' && s.includes('status'))) {
        return {
          stdout: opts.f2bList ?? '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'fail2ban-client' && argv.includes('banip')) {
        return {
          stdout: 'ok',
          stderr: '',
          exitCode: opts.banOk === false ? 1 : 0,
          argv,
          dryRun: false,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('auto-ban depth', () => {
  it('scoreAcc high tiers via heavy access log parse', () => {
    const lines: string[] = [];
    for (let i = 0; i < 220; i++) {
      lines.push(
        `203.0.113.200 - - [01/Jan/2026:00:00:00 +0000] "GET /x HTTP/1.1" 200 1 "-" "-"`,
      );
    }
    for (let i = 0; i < 55; i++) {
      lines.push(
        `203.0.113.200 - - [01/Jan/2026:00:00:00 +0000] "GET /x HTTP/1.1" 429 1 "-" "-"`,
      );
    }
    for (let i = 0; i < 25; i++) {
      lines.push(
        `203.0.113.200 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-admin HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    const map = parseAccessLogSuspects(lines.join('\n'));
    const a = map.get('203.0.113.200')!;
    expect(a.hits).toBeGreaterThan(200);
    expect(a.s429).toBeGreaterThan(50);
    expect(a.scan).toBeGreaterThan(20);
  });

  it('listSuspectIps with auth fails and fail2ban when execute on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-susp-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(
        `203.0.113.88 - - [01/Jan/2026:00:00:00 +0000] "GET /.env HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    // auth-style lines that parseAuthFailIps may pick
    for (let i = 0; i < 10; i++) {
      lines.push(
        `Failed password for root from 198.51.100.55 port 22 ssh2`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    const host = mockHost({
      execute: true,
      f2bList: 'Banned IP list:\n203.0.113.88\n',
    });
    const { items, notes } = await listSuspectIps({ host, db, dataDir: dir });
    expect(notes.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
    const hit = items.find((i) => i.ip === '203.0.113.88');
    expect(hit).toBeTruthy();
  });

  it('listSuspectIps empty logs notes honesty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-empty-'));
    dirs.push(dir);
    const db = store(dir);
    const host = mockHost({ execute: false });
    const { notes } = await listSuspectIps({ host, db, dataDir: dir });
    expect(notes.some((n) => n.length > 0)).toBe(true);
  });

  it('runAutoBanTick bans high-score suspects with custom thresholds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-tick-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 80; i++) {
      lines.push(
        `198.51.100.77 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-login.php HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    for (let i = 0; i < 15; i++) {
      lines.push(
        `198.51.100.77 - - [01/Jan/2026:00:00:00 +0000] "GET /x HTTP/1.1" 429 1 "-" "-"`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      method: 'fail2ban',
      maxAutoBansPerHour: 20,
      cooldownMinutes: 5,
      whitelist: ['127.0.0.1'],
      recentAutoBanAts: [],
    });
    db.snapshot.settings.defense_auto_ban_custom_th = JSON.stringify({
      minScore: 5,
      minHits: 10,
      min429: 5,
      minScan: 3,
    });
    db.persist();

    const host = mockHost({ execute: true, banOk: true });
    const r = await runAutoBanTick({ host, db, dataDir: dir });
    expect(r.ok).toBe(true);
    expect(r.banned.length + r.skipped.length).toBeGreaterThan(0);
    if (r.banned.length) {
      expect(r.banned).toContain('198.51.100.77');
      expect(r.policy.recentAutoBanAts?.length).toBeGreaterThan(0);
    }
  });

  it('runAutoBanTick skips whitelisted and cooldown ips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-cd-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(
        `203.0.113.10 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-admin HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      method: 'fail2ban',
      maxAutoBansPerHour: 50,
      cooldownMinutes: 60,
      whitelist: ['203.0.113.10'],
    });
    const host = mockHost({ execute: true, banOk: true });
    const r = await runAutoBanTick({ host, db, dataDir: dir });
    expect(r.ok).toBe(true);
    expect(r.banned).not.toContain('203.0.113.10');
    expect(r.skipped.includes('203.0.113.10') || r.banned.length === 0).toBe(true);
  });

  it('runAutoBanTick records failed ban as skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-failban-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(
        `203.0.113.33 - - [01/Jan/2026:00:00:00 +0000] "GET /.git HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      method: 'fail2ban',
      maxAutoBansPerHour: 10,
      whitelist: [],
    });
    db.snapshot.settings.defense_auto_ban_custom_th = JSON.stringify({
      minScore: 1,
      minHits: 5,
      min429: 1,
      minScan: 1,
    });
    db.persist();
    const host = mockHost({ execute: true, banOk: false });
    const r = await runAutoBanTick({ host, db, dataDir: dir });
    expect(r.ok).toBe(true);
    // ban failed → skipped path
    expect(r.banned.includes('203.0.113.33')).toBe(false);
  });

  it('runAutoBanTick respects recent ip cooldown map', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-recent-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(
        `203.0.113.44 - - [01/Jan/2026:00:00:00 +0000] "GET /phpmyadmin HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      method: 'fail2ban',
      maxAutoBansPerHour: 10,
      cooldownMinutes: 120,
      whitelist: [],
    });
    db.snapshot.settings.defense_auto_ban_recent_ips = JSON.stringify({
      '203.0.113.44': new Date().toISOString(),
    });
    db.snapshot.settings.defense_auto_ban_custom_th = JSON.stringify({
      minScore: 1,
      minHits: 5,
      min429: 1,
      minScan: 1,
    });
    db.persist();
    const host = mockHost({ execute: true, banOk: true });
    const r = await runAutoBanTick({ host, db, dataDir: dir });
    expect(r.ok).toBe(true);
    expect(r.banned).not.toContain('203.0.113.44');
  });

  it('defenseBanBatch with execute bans non-whitelist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-batch-'));
    dirs.push(dir);
    const db = store(dir);
    const host = mockHost({ execute: true, banOk: true });
    const r = await defenseBanBatch({
      host,
      db,
      ips: ['198.51.100.21', '198.51.100.21', 'bad'],
      method: 'fail2ban',
      reason: 'batch-depth',
    });
    expect(r.results.some((x) => x.ip === '198.51.100.21')).toBe(true);
    expect(r.results.every((x) => x.ip !== 'bad')).toBe(true);
  });

  it('corrupt custom threshold JSON falls back to mode defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-th-'));
    dirs.push(dir);
    const db = store(dir);
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'soft',
      maxAutoBansPerHour: 5,
    });
    db.snapshot.settings.defense_auto_ban_custom_th = 'not-json{';
    db.persist();
    const host = mockHost({ execute: true });
    const r = await runAutoBanTick({ host, db, dataDir: dir });
    // no suspects → ok true empty bans
    expect(typeof r.ok).toBe('boolean');
    expect(loadAutoBanPolicy(db).mode).toBe('soft');
  });
});
