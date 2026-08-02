/**
 * Branch coverage boost — pure auto-ban helpers (honest shipped exports).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import {
  countAutoBansLastHour,
  humanizeFail2ban,
  humanizeFirewall,
  loadAutoBanPolicy,
  modeThresholds,
  parseAccessLogSuspects,
  suggestedAutoBanForPreset,
  ipMatchesWhitelist,
  saveAutoBanPolicy,
  DEFAULT_AUTO_BAN,
} from './auto-ban.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('auto-ban branch boost', () => {
  it('modeThresholds off/default + all presets', () => {
    expect(modeThresholds('off').minScore).toBeGreaterThan(1000);
    expect(modeThresholds('soft').minHits).toBe(100);
    expect(modeThresholds('normal').min429).toBe(30);
    expect(modeThresholds('aggressive').minScan).toBe(5);
    for (const p of ['daily', 'hardened', 'under_attack', 'emergency'] as const) {
      const s = suggestedAutoBanForPreset(p);
      expect(s.mode).toBeTruthy();
      if (p === 'daily') expect(s.enabled).toBe(false);
      else expect(s.enabled).toBe(true);
    }
  });

  it('humanizeFirewall and humanizeFail2ban all tones', () => {
    expect(humanizeFirewall(undefined, false).tone).toBe('default');
    expect(humanizeFirewall('active', true).tone).toBe('ok');
    // shipped: "inactive".includes("active") → ok branch (substring match)
    expect(humanizeFirewall('inactive', true).tone).toBe('ok');
    expect(humanizeFirewall('Status: inactive', true).tone).toBe('ok');
    expect(humanizeFirewall('need to be root', true, false).tone).toBe('warn');
    expect(humanizeFirewall('error reading', true, true).short).toBeTruthy();
    expect(humanizeFirewall('weird-state-xyz', true).tone).toBe('default');

    expect(humanizeFail2ban(undefined, false).tone).toBe('default');
    expect(humanizeFail2ban('active', true).tone).toBe('ok');
    expect(humanizeFail2ban('inactive', true).tone).toBe('warn');
    expect(humanizeFail2ban('unknown', true).tone).toBe('default');
    expect(humanizeFail2ban('active', undefined).tone).toBe('ok');
  });

  it('loadAutoBanPolicy modes/methods + whitelist + count hour', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-abb-'));
    dirs.push(dir);
    const db = new JsonStore(join(dir, 'ysk.json'));
    // mode off + method ufw
    db.snapshot.settings.defense_auto_ban = JSON.stringify({
      enabled: true,
      mode: 'off',
      method: 'ufw',
      cooldownMinutes: 10000,
      maxAutoBansPerHour: 0,
      whitelist: ['10.0.0.1', 'invalid'],
      recentAutoBanAts: [
        new Date().toISOString(),
        new Date(Date.now() - 2 * 3600_000).toISOString(),
      ],
    });
    db.persist();
    const p = loadAutoBanPolicy(db);
    expect(p.mode).toBe('off');
    expect(p.method).toBe('ufw');
    expect(p.cooldownMinutes).toBeLessThanOrEqual(24 * 60);
    expect(p.maxAutoBansPerHour).toBeGreaterThanOrEqual(1);
    expect(countAutoBansLastHour(p)).toBe(1);

    // soft mode via unknown mode falls back
    db.snapshot.settings.defense_auto_ban = JSON.stringify({
      mode: 'nope',
      method: 'weird',
    });
    db.persist();
    const p2 = loadAutoBanPolicy(db);
    expect(p2.mode).toBe('soft');
    expect(p2.method).toBe('fail2ban');

    expect(ipMatchesWhitelist('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(ipMatchesWhitelist('8.8.8.8', ['127.0.0.1'])).toBe(false);
  });

  it('parseAccessLogSuspects hits 429 and scan paths', () => {
    const log = [
      '1.2.3.4 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1',
      '1.2.3.4 - - [01/Jan/2024:00:00:01 +0000] "GET / HTTP/1.1" 429 1',
      '5.6.7.8 - - [01/Jan/2024:00:00:02 +0000] "GET /.env HTTP/1.1" 404 1',
      '5.6.7.8 - - [01/Jan/2024:00:00:03 +0000] "GET /wp-login.php HTTP/1.1" 404 1',
      'not-a-log-line',
    ].join('\n');
    const map = parseAccessLogSuspects(log, 100);
    expect(map.size).toBeGreaterThanOrEqual(1);
    const a = map.get('1.2.3.4');
    expect(a?.hits).toBeGreaterThanOrEqual(2);
    expect(a?.s429).toBeGreaterThanOrEqual(1);
  });

  it('saveAutoBanPolicy truncates large whitelist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-abb2-'));
    dirs.push(dir);
    const db = new JsonStore(join(dir, 'ysk.json'));
    const big = Array.from({ length: 300 }, (_, i) => `203.0.113.${i % 250}`);
    const saved = saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      whitelist: big,
      recentAutoBanAts: Array.from({ length: 600 }, () => new Date().toISOString()),
    });
    expect(saved.whitelist.length).toBeLessThanOrEqual(200);
    expect(saved.recentAutoBanAts?.length).toBeLessThanOrEqual(500);
  });
});
