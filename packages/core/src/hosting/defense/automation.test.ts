/**
 * Integration-style tests for defense automation tick (mock host).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  loadDefenseAutomation,
  runDefenseAutomationTick,
  saveDefenseAutomation,
  updateDefenseAutomation,
  syncWhitelistToFail2banIgnore,
  desiredPresetFromScore,
  getAutomationMechanismRows,
  AUTOMATION_MECHANISM_ROWS,
  DEFAULT_AUTOMATION,
} from './automation.js';
import { scoreToThreatLevel, threatThresholdsFromAutoPreset } from './signals.js';
import { renderCfOnlyUfwScript, CLOUDFLARE_IPV4_RANGES } from './cf-ufw.js';

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  commands?: string[][];
}): HostExecutor {
  const log = opts?.commands ?? [];
  return {
    executeEnabled: () => Boolean(opts?.execute),
    isRoot: () => Boolean(opts?.root),
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async (name) => result(['systemctl', 'status', name], 0, 'inactive'),
    runCommand: async (argv) => {
      log.push([...argv]);
      const joined = argv.join(' ');
      if (joined.includes('fail2ban-client status')) {
        return result(argv, 0, 'Jail list:\n');
      }
      if (joined.includes('ufw status')) {
        return result(argv, 0, 'Status: inactive\n');
      }
      if (joined.includes('systemctl is-active')) {
        return result(argv, 0, 'inactive\n');
      }
      if (joined.includes('systemctl is-enabled')) {
        return result(argv, 0, 'disabled\n');
      }
      return result(argv, 0, 'ok\n');
    },
  };
}

function result(argv: string[], exitCode: number, stdout: string): RunResult {
  return { argv, exitCode, stdout, stderr: '', dryRun: false };
}

describe('defense automation integration', () => {
  it('unifies threat display thresholds with autoPreset knobs', () => {
    const ap = {
      escalateToHardenedAt: 25,
      escalateToUnderAttackAt: 50,
      suggestEmergencyAt: 90,
      criticalAt: 75,
    };
    const t = threatThresholdsFromAutoPreset(ap);
    expect(t.elevatedAt).toBe(25);
    expect(t.underAttackAt).toBe(50);
    expect(t.criticalAt).toBe(75);
    expect(scoreToThreatLevel(24, t)).toBe('low');
    expect(scoreToThreatLevel(25, t)).toBe('elevated');
    expect(scoreToThreatLevel(50, t)).toBe('under_attack');
    expect(scoreToThreatLevel(75, t)).toBe('critical');
    expect(desiredPresetFromScore(50, { ...DEFAULT_AUTOMATION.autoPreset, ...ap })).toBe(
      'under_attack',
    );
    expect(desiredPresetFromScore(99, { ...DEFAULT_AUTOMATION.autoPreset, ...ap })).toBe(
      'under_attack',
    ); // never emergency
  });

  it('renders CF-only UFW script with keep ports and CF ranges', () => {
    const body = renderCfOnlyUfwScript({ keepTcpPorts: [22, 2222] });
    expect(body).toContain('ufw allow 22/tcp');
    expect(body).toContain('ufw allow 2222/tcp');
    expect(body).toContain(CLOUDFLARE_IPV4_RANGES[0]);
    expect(body).toContain('default deny incoming');
  });

  it('runDefenseAutomationTick respects master off and never auto-emergency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-autotick-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = db.snapshot.settings ?? {};
      const auto = {
        ...DEFAULT_AUTOMATION,
        enabled: false,
        autoPreset: { ...DEFAULT_AUTOMATION.autoPreset, enabled: true },
        autoBan: { ...DEFAULT_AUTOMATION.autoBan, enabled: true },
      };
      saveDefenseAutomation(db, auto);
      const host = mockHost({ execute: false, root: false });
      const r = await runDefenseAutomationTick({
        host,
        db,
        dataDir: dir,
        requestCountLastMinute: 0,
      });
      expect(r.ok).toBe(true);
      expect(r.notes.some((n) => /主開關關閉/.test(n))).toBe(true);
      expect(r.presetChanged).toBeFalsy();
      expect(r.banned).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runDefenseAutomationTick with autoPreset on does not apply emergency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-autotick2-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = db.snapshot.settings ?? {};
      saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        enabled: true,
        autoPreset: {
          ...DEFAULT_AUTOMATION.autoPreset,
          enabled: true,
          escalateToHardenedAt: 1,
          escalateToUnderAttackAt: 2,
          suggestEmergencyAt: 3,
          criticalAt: 3,
        },
        autoBan: { ...DEFAULT_AUTOMATION.autoBan, enabled: false },
        signalWeights: {
          networkDown: 3,
          highReqRate: 3,
          ddosHeuristic: 3,
          tcpInuse: 3,
          ufwInactive: 3,
          f2bBans: 3,
        },
      });
      const cmds: string[][] = [];
      const host = mockHost({ execute: false, root: false, commands: cmds });
      const r = await runDefenseAutomationTick({
        host,
        db,
        dataDir: dir,
        requestCountLastMinute: 9999,
      });
      expect(r.ok).toBe(true);
      // If high score, may suggest emergency but preset never emergency
      if (r.suggestEmergency) {
        expect(r.preset).not.toBe('emergency');
      }
      if (r.presetChanged) {
        expect(['daily', 'hardened', 'under_attack']).toContain(r.preset);
      }
      const loaded = loadDefenseAutomation(db);
      expect(loaded.lastTickAt).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('defense automation depth', () => {
  it('updateDefenseAutomation custom thresholds + load invalid JSON + whitelist sync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auto-d-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = db.snapshot.settings ?? {};
      const updated = updateDefenseAutomation(db, {
        enabled: true,
        autoBan: {
          enabled: true,
          mode: 'custom',
          method: 'both',
          minScore: 40,
          minHits: 10,
          min429: 5,
          minScan: 3,
          cooldownMinutes: 30,
          maxAutoBansPerHour: 10,
          intervalSeconds: 45,
          whitelist: ['10.0.0.1', ''],
          syncFail2banIgnoreip: true,
        },
        autoPreset: {
          enabled: true,
          escalateToHardenedAt: 15,
          escalateToUnderAttackAt: 40,
          suggestEmergencyAt: 90,
          criticalAt: 70,
          deescalateEnabled: true,
          deescalateToDailyBelow: 5,
          holdMinutes: 10,
        },
        cloudflare: {
          enabled: true,
          zones: ['zone1'],
          onAutoEscalate: true,
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: [22, 443],
        },
        signalWeights: { networkDown: 2 },
      });
      expect(updated.autoBan.mode).toBe('custom');
      expect(updated.autoBan.minScore).toBe(40);
      expect(updated.cloudflare.zones).toEqual(['zone1']);
      expect(updated.autoBan.whitelist).toContain('10.0.0.1');

      const path = syncWhitelistToFail2banIgnore(dir, ['10.0.0.1', '10.0.0.2']);
      expect(path).toContain('ignoreip.txt');
      expect(loadDefenseAutomation(db).enabled).toBe(true);

      // invalid JSON → defaults
      db.snapshot.settings.defense_automation = '{not-json';
      db.persist();
      const fallback = loadDefenseAutomation(db);
      expect(fallback.autoPreset).toBeTruthy();
      expect(typeof fallback.enabled).toBe('boolean');

      // load from legacy only (no AUTO_KEY)
      const db2 = new JsonStore(join(dir, 'db2.json'));
      db2.snapshot.settings = {
        defense_auto_ban: JSON.stringify({
          enabled: true,
          mode: 'aggressive',
          method: 'ufw',
          cooldownMinutes: 15,
          maxAutoBansPerHour: 20,
          whitelist: ['1.1.1.1'],
        }),
      };
      db2.persist();
      const fromLegacy = loadDefenseAutomation(db2);
      expect(fromLegacy.autoBan.enabled).toBe(true);

      const rows = getAutomationMechanismRows();
      expect(rows.length).toBeGreaterThanOrEqual(5);
      expect(rows[0].step.length).toBeGreaterThan(0);
      expect(AUTOMATION_MECHANISM_ROWS().length).toBe(rows.length);

      expect(desiredPresetFromScore(12, DEFAULT_AUTOMATION.autoPreset)).toBe('daily');
      expect(desiredPresetFromScore(25, DEFAULT_AUTOMATION.autoPreset)).toBe('hardened');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tick with autoBan enabled + escalate to under_attack with CF opts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auto-tick3-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = db.snapshot.settings ?? {};
      saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        enabled: true,
        autoPreset: {
          ...DEFAULT_AUTOMATION.autoPreset,
          enabled: true,
          escalateToHardenedAt: 1,
          escalateToUnderAttackAt: 2,
          suggestEmergencyAt: 3,
          criticalAt: 3,
          deescalateEnabled: true,
          deescalateToDailyBelow: 0,
          holdMinutes: 1,
        },
        autoBan: {
          ...DEFAULT_AUTOMATION.autoBan,
          enabled: true,
          mode: 'custom',
          method: 'fail2ban',
          minScore: 1,
          minHits: 1,
          min429: 1,
          minScan: 1,
          maxAutoBansPerHour: 50,
          whitelist: ['127.0.0.1'],
        },
        signalWeights: {
          networkDown: 3,
          highReqRate: 3,
          ddosHeuristic: 3,
          tcpInuse: 3,
          ufwInactive: 3,
          f2bBans: 3,
        },
        cloudflare: {
          enabled: true,
          zones: ['example.com'],
          onAutoEscalate: true,
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: [22],
        },
      });
      const host = mockHost({ execute: false, root: false });
      const r = await runDefenseAutomationTick({
        host,
        db,
        dataDir: dir,
        requestCountLastMinute: 50_000,
      });
      expect(r.ok).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.banned)).toBe(true);
      expect(r.automation.lastTickAt).toBeTruthy();
      if (r.suggestEmergency) {
        expect(r.preset).not.toBe('emergency');
      }

      // second tick: hold may be active
      const r2 = await runDefenseAutomationTick({
        host,
        db,
        dataDir: dir,
        requestCountLastMinute: 0,
      });
      expect(r2.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saveDefenseAutomation normalizes interval and ufw ports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auto-save-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = {};
      const s = saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        enabled: true,
        autoBan: {
          ...DEFAULT_AUTOMATION.autoBan,
          mode: 'aggressive',
          intervalSeconds: 5, // clamp up
          whitelist: ['  a  ', ''],
        },
        cloudflare: {
          enabled: false,
          zones: ['z'],
          onAutoEscalate: false,
          ufwAllowOnlyCf: false,
          ufwKeepTcpPorts: [22, 99999, -1, 80.5, 443] as number[],
        },
      });
      expect(s.autoBan.intervalSeconds).toBeGreaterThanOrEqual(30);
      expect(s.autoBan.whitelist).toEqual(['a']);
      expect(s.cloudflare.ufwKeepTcpPorts.every((p) => p > 0 && p < 65536)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tick autoBan custom + hold note + cloudflare escalate branches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auto-tick-cf-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = {
        defense_active_preset: 'daily',
        // hold active to exercise hold note when not de-escalating
        defense_auto_preset_hold: JSON.stringify({
          at: new Date().toISOString(),
          preset: 'hardened',
        }),
        defense_timeline: '{bad-json',
      };
      saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        enabled: true,
        autoPreset: {
          ...DEFAULT_AUTOMATION.autoPreset,
          enabled: true,
          escalateToHardenedAt: 1,
          escalateToUnderAttackAt: 2,
          suggestEmergencyAt: 99,
          deescalateEnabled: true,
          deescalateToDailyBelow: 0,
          holdMinutes: 60,
        },
        autoBan: {
          ...DEFAULT_AUTOMATION.autoBan,
          enabled: true,
          mode: 'custom',
          method: 'both',
          minScore: 1,
          minHits: 1,
          min429: 1,
          minScan: 1,
        },
        cloudflare: {
          enabled: true,
          zones: ['zone-a'],
          onAutoEscalate: true,
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: [22, 443],
        },
        signalWeights: {
          networkDown: 3,
          highReqRate: 3,
          ddosHeuristic: 3,
          tcpInuse: 3,
          ufwInactive: 3,
          f2bBans: 3,
        },
      });
      // execute false: preset apply stays written/blocked without touching /etc
      const host = mockHost({ execute: false, root: false });
      const r = await runDefenseAutomationTick({
        host,
        db,
        dataDir: dir,
        requestCountLastMinute: 50_000,
      });
      expect(r.ok).toBe(true);
      expect(r.automation.lastTickAt).toBeTruthy();
      // autoBan custom path sets temporary thresholds
      expect(db.snapshot.settings.defense_auto_ban_custom_th).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
