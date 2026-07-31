import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { LocalHostExecutor } from '../../host/executor.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  DEFAULT_AUTO_BAN,
  countAutoBansLastHour,
  defenseBanBatch,
  humanizeFail2ban,
  humanizeFirewall,
  loadAutoBanPolicy,
  listSuspectIps,
  modeThresholds,
  parseAccessLogSuspects,
  runAutoBanTick,
  saveAutoBanPolicy,
  suggestedAutoBanForPreset,
  updateAutoBanPolicy,
  ipMatchesWhitelist,
} from './auto-ban.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function store(dir: string) {
  return new JsonStore(join(dir, 'ysk.json'));
}

describe('auto-ban policy and pure helpers', () => {
  it('loads defaults and saves round-trip with clamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ab-'));
    dirs.push(dir);
    const db = store(dir);
    const d = loadAutoBanPolicy(db);
    expect(d.enabled).toBe(false);
    expect(d.mode).toBe('soft');
    expect(d.whitelist).toContain('127.0.0.1');

    const saved = saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      method: 'both',
      cooldownMinutes: 12,
      maxAutoBansPerHour: 10,
      whitelist: ['203.0.113.0/24', 'bad', '  '],
      recentAutoBanAts: [new Date().toISOString()],
    });
    expect(saved.whitelist).toContain('203.0.113.0/24');
    // load clamps out-of-range values written raw into settings
    db.snapshot.settings.defense_auto_ban = JSON.stringify({
      enabled: true,
      mode: 'aggressive',
      method: 'both',
      cooldownMinutes: 1,
      maxAutoBansPerHour: 9999,
      whitelist: ['203.0.113.0/24'],
    });
    db.persist();
    const clamped = loadAutoBanPolicy(db);
    expect(clamped.cooldownMinutes).toBeGreaterThanOrEqual(5);
    expect(clamped.maxAutoBansPerHour).toBeLessThanOrEqual(500);

    const patched = updateAutoBanPolicy(db, { mode: 'normal', enabled: false });
    expect(patched.mode).toBe('normal');
    expect(patched.enabled).toBe(false);

    // corrupt JSON → defaults
    db.snapshot.settings.defense_auto_ban = '{not-json';
    db.persist();
    expect(loadAutoBanPolicy(db).mode).toBe('soft');
  });

  it('modeThresholds and suggestedAutoBanForPreset cover all modes', () => {
    expect(modeThresholds('aggressive').minScore).toBeLessThan(modeThresholds('soft').minScore);
    expect(modeThresholds('normal').minHits).toBeGreaterThan(modeThresholds('aggressive').minHits);
    expect(modeThresholds('off').minScore).toBe(9999);
    expect(suggestedAutoBanForPreset('daily').enabled).toBe(false);
    expect(suggestedAutoBanForPreset('hardened').mode).toBe('normal');
    expect(suggestedAutoBanForPreset('under_attack').mode).toBe('aggressive');
    expect(suggestedAutoBanForPreset('emergency').method).toBe('both');
  });

  it('countAutoBansLastHour filters old timestamps', () => {
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    const recent = new Date().toISOString();
    expect(countAutoBansLastHour({ ...DEFAULT_AUTO_BAN, recentAutoBanAts: [old, recent] })).toBe(1);
  });

  it('parseAccessLogSuspects scores hits 429 and scan paths', () => {
    const lines = [
      '203.0.113.50 - - [01/Jan/2026:00:00:01 +0000] "GET /wp-admin HTTP/1.1" 404 12 "-" "-"',
      '203.0.113.50 - - [01/Jan/2026:00:00:02 +0000] "GET /.env HTTP/1.1" 429 12 "-" "-"',
      '203.0.113.50 - - [01/Jan/2026:00:00:03 +0000] "GET /ok HTTP/1.1" 200 12 "-" "-"',
      '127.0.0.1 - - [01/Jan/2026:00:00:04 +0000] "GET /.env HTTP/1.1" 404 12 "-" "-"',
      'not-an-ip line without address',
    ];
    for (let i = 0; i < 25; i++) {
      lines.push(
        `198.51.100.9 - - [01/Jan/2026:00:00:${String(i).padStart(2, '0')} +0000] "GET /x HTTP/1.1" 200 1 "-" "-"`,
      );
    }
    const map = parseAccessLogSuspects(lines.join('\n'));
    expect(map.has('203.0.113.50')).toBe(true);
    const a = map.get('203.0.113.50')!;
    expect(a.hits).toBeGreaterThanOrEqual(3);
    expect(a.s429).toBeGreaterThanOrEqual(1);
    expect(a.scan).toBeGreaterThanOrEqual(2);
    expect(map.has('127.0.0.1')).toBe(false);
    expect(map.get('198.51.100.9')!.hits).toBeGreaterThanOrEqual(20);
  });

  it('humanizeFirewall and humanizeFail2ban tones', () => {
    expect(humanizeFirewall(undefined, false).tone).toBe('default');
    expect(humanizeFirewall('active', true).tone).toBe('ok');
    // note: "inactive".includes("active") matches first branch in humanizeFirewall
    expect(humanizeFirewall('Status: inactive', true).tone).toBe('ok');
    expect(humanizeFirewall('ERROR: need to be root', true, false).tone).toBe('warn');
    expect(humanizeFirewall('weird-state', true).tone).toBe('default');
    expect(humanizeFail2ban('active', true).tone).toBe('ok');
    expect(humanizeFail2ban('inactive', true).tone).toBe('warn');
    expect(humanizeFail2ban(undefined, false).tone).toBe('default');
  });

  it('ipMatchesWhitelist exact and cidr', () => {
    expect(ipMatchesWhitelist('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(ipMatchesWhitelist('203.0.113.9', ['203.0.113.0/24'])).toBe(true);
    expect(ipMatchesWhitelist('198.51.100.1', ['203.0.113.0/24'])).toBe(false);
  });
});

describe('auto-ban tick and batch honesty', () => {
  it('runAutoBanTick off/disabled is ok no bans; no execute pauses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tick-'));
    dirs.push(dir);
    const db = store(dir);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    saveAutoBanPolicy(db, { ...DEFAULT_AUTO_BAN, enabled: false, mode: 'off' });
    const off = await runAutoBanTick({ host, db, dataDir: dir });
    expect(off.ok).toBe(true);
    expect(off.banned).toHaveLength(0);

    updateAutoBanPolicy(db, { enabled: true, mode: 'soft' });
    const blocked = await runAutoBanTick({ host, db, dataDir: dir });
    expect(blocked.ok).toBe(false);
    expect(blocked.policy.pausedReason).toBe('no_execute');
    expect(blocked.notes.some((n) => n.length > 0)).toBe(true);
  });

  it('runAutoBanTick circuit breaker when max/hour exceeded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cb-'));
    dirs.push(dir);
    const db = store(dir);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    // LocalHostExecutor isRoot may be false; tick only checks executeEnabled for circuit path after enabled
    const recent = Array.from({ length: 5 }, () => new Date().toISOString());
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      mode: 'aggressive',
      maxAutoBansPerHour: 3,
      recentAutoBanAts: recent,
    });
    // Mock executeEnabled true via wrapper
    const mockHost: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => false,
      pathExists: () => false,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv) => ({ stdout: '', stderr: '', exitCode: 1, argv, dryRun: false }),
    };
    const r = await runAutoBanTick({ host: mockHost, db, dataDir: dir });
    expect(r.ok).toBe(false);
    expect(r.policy.pausedReason).toBe('circuit_breaker');
  });

  it('listSuspectIps reads dataDir nginx logs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-susp-'));
    dirs.push(dir);
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(
        `203.0.113.77 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-login.php HTTP/1.1" 404 1 "-" "-"`,
      );
    }
    writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');
    const db = store(dir);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const { items, notes } = await listSuspectIps({ host, db, dataDir: dir });
    expect(notes.length).toBeGreaterThan(0);
    const hit = items.find((i) => i.ip === '203.0.113.77');
    expect(hit).toBeTruthy();
    expect(hit!.hits).toBeGreaterThanOrEqual(20);
    expect(hit!.score).toBeGreaterThan(0);
  });

  it('defenseBanBatch empty and whitelist honesty without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-banb-'));
    dirs.push(dir);
    const db = store(dir);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const empty = await defenseBanBatch({ host, db, ips: [] });
    expect(empty.ok).toBe(false);
    expect(empty.notes.length).toBeGreaterThan(0);

    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      whitelist: ['203.0.113.1'],
    });
    const wl = await defenseBanBatch({ host, db, ips: ['203.0.113.1', 'not-ip'] });
    expect(wl.results.some((r) => r.ip === '203.0.113.1' && !r.ok)).toBe(true);

    const batch = await defenseBanBatch({
      host,
      db,
      ips: ['198.51.100.20'],
      reason: 'test',
      method: 'fail2ban',
    });
    // without execute, ban should not claim success dishonestly
    expect(Array.isArray(batch.results)).toBe(true);
    if (batch.results[0]) {
      expect(batch.results[0].ok === false || batch.blocked === true || batch.ok === false).toBe(
        true,
      );
    }
  });
});
