/**
 * Official GitHub release lookup for validator client tags.
 * Fetch failures fall back to the pinned registry tag.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVersionParts, tagIsNewer } from './versions.js';

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
  sui: {
    github: 'MystenLabs/sui',
    changelog: 'https://github.com/MystenLabs/sui/releases',
  },
  aptos: {
    github: 'aptos-labs/aptos-core',
    changelog: 'https://github.com/aptos-labs/aptos-core/releases',
  },
  agave: {
    github: 'anza-xyz/agave',
    changelog: 'https://github.com/anza-xyz/agave/releases',
  },
};

export type RemoteTagCache = {
  at: string;
  tags: Record<string, string>;
  notes: string[];
};

function cachePath(dataDir: string): string {
  return join(dataDir, 'validators', 'remote-tags.json');
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
  const fetchFn = input.fetchFn ?? fetch;
  const tags: Record<string, string> = {};
  const notes: string[] = [];
  for (const [id, meta] of Object.entries(CLIENT_RELEASES)) {
    try {
      const raw = await fetchGithubReleaseTag(meta.github, fetchFn);
      const norm = raw ? normalizeGithubTag(raw, meta.tagPrefix) : null;
      if (norm) tags[id] = norm;
      else notes.push(`${id}: no tag`);
    } catch (e) {
      notes.push(`${id}: ${e instanceof Error ? e.message : 'fetch failed'}`);
    }
  }
  const cache: RemoteTagCache = { at: new Date().toISOString(), tags, notes };
  saveRemoteClientTags(input.dataDir, cache);
  return cache;
}

export function changelogForClient(clientId: string): string | undefined {
  return CLIENT_RELEASES[clientId]?.changelog;
}
