/**
 * NEAR adapter — neard. RPC vs validator-ready share the same binary;
 * validator keys are never written by the panel.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';

export function buildNearComposeYaml(spec: ValidatorInstanceDto): string {
  const node = spec.clients.node ?? v1ValidatorClients('near')[0];
  const img = `${node?.image ?? 'nearprotocol/nearcore'}:${node?.tag ?? '2.5.0'}`;
  const rpc = spec.ports.rpc ?? 3030;
  const p2p = spec.ports.p2p ?? 24567;
  const chainId = spec.network === 'mainnet' ? 'mainnet' : 'testnet';
  return `# ysk-server validators near — generated
services:
  node:
    image: ${img}
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -e
        if [ ! -f /data/config.json ]; then
          neard --home /data init --chain-id ${chainId} --download-genesis --download-config
        fi
        neard --home /data run
    ports:
      - "127.0.0.1:${rpc}:3030"
      - "0.0.0.0:${p2p}:24567"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planNearInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  const clients = v1ValidatorClients('near');
  return {
    notes: ['neard', 'downloads official genesis/config on first start', 'rpc localhost only', 'no validator keys'],
    composeYaml: buildNearComposeYaml(spec),
    dataPath: spec.dataPath,
    images: clients.map((c) => `${c.image}:${c.tag}`),
    ports: spec.ports,
  };
}

export function parseNearStatus(body: unknown): {
  syncProgress: number | null;
  peers: number | null;
  version: string | null;
} {
  if (!body || typeof body !== 'object') {
    return { syncProgress: null, peers: null, version: null };
  }
  const o = body as {
    version?: { version?: string };
    sync_info?: { syncing?: boolean; latest_block_height?: number };
    peers?: unknown[];
    num_active_peers?: number;
  };
  const syncing = o.sync_info?.syncing === true;
  const peers = Array.isArray(o.peers)
    ? o.peers.length
    : typeof o.num_active_peers === 'number'
      ? o.num_active_peers
      : null;
  return {
    syncProgress: syncing ? null : 1,
    peers,
    version: o.version?.version ?? null,
  };
}

export async function probeNearStatus(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<Pick<ValidatorNodeStatus, 'syncProgress' | 'peers' | 'version' | 'lastError'>> {
  const url = `http://127.0.0.1:${spec.ports.rpc ?? 3030}/status`;
  try {
    const res = await fetchFn(url);
    const parsed = parseNearStatus(await res.json());
    return { ...parsed, lastError: null };
  } catch (e) {
    return {
      syncProgress: null,
      peers: null,
      version: null,
      lastError: e instanceof Error ? e.message : 'rpc unreachable',
    };
  }
}
