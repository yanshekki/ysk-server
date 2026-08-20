/**
 * Official GitHub release lookup for validator client tags.
 * Fetch failures fall back to the pinned registry tag.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidatorOfficialVersionDto } from 'ysk-server-shared';
import { parseVersionParts, tagIsNewer } from './versions.js';
import { findValidatorClient } from './registry.js';

export type ClientReleaseMeta = {
  github: string;
  changelog: string;
  /** Prepended to a GitHub tag when the image tag differs (e.g. multiarch-) */
  tagPrefix?: string;
};

export const CLIENT_RELEASES: Record<string, ClientReleaseMeta> = {
  reth: {
    github: 'paradigmxyz/reth',
    changelog: 'https://github.com/paradigmxyz/reth/releases',
  },
  geth: {
    github: 'ethereum/go-ethereum',
    changelog: 'https://github.com/ethereum/go-ethereum/releases',
  },
  nethermind: {
    github: 'NethermindEth/nethermind',
    changelog: 'https://github.com/NethermindEth/nethermind/releases',
  },
  lighthouse: {
    github: 'sigp/lighthouse',
    changelog: 'https://github.com/sigp/lighthouse/releases',
  },
  prysm: {
    github: 'OffchainLabs/prysm',
    changelog: 'https://github.com/OffchainLabs/prysm/releases',
  },
  teku: {
    github: 'Consensys/teku',
    changelog: 'https://github.com/Consensys/teku/releases',
  },
  nimbus: {
    github: 'status-im/nimbus-eth2',
    changelog: 'https://github.com/status-im/nimbus-eth2/releases',
    tagPrefix: 'multiarch-',
  },
  avalanchego: {
    github: 'ava-labs/avalanchego',
    changelog: 'https://github.com/ava-labs/avalanchego/releases',
  },
  neard: {
    github: 'near/nearcore',
    changelog: 'https://github.com/near/nearcore/releases',
  },
  'cardano-node': {
    github: 'IntersectMBO/cardano-node',
    changelog: 'https://github.com/IntersectMBO/cardano-node/releases',
  },
  bitcoind: {
    github: 'bitcoin/bitcoin',
    changelog: 'https://github.com/bitcoin/bitcoin/releases',
  },
  gaiad: {
    github: 'cosmos/gaia',
    changelog: 'https://github.com/cosmos/gaia/releases',
  },
  'sui-node': {
    github: 'MystenLabs/sui',
    changelog: 'https://github.com/MystenLabs/sui/releases',
  },
  'aptos-node': {
    github: 'aptos-labs/aptos-core',
    changelog: 'https://github.com/aptos-labs/aptos-core/releases',
  },
  agave: {
    github: 'anza-xyz/agave',
    changelog: 'https://github.com/anza-xyz/agave/releases',
  },
  polkadot: {
    github: 'paritytech/polkadot-sdk',
    changelog: 'https://github.com/paritytech/polkadot-sdk/releases',
  },
};

export type RemoteTagCache = {
  at: string;
  tags: Record<string, string>;
  notes: string[];
};

export type OfficialVersionItem = ValidatorOfficialVersionDto;

export type RemoteReleasesCache = {
  at: string;
  clients: Record<
    string,
    { at: string; items: OfficialVersionItem[]; error?: string }
  >;
};

const OFFICIAL_CACHE_TTL_MS = 15 * 60_000;
const OFFICIAL_LIST_CAP = 12;

function cachePath(dataDir: string): string {
  return join(dataDir, 'validators', 'remote-tags.json');
}

function releasesCachePath(dataDir: string): string {
  return join(dataDir, 'validators', 'remote-releases.json');
}

export function loadRemoteClientTags(dataDir: string): Record<string, string> {
  const p = cachePath(dataDir);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<RemoteTagCache>;
    return raw.tags && typeof raw.tags === 'object' ? raw.tags : {};
  } catch {
    return {};
  }
}

export function saveRemoteClientTags(dataDir: string, cache: RemoteTagCache): void {
  mkdirSync(join(dataDir, 'validators'), { recursive: true });
  writeFileSync(cachePath(dataDir), `${JSON.stringify(cache, null, 2)}\n`);
}

export function loadRemoteReleases(dataDir: string): RemoteReleasesCache {
  const p = releasesCachePath(dataDir);
  if (!existsSync(p)) return { at: '', clients: {} };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<RemoteReleasesCache>;
    const clients =
      raw.clients && typeof raw.clients === 'object' ? raw.clients : {};
    return { at: String(raw.at ?? ''), clients };
  } catch {
    return { at: '', clients: {} };
  }
}

export function saveRemoteReleases(dataDir: string, cache: RemoteReleasesCache): void {
  mkdirSync(join(dataDir, 'validators'), { recursive: true });
  writeFileSync(releasesCachePath(dataDir), `${JSON.stringify(cache, null, 2)}\n`);
}

export function dockerRegistryHost(image: string): string {
  const first = String(image ?? '').trim().split('/')[0] ?? '';
  if (first.includes('.') || first.includes(':')) return first;
  return 'docker.io';
}

/** Map an official GitHub tag onto the Docker tag we can pull. Null = do not offer. */
export function dockerTagFromGit(
  clientId: string,
  gitTag: string,
  network?: string,
): string | null {
  const meta = CLIENT_RELEASES[clientId];
  if (!meta) return null;
  const raw = String(gitTag ?? '').trim();
  if (!raw || raw === 'latest' || /nightly/i.test(raw)) return null;

  if (clientId === 'sui-node') {
    if (/^testnet-v\d/.test(raw)) {
      if (network && network !== 'testnet') return null;
      return raw;
    }
    if (/^mainnet-v\d/.test(raw)) {
      if (network && network !== 'mainnet') return null;
      return raw;
    }
    const core = normalizeGithubTag(raw);
    if (!core) return null;
    const v = core.startsWith('v') ? core : `v${core}`;
    if (network === 'mainnet') return `mainnet-${v}`;
    if (network === 'testnet') return `testnet-${v}`;
    return null;
  }

  if (clientId === 'aptos-node') {
    if (/^aptos-node-v\d/.test(raw)) return raw;
    const core = normalizeGithubTag(raw);
    if (!core) return null;
    const v = core.startsWith('v') ? core : `v${core}`;
    return `aptos-node-${v}`;
  }

  if (clientId === 'polkadot') {
    return normalizeGithubTag(raw);
  }

  return normalizeGithubTag(raw, meta.tagPrefix);
}

export function compareOfficialVersions(
  a: OfficialVersionItem,
  b: OfficialVersionItem,
): number {
  if (a.prerelease !== b.prerelease) return a.prerelease ? 1 : -1;
  if (tagIsNewer(a.dockerTag, b.dockerTag)) return 1;
  if (tagIsNewer(b.dockerTag, a.dockerTag)) return -1;
  return 0;
}

export function officialLatestDockerTag(items: OfficialVersionItem[], pin = ''): string {
  const latest =
    items.find((v) => !v.prerelease)?.dockerTag ?? items[0]?.dockerTag ?? '';
  return latest || pin;
}

export function mergeOfficialVersions(input: {
  pin: string;
  extraTags?: string[];
  fetched: OfficialVersionItem[];
  pinHtmlUrl?: string;
}): OfficialVersionItem[] {
  const byTag = new Map<string, OfficialVersionItem>();
  const pin = String(input.pin ?? '').trim();
  if (pin) {
    byTag.set(pin, {
      gitTag: pin,
      dockerTag: pin,
      prerelease: /rc|alpha|beta|preview/i.test(pin),
      htmlUrl: input.pinHtmlUrl ?? '',
    });
  }
  for (const extra of input.extraTags ?? []) {
    const t = String(extra ?? '').trim();
    if (!t || byTag.has(t)) continue;
    byTag.set(t, {
      gitTag: t,
      dockerTag: t,
      prerelease: /rc|alpha|beta|preview/i.test(t),
      htmlUrl: '',
    });
  }
  let fetched = 0;
  for (const item of input.fetched) {
    if (!item.dockerTag || byTag.has(item.dockerTag)) continue;
    if (fetched >= OFFICIAL_LIST_CAP) break;
    byTag.set(item.dockerTag, item);
    fetched += 1;
  }
  return [...byTag.values()].sort(compareOfficialVersions);
}

type GithubReleaseRow = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
};

export async function fetchGithubReleaseList(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<GithubReleaseRow[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=30`;
  const res = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ysk-server-validators',
    },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as GithubReleaseRow[]) : [];
}

function parseFetchedVersions(
  clientId: string,
  rows: GithubReleaseRow[],
  network?: string,
): OfficialVersionItem[] {
  const out: OfficialVersionItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.draft) continue;
    const gitTag = String(row.tag_name ?? '').trim();
    const dockerTag = dockerTagFromGit(clientId, gitTag, network);
    if (!dockerTag || seen.has(dockerTag)) continue;
    seen.add(dockerTag);
    out.push({
      gitTag,
      dockerTag,
      prerelease: row.prerelease === true,
      htmlUrl: String(row.html_url ?? ''),
    });
  }
  return out;
}

/** Fetch GitHub tags for one client when missing, empty, stale, or forced. */
export async function ensureClientOfficialReleases(input: {
  dataDir: string;
  clientId: string;
  fetchFn?: typeof fetch;
  force?: boolean;
}): Promise<RemoteReleasesCache> {
  const prev = loadRemoteReleases(input.dataDir);
  const row = prev.clients[input.clientId];
  const at = row?.at || prev.at;
  const age = at ? Date.now() - Date.parse(at) : Number.POSITIVE_INFINITY;
  const empty = !row || row.items.length === 0;
  const stale = !Number.isFinite(age) || age < 0 || age >= OFFICIAL_CACHE_TTL_MS;
  if (!input.force && !empty && !stale) return prev;
  return refreshOfficialReleases({
    dataDir: input.dataDir,
    fetchFn: input.fetchFn,
    clientIds: [input.clientId],
    force: true,
  });
}

export async function refreshOfficialReleases(input: {
  dataDir: string;
  fetchFn?: typeof fetch;
  clientIds?: string[];
  force?: boolean;
}): Promise<RemoteReleasesCache> {
  const prev = loadRemoteReleases(input.dataDir);
  const age = prev.at ? Date.now() - Date.parse(prev.at) : Number.POSITIVE_INFINITY;
  const ids = input.clientIds?.length ? input.clientIds : Object.keys(CLIENT_RELEASES);
  if (!input.force && Number.isFinite(age) && age >= 0 && age < OFFICIAL_CACHE_TTL_MS) {
    return prev;
  }
  const fetchFn = input.fetchFn ?? fetch;
  const clients = { ...prev.clients };
  const notesAt = new Date().toISOString();
  for (const id of ids) {
    const meta = CLIENT_RELEASES[id];
    if (!meta) continue;
    try {
      const rows = await fetchGithubReleaseList(meta.github, fetchFn);
      const items = parseFetchedVersions(id, rows);
      clients[id] = { at: notesAt, items };
    } catch (e) {
      const prevClient = clients[id];
      clients[id] = {
        at: prevClient?.at ?? notesAt,
        items: prevClient?.items ?? [],
        error: e instanceof Error ? e.message : 'fetch failed',
      };
    }
  }
  const cache: RemoteReleasesCache = { at: notesAt, clients };
  saveRemoteReleases(input.dataDir, cache);
  const tags: Record<string, string> = {};
  const tagNotes: string[] = [];
  for (const [id, row] of Object.entries(clients)) {
    const newest = row.items[0]?.dockerTag;
    if (newest) tags[id] = newest;
    else if (row.error) tagNotes.push(`${id}: ${row.error}`);
  }
  saveRemoteClientTags(input.dataDir, { at: notesAt, tags, notes: tagNotes });
  return cache;
}

export function listOfficialClientVersions(input: {
  clientId: string;
  dataDir: string;
  network?: string;
  extraTags?: string[];
}): {
  clientId: string;
  image: string;
  pin: string;
  latest: string | null;
  github: string | null;
  changelogUrl: string | null;
  registryHost: string;
  at: string | null;
  error: string | null;
  versions: OfficialVersionItem[];
} {
  const clientId = String(input.clientId ?? '').trim();
  const cat = findValidatorClient(clientId);
  const meta = CLIENT_RELEASES[clientId];
  const pin = cat?.tag ?? '';
  const image = cat?.image ?? '';
  const cache = loadRemoteReleases(input.dataDir);
  const row = cache.clients[clientId];
  let fetched = row?.items ?? [];
  if (input.network) {
    fetched = fetched.filter((item) => dockerTagFromGit(clientId, item.gitTag, input.network));
  }
  const versions = mergeOfficialVersions({
    pin,
    extraTags: input.extraTags,
    fetched,
    pinHtmlUrl: meta ? `https://github.com/${meta.github}/releases/tag/${pin}` : '',
  });
  const latest = officialLatestDockerTag(versions, pin) || null;
  return {
    clientId,
    image,
    pin,
    latest,
    github: meta?.github ?? null,
    changelogUrl: meta?.changelog ?? null,
    registryHost: dockerRegistryHost(image),
    at: row?.at ?? (cache.at || null),
    error: row?.error ?? null,
    versions,
  };
}

export function allowedDockerTagsForClient(input: {
  clientId: string;
  dataDir: string;
  extraTags?: string[];
}): Set<string> {
  const listed = listOfficialClientVersions(input);
  return new Set(listed.versions.map((v) => v.dockerTag));
}

export function normalizeGithubTag(raw: string, prefix?: string): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const core = t.replace(/^v/i, '');
  if (!/^\d+\.\d+/.test(core)) return null;
  if (prefix) return `${prefix}v${core}`;
  return t;
}

export function pickAllowedNextTag(input: {
  current: string;
  pin: string;
  remote?: string | null;
}): { next: string; fromRemote: boolean } {
  const remote = input.remote?.trim() || null;
  if (remote && tagIsNewer(input.pin, remote) && tagIsNewer(input.current, remote)) {
    const pinMaj = parseVersionParts(input.pin).major;
    const remMaj = parseVersionParts(remote).major;
    if (remMaj > pinMaj + 1) return { next: input.pin, fromRemote: false };
    return { next: remote, fromRemote: true };
  }
  return { next: input.pin, fromRemote: false };
}

export async function fetchGithubReleaseTag(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ysk-server-validators',
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { tag_name?: string };
  return String(body.tag_name ?? '').trim() || null;
}

export async function refreshRemoteClientTags(input: {
  dataDir: string;
  fetchFn?: typeof fetch;
}): Promise<RemoteTagCache> {
  const official = await refreshOfficialReleases({
    dataDir: input.dataDir,
    fetchFn: input.fetchFn,
    force: true,
  });
  const tags = loadRemoteClientTags(input.dataDir);
  const notes = Object.entries(official.clients)
    .filter(([, row]) => row.error)
    .map(([id, row]) => `${id}: ${row.error}`);
  return { at: official.at, tags, notes };
}

export function changelogForClient(clientId: string): string | undefined {
  return CLIENT_RELEASES[clientId]?.changelog;
}
