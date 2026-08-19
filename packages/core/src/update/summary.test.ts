import { describe, expect, it } from 'vitest';
import {
  buildUpdatesSummary,
  normalizeUpdatesScanSettings,
  DEFAULT_UPDATES_SCAN,
} from './summary.js';

describe('updates summary', () => {
  it('normalizes scan settings', () => {
    expect(normalizeUpdatesScanSettings(null).enabled).toBe(true);
    expect(normalizeUpdatesScanSettings({ enabled: false }).enabled).toBe(false);
    expect(normalizeUpdatesScanSettings({ intervalMs: 24 * 60 * 60_000 }).intervalMs).toBe(
      24 * 60 * 60_000,
    );
    expect(normalizeUpdatesScanSettings({ intervalMs: 100 }).intervalMs).toBe(
      DEFAULT_UPDATES_SCAN.intervalMs,
    );
  });

  it('builds badge from inventory + panel', () => {
    const s = buildUpdatesSummary({
      lastInventory: {
        at: new Date().toISOString(),
        upgradable: 3,
        advice: [
          { risk: 'high', candidateVersion: '2', currentVersion: '1', requiresApproval: true },
          { risk: 'low', candidateVersion: '2', currentVersion: '1' },
        ],
      },
      lastSelf: {
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        lastCheckAt: new Date().toISOString(),
      },
      scanSettings: { enabled: true, intervalMs: 24 * 60 * 60_000 },
      nextScanAt: '2099-01-01T00:00:00.000Z',
    });
    expect(s.packagesUpgradable).toBe(3);
    expect(s.packagesHighRisk).toBe(1);
    expect(s.panelUpdateAvailable).toBe(true);
    expect(s.badgeCount).toBe(4);
    expect(s.stale).toBe(false);
    expect(s.nextScanAt).toContain('2099');
  });

  it('hides panel update when current equals latest', () => {
    const s = buildUpdatesSummary({
      lastInventory: { at: new Date().toISOString(), upgradable: 0 },
      lastSelf: {
        updateAvailable: true,
        currentVersion: '1.1.12',
        latestVersion: '1.1.12',
      },
    });
    expect(s.panelUpdateAvailable).toBe(false);
    expect(s.badgeCount).toBe(0);
  });

  it('marks stale when last scan too old', () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    const s = buildUpdatesSummary({
      lastInventory: { at: old, upgradable: 0 },
      scanSettings: { enabled: true, intervalMs: 24 * 60 * 60_000 },
    });
    expect(s.stale).toBe(true);
  });
});
