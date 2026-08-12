import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAnnounceList,
  buildSeederAnnounceList,
  btTrackerPortBindings,
  loadBtTrackerSettings,
  normalizeBtTrackerSettings,
  resolveAnnounceHost,
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

  it('builds announce list from panel public host + ports (no fake 127.0.0.1)', () => {
    const fromPanel = buildAnnounceList({
      ...DEFAULT_BT_TRACKER_SETTINGS,
      httpPort: 8000,
      udpPort: 6969,
      wsEnabled: true,
      publicAnnounceHost: 'tracker.example.test',
      listenHost: '0.0.0.0',
    });
    expect(fromPanel).toEqual([
      'http://tracker.example.test:8000/announce',
      'ws://tracker.example.test:8000',
      'udp://tracker.example.test:6969',
    ]);
    expect(fromPanel.join(' ')).not.toContain('127.0.0.1');

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

    // Unset public host + bind-all → empty (do not invent 127.0.0.1 in magnets)
    expect(
      buildAnnounceList({
        ...DEFAULT_BT_TRACKER_SETTINGS,
        publicAnnounceHost: '',
        listenHost: '0.0.0.0',
      }),
    ).toEqual([]);

    expect(
      resolveAnnounceHost({
        publicAnnounceHost: '  tracker.example.test ',
        listenHost: '0.0.0.0',
      }),
    ).toBe('tracker.example.test');
  });

  it('seeder announce is a single local URL (avoid double seed count)', () => {
    const list = buildSeederAnnounceList({
      ...DEFAULT_BT_TRACKER_SETTINGS,
      httpPort: 8000,
      wsEnabled: true,
      publicAnnounceHost: 'tracker.example.test',
      listenHost: '0.0.0.0',
    });
    // Exactly one announce — HTTP+WS dual-register was showing 種子=2 forever
    expect(list).toHaveLength(1);
    expect(list[0]).toBe('http://127.0.0.1:8000/announce');
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

  it('builds exposure bindings for HTTP (+ optional UDP)', () => {
    const httpOnly = btTrackerPortBindings({
      ...DEFAULT_BT_TRACKER_SETTINGS,
      httpPort: 8000,
      udpPort: 0,
    });
    expect(httpOnly).toEqual([
      { role: 'http', port: '8000', proto: 'tcp' },
    ]);

    const withUdp = btTrackerPortBindings({
      ...DEFAULT_BT_TRACKER_SETTINGS,
      httpPort: 8000,
      udpPort: 6969,
    });
    expect(withUdp).toEqual([
      { role: 'http', port: '8000', proto: 'tcp' },
      { role: 'udp-announce', port: '6969', proto: 'udp' },
    ]);
  });
});
