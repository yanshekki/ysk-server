/**
 * Avalanche adapter — avalanchego, state-sync on for minimal/pruned.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';
import { readRpcJson } from '../rpc-json.js';

/** C-Chain JSON — `--state-sync-enabled` is not an avalanchego CLI flag. */
export function avaxCChainConfig(stateSync: boolean): string {
  return `${JSON.stringify({ 'state-sync-enabled': stateSync }, null, 2)}\n`;
}

export function ensureAvaxChainConfig(dataPath: string, stateSync = true): void {
  const dir = join(String(dataPath ?? '').replace(/\/+$/, ''), 'configs', 'chains', 'C');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), avaxCChainConfig(stateSync), 'utf8');
}

export function buildAvaxComposeYaml(spec: ValidatorInstanceDto): string {
  const node = spec.clients.node ?? v1ValidatorClients('avax')[0];
  const img = `${node?.image ?? 'avaplatform/avalanchego'}:${node?.tag ?? 'v1.14.1'}`;
  const rpc = spec.ports.rpc ?? 9650;
  const p2p = spec.ports.p2p ?? 9651;
  const netId = spec.network === 'mainnet' ? 'mainnet' : 'fuji';
  return `# ysk-server validators avax — generated
services:
  node:
    image: ${img}
    restart: unless-stopped
    entrypoint: ["/avalanchego/build/avalanchego"]
    command:
      - --network-id=${netId}
      - --http-host=0.0.0.0
      - --http-port=9650
      - --staking-port=9651
      - --public-ip-resolution-service=ifconfigMe
      - --db-dir=/data
      - --chain-config-dir=/data/configs/chains
    ports:
      - "127.0.0.1:${rpc}:9650"
      - "0.0.0.0:${p2p}:9651/tcp"
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseAvaxHealth(body: unknown): {
  healthy: boolean;
  lastError: string | null;
  peers: number | null;
} {
  const top = asRecord(body);
  const result = asRecord(top?.result) ?? top;
  if (!result) return { healthy: false, lastError: 'bad health', peers: null };
  const checks = asRecord(result.checks) ?? asRecord(result.reason) ?? result;
  const network = asRecord(checks.network);
  const netMsg = asRecord(network?.message);
  const peers =
    typeof netMsg?.connectedPeers === 'number' && Number.isFinite(netMsg.connectedPeers)
      ? netMsg.connectedPeers
      : null;
  const healthy = result.healthy === true;
  if (healthy) return { healthy: true, lastError: null, peers };
  const boot = asRecord(checks.bootstrapped);
  const err =
    (typeof network?.error === 'string' && network.error) ||
    (typeof boot?.error === 'string' && boot.error) ||
    'unhealthy';
  return { healthy: false, lastError: err.slice(0, 280), peers };
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
    const health = parseAvaxHealth(await readRpcJson(res));
    return {
      syncProgress: health.healthy ? 1 : null,
      peers: health.peers,
      version: 'avalanchego',
      lastError: health.lastError,
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

export type AvaxStakingIdentity = {
  nodeId: string | null;
  blsPublicKey: string | null;
  blsProofOfPossession: string | null;
};

const emptyAvaxIdentity: AvaxStakingIdentity = {
  nodeId: null,
  blsPublicKey: null,
  blsProofOfPossession: null,
};

function asTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Best-effort NodeID + BLS PoP for P-Chain registration. Null until RPC answers. */
export async function probeAvaxStakingIdentity(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<AvaxStakingIdentity> {
  const url = `http://127.0.0.1:${spec.ports.rpc ?? 9650}/ext/info`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'info.getNodeID',
        params: {},
      }),
    });
    const body = (await readRpcJson(res)) as {
      result?: {
        nodeID?: string;
        nodeId?: string;
        nodePOP?: { publicKey?: string; proofOfPossession?: string };
      };
    };
    const pop = body.result?.nodePOP;
    return {
      nodeId: asTrimmed(body.result?.nodeID ?? body.result?.nodeId),
      blsPublicKey: asTrimmed(pop?.publicKey),
      blsProofOfPossession: asTrimmed(pop?.proofOfPossession),
    };
  } catch {
    return emptyAvaxIdentity;
  }
}

export async function probeAvaxNodeId(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  return (await probeAvaxStakingIdentity(spec, fetchFn)).nodeId;
}
