/**
 * In-process BitTorrent tracker (bittorrent-tracker) managed by the control plane.
 * Honest: start without EXECUTE still attempts listen if permitted; package install is N/A (bundled dep).
 */
import type { HostExecutor } from '../../host/executor.js';
import {
  type BtTrackerSettings,
  type BtTrackerStatus,
  type BtTrackerTorrentRow,
  tl,
} from '@ysk/shared';
import {
  buildAnnounceList,
  loadBtTrackerSettings,
  saveBtTrackerSettings,
} from './settings.js';

type TrackerSwarm = {
  complete?: number;
  incomplete?: number;
  peers?: { keys?: string[]; length?: number };
};

type TrackerServer = {
  http?: { address?: () => { port: number } | string | null; close: (cb?: () => void) => void };
  udp?: { close: (cb?: () => void) => void };
  ws?: { close: (cb?: () => void) => void };
  close: (cb?: (err?: Error) => void) => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  listen: (port: number, host?: string | (() => void), cb?: () => void) => void;
  /** Live swarms from bittorrent-tracker */
  torrents?: Record<string, TrackerSwarm>;
};

type Runtime = {
  server: TrackerServer;
  settings: BtTrackerSettings;
  startedAt: string;
  announces: number;
  /** infoHash hex → counts from announce events */
  swarm: Map<string, { complete: number; incomplete: number; name?: string }>;
};

let runtime: Runtime | null = null;

export function isBtTrackerRunning(): boolean {
  return Boolean(runtime?.server);
}

export function getBtTrackerRuntime(): Runtime | null {
  return runtime;
}

export async function getBtTrackerStatus(input: {
  dataDir: string;
  host: HostExecutor;
  publicHostHint?: string | null;
}): Promise<BtTrackerStatus> {
  const settings = loadBtTrackerSettings(input.dataDir);
  const notes: string[] = [];
  const installed = true; // bundled dependency
  // Detached worker pid (optional) — dynamic import avoids circular init
  let detachedPid: number | null = null;
  let detached = false;
  try {
    const proc = await import('./process.js');
    detached = proc.isDetachedTrackerRunning(input.dataDir);
    detachedPid = detached ? proc.readTrackerPid(input.dataDir) : null;
  } catch {
    /* */
  }
  const inProcess = isBtTrackerRunning();
  const running = inProcess || detached;
  if (!input.host.executeEnabled()) {
    notes.push(tl('notes.btTracker.needExecute'));
  }
  if (detached && !inProcess) {
    notes.push(tl('notes.btTracker.runningDetached', { pid: String(detachedPid || '') }));
  }
  const announceUrls = buildAnnounceList(settings, {
    publicHost: input.publicHostHint || settings.publicAnnounceHost || undefined,
  });
  let stats: BtTrackerStatus['stats'];
  if (runtime) {
    const fromServer = readServerTorrents(runtime.server);
    if (fromServer.length) {
      let peers = 0;
      for (const r of fromServer) peers += r.seeders + r.leechers;
      stats = {
        torrents: fromServer.length,
        peers,
        announces: runtime.announces,
      };
    } else {
      let peers = 0;
      for (const s of runtime.swarm.values()) {
        peers += s.complete + s.incomplete;
      }
      stats = {
        torrents: runtime.swarm.size,
        peers,
        announces: runtime.announces,
      };
    }
  } else if (detached) {
    // Aggregate scrape from local tracker HTTP when detached
    try {
      const scraped = await scrapeLocalTrackerStats(settings.httpPort);
      if (scraped) stats = scraped;
    } catch {
      /* optional */
    }
  }
  return {
    installed,
    running,
    pid: inProcess ? process.pid : detachedPid,
    settings,
    announceUrls,
    executeEnabled: input.host.executeEnabled(),
    isRoot: input.host.isRoot(),
    notes,
    stats,
    startedAt: runtime?.startedAt ?? null,
  };
}

export async function startBtTracker(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; requiresExecute?: boolean }> {
  const notes: string[] = [];
  if (runtime) {
    notes.push(tl('notes.btTracker.alreadyRunning'));
    return { ok: true, notes };
  }
  // Listening is local process control — allow without root; EXECUTE preferred for honesty on production
  if (!input.host.executeEnabled()) {
    notes.push(tl('notes.btTracker.startWithoutExecute'));
  }
  const settings = loadBtTrackerSettings(input.dataDir);
  try {
    const { Server } = await import('bittorrent-tracker');
    const server = new Server({
      udp: settings.udpPort > 0,
      http: true,
      ws: settings.wsEnabled,
      stats: true,
      filter(_infoHash: Buffer, _params: unknown, cb: (err: Error | null) => void) {
        // Accept all infohashes for self-hosted private panel shares
        cb(null);
      },
    }) as TrackerServer;

    const swarm = new Map<string, { complete: number; incomplete: number; name?: string }>();
    let announces = 0;

    server.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(msg);
    });
    server.on('warning', () => {
      /* ignore noisy */
    });
    server.on('start', () => {
      /* listening */
    });
    server.on('complete', (...args: unknown[]) => {
      const addr = (args[0] ?? {}) as { infoHash?: string };
      const h = normalizeHash(addr?.infoHash);
      if (!h) return;
      const cur = swarm.get(h) ?? { complete: 0, incomplete: 0 };
      cur.complete += 1;
      swarm.set(h, cur);
    });
    server.on('update', (...args: unknown[]) => {
      const addr = (args[0] ?? {}) as {
        infoHash?: string;
        complete?: number;
        incomplete?: number;
      };
      announces += 1;
      const h = normalizeHash(addr?.infoHash);
      if (!h) return;
      const cur = swarm.get(h) ?? { complete: 0, incomplete: 0 };
      if (typeof addr.complete === 'number') cur.complete = addr.complete;
      if (typeof addr.incomplete === 'number') cur.incomplete = addr.incomplete;
      swarm.set(h, cur);
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      server.on('error', finish);
      server.on('listening', () => finish());
      try {
        // Must call as method (this-binding) — detached listen loses _listenCalled
        if (settings.listenHost && settings.listenHost !== '0.0.0.0') {
          server.listen(settings.httpPort, settings.listenHost, () => finish());
        } else {
          server.listen(settings.httpPort, () => finish());
        }
      } catch (e) {
        finish(e);
      }
    });

    runtime = {
      server,
      settings,
      startedAt: new Date().toISOString(),
      announces: 0,
      swarm,
    };
    // keep announces in runtime via closure update — rebind
    runtime.announces = 0;
    const r = runtime;
    server.on('update', () => {
      r.announces += 1;
    });

    notes.push(
      tl('notes.btTracker.started', {
        port: String(settings.httpPort),
      }),
    );
    return { ok: true, notes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(tl('notes.btTracker.startFailed', { detail: msg.slice(0, 240) }));
    return {
      ok: false,
      notes,
      blocked: /EACCES|permission|root/i.test(msg),
      requiresExecute: !input.host.executeEnabled(),
    };
  }
}

export async function stopBtTracker(): Promise<{ ok: boolean; notes: string[] }> {
  if (!runtime) {
    return { ok: true, notes: [tl('notes.btTracker.notRunning')] };
  }
  const srv = runtime.server;
  runtime = null;
  await new Promise<void>((resolve) => {
    try {
      srv.close(() => resolve());
      setTimeout(() => resolve(), 2_000);
    } catch {
      resolve();
    }
  });
  return { ok: true, notes: [tl('notes.btTracker.stopped')] };
}

type TorrentHint = {
  infoHash?: string;
  name?: string;
  shareId?: string;
  seedStatus?: string;
  seeders?: number;
  leechers?: number;
};

function mergeTorrentRow(
  byHash: Map<string, BtTrackerTorrentRow>,
  row: BtTrackerTorrentRow,
  preferLive = false,
): void {
  const h = row.infoHash.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(h)) return;
  const prev = byHash.get(h);
  if (!prev) {
    byHash.set(h, { ...row, infoHash: h });
    return;
  }
  byHash.set(h, {
    infoHash: h,
    name: row.name || prev.name,
    seeders: preferLive ? row.seeders : Math.max(prev.seeders, row.seeders),
    leechers: preferLive ? row.leechers : Math.max(prev.leechers, row.leechers),
    completed: row.completed ?? prev.completed,
    shareId: row.shareId || prev.shareId,
    seedStatus: row.seedStatus || prev.seedStatus,
    uploadSpeed: row.uploadSpeed ?? prev.uploadSpeed,
    downloadSpeed: row.downloadSpeed ?? prev.downloadSpeed,
  });
}

/**
 * List tracked torrents — prefers live `server.torrents` swarm counts,
 * falls back to announce-event map, then optional share/seed hints.
 */
export function listBtTrackerTorrents(opts?: {
  /** Known shares/seeds to surface even before first announce */
  hints?: TorrentHint[];
}): BtTrackerTorrentRow[] {
  const byHash = new Map<string, BtTrackerTorrentRow>();

  // 1) Live bittorrent-tracker swarms (most accurate)
  if (runtime?.server) {
    for (const row of readServerTorrents(runtime.server)) {
      mergeTorrentRow(byHash, row, true);
    }
  }

  // 2) Event-driven map
  if (runtime) {
    for (const [infoHash, s] of runtime.swarm) {
      mergeTorrentRow(byHash, {
        infoHash,
        seeders: s.complete,
        leechers: s.incomplete,
        name: s.name,
      });
    }
  }

  // 3) Hints from shares / local seeder
  for (const h of opts?.hints ?? []) {
    if (!h.infoHash) continue;
    mergeTorrentRow(byHash, {
      infoHash: h.infoHash,
      name: h.name,
      seeders: h.seeders ?? 0,
      leechers: h.leechers ?? 0,
      shareId: h.shareId,
      seedStatus: h.seedStatus,
    });
  }

  return [...byHash.values()].sort((a, b) => a.infoHash.localeCompare(b.infoHash));
}

/**
 * Async list: same as listBtTrackerTorrents, then HTTP scrape when detached
 * (or when caller forces scrape) to refresh seeders/leechers from tracker.
 */
export async function listBtTrackerTorrentsAsync(opts?: {
  hints?: TorrentHint[];
  dataDir?: string;
  /** Force scrape even if in-process (default: only when not in-process) */
  forceScrape?: boolean;
}): Promise<BtTrackerTorrentRow[]> {
  const base = listBtTrackerTorrents({ hints: opts?.hints });
  const needScrape =
    opts?.forceScrape || (!isBtTrackerRunning() && Boolean(opts?.dataDir));
  if (!needScrape || !opts?.dataDir) return base;

  const hashes = [
    ...new Set(
      [
        ...base.map((r) => r.infoHash),
        ...(opts.hints ?? []).map((h) => h.infoHash || ''),
      ]
        .map((h) => h.toLowerCase())
        .filter((h) => /^[a-f0-9]{40}$/.test(h)),
    ),
  ];
  if (!hashes.length) return base;

  try {
    const { scrapeLocalHttpPort } = await import('./scrape.js');
    const settings = loadBtTrackerSettings(opts.dataDir);
    const scraped = await scrapeLocalHttpPort(settings.httpPort, hashes);
    if (!scraped.length) return base;
    const byHash = new Map(base.map((r) => [r.infoHash, r]));
    for (const s of scraped) {
      mergeTorrentRow(byHash, s, true);
    }
    return [...byHash.values()].sort((a, b) => a.infoHash.localeCompare(b.infoHash));
  } catch {
    return base;
  }
}

function readServerTorrents(server: TrackerServer): BtTrackerTorrentRow[] {
  const map = server.torrents;
  if (!map || typeof map !== 'object') return [];
  const out: BtTrackerTorrentRow[] = [];
  for (const [rawHash, swarm] of Object.entries(map)) {
    const h = normalizeHash(rawHash);
    if (!h) continue;
    const complete = Number(swarm?.complete) || 0;
    const incomplete = Number(swarm?.incomplete) || 0;
    out.push({
      infoHash: h,
      seeders: complete,
      leechers: incomplete,
    });
  }
  return out;
}

/** HTTP GET localhost /stats.json for detached tracker aggregate stats */
async function scrapeLocalTrackerStats(
  httpPort: number,
): Promise<BtTrackerStatus['stats'] | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1_500);
  try {
    const res = await fetch(`http://127.0.0.1:${httpPort}/stats.json`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as {
      torrents?: number;
      peersAll?: number;
      peersSeederOnly?: number;
      peersLeecherOnly?: number;
    };
    return {
      torrents: Number(j.torrents) || 0,
      peers: Number(j.peersAll) || 0,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

export function patchBtTrackerSettings(
  dataDir: string,
  patch: Partial<BtTrackerSettings>,
): BtTrackerSettings {
  return saveBtTrackerSettings(dataDir, patch);
}

function normalizeHash(h: unknown): string | null {
  if (!h) return null;
  if (Buffer.isBuffer(h)) return h.toString('hex');
  const s = String(h).trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(s)) return s;
  try {
    return Buffer.from(s, 'hex').toString('hex');
  } catch {
    return s.slice(0, 40) || null;
  }
}
