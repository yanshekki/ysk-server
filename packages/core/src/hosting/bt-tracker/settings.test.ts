import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAnnounceList,
  loadBtTrackerSettings,
  normalizeBtTrackerSettings,
  saveBtTrackerSettings,
} from './settings.js';
import { DEFAULT_BT_TRACKER_SETTINGS } from '@ysk/shared';

describe('bt-tracker settings', () => {
  it('normalizes ports and maxSeeds', () => {
    const n = normalizeBtTrackerSettings({
      ...DEFAULT_BT_TRACKER_SETTINGS,
      httpPort: 99999,
      udpPort: -1,
      maxSeeds: 9999,
      seederPortMin: 7000,
      seederPortMax: 6000,
    });
    expect(n.httpPort).toBe(8000);
    expect(n.udpPort).toBe(0);
    expect(n.maxSeeds).toBe(256);
    expect(n.seederPortMax).toBe(n.seederPortMin);
  });

  it('builds announce list with ws and optional udp', () => {
    const httpOnly = buildAnnounceList(
      { ...DEFAULT_BT_TRACKER_SETTINGS, httpPort: 8000, wsEnabled: true, udpPort: 0 },
      { publicHost: 'example.com' },
    );
    expect(httpOnly).toContain('http://example.com:8000/announce');
    expect(httpOnly.some((u) => u.startsWith('ws://'))).toBe(true);

    const withUdp = buildAnnounceList(
      { ...DEFAULT_BT_TRACKER_SETTINGS, httpPort: 8000, wsEnabled: false, udpPort: 8001 },
      { publicHost: 'example.com' },
    );
    expect(withUdp.some((u) => u.startsWith('udp://'))).toBe(true);
    expect(withUdp.some((u) => u.startsWith('ws://'))).toBe(false);
  });

  it('persists settings under dataDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bt-settings-'));
    try {
      expect(loadBtTrackerSettings(dir).httpPort).toBe(8000);
      const saved = saveBtTrackerSettings(dir, {
        httpPort: 18080,
        publicAnnounceHost: 'seed.example',
        autostart: true,
      });
      expect(saved.httpPort).toBe(18080);
      expect(saved.autostart).toBe(true);
      const loaded = loadBtTrackerSettings(dir);
      expect(loaded.publicAnnounceHost).toBe('seed.example');
      expect(loaded.httpPort).toBe(18080);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
