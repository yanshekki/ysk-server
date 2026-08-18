/**
 * Avalanche adapter — avalanchego, state-sync on for minimal/pruned.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';

export function buildAvaxComposeYaml(spec: ValidatorInstanceDto): string {
  const node = spec.clients.node ?? v1ValidatorClients('avax')[0];
  const img = `${node?.image ?? 'avaplatform/avalanchego'}:${node?.tag ?? 'v1.13.5'}`;
  const rpc = spec.ports.rpc ?? 9650;
  const p2p = spec.ports.p2p ?? 9651;
  const netId = spec.network === 'mainnet' ? 'mainnet' : 'fuji';
  const stateSync = spec.profile === 'validator-ready' ? 'true' : 'true';
  return `# ysk-server validators avax — generated
services:
  node:
    image: ${img}
    restart: unless-stopped
    command:
      - --network-id=${netId}
      - --http-host=0.0.0.0
      - --http-port=9650
      - --staking-port=9651
      - --db-dir=/data
      - --state-sync-enabled=${stateSync}
    ports:
      - "127.0.0.1:${rpc}:9650"
      - "0.0.0.0:${p2p}:9651"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
`;
}

export function planAvaxInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  const clients = v1ValidatorClients('avax');
  return {
    notes: ['avalanchego', 'state-sync on', 'rpc localhost only'],
    composeYaml: buildAvaxComposeYaml(spec),
    dataPath: spec.dataPath,
    images: clients.map((c) => `${c.image}:${c.tag}`),
    ports: spec.ports,
  };
}

export function parseAvaxHealth(body: unknown): { healthy: boolean } {
  if (body && typeof body === 'object' && 'healthy' in body) {
    return { healthy: Boolean((body as { healthy: unknown }).healthy) };
  }
  return { healthy: false };
}

export async function probeAvaxStatus(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<{
  syncProgress: number | null;
  peers: number | null;
  version: string | null;
  lastError: string | null;
}> {
  const url = `http://127.0.0.1:${spec.ports.rpc ?? 9650}/ext/health`;
  try {
    const res = await fetchFn(url);
    const healthy = parseAvaxHealth(await res.json()).healthy;
    return {
      syncProgress: healthy ? 1 : null,
      peers: null,
      version: 'avalanchego',
      lastError: healthy ? null : 'unhealthy',
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
