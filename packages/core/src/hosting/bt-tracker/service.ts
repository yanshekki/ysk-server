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

type TrackerServer = {
  http?: { address?: () => { port: number } | string | null; close: (cb?: () => void) => void };
  udp?: { close: (cb?: () => void) => void };
  ws?: { close: (cb?: () => void) => void };
  close: (cb?: (err?: Error) => void) => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  listen: (port: number, host?: string | (() => void), cb?: () => void) => void;
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
  const running = isBtTrackerRunning();
  if (!input.host.executeEnabled()) {
    notes.push(tl('notes.btTracker.needExecute'));
  }
  const announceUrls = buildAnnounceList(settings, {
    publicHost: input.publicHostHint || settings.publicAnnounceHost || undefined,
  });
  let stats: BtTrackerStatus['stats'];
  if (runtime) {
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
  return {
    installed,
    running,
    pid: running ? process.pid : null,
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

export function listBtTrackerTorrents(): BtTrackerTorrentRow[] {
  if (!runtime) return [];
  const out: BtTrackerTorrentRow[] = [];
  for (const [infoHash, s] of runtime.swarm) {
    out.push({
      infoHash,
      seeders: s.complete,
      leechers: s.incomplete,
      name: s.name,
    });
  }
  return out;
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
