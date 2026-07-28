/**
 * Download GeoIP MMDB files into dataDir/geoip with fail-soft (keep old on error).
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    // Node 18+ fetch body is web stream — convert
    const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
    await pipeline(nodeStream, createWriteStream(tmp));
    const st = statSync(tmp);
    if (st.size < 1024) {
      throw new Error(`檔案過細（${st.size} B），可能下載失敗`);
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
      if (existsSync(tmp)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmp);
      }
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

  for (const src of sources) {
    const r = await downloadOne(src, dir);
    files.push(r);
    if (r.ok) notes.push(`已更新 ${r.filename}（${r.bytes} B）`);
    else {
      notes.push(`更新失敗 ${r.filename}：${r.error}${existsSync(join(dir, src.filename)) ? '（保留舊庫）' : ''}`);
    }
  }

  const anyOk = files.some((f) => f.ok);
  const allPresent = sources.every((s) => existsSync(join(dir, s.filename)));
  const meta: GeoipMetaFile = {
    provider,
    files,
    lastAttemptAt: new Date().toISOString(),
    lastSuccessAt: anyOk
      ? new Date().toISOString()
      : prev?.lastSuccessAt,
    lastError: files.filter((f) => !f.ok).map((f) => f.error).filter(Boolean).join('; ') || undefined,
    attribution: sources.map((s) => s.attribution).filter(Boolean).join(' · ') || undefined,
  };
  saveGeoipMeta(dataDir, meta);

  return {
    ok: anyOk || allPresent,
    meta,
    notes,
  };
}

export function listGeoipSourceStatus(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const { provider, sources } = resolveGeoipSources(env);
  const dir = geoipDir(dataDir);
  return {
    provider,
    sources: sources.map((s) => {
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
