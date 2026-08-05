/**
 * Optional remote "latest" hints for runtimes (best-effort, cached on disk).
 * Does not block install UI — panel supported list remains SSOT for install targets.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeKind } from './runtime.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type RuntimeLatestHint = {
  kind: RuntimeKind;
  /** Highest line from panel supported list (local SSOT) */
  panelLatest: string;
  /** Remote latest if fetch succeeded */
  remoteLatest?: string;
  /** true when remote > panelLatest by simple compare */
  newerThanPanel?: boolean;
  source?: string;
  fetchedAt?: string;
  notes: string[];
};

type CacheFile = {
  at: number;
  byKind: Partial<Record<RuntimeKind, { remote: string; source: string }>>;
};

function readCache(dataDir: string): CacheFile {
  const p = join(dataDir, 'cache', 'runtime-latest.json');
  try {
    if (!existsSync(p)) return { at: 0, byKind: {} };
    const j = JSON.parse(readFileSync(p, 'utf8')) as CacheFile;
    return j?.byKind ? j : { at: 0, byKind: {} };
  } catch {
    return { at: 0, byKind: {} };
  }
}

function writeCache(dataDir: string, cache: CacheFile): void {
  try {
    const dir = join(dataDir, 'cache');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'runtime-latest.json'), JSON.stringify(cache, null, 2));
  } catch {
    /* ignore */
  }
}

function cmpVer(a: string, b: string): number {
  const na = a.replace(/^v/i, '').toLowerCase();
  const nb = b.replace(/^v/i, '').toLowerCase();
  if (na === 'latest' || na === 'stable') return 1;
  if (nb === 'latest' || nb === 'stable') return -1;
  const pa = na.split(/[.+_-]/).map((x) => parseInt(x, 10) || 0);
  const pb = nb.split(/[.+_-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

async function fetchText(url: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'ysk-server-runtime-latest/1' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  const t = await fetchText(url);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Fetch remote latest string for a kind (best-effort). */
export async function fetchRemoteLatest(kind: RuntimeKind): Promise<{ remote: string; source: string } | null> {
  if (kind === 'node') {
    // index.json is large; use latest-v22.x SHASUMS header path or dist/index
    const j = (await fetchJson('https://nodejs.org/dist/index.json')) as
      | Array<{ version?: string; lts?: string | false }>
      | null;
    if (Array.isArray(j) && j[0]?.version) {
      const lts = j.find((x) => x.lts);
      const ver = (lts?.version || j[0].version || '').replace(/^v/, '');
      const major = ver.split('.')[0];
      return { remote: major || ver, source: 'nodejs.org/dist/index.json' };
    }
  }
  if (kind === 'php') {
    // no single JSON; skip remote
    return null;
  }
  if (kind === 'go') {
    const j = (await fetchJson('https://go.dev/dl/?mode=json')) as
      | Array<{ version?: string; stable?: boolean }>
      | null;
    if (Array.isArray(j)) {
      const st = j.find((x) => x.stable) || j[0];
      const v = (st?.version || '').replace(/^go/, '');
      // panel uses 1.22 style
      const m = v.match(/^(\d+\.\d+)/);
      return m ? { remote: m[1]!, source: 'go.dev/dl' } : null;
    }
  }
  if (kind === 'rust') {
    return { remote: 'stable', source: 'rustup (channel)' };
  }
  if (kind === 'java') {
    return { remote: '21', source: 'panel-default LTS' };
  }
  if (kind === 'kotlin') {
    const t = await fetchText(
      'https://api.github.com/repos/JetBrains/kotlin/releases/latest',
    );
    if (t) {
      try {
        const j = JSON.parse(t) as { tag_name?: string };
        const v = (j.tag_name || '').replace(/^v/, '');
        if (v) return { remote: v, source: 'github.com/JetBrains/kotlin' };
      } catch {
        /* */
      }
    }
  }
  if (kind === 'bun') {
    const t = await fetchText('https://api.github.com/repos/oven-sh/bun/releases/latest');
    if (t) {
      try {
        const j = JSON.parse(t) as { tag_name?: string };
        const v = (j.tag_name || '').replace(/^bun-v/, '').replace(/^v/, '');
        if (v) return { remote: v, source: 'github.com/oven-sh/bun' };
      } catch {
        /* */
      }
    }
  }
  if (kind === 'python') {
    return null;
  }
  return null;
}

/**
 * Build latest hint for UI: compare panel supported max vs cached remote.
 */
export async function getRuntimeLatestHint(input: {
  dataDir: string;
  kind: RuntimeKind;
  panelSupported: string[];
  /** force network refresh */
  refresh?: boolean;
}): Promise<RuntimeLatestHint> {
  const notes: string[] = [];
  const panelLatest =
    input.panelSupported.length === 0
      ? '—'
      : input.panelSupported.reduce((a, b) => (cmpVer(a, b) >= 0 ? a : b));

  const cache = readCache(input.dataDir);
  const fresh = Date.now() - cache.at < CACHE_TTL_MS && !input.refresh;
  let remote = cache.byKind[input.kind];

  if (!fresh || !remote) {
    const got = await fetchRemoteLatest(input.kind);
    if (got) {
      cache.byKind[input.kind] = got;
      cache.at = Date.now();
      writeCache(input.dataDir, cache);
      remote = got;
      notes.push('fetched remote latest');
    } else {
      notes.push('remote latest unavailable');
    }
  } else {
    notes.push('cache hit');
  }

  const remoteLatest = remote?.remote;
  const newerThanPanel =
    remoteLatest && panelLatest !== '—'
      ? cmpVer(remoteLatest, panelLatest) > 0
      : undefined;

  return {
    kind: input.kind,
    panelLatest,
    remoteLatest,
    newerThanPanel,
    source: remote?.source,
    fetchedAt: cache.at ? new Date(cache.at).toISOString() : undefined,
    notes,
  };
}
