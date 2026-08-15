/**
 * Ethereum adapter — EL × CL matrix. No staking keys.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ChainAdapter, ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { buildClService, buildElService, jwtHost } from './eth-clients.js';

export function ethJwtPath(spec: ValidatorInstanceDto): string {
  return jwtHost(spec);
}

export function parseEthSyncing(body: unknown): { syncing: boolean; progress: number | null } {
  if (body && typeof body === 'object' && 'result' in body) {
    const r = (body as { result: unknown }).result;
    if (r === false) return { syncing: false, progress: 1 };
    if (r && typeof r === 'object') {
      const o = r as { currentBlock?: string; highestBlock?: string };
      const cur = Number.parseInt(String(o.currentBlock ?? '0'), 16);
      const hi = Number.parseInt(String(o.highestBlock ?? '0'), 16);
      if (hi > 0 && Number.isFinite(cur)) return { syncing: true, progress: Math.min(1, cur / hi) };
      return { syncing: true, progress: null };
    }
  }
  return { syncing: false, progress: null };
}

export function parseEthPeerCount(body: unknown): number | null {
  if (body && typeof body === 'object' && 'result' in body) {
    const n = Number.parseInt(String((body as { result: unknown }).result), 16);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function buildEthComposeYaml(spec: ValidatorInstanceDto): string {
  const jwt = '/jwt/jwt.hex';
  return `# ysk-server validators eth — generated
# EL=${spec.clients.el?.id ?? 'reth'} CL=${spec.clients.cl?.id ?? 'lighthouse'}
# RPC localhost only. No staking keys.
services:
${buildElService(spec, jwt)}
${buildClService(spec, jwt)}
`;
}

export function planEthInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  const clients = v1ValidatorClients('eth');
  const yaml = buildEthComposeYaml(spec);
  return {
    notes: [
      `eth ${spec.clients.el?.id ?? 'reth'}+${spec.clients.cl?.id ?? 'lighthouse'}`,
      'rpc localhost only',
      'no staking keys',
    ],
    composeYaml: yaml,
    dataPath: spec.dataPath,
    images: clients.map((c) => `${c.image}:${c.tag}`),
    jwtHex: undefined, // filled by ensureEthJwt
    jwtPath: ethJwtPath(spec),
    ports: spec.ports,
  };
}

export const ethAdapter: Pick<ChainAdapter, 'id' | 'planInstall'> & {
  rpcUrl(spec: ValidatorInstanceDto): string;
} = {
  id: 'eth',
  planInstall: planEthInstall,
  rpcUrl(spec) {
    return `http://127.0.0.1:${spec.ports.rpc ?? 8545}`;
  },
};

export async function probeEthStatus(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<Pick<ValidatorNodeStatus, 'syncProgress' | 'peers' | 'version' | 'lastError'>> {
  const url = ethAdapter.rpcUrl(spec);
  try {
    const [syncRes, peerRes, verRes] = await Promise.all([
      fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_syncing', params: [] }),
      }),
      fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'net_peerCount', params: [] }),
      }),
      fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'web3_clientVersion', params: [] }),
      }),
    ]);
    const sync = parseEthSyncing(await syncRes.json());
    const peers = parseEthPeerCount(await peerRes.json());
    const verBody = (await verRes.json()) as { result?: string };
    return {
      syncProgress: sync.syncing ? sync.progress : 1,
      peers,
      version: typeof verBody.result === 'string' ? verBody.result : null,
      lastError: null,
    };
  } catch (e) {
    return {
      syncProgress: null,
      peers: null,
      version: null,
      lastError: e instanceof Error ? e.message : 'rpc unreachable',
    };
  }
}


