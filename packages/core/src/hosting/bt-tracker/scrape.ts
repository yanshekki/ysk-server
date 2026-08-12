/**
 * HTTP scrape against a BitTorrent tracker (local or remote announce URL).
 * Used when tracker runs detached / off-process so we still get seeders/leechers.
 */
import type { BtTrackerTorrentRow } from '@ysk/shared';

function hexToRawInfoHash(hex: string): Buffer | null {
  const h = String(hex || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(h)) return null;
  return Buffer.from(h, 'hex');
}

/** Encode 20-byte info_hash for tracker query (percent-encode each byte). */
export function encodeInfoHashQuery(hex: string): string | null {
  const buf = hexToRawInfoHash(hex);
  if (!buf) return null;
  let out = '';
  for (const b of buf) {
    out += `%${b.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  return out;
}

/**
 * Build scrape URL from announce URL + info hashes.
 * http://host:port/announce → http://host:port/scrape
 */
export function scrapeUrlFromAnnounce(
  announceUrl: string,
  infoHashes: string[],
): string | null {
  const base = String(announceUrl || '').trim();
  if (!base.startsWith('http://') && !base.startsWith('https://')) return null;
  let scrape = base.replace(/\/announce\/?$/i, '/scrape');
  if (scrape === base) {
    // already /scrape or path without announce
    if (!/\/scrape\/?$/i.test(scrape)) {
      scrape = base.replace(/\/?$/, '/scrape');
    }
  }
  const qs: string[] = [];
  for (const h of infoHashes.slice(0, 40)) {
    const enc = encodeInfoHashQuery(h);
    if (enc) qs.push(`info_hash=${enc}`);
  }
  if (!qs.length) return null;
  return `${scrape}?${qs.join('&')}`;
}

type BencodeFiles = Record<
  string,
  { complete?: number; incomplete?: number; downloaded?: number }
>;

/**
 * Parse bencoded scrape body. Minimal decoder for files{...} only when bencode pkg present.
 */
async function decodeScrapeBody(
  buf: Buffer,
): Promise<Map<string, { complete: number; incomplete: number; downloaded?: number }>> {
  const out = new Map<string, { complete: number; incomplete: number; downloaded?: number }>();
  try {
    const bencode = (await import('bencode')) as {
      default?: { decode: (b: Buffer) => unknown };
      decode?: (b: Buffer) => unknown;
    };
    const decode = bencode.decode ?? bencode.default?.decode;
    if (!decode) return out;
    const root = decode(buf) as {
      files?: BencodeFiles | Map<Buffer, { complete?: number; incomplete?: number; downloaded?: number }>;
    };
    const files = root?.files;
    if (!files) return out;

    if (files instanceof Map) {
      for (const [k, v] of files) {
        const hex = Buffer.isBuffer(k)
          ? k.toString('hex')
          : Buffer.from(String(k), 'binary').toString('hex');
        out.set(hex.toLowerCase(), {
          complete: Number(v?.complete) || 0,
          incomplete: Number(v?.incomplete) || 0,
          downloaded: Number(v?.downloaded) || undefined,
        });
      }
      return out;
    }

    // object keys may be binary strings
    for (const [k, v] of Object.entries(files)) {
      let hex: string;
      try {
        hex = Buffer.from(k, 'binary').toString('hex');
        if (hex.length !== 40) hex = Buffer.from(k, 'utf8').toString('hex');
      } catch {
        continue;
      }
      if (hex.length !== 40) continue;
      out.set(hex.toLowerCase(), {
        complete: Number(v?.complete) || 0,
        incomplete: Number(v?.incomplete) || 0,
        downloaded: Number(v?.downloaded) || undefined,
      });
    }
  } catch {
    /* leave empty */
  }
  return out;
}

/**
 * Scrape one or more infohashes from a tracker HTTP endpoint.
 */
export async function scrapeTrackerHttp(input: {
  announceUrl: string;
  infoHashes: string[];
  timeoutMs?: number;
}): Promise<BtTrackerTorrentRow[]> {
  const hashes = [...new Set(input.infoHashes.map((h) => h.toLowerCase()))].filter((h) =>
    /^[a-f0-9]{40}$/.test(h),
  );
  if (!hashes.length) return [];
  const url = scrapeUrlFromAnnounce(input.announceUrl, hashes);
  if (!url) return [];

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 2_500);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/octet-stream' },
    });
    if (!res.ok) return [];
    const ab = await res.arrayBuffer();
    const decoded = await decodeScrapeBody(Buffer.from(ab));
    const rows: BtTrackerTorrentRow[] = [];
    for (const h of hashes) {
      const s = decoded.get(h);
      if (!s) continue;
      rows.push({
        infoHash: h,
        seeders: s.complete,
        leechers: s.incomplete,
        completed: s.downloaded,
      });
    }
    return rows;
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Scrape local tracker on 127.0.0.1:port for known hashes. */
export async function scrapeLocalHttpPort(
  httpPort: number,
  infoHashes: string[],
): Promise<BtTrackerTorrentRow[]> {
  return scrapeTrackerHttp({
    announceUrl: `http://127.0.0.1:${httpPort}/announce`,
    infoHashes,
    timeoutMs: 2_000,
  });
}
