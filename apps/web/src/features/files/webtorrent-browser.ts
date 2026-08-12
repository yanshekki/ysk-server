/**
 * Browser WebTorrent client for public share BT downloads.
 * Loaded on demand from CDN (keeps main bundle small; no Node polyfill build).
 */

export type BrowserBtProgress = {
  progress: number;
  peers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  length: number;
  name?: string;
};

export type BrowserBtResult = {
  ok: boolean;
  blob?: Blob;
  name?: string;
  notes: string[];
};

type WtFile = {
  name: string;
  length: number;
  getBlob: (cb: (err: Error | null, blob?: Blob) => void) => void;
};

type WtTorrent = {
  name?: string;
  length?: number;
  progress: number;
  numPeers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  files: WtFile[];
  destroy: (opts?: { destroyStore?: boolean }, cb?: () => void) => void;
  on: (ev: string, fn: (...a: unknown[]) => void) => void;
};

type WtClient = {
  add: (
    id: string,
    opts?: Record<string, unknown>,
    cb?: (t: WtTorrent) => void,
  ) => WtTorrent;
  destroy: (cb?: (err?: Error) => void) => void;
};

const CDN_URL = 'https://esm.sh/webtorrent@2.8.4?bundle';

let clientPromise: Promise<new () => WtClient> | null = null;

export function isBrowserWebTorrentSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof WebSocket === 'undefined') return false;
  // RTCPeerConnection required for pure browser peers
  const rtc =
    (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection ||
    (window as unknown as { webkitRTCPeerConnection?: unknown }).webkitRTCPeerConnection;
  return Boolean(rtc);
}

async function loadWebTorrentCtor(): Promise<new () => WtClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = (await import(/* @vite-ignore */ CDN_URL)) as {
        default?: new () => WtClient;
      } & (new () => WtClient);
      const Ctor = (mod.default ?? mod) as new () => WtClient;
      if (typeof Ctor !== 'function') {
        throw new Error('WebTorrent module has no constructor');
      }
      return Ctor;
    })();
  }
  return clientPromise;
}

/**
 * Normalize magnet so parse-torrent / WebTorrent accept it.
 * Legacy magnets used URLSearchParams which encoded `xt=urn%3Abtih%3A…` — invalid.
 */
export function normalizeMagnetUri(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-f0-9]{40}$/i.test(s)) return s.toLowerCase();
  if (!s.toLowerCase().startsWith('magnet:')) return s;

  // Already has a good xt form
  if (/[?&]xt=urn:btih:[a-f0-9]{40}\b/i.test(s) || /[?&]xt=urn:btih:[a-z2-7]{32}\b/i.test(s)) {
    return s;
  }

  // Recover hash from percent-encoded xt=urn%3Abtih%3A…
  const m =
    /[?&]xt=urn%3Abtih%3A([a-f0-9]{40})/i.exec(s) ||
    /[?&]xt=urn%3Abtih%3A([a-z2-7]{32})/i.exec(s) ||
    /[?&]xt=urn:btih:([a-f0-9]{40})/i.exec(s) ||
    /[?&]xt=urn:btih:([a-z2-7]{32})/i.exec(s);
  if (!m?.[1]) return s;

  const hash = m[1].toLowerCase();
  const parts = [`xt=urn:btih:${hash}`];

  try {
    const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : '';
    const params = new URLSearchParams(q);
    const dn = params.get('dn');
    if (dn) parts.push(`dn=${encodeURIComponent(dn)}`);
    for (const tr of params.getAll('tr')) {
      if (tr) parts.push(`tr=${encodeURIComponent(tr)}`);
    }
  } catch {
    /* keep minimal magnet */
  }
  return `magnet:?${parts.join('&')}`;
}

/**
 * Download first file of a magnet (or torrent URL) via browser WebTorrent.
 * Prefer absolute .torrent HTTP URL when available (metadata + trackers without DHT).
 */
export async function downloadWithBrowserWebTorrent(input: {
  magnetOrTorrent: string;
  /** Preferred: absolute URL to .torrent (uses server trackers in the file) */
  torrentUrl?: string;
  onProgress?: (p: BrowserBtProgress) => void;
  signal?: AbortSignal;
  /** Prefer largest file when multi-file torrent */
  preferLargest?: boolean;
  /** Extra announce trackers (e.g. ws://host:port) when magnet lacks them */
  announce?: string[];
}): Promise<BrowserBtResult> {
  const notes: string[] = [];
  if (!isBrowserWebTorrentSupported()) {
    return { ok: false, notes: ['webrtc unsupported'] };
  }

  const magnet = normalizeMagnetUri(input.magnetOrTorrent);
  const torrentUrl = String(input.torrentUrl || '').trim();
  // Prefer .torrent file (has full metadata + announce list from our tracker)
  const torrentId = torrentUrl || magnet;
  if (!torrentId) {
    return { ok: false, notes: ['empty magnet'] };
  }

  let client: WtClient | null = null;
  let torrent: WtTorrent | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    try {
      torrent?.destroy?.({ destroyStore: true });
    } catch {
      /* */
    }
    try {
      client?.destroy?.();
    } catch {
      /* */
    }
    torrent = null;
    client = null;
  };

  if (input.signal?.aborted) {
    return { ok: false, notes: ['aborted'] };
  }

  const onAbort = () => {
    cleanup();
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const WebTorrent = await loadWebTorrentCtor();
    client = new WebTorrent();
    const addOpts: Record<string, unknown> = {};
    if (input.announce?.length) {
      addOpts.announce = input.announce;
    }
    torrent = await new Promise<WtTorrent>((resolve, reject) => {
      const t = client!.add(torrentId, addOpts, (ready) => {
        resolve(ready || t);
      });
      t.on('error', (e: unknown) => {
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      // timeout for metadata
      setTimeout(() => {
        if (t.files?.length) resolve(t);
      }, 45_000);
    });

    if (input.signal?.aborted) {
      cleanup();
      return { ok: false, notes: ['aborted'] };
    }

    const files = torrent.files || [];
    if (!files.length) {
      cleanup();
      return { ok: false, notes: ['no files in torrent'] };
    }
    let file = files[0]!;
    if (input.preferLargest !== false && files.length > 1) {
      file = files.reduce((a, b) => (b.length > a.length ? b : a));
    }

    timer = setInterval(() => {
      if (!torrent) return;
      input.onProgress?.({
        progress: Number(torrent.progress) || 0,
        peers: Number(torrent.numPeers) || 0,
        downloadSpeed: Number(torrent.downloadSpeed) || 0,
        uploadSpeed: Number(torrent.uploadSpeed) || 0,
        downloaded: Number(torrent.downloaded) || 0,
        length: Number(torrent.length) || file.length || 0,
        name: file.name || torrent.name,
      });
    }, 500);

    const blob = await new Promise<Blob>((resolve, reject) => {
      file.getBlob((err, b) => {
        if (err || !b) reject(err || new Error('empty blob'));
        else resolve(b);
      });
    });

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    input.onProgress?.({
      progress: 1,
      peers: Number(torrent.numPeers) || 0,
      downloadSpeed: 0,
      uploadSpeed: Number(torrent.uploadSpeed) || 0,
      downloaded: Number(torrent.downloaded) || blob.size,
      length: blob.size,
      name: file.name,
    });

    // Keep seeding briefly then destroy (guest page)
    setTimeout(() => cleanup(), 3_000);
    input.signal?.removeEventListener('abort', onAbort);
    notes.push('webtorrent browser download ok');
    return { ok: true, blob, name: file.name, notes };
  } catch (e) {
    cleanup();
    input.signal?.removeEventListener('abort', onAbort);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, notes: [msg.slice(0, 240)] };
  }
}
