/**
 * Phase 2 chain adapters: Bitcoin, Cosmos Hub, Sui, Aptos, Polkadot, Solana.
 * RPC bound to localhost on the host. No keys written.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';

type Probe = Pick<ValidatorNodeStatus, 'syncProgress' | 'peers' | 'version' | 'lastError'>;

function img(spec: ValidatorInstanceDto, fallback: string, tag: string): string {
  const n = spec.clients.node ?? v1ValidatorClients(spec.chain)[0];
  return `${n?.image ?? fallback}:${n?.tag ?? tag}`;
}

function plan(
  spec: ValidatorInstanceDto,
  yaml: string,
  notes: string[],
): ValidatorHostPlan {
  const clients = v1ValidatorClients(spec.chain);
  return {
    notes,
    composeYaml: yaml,
    dataPath: spec.dataPath,
    images: clients.map((c) => `${c.image}:${c.tag}`),
    ports: spec.ports,
  };
}

export function buildBtcComposeYaml(spec: ValidatorInstanceDto): string {
  const prune = spec.profile === 'rpc' || spec.profile === 'validator-ready' ? 550 : 550;
  const testnet = spec.network !== 'mainnet';
  const rpc = spec.ports.rpc ?? (testnet ? 18332 : 8332);
  const p2p = spec.ports.p2p ?? (testnet ? 18333 : 8333);
  return `# ysk-server validators btc — generated (pruned)
services:
  node:
    image: ${img(spec, 'lncm/bitcoind', 'v28.0')}
    restart: unless-stopped
    command:
      - bitcoind
      - -datadir=/data
      - -server=1
      - -prune=${prune}
      - -rpcbind=0.0.0.0
      - -rpcallowip=0.0.0.0/0${testnet ? '\n      - -testnet=1' : ''}
    ports:
      - "127.0.0.1:${rpc}:${testnet ? 18332 : 8332}"
      - "0.0.0.0:${p2p}:${testnet ? 18333 : 8333}"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planBtcInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildBtcComposeYaml(spec), ['bitcoind pruned', 'rpc localhost only']);
}

export function parseBtcInfo(body: unknown): Probe {
  const r = body && typeof body === 'object' && 'result' in body ? (body as { result: Record<string, unknown> }).result : null;
  if (!r) return { syncProgress: null, peers: null, version: null, lastError: 'bad rpc' };
  const prog = Number(r.verificationprogress);
  return {
    syncProgress: Number.isFinite(prog) ? Math.min(1, prog) : null,
    peers: typeof r.connections === 'number' ? r.connections : null,
    version: r.chain ? String(r.chain) : null,
    lastError: null,
  };
}

export function buildCosmosComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 26657;
  const p2p = spec.ports.p2p ?? 26656;
  const chainId = spec.network === 'mainnet' ? 'cosmoshub-4' : 'provider';
  return `# ysk-server validators cosmos — generated (state-sync later)
services:
  node:
    image: ${img(spec, 'ghcr.io/cosmos/gaia', 'v23.3.0')}
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -e
        if [ ! -f /data/config/genesis.json ]; then
          gaiad init ysk --home /data --chain-id ${chainId}
        fi
        gaiad start --home /data --rpc.laddr tcp://0.0.0.0:26657 --p2p.laddr tcp://0.0.0.0:26656
    ports:
      - "127.0.0.1:${rpc}:26657"
      - "0.0.0.0:${p2p}:26656"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planCosmosInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildCosmosComposeYaml(spec), ['gaiad', 'rpc localhost only', 'state-sync via gaiad config']);
}

export function parseCosmosStatus(body: unknown): Probe {
  const result = body && typeof body === 'object' && 'result' in body ? (body as { result: unknown }).result : body;
  if (!result || typeof result !== 'object') {
    return { syncProgress: null, peers: null, version: null, lastError: 'bad status' };
  }
  const s = result as { sync_info?: { catching_up?: boolean }; node_info?: { version?: string }; validator_info?: unknown };
  return {
    syncProgress: s.sync_info?.catching_up === false ? 1 : s.sync_info?.catching_up === true ? null : null,
    peers: null,
    version: s.node_info?.version ?? null,
    lastError: null,
  };
}

export function buildSuiComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 9002;
  const net = spec.network === 'mainnet' ? 'mainnet' : 'testnet';
  return `# ysk-server validators sui — generated
services:
  node:
    image: ${img(spec, 'mysten/sui-node', 'mainnet-v1.44.2')}
    restart: unless-stopped
    command: ["sui-node", "--config-path", "/data/fullnode.yaml"]
    environment:
      SUI_NETWORK: ${net}
    ports:
      - "127.0.0.1:${rpc}:9000"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planSuiInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildSuiComposeYaml(spec), ['sui-node', 'rpc localhost only']);
}

export function parseSuiHealth(body: unknown): Probe {
  if (body && typeof body === 'object' && 'result' in body) {
    return { syncProgress: 1, peers: null, version: 'sui-node', lastError: null };
  }
  return { syncProgress: null, peers: null, version: null, lastError: 'unhealthy' };
}

export function buildAptosComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 8080;
  const p2p = spec.ports.p2p ?? 6180;
  const net = spec.network === 'mainnet' ? 'mainnet' : 'testnet';
  return `# ysk-server validators aptos — generated
services:
  node:
    image: ${img(spec, 'aptoslabs/validator', 'aptos-node-v1.27.2')}
    restart: unless-stopped
    command: ["aptos-node", "-f", "/data/fullnode.yaml"]
    environment:
      APTOS_NETWORK: ${net}
    ports:
      - "127.0.0.1:${rpc}:8080"
      - "0.0.0.0:${p2p}:6180"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planAptosInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildAptosComposeYaml(spec), ['aptos-node', 'rpc localhost only']);
}

export function parseAptosLedger(body: unknown): Probe {
  if (body && typeof body === 'object') {
    const o = body as { chain_id?: number; ledger_version?: string };
    if (o.chain_id != null || o.ledger_version != null) {
      return { syncProgress: 1, peers: null, version: o.ledger_version ? String(o.ledger_version) : null, lastError: null };
    }
  }
  return { syncProgress: null, peers: null, version: null, lastError: 'unhealthy' };
}

export function buildDotComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 9933;
  const p2p = spec.ports.p2p ?? 30333;
  const chain = spec.network === 'mainnet' ? 'polkadot' : 'westend';
  return `# ysk-server validators dot — generated
services:
  node:
    image: ${img(spec, 'parity/polkadot', 'v1.16.1')}
    restart: unless-stopped
    command:
      - polkadot
      - --base-path=/data
      - --chain=${chain}
      - --rpc-external
      - --rpc-port=9933
      - --port=30333
      - --rpc-cors=all
    ports:
      - "127.0.0.1:${rpc}:9933"
      - "0.0.0.0:${p2p}:30333"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planDotInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildDotComposeYaml(spec), ['polkadot', 'rpc localhost only']);
}

export function parseDotSync(body: unknown): Probe {
  const r = body && typeof body === 'object' && 'result' in body ? (body as { result: Record<string, unknown> }).result : null;
  if (!r) return { syncProgress: null, peers: null, version: null, lastError: 'bad rpc' };
  const current = Number(r.currentBlock);
  const highest = Number(r.highestBlock);
  const syncing = r.isSyncing === true;
  return {
    syncProgress: !syncing && highest > 0 ? 1 : highest > 0 && current >= 0 ? Math.min(1, current / highest) : null,
    peers: typeof r.peers === 'number' ? r.peers : null,
    version: 'polkadot',
    lastError: null,
  };
}

export function buildSolComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 8899;
  const net = spec.network === 'mainnet' ? 'mainnet-beta' : 'testnet';
  return `# ysk-server validators sol — HEAVY (needs high IOPS / large disk)
services:
  node:
    image: ${img(spec, 'solanalabs/solana', 'v2.1.11')}
    restart: unless-stopped
    command:
      - solana-validator
      - --ledger
      - /data
      - --rpc-port
      - "8899"
      - --dynamic-port-range
      - 8000-8020
      - --entrypoint
      - entrypoint.${net}.solana.com:8001
      - --expected-genesis-hash
      - auto
      - --no-voting
      - --limit-ledger-size
    ports:
      - "127.0.0.1:${rpc}:8899"
    volumes:
      - ${JSON.stringify(spec.dataPath)}:/data
`;
}

export function planSolInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  return plan(spec, buildSolComposeYaml(spec), [
    'solana-validator',
    'HEAVY: mainnet needs ~2 TiB and high IOPS',
    'rpc localhost only',
    'no voting identity',
  ]);
}

export function parseSolHealth(body: unknown): Probe {
  const r = body && typeof body === 'object' && 'result' in body ? (body as { result: unknown }).result : null;
  if (r === 'ok') return { syncProgress: 1, peers: null, version: 'agave', lastError: null };
  return { syncProgress: null, peers: null, version: null, lastError: 'unhealthy' };
}

async function postRpc(
  url: string,
  method: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
  });
  return res.json();
}

export async function probeBtcStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    return parseBtcInfo(await postRpc(`http://127.0.0.1:${spec.ports.rpc ?? 8332}`, 'getblockchaininfo', fetchFn));
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}

export async function probeCosmosStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${spec.ports.rpc ?? 26657}/status`);
    return parseCosmosStatus(await res.json());
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}

export async function probeSuiStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    return parseSuiHealth(await postRpc(`http://127.0.0.1:${spec.ports.rpc ?? 9002}`, 'sui_getLatestCheckpointSequenceNumber', fetchFn));
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}

export async function probeAptosStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${spec.ports.rpc ?? 8080}/v1`);
    return parseAptosLedger(await res.json());
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}

export async function probeDotStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    return parseDotSync(await postRpc(`http://127.0.0.1:${spec.ports.rpc ?? 9933}`, 'system_syncState', fetchFn));
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}

export async function probeSolStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    return parseSolHealth(await postRpc(`http://127.0.0.1:${spec.ports.rpc ?? 8899}`, 'getHealth', fetchFn));
  } catch (e) {
    return { syncProgress: null, peers: null, version: null, lastError: e instanceof Error ? e.message : 'rpc' };
  }
}
