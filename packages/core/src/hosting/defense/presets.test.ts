import { describe, expect, it } from 'vitest';
import { buildPresetActions, getDefensePreset, listDefensePresets } from './presets.js';
import { renderDefenseLimitsInclude, writeDefenseNginxLimits } from './nginx-limits.js';
import { scoreToThreatLevel } from './signals.js';
import {
  humanizeFirewall,
  ipMatchesWhitelist,
  modeThresholds,
  parseAccessLogSuspects,
  suggestedAutoBanForPreset,
} from './auto-ban.js';
import { desiredPresetFromScore, DEFAULT_AUTOMATION } from './automation.js';
import { setCloudflareSecurityLevel } from './cloudflare-ua.js';
import { parseAuthFailIps, collectTopIps, listVhostDefenseMarkers } from './intel.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('defense presets', () => {
  it('lists four presets with nginx specs', () => {
    const list = listDefensePresets();
    expect(list).toHaveLength(4);
    expect(getDefensePreset('under_attack').nginx.reqRate).toMatch(/r\/s/);
    expect(getDefensePreset('emergency').requireConfirm).toBe('EMERGENCY');
    const actions = buildPresetActions(getDefensePreset('daily'));
    expect(actions.some((a) => a.kind === 'nginx_limits')).toBe(true);
  });

  it('writes nginx limit files and injects vhosts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-def-'));
    try {
      const confDir = join(dir, 'nginx', 'conf.d');
      mkdirSync(confDir, { recursive: true });
      writeFileSync(
        join(confDir, 'demo.conf'),
        'server {\n  listen 80;\n  server_name demo.test;\n  location / { return 200; }\n}\n',
        'utf8',
      );
      const r = writeDefenseNginxLimits(dir, {
        reqRate: '10r/s',
        burst: 20,
        connLimit: 40,
      });
      expect(r.written.length).toBeGreaterThanOrEqual(2);
      const body = readFileSync(r.confPath, 'utf8');
      expect(body).toContain('limit_req_zone');
      expect(body).toContain('10r/s');
      const inc = renderDefenseLimitsInclude({
        reqRate: '10r/s',
        burst: 20,
        connLimit: 40,
      });
      expect(inc).toContain('burst=20');
      expect(inc).toContain('limit_conn ysk_conn 40');
      const vhost = readFileSync(join(confDir, 'demo.conf'), 'utf8');
      expect(vhost).toContain('BEGIN YSK_DEFENSE');
      expect(vhost).toContain('include ysk-defense-limits.inc');
      expect(r.vhostsUpdated.some((p) => p.endsWith('demo.conf'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps score to threat levels (default + custom thresholds)', () => {
    expect(scoreToThreatLevel(0)).toBe('low');
    expect(scoreToThreatLevel(25)).toBe('elevated');
    expect(scoreToThreatLevel(50)).toBe('under_attack');
    expect(scoreToThreatLevel(80)).toBe('critical');
    expect(
      scoreToThreatLevel(30, { elevatedAt: 10, underAttackAt: 40, criticalAt: 90 }),
    ).toBe('elevated');
    expect(
      scoreToThreatLevel(90, { elevatedAt: 10, underAttackAt: 40, criticalAt: 90 }),
    ).toBe('critical');
  });

  it('parses access log suspects and whitelist/cidr', () => {
    const log = [
      '203.0.113.10 - - [01/Jan/2026:00:00:01 +0000] "GET /wp-admin HTTP/1.1" 404 12',
      '203.0.113.10 - - [01/Jan/2026:00:00:02 +0000] "GET /.env HTTP/1.1" 404 12',
      '203.0.113.10 - - [01/Jan/2026:00:00:03 +0000] "GET / HTTP/1.1" 429 12',
      '198.51.100.1 - - [01/Jan/2026:00:00:04 +0000] "GET / HTTP/1.1" 200 100',
    ].join('\n');
    const map = parseAccessLogSuspects(log);
    expect(map.get('203.0.113.10')?.scan).toBeGreaterThanOrEqual(2);
    expect(map.get('203.0.113.10')?.s429).toBe(1);
    expect(ipMatchesWhitelist('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
    expect(ipMatchesWhitelist('203.0.113.10', ['127.0.0.1'])).toBe(false);
    expect(humanizeFirewall('ERROR: You need to be root', true, false).short).toBe('需 root');
    expect(modeThresholds('aggressive').minScore).toBeLessThan(modeThresholds('soft').minScore);
    expect(suggestedAutoBanForPreset('hardened').enabled).toBe(true);
  });

  it('maps score to auto preset without emergency', () => {
    const ap = DEFAULT_AUTOMATION.autoPreset;
    expect(desiredPresetFromScore(5, ap)).toBe('daily');
    expect(desiredPresetFromScore(25, ap)).toBe('hardened');
    expect(desiredPresetFromScore(50, ap)).toBe('under_attack');
    expect(desiredPresetFromScore(99, ap)).toBe('under_attack'); // never emergency
  });

  it('cloudflare under attack dry-run without token', async () => {
    const prev = process.env.CF_API_TOKEN;
    delete process.env.CF_API_TOKEN;
    const r = await setCloudflareSecurityLevel({
      zone: 'example.com',
      level: 'under_attack',
    });
    expect(r.requiresToken).toBe(true);
    expect(r.ok).toBe(false);
    if (prev) process.env.CF_API_TOKEN = prev;
  });

  it('parses auth fails and lists vhost markers', () => {
    const auth = parseAuthFailIps(
      'Failed password for root from 203.0.113.9 port 22\nFailed password for root from 203.0.113.9 port 22\n',
    );
    expect(auth.get('203.0.113.9')).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), 'ysk-intel-'));
    try {
      mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
      writeFileSync(
        join(dir, 'nginx', 'conf.d', 'site.conf'),
        'server {\n  server_name x;\n# BEGIN YSK_DEFENSE\n  include ysk-defense-limits.inc;\n# END YSK_DEFENSE\n}\n',
      );
      const v = listVhostDefenseMarkers(dir);
      expect(v.withLimit).toBe(1);
      const top = collectTopIps(dir);
      expect(Array.isArray(top.items)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
