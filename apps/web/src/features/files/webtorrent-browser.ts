/**
 * Browser WebTorrent client for public share BT downloads.
 *
 * Self-hosted: loads the official browser build shipped with the `webtorrent`
 * npm package (vite copies it into our assets — no esm.sh / CDN).
 *
 * Tracker: pass same-origin `wss://panel/api/v1/public/bt-tracker` via
 * `announce` so HTTPS pages can discover the panel seeder (mixed-content
 * blocks raw ws://:8000).
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
  blob?: (opts?: unknown) => Promise<Blob>;
  arrayBuffer?: (opts?: unknown) => Promise<ArrayBuffer>;
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

type WtCtor = new (opts?: Record<string, unknown>) => WtClient;

/** Vite emits this as a same-origin /assets/*.js file from our node_modules. */
// @ts-expect-error Vite ?url import
import webtorrentMinUrl from 'webtorrent/dist/webtorrent.min.js?url';

let loadPromise: Promise<WtCtor> | null = null;

export function isBrowserWebTorrentSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof WebSocket === 'undefined') return false;
  const rtc =
    (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection ||
    (window as unknown as { webkitRTCPeerConnection?: unknown })
      .webkitRTCPeerConnection;
  return Boolean(rtc);
}

/**
 * Load self-hosted WebTorrent UMD build (window.WebTorrent).
 * No third-party CDN — asset is part of the ysk-server web build.
 */
async function loadWebTorrentCtor(): Promise<WtCtor> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const w = window as unknown as { WebTorrent?: WtCtor };
      if (typeof w.WebTorrent === 'function') {
        return w.WebTorrent;
      }
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(
          'script[data-ysk-webtorrent="1"]',
        ) as HTMLScriptElement | null;
        if (existing) {
          if (typeof w.WebTorrent === 'function') {
            resolve();
            return;
          }
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () =>
            reject(new Error('WebTorrent script failed')),
          );
          return;
        }
        const s = document.createElement('script');
        s.src = webtorrentMinUrl as string;
        s.async = true;
        s.dataset.yskWebtorrent = '1';
        s.onload = () => resolve();
        s.onerror = () =>
          reject(new Error('Failed to load self-hosted WebTorrent build'));
        document.head.appendChild(s);
      });
      if (typeof w.WebTorrent !== 'function') {
        throw new Error('WebTorrent global missing after load');
      }
      return w.WebTorrent;
    })();
  }
  return loadPromise;
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

/** Same-origin tracker URL for the current page (wss on HTTPS). */
export function defaultBrowserTrackerAnnounce(): string[] {
  if (typeof window === 'undefined') return [];
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return [`${scheme}://${window.location.host}/api/v1/public/bt-tracker`];
}

async function fileToBlob(file: WtFile): Promise<Blob> {
  if (typeof file.blob === 'function') {
    return file.blob();
  }
  if (typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    return new Blob([ab]);
  }
  if (typeof file.getBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      file.getBlob!((err, b) => {
        if (err || !b) reject(err || new Error('empty blob'));
        else resolve(b);
      });
    });
  }
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

/**
 * Download first file via browser WebTorrent using **our** tracker proxy.
 */
export async function downloadWithBrowserWebTorrent(input: {
  magnetOrTorrent: string;
  torrentUrl?: string;
  onProgress?: (p: BrowserBtProgress) => void;
  signal?: AbortSignal;
  preferLargest?: boolean;
  /** Same-origin tracker(s); defaults to /api/v1/public/bt-tracker */
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

  const announce =
    input.announce?.length ? input.announce : defaultBrowserTrackerAnnounce();

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
    client = new WebTorrent({ utp: false });
    notes.push(`tracker=${announce.join(',') || 'none'}`);

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
        // Force our self-hosted tracker (same-origin proxy) so browser
        // discovers the panel seeder — ignores broken/external tr= in magnet.
        const t = client!.add(
          torrentId,
          { announce },
          (ready) => finish(ready || t),
        );
        t.on('error', fail);
        t.on('ready', () => finish(t));
        setTimeout(() => {
          if (t.files?.length) finish(t);
        }, 45_000);
      } catch (e) {
        fail(e);
      }
    });

    if (input.signal?.aborted) {
      cleanup();
      return { ok: false, notes: ['aborted'] };
    }

    const files = torrent.files || [];
    if (!files.length) {
      cleanup();
      return { ok: false, notes: ['no files in torrent (metadata timeout?)'] };
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

    // Wait for download complete (or long timeout)
    await new Promise<void>((resolve) => {
      if (torrent!.done || torrent!.progress >= 1) {
        resolve();
        return;
      }
      const t = setTimeout(() => resolve(), 10 * 60_000);
      torrent!.once?.('done', () => {
        clearTimeout(t);
        resolve();
      });
      torrent!.on('error', () => {
        clearTimeout(t);
        resolve();
      });
    });

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
    return { ok: false, notes: [...notes, msg.slice(0, 240)] };
  }
}
