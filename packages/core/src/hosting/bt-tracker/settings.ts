/**
 * Persist BitTorrent tracker settings under document store / dataDir JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_BT_TRACKER_SETTINGS,
  type BtTrackerSettings,
  type ServicePortBinding,
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

/**
 * Host clients see in magnet / announce URLs — always from panel settings.
 * Order: explicit override → publicAnnounceHost → listenHost (if not 0.0.0.0).
 * Never invent a random hostname; empty string means “not configured yet”.
 */
export function resolveAnnounceHost(
  settings: Pick<BtTrackerSettings, 'publicAnnounceHost' | 'listenHost'>,
  opts?: { publicHost?: string | null },
): string {
  const pick = (raw: string | undefined | null): string => {
    const s = String(raw || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '')
      .split('/')[0]
      ?.trim();
    if (!s) return '';
    // strip accidental path / trailing junk
    return s.replace(/:\d+$/, (m) => m); // keep host:port if operator put it in publicAnnounceHost
  };

  const fromOpt = pick(opts?.publicHost);
  if (fromOpt) return fromOpt;

  const fromPublic = pick(settings.publicAnnounceHost);
  if (fromPublic) return fromPublic;

  const listen = pick(settings.listenHost);
  if (listen && listen !== '0.0.0.0' && listen !== '::' && listen !== '[::]') {
    return listen;
  }
  return '';
}

/**
 * Loopback host for process-local access to the tracker (proxy / scrape / seeder).
 * Uses listenHost when bound to a specific address; else 127.0.0.1.
 */
export function resolveTrackerLoopbackHost(
  settings: Pick<BtTrackerSettings, 'listenHost'>,
): string {
  const h = String(settings.listenHost || '').trim();
  if (h && h !== '0.0.0.0' && h !== '::' && h !== '[::]') return h;
  return '127.0.0.1';
}

/** Build announce URL list for create-torrent / magnet — panel ports + host only. */
export function buildAnnounceList(
  settings: BtTrackerSettings,
  opts?: { publicHost?: string },
): string[] {
  const host = resolveAnnounceHost(settings, opts);
  if (!host) {
    // Operator has not set public announce host yet — no fake 127.0.0.1 in magnets
    return [];
  }
  // publicAnnounceHost may already include :port (e.g. host:8000)
  const hostHasPort = /:\d+$/.test(host);
  const httpHost = hostHasPort ? host : `${host}:${settings.httpPort}`;
  const urls = [`http://${httpHost}/announce`];
  if (settings.wsEnabled) {
    urls.push(`ws://${httpHost}`);
  }
  if (settings.udpPort > 0) {
    const udpHost = hostHasPort
      ? host.replace(/:\d+$/, `:${settings.udpPort}`)
      : `${host}:${settings.udpPort}`;
    urls.push(`udp://${udpHost}`);
  }
  return urls;
}

/**
 * Announce list for the in-process seeder.
 *
 * **Only one** tracker URL — bittorrent-tracker keys HTTP peers by ip:port and
 * WS peers by peer_id. Announcing HTTP + WS (or public + loopback) registers
 * the same seeder twice → UI always shows 種子=2.
 *
 * Browser clients still join via the same-origin WS proxy into this process;
 * they share the same swarm as this single HTTP announce.
 */
export function buildSeederAnnounceList(settings: BtTrackerSettings): string[] {
  const loop = resolveTrackerLoopbackHost(settings);
  return [`http://${loop}:${settings.httpPort}/announce`];
}

/**
 * Firewall / service-exposure bindings for the tracker.
 * HTTP (and WS on same TCP port) always; UDP only when udpPort > 0.
 */
export function btTrackerPortBindings(
  settings: Pick<BtTrackerSettings, 'httpPort' | 'udpPort'>,
): ServicePortBinding[] {
  const ports: ServicePortBinding[] = [
    { role: 'http', port: String(settings.httpPort), proto: 'tcp' },
  ];
  if (settings.udpPort > 0) {
    ports.push({
      role: 'udp-announce',
      port: String(settings.udpPort),
      proto: 'udp',
    });
  }
  return ports;
}
