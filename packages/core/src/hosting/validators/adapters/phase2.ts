/**
 * Phase 2 chain adapters: Bitcoin, Cosmos Hub, Sui, Aptos, Polkadot, Solana.
 * RPC bound to localhost on the host. No keys written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { SUI_NODE_IMAGE, suiNodeTag, v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';
import { readRpcJson } from '../rpc-json.js';

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
      - -datadir=/data
      - -server=1
      - -prune=${prune}
      - -rpcbind=0.0.0.0
      - -rpcallowip=0.0.0.0/0${testnet ? '\n      - -testnet=1' : ''}
    ports:
      - "127.0.0.1:${rpc}:${testnet ? 18332 : 8332}"
      - "0.0.0.0:${p2p}:${testnet ? 18333 : 8333}"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
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

export function cosmosChainId(network: string): string {
  return network === 'mainnet' ? 'cosmoshub-4' : 'provider';
}

/** Official Cosmos Hub testnet is ICS `provider` (theta-testnet-001 is killed). */
export function cosmosGenesisUrl(network: string): string {
  if (network === 'mainnet') {
    return 'https://raw.githubusercontent.com/cosmos/mainnet/master/genesis.json';
  }
  return 'https://raw.githubusercontent.com/cosmos/testnets/master/provider/provider-genesis.json';
}

export function cosmosSeeds(network: string): string {
  if (network === 'mainnet') {
    return 'ade4d8bc8cbe014af6ebdf3cb7b1e9ad36f412c0@seeds.polkachu.com:14956';
  }
  return '08ec17e86dac67b9da70deb20177655495a55407@provider-seed-01.hub-testnet.polypore.xyz:26656,4ea6e56300a2f37b90e58de5ee27d1c9065cf871@provider-seed-02.hub-testnet.polypore.xyz:26656';
}

export async function ensureCosmosGenesisFile(
  dataPath: string,
  network: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; notes: string[] }> {
  const dir = String(dataPath ?? '').replace(/\/+$/, '');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'official-genesis.json');
  if (existsSync(dest)) return { ok: true, notes: [] };
  const url = cosmosGenesisUrl(network);
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { ok: false, notes: [`cosmos genesis http ${res.status} ${url}`] };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) return { ok: false, notes: ['cosmos genesis too small'] };
    writeFileSync(dest, buf);
    return { ok: true, notes: [] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'cosmos genesis fetch failed'] };
  }
}

export function buildCosmosComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 26657;
  const p2p = spec.ports.p2p ?? 26656;
  const chainId = cosmosChainId(spec.network);
  const seeds = cosmosSeeds(spec.network);
  return `# ysk-server validators cosmos — generated (official genesis)
services:
  node:
    image: ${img(spec, 'ghcr.io/cosmos/gaia', 'v23.3.0')}
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -e
        if [ ! -w /data ]; then
          echo "data dir not writable: /data" >&2
          exit 1
        fi
        if [ ! -f /data/official-genesis.json ]; then
          echo "official genesis missing: /data/official-genesis.json" >&2
          exit 1
        fi
        if [ ! -f /data/config/config.toml ]; then
          gaiad init ysk --home /data --chain-id ${chainId}
        fi
        cp /data/official-genesis.json /data/config/genesis.json
        if [ -f /data/config/config.toml ]; then
          sed -i -e '/minimum-gas-prices =/ s^= .*^= "0.005uatom"^' /data/config/app.toml || true
          sed -i -e '/seeds =/ s^= .*^= "${seeds}"^' /data/config/config.toml || true
        fi
        gaiad start --home /data --rpc.laddr tcp://0.0.0.0:26657 --p2p.laddr tcp://0.0.0.0:26656 --p2p.seeds="${seeds}" --minimum-gas-prices=0.005uatom
    ports:
      - "127.0.0.1:${rpc}:26657"
      - "0.0.0.0:${p2p}:26656"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
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

export function suiGenesisUrl(network: string): string {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet';
  return `https://github.com/MystenLabs/sui-genesis/raw/main/${net}/genesis.blob`;
}

export function suiFullnodeYaml(network: string): string {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet';
  return `# ysk-server generated Sui ${net} fullnode
db-path: /data/suidb
network-address: /ip4/0.0.0.0/tcp/8080/http
metrics-address: 0.0.0.0:9184
json-rpc-address: 0.0.0.0:9000
enable-index-processing: false
genesis:
  genesis-file-location: /data/genesis.blob
`;
}

export async function ensureSuiFullnodeFiles(
  dataPath: string,
  network: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; notes: string[] }> {
  const dir = String(dataPath ?? '').replace(/\/+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fullnode.yaml'), suiFullnodeYaml(network), 'utf8');
  const genesisPath = join(dir, 'genesis.blob');
  if (existsSync(genesisPath)) return { ok: true, notes: [] };
  const url = suiGenesisUrl(network);
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { ok: false, notes: [`sui genesis http ${res.status} ${url}`] };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8) return { ok: false, notes: ['sui genesis blob too small'] };
    writeFileSync(genesisPath, buf);
    return { ok: true, notes: [] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'sui genesis fetch failed'] };
  }
}

export function buildSuiComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 9002;
  const net = spec.network === 'mainnet' ? 'mainnet' : 'testnet';
  const tag = suiNodeTag(spec.network);
  const image = spec.clients.node?.image || SUI_NODE_IMAGE;
  return `# ysk-server validators sui — generated
services:
  node:
    image: ${image}:${tag}
    restart: unless-stopped
    command:
      - sui-node
      - --config-path
      - /data/fullnode.yaml
    environment:
      SUI_NETWORK: ${net}
    ports:
      - "127.0.0.1:${rpc}:9000"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
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

export function aptosFullnodeYaml(): string {
  return `# ysk-server generated Aptos public fullnode
base:
  role: "full_node"
  data_dir: "/data"
  waypoint:
    from_file: "/data/waypoint.txt"
execution:
  genesis_file_location: "/data/genesis.blob"
full_node_networks:
  - discovery_method: "onchain"
    listen_address: "/ip4/0.0.0.0/tcp/6180"
api:
  enabled: true
  address: 0.0.0.0:8080
`;
}

export function aptosNetworkFileUrl(network: string, file: 'genesis.blob' | 'waypoint.txt'): string {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet';
  return `https://github.com/aptos-labs/aptos-networks/raw/main/${net}/${file}`;
}

export async function ensureAptosFullnodeFiles(
  dataPath: string,
  network: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; notes: string[] }> {
  const dir = String(dataPath ?? '').replace(/\/+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fullnode.yaml'), aptosFullnodeYaml(), 'utf8');
  const notes: string[] = [];
  for (const file of ['genesis.blob', 'waypoint.txt'] as const) {
    const dest = join(dir, file);
    if (existsSync(dest)) continue;
    const url = aptosNetworkFileUrl(network, file);
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        notes.push(`aptos ${file} http ${res.status}`);
        continue;
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      notes.push(e instanceof Error ? e.message : `aptos ${file} fetch failed`);
    }
  }
  return { ok: notes.length === 0, notes };
}

export function buildAptosComposeYaml(spec: ValidatorInstanceDto): string {
  const rpc = spec.ports.rpc ?? 18080;
  const p2p = spec.ports.p2p ?? 6180;
  const net = spec.network === 'mainnet' ? 'mainnet' : 'testnet';
  return `# ysk-server validators aptos — generated
services:
  node:
    image: ${img(spec, 'aptoslabs/validator', 'aptos-node-v1.27.2')}
    restart: unless-stopped
    command:
      - aptos-node
      - -f
      - /data/fullnode.yaml
    environment:
      APTOS_NETWORK: ${net}
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
    ports:
      - "127.0.0.1:${rpc}:8080"
      - "0.0.0.0:${p2p}:6180"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}
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
      - ${composeBind(spec.dataPath, '/data')}
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
      - ${composeBind(spec.dataPath, '/data')}
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

export function btcCookiePaths(dataPath: string, network: string): string[] {
  const p = String(dataPath ?? '').replace(/\/+$/, '');
  if (network === 'mainnet') return [join(p, '.cookie')];
  return [join(p, 'testnet3', '.cookie'), join(p, 'signet', '.cookie'), join(p, '.cookie')];
}

export function parseBtcCookieFile(raw: string): { user: string; pass: string } | null {
  const line = String(raw ?? '')
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const i = line.indexOf(':');
  if (i <= 0) return null;
  const user = line.slice(0, i);
  const pass = line.slice(i + 1);
  if (!user || !pass) return null;
  return { user, pass };
}

function readBtcCookie(dataPath: string, network: string): { user: string; pass: string } | null {
  for (const f of btcCookiePaths(dataPath, network)) {
    try {
      if (!existsSync(f)) continue;
      const parsed = parseBtcCookieFile(readFileSync(f, 'utf8'));
      if (parsed) return parsed;
    } catch {
      /* unreadable cookie is RPC-not-ready, not a crash */
    }
  }
  return null;
}

async function postRpc(
  url: string,
  method: string,
  fetchFn: typeof fetch,
  auth?: { user: string; pass: string },
): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    headers.authorization = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}`;
  }
  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
  });
  return readRpcJson(res);
}

export async function probeBtcStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    const cookie = readBtcCookie(spec.dataPath, spec.network);
    return parseBtcInfo(
      await postRpc(
        `http://127.0.0.1:${spec.ports.rpc ?? 8332}`,
        'getblockchaininfo',
        fetchFn,
        cookie ?? undefined,
      ),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'rpc unreachable';
    return { syncProgress: null, peers: null, version: null, lastError: msg };
  }
}

export async function probeCosmosStatus(spec: ValidatorInstanceDto, fetchFn: typeof fetch = fetch): Promise<Probe> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${spec.ports.rpc ?? 26657}/status`);
    return parseCosmosStatus(await readRpcJson(res));
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
    const res = await fetchFn(`http://127.0.0.1:${spec.ports.rpc ?? 18080}/v1`);
    return parseAptosLedger(await readRpcJson(res));
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
