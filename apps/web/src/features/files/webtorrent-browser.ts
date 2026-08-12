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
 * Download first file of a magnet (or torrent URL) via browser WebTorrent.
 * Caller should destroy via returned `abort`.
 */
export async function downloadWithBrowserWebTorrent(input: {
  magnetOrTorrent: string;
  onProgress?: (p: BrowserBtProgress) => void;
  signal?: AbortSignal;
  /** Prefer largest file when multi-file torrent */
  preferLargest?: boolean;
}): Promise<BrowserBtResult> {
  const notes: string[] = [];
  if (!isBrowserWebTorrentSupported()) {
    return { ok: false, notes: ['webrtc unsupported'] };
  }
  if (!input.magnetOrTorrent?.trim()) {
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
    torrent = await new Promise<WtTorrent>((resolve, reject) => {
      const t = client!.add(input.magnetOrTorrent, {}, (ready) => {
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
