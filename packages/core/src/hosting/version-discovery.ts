/**
 * Dynamic software version discovery — NO hardcoded "latest" version numbers.
 *
 * Runtimes: official upstream APIs (cached on disk).
 * Host services: local apt Candidate via HostSoftwareProbe.
 * UI must consume this module / API; never embed version lists in the frontend.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import type { RuntimeKind } from './runtime.js';
import { HostSoftwareProbe } from './software-probe/index.js';
import { getProbeEntry, listProbeIds } from './software-probe/registry.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CACHE_NAME = 'version-discovery.json';

export type VersionCandidate = {
  version: string;
  label: string;
  source: string;
};

export type SoftwareVersionStatus = {
  id: string;
  title: string;
  updateKind: 'runtime' | 'apt' | 'none';
  installed: boolean;
  currentVersion?: string;
  latestVersion?: string;
  upgradable: boolean;
  candidates: VersionCandidate[];
  packageName?: string;
  source?: string;
  fetchedAt?: string;
  notes: string[];
};

type DiscoveryCache = {
  at: number;
  byId: Record<
    string,
    {
      latestVersion?: string;
      candidates: VersionCandidate[];
      source?: string;
      at: number;
    }
  >;
};

const RUNTIME_IDS = new Set<string>([
  'node',
  'php',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'bun',
]);

function readCache(dataDir: string): DiscoveryCache {
  const p = join(dataDir, 'cache', CACHE_NAME);
  try {
    if (!existsSync(p)) return { at: 0, byId: {} };
    const j = JSON.parse(readFileSync(p, 'utf8')) as DiscoveryCache;
    return j?.byId ? j : { at: 0, byId: {} };
  } catch {
    return { at: 0, byId: {} };
  }
}

function writeCache(dataDir: string, cache: DiscoveryCache): void {
  try {
    const dir = join(dataDir, 'cache');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CACHE_NAME), JSON.stringify(cache, null, 2));
  } catch {
    /* ignore disk errors */
  }
}

export function cmpSemver(a: string, b: string): number {
  const na = a.replace(/^v/i, '').replace(/^go/i, '').replace(/^bun-v/i, '').toLowerCase();
  const nb = b.replace(/^v/i, '').replace(/^go/i, '').replace(/^bun-v/i, '').toLowerCase();
  if (na === 'latest' || na === 'stable' || na === 'nightly' || na === 'beta') {
    if (na === nb) return 0;
    // channel names: prefer stable/latest over numbered only when comparing channels
    if (nb === 'latest' || nb === 'stable') return na === 'stable' || na === 'latest' ? 0 : -1;
  }
  if (nb === 'latest' || nb === 'stable' || nb === 'nightly' || nb === 'beta') return -1;
  const pa = na.split(/[.+_-]/).map((x) => parseInt(x, 10) || 0);
  const pb = nb.split(/[.+_-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'ysk-server-version-discovery/1',
        Accept: 'application/json, text/plain, */*',
      },
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

function uniqCandidates(list: VersionCandidate[]): VersionCandidate[] {
  const seen = new Set<string>();
  const out: VersionCandidate[] = [];
  for (const c of list) {
    const k = c.version.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Discover installable versions from upstream (no hardcoded version numbers). */
export async function discoverRuntimeVersions(
  kind: RuntimeKind,
): Promise<{ latestVersion?: string; candidates: VersionCandidate[]; source?: string; notes: string[] }> {
  const notes: string[] = [];
  const candidates: VersionCandidate[] = [];
  let latestVersion: string | undefined;
  let source: string | undefined;

  if (kind === 'node') {
    const j = (await fetchJson('https://nodejs.org/dist/index.json')) as
      | Array<{ version?: string; lts?: string | false }>
      | null;
    if (!Array.isArray(j) || !j.length) {
      notes.push('nodejs.org/dist/index.json unavailable');
    } else {
      source = 'nodejs.org/dist/index.json';
      const majors = new Map<string, { full: string; lts: boolean }>();
      for (const row of j) {
        const full = (row.version || '').replace(/^v/, '');
        const major = full.split('.')[0];
        if (!major || !full) continue;
        if (!majors.has(major)) {
          majors.set(major, { full, lts: Boolean(row.lts) });
        }
      }
      // Prefer newest LTS as latest; else newest current
      const ltsMajors = [...majors.entries()].filter(([, v]) => v.lts);
      const pick =
        ltsMajors.sort((a, b) => cmpSemver(b[1].full, a[1].full))[0] ??
        [...majors.entries()].sort((a, b) => cmpSemver(b[1].full, a[1].full))[0];
      if (pick) latestVersion = pick[0]; // major pin for panel install
      // Offer recent majors (dynamic from index, not a fixed list)
      const sorted = [...majors.entries()]
        .sort((a, b) => cmpSemver(b[1].full, a[1].full))
        .slice(0, 8);
      for (const [major, info] of sorted) {
        candidates.push({
          version: major,
          label: info.lts ? `${major} (LTS · ${info.full})` : `${major} (${info.full})`,
          source,
        });
      }
    }
  } else if (kind === 'go') {
    const j = (await fetchJson('https://go.dev/dl/?mode=json')) as
      | Array<{ version?: string; stable?: boolean }>
      | null;
    if (!Array.isArray(j) || !j.length) {
      notes.push('go.dev/dl/?mode=json unavailable');
    } else {
      source = 'go.dev/dl';
      const stables = j.filter((x) => x.stable && x.version);
      const pool = stables.length ? stables : j;
      const fulls: string[] = [];
      for (const row of pool) {
        const v = (row.version || '').replace(/^go/, '');
        if (/^\d+\.\d+(\.\d+)?$/.test(v)) fulls.push(v.includes('.') && v.split('.').length === 2 ? `${v}.0` : v.match(/^\d+\.\d+\.\d+/)?.[0] || v);
      }
      // Prefer full x.y.z
      const patches = fulls
        .map((v) => v.match(/^(\d+\.\d+\.\d+)/)?.[1] || v)
        .filter(Boolean);
      patches.sort((a, b) => cmpSemver(a, b));
      // Candidates + latest use **minor** pins (1.26) — same SSOT as
      // /usr/local/ysk/go/<minor> and probe 已就緒. Full patch only in label;
      // install script resolves go1.x.y.z tarball from go.dev at apply time.
      const byMinor = new Map<string, string>();
      for (const p of patches) {
        const minor = p.match(/^(\d+\.\d+)/)?.[1];
        if (!minor) continue;
        const prev = byMinor.get(minor);
        if (!prev || cmpSemver(p, prev) > 0) byMinor.set(minor, p);
      }
      const minors = [...byMinor.entries()].sort((a, b) => cmpSemver(a[1], b[1])).reverse();
      if (minors.length) {
        latestVersion = minors[0]![0]; // e.g. 1.26
      }
      for (const [minor, full] of minors.slice(0, 12)) {
        candidates.push({
          version: minor,
          label: `${minor} (go${full})`,
          source,
        });
      }
    }
  } else if (kind === 'rust') {
    // Channel channels are not version numbers — stable tracks latest.
    // Also read stable channel version from rust-lang static when possible.
    source = 'static.rust-lang.org';
    const toml = await fetchText(
      'https://static.rust-lang.org/dist/channel-rust-stable.toml',
    );
    let stableVer: string | undefined;
    if (toml) {
      const m = toml.match(/\[pkg\.rust\][\s\S]*?version\s*=\s*"([^"]+)"/);
      stableVer = m?.[1]?.replace(/ \(.*\)$/, '').trim();
    }
    latestVersion = stableVer || 'stable';
    candidates.push({
      version: 'stable',
      label: stableVer ? `stable (${stableVer})` : 'stable',
      source,
    });
    candidates.push({ version: 'beta', label: 'beta', source: 'rustup' });
    candidates.push({ version: 'nightly', label: 'nightly', source: 'rustup' });
    if (stableVer) {
      // Offer the concrete stable pin as optional install target
      const minor = stableVer.match(/^(\d+\.\d+)/)?.[1];
      if (minor) {
        candidates.push({
          version: minor,
          label: `${minor} (from stable ${stableVer})`,
          source,
        });
      }
    }
    if (!toml) notes.push('rust stable channel toml unavailable; using channel names only');
  } else if (kind === 'bun') {
    source = 'github.com/oven-sh/bun';
    const latest = (await fetchJson(
      'https://api.github.com/repos/oven-sh/bun/releases/latest',
    )) as { tag_name?: string } | null;
    const list = (await fetchJson(
      'https://api.github.com/repos/oven-sh/bun/releases?per_page=15',
    )) as Array<{ tag_name?: string }> | null;
    const tags: string[] = [];
    if (latest?.tag_name) tags.push(latest.tag_name);
    if (Array.isArray(list)) {
      for (const r of list) if (r.tag_name) tags.push(r.tag_name);
    }
    const vers = tags
      .map((t) => t.replace(/^bun-v/i, '').replace(/^v/i, ''))
      .filter((v) => /^\d+\.\d+/.test(v));
    if (vers.length) {
      latestVersion = vers[0];
      candidates.push({ version: 'latest', label: `latest (${vers[0]})`, source });
      for (const v of vers.slice(0, 8)) {
        candidates.push({ version: v, label: v, source });
      }
    } else {
      notes.push('bun releases unavailable');
      candidates.push({ version: 'latest', label: 'latest', source });
      latestVersion = 'latest';
    }
  } else if (kind === 'kotlin') {
    source = 'github.com/JetBrains/kotlin';
    const latest = (await fetchJson(
      'https://api.github.com/repos/JetBrains/kotlin/releases/latest',
    )) as { tag_name?: string } | null;
    const list = (await fetchJson(
      'https://api.github.com/repos/JetBrains/kotlin/releases?per_page=12',
    )) as Array<{ tag_name?: string }> | null;
    const vers: string[] = [];
    if (latest?.tag_name) vers.push(latest.tag_name.replace(/^v/, ''));
    if (Array.isArray(list)) {
      for (const r of list) {
        const v = (r.tag_name || '').replace(/^v/, '');
        if (v && !vers.includes(v)) vers.push(v);
      }
    }
    if (vers.length) {
      latestVersion = vers[0];
      for (const v of vers.slice(0, 10)) {
        candidates.push({ version: v, label: v, source });
      }
    } else {
      notes.push('kotlin releases unavailable');
    }
  } else if (kind === 'java') {
    // Adoptium available LTS feature versions — dynamic, not hardcoded 17/21
    source = 'api.adoptium.net';
    const j = (await fetchJson(
      'https://api.adoptium.net/v3/info/available_releases',
    )) as {
      available_lts_releases?: number[];
      most_recent_lts?: number;
      available_releases?: number[];
    } | null;
    if (j) {
      const lts = (j.available_lts_releases ?? []).map(String);
      const recent = j.most_recent_lts != null ? String(j.most_recent_lts) : lts[lts.length - 1];
      latestVersion = recent;
      const pool = lts.length
        ? lts
        : (j.available_releases ?? []).map(String).slice(-6);
      for (const v of [...pool].reverse()) {
        candidates.push({
          version: v,
          label: lts.includes(v) ? `${v} (LTS)` : v,
          source,
        });
      }
    } else {
      notes.push('adoptium available_releases unavailable');
    }
  } else if (kind === 'php') {
    source = 'www.php.net/releases';
    const j = (await fetchJson('https://www.php.net/releases/index.php?json=1&version=8&max=20')) as
      | Record<string, { version?: string; date?: string }>
      | Array<{ version?: string }>
      | null;
    // API shape varies; also try without version filter
    let versions: string[] = [];
    if (j && !Array.isArray(j) && typeof j === 'object') {
      versions = Object.keys(j).filter((k) => /^\d+\.\d+/.test(k));
    }
    if (!versions.length) {
      const j2 = (await fetchJson('https://www.php.net/releases/index.php?json=1')) as
        | Record<string, unknown>
        | null;
      if (j2 && typeof j2 === 'object') {
        versions = Object.keys(j2).filter((k) => /^\d+\.\d+/.test(k));
      }
    }
    // Normalize to minor x.y
    const minors = new Map<string, string>();
    for (const v of versions) {
      const minor = v.match(/^(\d+\.\d+)/)?.[1];
      if (!minor) continue;
      const prev = minors.get(minor);
      if (!prev || cmpSemver(v, prev) > 0) minors.set(minor, v);
    }
    const sorted = [...minors.entries()].sort((a, b) => cmpSemver(a[0], b[0])).reverse();
    if (sorted.length) {
      latestVersion = sorted[0]![0];
      for (const [minor, full] of sorted.slice(0, 8)) {
        candidates.push({
          version: minor,
          label: `${minor} (${full})`,
          source,
        });
      }
    } else {
      notes.push('php.net releases unavailable');
    }
  } else if (kind === 'python') {
    // endoflife.date — cycle list for active python
    source = 'endoflife.date/api/python';
    const j = (await fetchJson('https://endoflife.date/api/python.json')) as
      | Array<{ cycle?: string; latest?: string; eol?: string | boolean; support?: string | boolean }>
      | null;
    if (Array.isArray(j) && j.length) {
      const active = j.filter((row) => {
        if (row.eol === false) return true;
        if (typeof row.eol === 'string') {
          const t = Date.parse(row.eol);
          return !Number.isNaN(t) && t > Date.now();
        }
        return Boolean(row.cycle);
      });
      const pool = active.length ? active : j.slice(0, 6);
      for (const row of pool) {
        const cycle = String(row.cycle || '');
        if (!/^\d+\.\d+/.test(cycle)) continue;
        candidates.push({
          version: cycle,
          label: row.latest ? `${cycle} (latest ${row.latest})` : cycle,
          source,
        });
      }
      candidates.sort((a, b) => cmpSemver(b.version, a.version));
      latestVersion = candidates[0]?.version;
    } else {
      notes.push('endoflife.date python API unavailable');
    }
  }

  return {
    latestVersion,
    candidates: uniqCandidates(candidates),
    source,
    notes,
  };
}

async function resolveInstalledRuntime(
  host: HostExecutor,
  kind: RuntimeKind,
): Promise<{ installed: boolean; currentVersion?: string; notes: string[] }> {
  const notes: string[] = [];
  // Prefer version output from common bins
  const cmds: Record<RuntimeKind, string[]> = {
    node: ['bash', '-c', 'node -v 2>/dev/null | head -1'],
    php: ['bash', '-c', 'php -r "echo PHP_MAJOR_VERSION.\'.\'.PHP_MINOR_VERSION;" 2>/dev/null'],
    python: [
      'bash',
      '-c',
      // Highest versioned binary wins (python3.14 over PATH python3 → 3.12)
      'bins=$(ls -1 /usr/bin/python[0-9]* /usr/local/bin/python[0-9]* 2>/dev/null | sed -n "s|.*/python\\([0-9][0-9]*\\.[0-9][0-9]*\\)$|\\1|p" | sort -t. -k1,1n -k2,2n | tail -1); if [ -n "$bins" ]; then echo "$bins"; else python3 -c "import sys;print(f\\"{sys.version_info.major}.{sys.version_info.minor}\\")" 2>/dev/null; fi',
    ],
    go: ['bash', '-c', 'go env GOVERSION 2>/dev/null || go version 2>/dev/null | awk \'{print $3}\''],
    rust: ['bash', '-c', 'rustc --version 2>/dev/null | awk \'{print $2}\''],
    java: ['bash', '-c', 'java -version 2>&1 | head -1'],
    kotlin: ['bash', '-c', 'kotlin -version 2>&1 | head -1'],
    bun: ['bash', '-c', 'bun --version 2>/dev/null'],
  };
  try {
    const r = await host.runCommand(cmds[kind], { timeoutMs: 8_000 });
    const out = (r.stdout || r.stderr || '').trim();
    if (!out) return { installed: false, notes };
    let currentVersion: string | undefined;
    if (kind === 'node') currentVersion = out.replace(/^v/i, '').split('.')[0];
    else if (kind === 'go')
      // Minor SSOT (1.26) — matches panel chips + managed dirs
      currentVersion = out.replace(/^go/i, '').match(/(\d+\.\d+)/)?.[1];
    else if (kind === 'java') {
      const m = out.match(/version "?(\d+)/) || out.match(/(\d+)\.\d+\.\d+/);
      currentVersion = m?.[1];
    } else if (kind === 'kotlin') {
      currentVersion = out.match(/(\d+\.\d+\.\d+)/)?.[1];
    } else if (kind === 'bun') {
      currentVersion = out.match(/(\d+\.\d+[\w.-]*)/)?.[1];
    } else if (kind === 'rust') {
      currentVersion = out.match(/(\d+\.\d+\.\d+)/)?.[1] || out;
    } else if (kind === 'python') {
      // may already be "3.14" from versioned scan, or "3.12" from python3
      currentVersion = out.match(/(\d+\.\d+)/)?.[1] || out;
    } else {
      currentVersion = out.match(/(\d+\.\d+)/)?.[1] || out;
    }
    return { installed: Boolean(currentVersion), currentVersion, notes };
  } catch {
    notes.push('install probe failed');
    return { installed: false, notes };
  }
}

function isRuntimeId(id: string): id is RuntimeKind {
  return RUNTIME_IDS.has(id);
}

/**
 * Pins from disk cache only (no network). Used by probeRuntimes so installable
 * candidates are checked after install even when listSupportedRuntimes is empty.
 */
export function getCachedRuntimeVersionPins(dataDir: string, kind: RuntimeKind): string[] {
  try {
    const cache = readCache(dataDir);
    const row = cache.byId[kind];
    if (!row?.candidates?.length) return [];
    // Prefer stable pins for probe (skip -Beta/-RC/-M so select* never throws mid-probe)
    const all = row.candidates.map((c) => c.version).filter(Boolean);
    const stable = all.filter((v) => !/-(beta|rc|alpha|m\d|snapshot)/i.test(v));
    return stable.length ? stable : all;
  } catch {
    return [];
  }
}

/**
 * Resolve full version status for one software id (runtime or apt catalog).
 */
export async function resolveSoftwareVersionStatus(input: {
  host: HostExecutor;
  dataDir: string;
  id: string;
  refresh?: boolean;
}): Promise<SoftwareVersionStatus> {
  const id = input.id.trim();
  const notes: string[] = [];

  // —— Runtime path ——
  if (isRuntimeId(id)) {
    const cache = readCache(input.dataDir);
    const cached = cache.byId[id];
    const fresh =
      cached && Date.now() - cached.at < CACHE_TTL_MS && !input.refresh;

    let latestVersion = cached?.latestVersion;
    let candidates = cached?.candidates ?? [];
    let source = cached?.source;
    let fetchedAt = cached ? new Date(cached.at).toISOString() : undefined;

    if (!fresh) {
      const disc = await discoverRuntimeVersions(id);
      notes.push(...disc.notes);
      if (disc.candidates.length || disc.latestVersion) {
        latestVersion = disc.latestVersion;
        candidates = disc.candidates;
        source = disc.source;
        cache.byId[id] = {
          latestVersion,
          candidates,
          source,
          at: Date.now(),
        };
        cache.at = Date.now();
        writeCache(input.dataDir, cache);
        fetchedAt = new Date(cache.at).toISOString();
        notes.push('fetched remote versions');
      } else if (cached) {
        notes.push('remote fetch failed; using disk cache');
        latestVersion = cached.latestVersion;
        candidates = cached.candidates;
        source = cached.source;
      } else {
        notes.push('remote versions unavailable (no cache)');
      }
    } else {
      notes.push('cache hit');
    }

    const inst = await resolveInstalledRuntime(input.host, id);
    notes.push(...inst.notes);

    let upgradable = false;
    if (inst.installed && inst.currentVersion && latestVersion) {
      // For node, compare majors; for go full/minor; for rust stable always offer if pin older
      if (id === 'rust') {
        upgradable =
          inst.currentVersion !== latestVersion &&
          latestVersion !== 'stable' &&
          cmpSemver(latestVersion, inst.currentVersion) > 0;
        // also treat any non-matching as informational
        if (latestVersion === 'stable') {
          // can't compare pin vs channel without rustc channel — leave false unless candidate newer pin
          upgradable = false;
        }
      } else {
        upgradable = cmpSemver(latestVersion, inst.currentVersion) > 0;
      }
    } else if (!inst.installed && latestVersion) {
      upgradable = false; // not installed ≠ update; UI can still install latest
    }

    return {
      id,
      title: id,
      updateKind: 'runtime',
      installed: inst.installed,
      currentVersion: inst.currentVersion,
      latestVersion,
      upgradable,
      candidates,
      source,
      fetchedAt,
      notes,
    };
  }

  // —— Apt catalog path ——
  const entry = getProbeEntry(id);
  if (!entry && !listProbeIds().includes(id)) {
    return {
      id,
      title: id,
      updateKind: 'none',
      installed: false,
      upgradable: false,
      candidates: [],
      notes: ['unknown software id'],
    };
  }

  const probe = new HostSoftwareProbe(input.host);
  const up = await probe.upgrade(id);
  const title = entry?.title ?? id;
  const candidates: VersionCandidate[] = [];
  if (up.candidateVersion && up.upgradable) {
    candidates.push({
      version: up.candidateVersion,
      label: up.candidateVersion,
      source: 'apt',
    });
  }

  return {
    id,
    title,
    updateKind: 'apt',
    installed: up.installed,
    currentVersion: up.currentVersion,
    latestVersion: up.candidateVersion || up.currentVersion,
    upgradable: up.upgradable,
    candidates,
    packageName: up.packageName,
    source: up.source,
    notes: [...notes, ...up.notes],
  };
}

export async function resolveSoftwareVersionBatch(input: {
  host: HostExecutor;
  dataDir: string;
  ids: string[];
  refresh?: boolean;
}): Promise<SoftwareVersionStatus[]> {
  const out: SoftwareVersionStatus[] = [];
  for (const id of input.ids) {
    out.push(
      await resolveSoftwareVersionStatus({
        host: input.host,
        dataDir: input.dataDir,
        id,
        refresh: input.refresh,
      }),
    );
  }
  return out;
}

/** All known software ids that support version discovery */
export function listVersionDiscoveryIds(): string[] {
  const runtimes = [...RUNTIME_IDS];
  const apt = listProbeIds().filter((id) => !RUNTIME_IDS.has(id));
  return [...runtimes, ...apt];
}
