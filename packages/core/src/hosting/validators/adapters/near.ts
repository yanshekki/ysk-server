/**
 * NEAR adapter — neard. RPC vs validator-ready share the same binary;
 * validator keys are never written by the panel.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';
import { readRpcJson } from '../rpc-json.js';
import { RESOLVE_PUBLIC_IP_SH } from './p2p-public-ip.js';

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
    mem_limit: 12g
    memswap_limit: 12g
    pids_limit: 4096
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -e
        if [ ! -f /data/config.json ]; then
          neard --home /data init --chain-id ${chainId} --download-genesis --download-config
        fi
        ${RESOLVE_PUBLIC_IP_SH.split('\n').join('\n        ')}
        if [ -n "$PUB" ] && [ -f /data/config.json ]; then
          if grep -q '"public_addr"' /data/config.json; then
            sed -i "s/\\"public_addr\\": \\"[^\\"]*\\"/\\"public_addr\\": \\"$PUB:24567\\"/" /data/config.json || true
          else
            sed -i "s/\\"addr\\": \\"0.0.0.0:24567\\"/\\"addr\\": \\"0.0.0.0:24567\\",\\n    \\"public_addr\\": \\"$PUB:24567\\"/" /data/config.json || true
          fi
        fi
        neard --home /data run
    ports:
      - "127.0.0.1:${rpc}:3030"
      - "0.0.0.0:${p2p}:24567"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
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
    const parsed = parseNearStatus(await readRpcJson(res));
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
