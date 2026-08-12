/**
 * Persist BitTorrent tracker settings under document store / dataDir JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_BT_TRACKER_SETTINGS,
  type BtTrackerSettings,
} from '@ysk/shared';

function settingsPath(dataDir: string): string {
  return join(dataDir, 'bt-tracker', 'settings.json');
}

export function loadBtTrackerSettings(dataDir: string): BtTrackerSettings {
  const p = settingsPath(dataDir);
  if (!existsSync(p)) return { ...DEFAULT_BT_TRACKER_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<BtTrackerSettings>;
    return normalizeBtTrackerSettings({ ...DEFAULT_BT_TRACKER_SETTINGS, ...raw });
  } catch {
    return { ...DEFAULT_BT_TRACKER_SETTINGS };
  }
}

export function saveBtTrackerSettings(
  dataDir: string,
  patch: Partial<BtTrackerSettings>,
): BtTrackerSettings {
  const next = normalizeBtTrackerSettings({
    ...loadBtTrackerSettings(dataDir),
    ...patch,
  });
  mkdirSync(join(dataDir, 'bt-tracker'), { recursive: true });
  writeFileSync(settingsPath(dataDir), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function normalizeBtTrackerSettings(s: BtTrackerSettings): BtTrackerSettings {
  const httpPort = clampPort(s.httpPort, 8000);
  let udpPort = Number(s.udpPort) || 0;
  if (udpPort < 0 || udpPort > 65535) udpPort = 0;
  const seederPortMin = clampPort(s.seederPortMin, 6881);
  let seederPortMax = clampPort(s.seederPortMax, 6889);
  if (seederPortMax < seederPortMin) seederPortMax = seederPortMin;
  return {
    listenHost: String(s.listenHost || '0.0.0.0').trim() || '0.0.0.0',
    httpPort,
    udpPort,
    wsEnabled: s.wsEnabled !== false,
    autostart: Boolean(s.autostart),
    publicAnnounceHost: String(s.publicAnnounceHost || '').trim(),
    maxSeeds: Math.min(256, Math.max(1, Number(s.maxSeeds) || 32)),
    seederPortMin,
    seederPortMax,
  };
}

function clampPort(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 65535) return fallback;
  return v;
}

/** Build announce URL list for create-torrent / magnet. */
export function buildAnnounceList(
  settings: BtTrackerSettings,
  opts?: { publicHost?: string },
): string[] {
  const host =
    (opts?.publicHost || settings.publicAnnounceHost || '127.0.0.1')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0] || '127.0.0.1';
  const port = settings.httpPort;
  const urls = [`http://${host}:${port}/announce`];
  if (settings.wsEnabled) {
    urls.push(`ws://${host}:${port}`);
  }
  if (settings.udpPort > 0) {
    urls.push(`udp://${host}:${settings.udpPort}`);
  }
  return urls;
}
