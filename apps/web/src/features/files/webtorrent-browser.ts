/**
 * Browser WebTorrent client for public share BT downloads.
 * Loaded on demand from CDN (keeps main bundle small; no Node polyfill build).
 *
 * WebTorrent 2.x browser File API:
 *   await file.blob()  /  await file.arrayBuffer()
 * (callback-style getBlob is gone — that caused "getBlob is not a function")
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
  select?: () => void;
  /** WebTorrent 2.x */
  blob?: (opts?: unknown) => Promise<Blob>;
  arrayBuffer?: (opts?: unknown) => Promise<ArrayBuffer>;
  /** Legacy callback API (older builds) */
  getBlob?: (cb: (err: Error | null, blob?: Blob) => void) => void;
  getBlobURL?: (cb: (err: Error | null, url?: string) => void) => void;
};

type WtTorrent = {
  name?: string;
  length?: number;
  progress: number;
  numPeers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  done?: boolean;
  files: WtFile[];
  destroy: (opts?: { destroyStore?: boolean }, cb?: () => void) => void;
  on: (ev: string, fn: (...a: unknown[]) => void) => void;
  once?: (ev: string, fn: (...a: unknown[]) => void) => void;
};

type WtClient = {
  add: (
    id: string | Uint8Array | ArrayBuffer,
    opts?: Record<string, unknown>,
    cb?: (t: WtTorrent) => void,
  ) => WtTorrent;
  destroy: (cb?: (err?: Error) => void) => void;
};

/** Prefer jsDelivr UMD-style browser build for stable `new WebTorrent()`. */
const CDN_CANDIDATES = [
  'https://esm.sh/webtorrent@2.5.1/dist/webtorrent.min.js?bundle',
  'https://esm.sh/webtorrent@2.8.4?bundle',
  'https://cdn.jsdelivr.net/npm/webtorrent@2.5.1/webtorrent.min.js/+esm',
] as const;

let clientPromise: Promise<new (opts?: Record<string, unknown>) => WtClient> | null =
  null;

export function isBrowserWebTorrentSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof WebSocket === 'undefined') return false;
  const rtc =
    (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection ||
    (window as unknown as { webkitRTCPeerConnection?: unknown })
      .webkitRTCPeerConnection;
  return Boolean(rtc);
}

function pickCtor(mod: unknown): (new (opts?: Record<string, unknown>) => WtClient) | null {
  if (!mod) return null;
  const m = mod as Record<string, unknown>;
  const candidates: unknown[] = [
    m.default,
    m.WebTorrent,
    m,
    // esm.sh sometimes nests: { default: { default: Ctor } }
    (m.default as Record<string, unknown> | undefined)?.default,
    (m.default as Record<string, unknown> | undefined)?.WebTorrent,
  ];
  for (const c of candidates) {
    if (typeof c === 'function') {
      try {
        // Must be constructable with `new`
        const proto = (c as { prototype?: unknown }).prototype;
        if (proto && typeof proto === 'object') {
          return c as new (opts?: Record<string, unknown>) => WtClient;
        }
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function loadWebTorrentCtor(): Promise<
  new (opts?: Record<string, unknown>) => WtClient
> {
  if (!clientPromise) {
    clientPromise = (async () => {
      let lastErr: unknown;
      for (const url of CDN_CANDIDATES) {
        try {
          const mod = await import(/* @vite-ignore */ url);
          const Ctor = pickCtor(mod);
          if (Ctor) return Ctor;
          lastErr = new Error(`no constructor in ${url}`);
        } catch (e) {
          lastErr = e;
        }
      }
      const msg =
        lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown');
      throw new Error(`WebTorrent load failed: ${msg.slice(0, 160)}`);
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

  if (
    /[?&]xt=urn:btih:[a-f0-9]{40}\b/i.test(s) ||
    /[?&]xt=urn:btih:[a-z2-7]{32}\b/i.test(s)
  ) {
    return s;
  }

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

async function fileToBlob(file: WtFile): Promise<Blob> {
  // WebTorrent 2.x preferred
  if (typeof file.blob === 'function') {
    return file.blob();
  }
  if (typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    return new Blob([ab]);
  }
  // Legacy callback getBlob
  if (typeof file.getBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      file.getBlob!((err, b) => {
        if (err || !b) reject(err || new Error('empty blob'));
        else resolve(b);
      });
    });
  }
  // Legacy getBlobURL → fetch
  if (typeof file.getBlobURL === 'function') {
    const url = await new Promise<string>((resolve, reject) => {
      file.getBlobURL!((err, u) => {
        if (err || !u) reject(err || new Error('empty blob url'));
        else resolve(u);
      });
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`blob url fetch ${res.status}`);
    return res.blob();
  }
  throw new Error('WebTorrent file has no blob/arrayBuffer API');
}

function waitTorrentReady(torrent: WtTorrent, timeoutMs: number): Promise<void> {
  if (torrent.files?.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('timeout waiting for torrent metadata'));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const cleanup = () => {
      clearTimeout(t);
    };
    torrent.once?.('ready', onReady);
    torrent.once?.('metadata', onReady);
    torrent.on('error', onError);
    // Poll in case events already fired
    const poll = setInterval(() => {
      if (torrent.files?.length) {
        clearInterval(poll);
        cleanup();
        resolve();
      }
    }, 200);
    setTimeout(() => clearInterval(poll), timeoutMs + 50);
  });
}

function waitTorrentDone(torrent: WtTorrent, timeoutMs: number): Promise<void> {
  if (torrent.done || torrent.progress >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      // Partial download may still yield blob for small files; don't hard-fail
      resolve();
    }, timeoutMs);
    const onDone = () => {
      clearTimeout(t);
      resolve();
    };
    const onError = (e: unknown) => {
      clearTimeout(t);
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    torrent.once?.('done', onDone);
    torrent.on('error', onError);
  });
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
    // Always `new` — fixes "Class constructor cannot be invoked without 'new'"
    client = new WebTorrent({ utp: false });

    const addOpts: Record<string, unknown> = {};
    if (input.announce?.length) {
      addOpts.announce = input.announce;
    }

    torrent = await new Promise<WtTorrent>((resolve, reject) => {
      let settled = false;
      const finish = (t: WtTorrent) => {
        if (settled) return;
        settled = true;
        resolve(t);
      };
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      try {
        const t = client!.add(torrentId, addOpts, (ready) => {
          finish(ready || t);
        });
        t.on('error', fail);
        t.on('ready', () => finish(t));
        // metadata may arrive without ready callback on some builds
        setTimeout(() => {
          if (t.files?.length) finish(t);
        }, 30_000);
      } catch (e) {
        fail(e);
      }
    });

    if (input.signal?.aborted) {
      cleanup();
      return { ok: false, notes: ['aborted'] };
    }

    await waitTorrentReady(torrent, 60_000);

    const files = torrent.files || [];
    if (!files.length) {
      cleanup();
      return { ok: false, notes: ['no files in torrent'] };
    }
    let file = files[0]!;
    if (input.preferLargest !== false && files.length > 1) {
      file = files.reduce((a, b) => (b.length > a.length ? b : a));
    }
    try {
      file.select?.();
    } catch {
      /* */
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

    // Wait for content (or timeout — blob() may still stream remaining pieces)
    await waitTorrentDone(torrent, 10 * 60_000);

    if (input.signal?.aborted) {
      cleanup();
      return { ok: false, notes: ['aborted'] };
    }

    const blob = await fileToBlob(file);

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
