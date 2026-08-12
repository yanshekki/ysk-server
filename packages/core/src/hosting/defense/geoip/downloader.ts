import { tl } from 'ysk-server-shared';
/**
 * Download GeoIP MMDB files into dataDir/geoip with fail-soft (keep old on error).
 * Supports gzip (.mmdb.gz) for DB-IP City Lite.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolveGeoipSources, type GeoipSource } from './providers.js';
import type { GeoipMetaFile } from './types.js';

export function geoipDir(dataDir: string): string {
  return join(dataDir, 'geoip');
}

export function metaPath(dataDir: string): string {
  return join(geoipDir(dataDir), 'meta.json');
}

export function loadGeoipMeta(dataDir: string): GeoipMetaFile | null {
  try {
    const p = metaPath(dataDir);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as GeoipMetaFile;
  } catch {
    return null;
  }
}

export function saveGeoipMeta(dataDir: string, meta: GeoipMetaFile): void {
  mkdirSync(geoipDir(dataDir), { recursive: true });
  writeFileSync(metaPath(dataDir), JSON.stringify(meta, null, 2), 'utf8');
}

async function downloadOne(
  src: GeoipSource,
  dir: string,
): Promise<GeoipMetaFile['files'][0]> {
  const dest = join(dir, src.filename);
  const tmp = `${dest}.tmp`;
  const started = new Date().toISOString();
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'ysk-server-geoip/1.0' },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} for ${src.filename}`);
    }
    const etag = res.headers.get('etag') ?? undefined;
    const nodeStream = Readable.fromWeb(
      res.body as import('stream/web').ReadableStream,
    );
    const useGzip =
      src.gzip ||
      /\.gz(\?|$)/i.test(src.url) ||
      (res.headers.get('content-encoding') || '').includes('gzip') ||
      (res.headers.get('content-type') || '').includes('gzip');

    if (useGzip) {
      await pipeline(nodeStream, createGunzip(), createWriteStream(tmp));
    } else {
      await pipeline(nodeStream, createWriteStream(tmp));
    }
    const st = statSync(tmp);
    if (st.size < 1024) {
      throw new Error(tl('notes.auto.t0775', { v0: (st.size) }));
    }
    renameSync(tmp, dest);
    return {
      filename: src.filename,
      url: src.url.replace(/token=[^&]+/i, 'token=***'),
      downloadedAt: started,
      bytes: st.size,
      etag,
      ok: true,
    };
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return {
      filename: src.filename,
      url: src.url.replace(/token=[^&]+/i, 'token=***'),
      downloadedAt: started,
      bytes: existsSync(dest) ? statSync(dest).size : 0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function updateGeoipDatabases(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  ok: boolean;
  meta: GeoipMetaFile;
  notes: string[];
}> {
  const dir = geoipDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const { provider, sources } = resolveGeoipSources(env);
  const prev = loadGeoipMeta(dataDir);
  const files: GeoipMetaFile['files'] = [];
  const notes: string[] = [];
  const okFiles = new Set<string>();

  for (const src of sources) {
    // City lite has primary + fallback same filename — skip if already ok
    if (okFiles.has(src.filename)) {
      notes.push(tl('notes.auto.t0776', { v0: (src.filename) }));
      continue;
    }
    const r = await downloadOne(src, dir);
    if (r.ok) {
      okFiles.add(src.filename);
      files.push(r);
      notes.push(tl('notes.auto.t0777', { v0: (r.filename), v1: (r.bytes) }));
    } else {
      // Only record last failure for this filename if never succeeded this run
      const prevFail = files.find((f) => f.filename === src.filename && !f.ok);
      if (prevFail) {
        prevFail.error = r.error;
        prevFail.url = r.url;
      } else {
        files.push(r);
      }
      notes.push(
        tl('notes.auto.t0778', { v0: (r.filename), v1: (r.error), v2: (existsSync(join(dir, src.filename)) ? tl('notes.tpl.keepOldDb') : '') }),
      );
    }
  }

  const anyOk = files.some((f) => f.ok) || sources.some((s) => existsSync(join(dir, s.filename)));
  const attrs = [
    ...new Set(sources.map((s) => s.attribution).filter(Boolean)),
  ];
  const meta: GeoipMetaFile = {
    provider,
    files,
    lastAttemptAt: new Date().toISOString(),
    lastSuccessAt: files.some((f) => f.ok)
      ? new Date().toISOString()
      : prev?.lastSuccessAt,
    lastError:
      files
        .filter((f) => !f.ok)
        .map((f) => f.error)
        .filter(Boolean)
        .join('; ') || undefined,
    attribution: attrs.join(' · ') || undefined,
  };
  saveGeoipMeta(dataDir, meta);

  return { ok: anyOk, meta, notes };
}

export function listGeoipSourceStatus(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { provider, sources } = resolveGeoipSources(env);
  const dir = geoipDir(dataDir);
  // Dedupe by filename for status display
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    if (seen.has(s.filename)) return false;
    seen.add(s.filename);
    return true;
  });
  return {
    provider,
    sources: unique.map((s) => {
      const p = join(dir, s.filename);
      const present = existsSync(p);
      let mtime: string | undefined;
      let bytes: number | undefined;
      if (present) {
        const st = statSync(p);
        mtime = st.mtime.toISOString();
        bytes = st.size;
      }
      return {
        filename: s.filename,
        url: s.url.replace(/token=[^&]+/i, 'token=***'),
        license: s.license,
        updateHint: s.updateHint,
        present,
        mtime,
        bytes,
        attribution: s.attribution,
      };
    }),
  };
}
