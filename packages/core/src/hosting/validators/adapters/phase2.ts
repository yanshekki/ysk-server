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
import { RESOLVE_PUBLIC_IP_SH } from './p2p-public-ip.js';

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

/** Official provider join uses state-sync; launch genesis cannot InitChain on current Gaia. */
export function cosmosStateSyncRpcs(network: string): string[] {
  if (network === 'mainnet') return [];
  return [
    'https://rpc.provider-state-sync-01.hub-testnet.polypore.xyz:443',
    'https://rpc.provider-state-sync-02.hub-testnet.polypore.xyz:443',
  ];
}

export async function ensureCosmosStateSyncFile(
  dataPath: string,
  network: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; notes: string[] }> {
  const rpcs = cosmosStateSyncRpcs(network);
  if (!rpcs.length) return { ok: true, notes: [] };
  const dir = String(dataPath ?? '').replace(/\/+$/, '');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'statesync.env');
  const rpc = rpcs[0]!;
  try {
    const latestRes = await fetchFn(`${rpc}/block`);
    if (!latestRes.ok) return { ok: false, notes: [`cosmos state-sync http ${latestRes.status}`] };
    const latest = (await latestRes.json()) as {
      result?: { block?: { header?: { height?: string } } };
    };
    const height = Number(latest.result?.block?.header?.height);
    if (!Number.isFinite(height) || height < 1001) {
      return { ok: false, notes: ['cosmos state-sync height missing'] };
    }
    const trustHeight = height - 1000;
    const trustedRes = await fetchFn(`${rpc}/block?height=${trustHeight}`);
    if (!trustedRes.ok) return { ok: false, notes: [`cosmos state-sync trust http ${trustedRes.status}`] };
    const trusted = (await trustedRes.json()) as { result?: { block_id?: { hash?: string } } };
    const hash = String(trusted.result?.block_id?.hash ?? '').trim();
    if (!/^[0-9A-Fa-f]{64}$/.test(hash)) return { ok: false, notes: ['cosmos state-sync hash missing'] };
    writeFileSync(
      dest,
      [`TRUST_HEIGHT=${trustHeight}`, `TRUST_HASH=${hash}`, `RPC_SERVERS=${rpcs.join(',')}`, ''].join('\n'),
    );
    return { ok: true, notes: [] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'cosmos state-sync fetch failed'] };
  }
}

export async function ensureCosmosNodeFiles(
  dataPath: string,
  network: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; notes: string[] }> {
  const genesis = await ensureCosmosGenesisFile(dataPath, network, fetchFn);
  const sync = await ensureCosmosStateSyncFile(dataPath, network, fetchFn);
  return { ok: genesis.ok && sync.ok, notes: [...genesis.notes, ...sync.notes] };
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
    image: ${img(spec, 'ghcr.io/cosmos/gaia', 'v28.0.0-rc0')}
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
        if [ "${chainId}" = "provider" ] && [ ! -f /data/statesync.env ]; then
          echo "cosmos state-sync params missing: /data/statesync.env" >&2
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
        if [ -f /data/statesync.env ]; then
          set -a
          . /data/statesync.env
          set +a
          if [ -n "$TRUST_HEIGHT" ] && [ -n "$TRUST_HASH" ] && [ -n "$RPC_SERVERS" ]; then
            gaiad config set config statesync.enable true --home /data 2>/dev/null || true
            gaiad config set config statesync.trust_height "$TRUST_HEIGHT" --home /data 2>/dev/null || true
            gaiad config set config statesync.trust_hash "$TRUST_HASH" --home /data 2>/dev/null || true
            gaiad config set config statesync.trust_period "8h0m0s" --home /data 2>/dev/null || true
            gaiad config set config statesync.rpc_servers "$RPC_SERVERS" --home /data 2>/dev/null || true
            sed -i -e '/^\\[statesync\\]/,/^\\[/{
              s/^enable = .*/enable = true/
              s/^trust_period = .*/trust_period = "8h0m0s"/
              s/^trust_height = .*/trust_height = '"$TRUST_HEIGHT"'/
              s/^trust_hash = .*/trust_hash = "'"$TRUST_HASH"'"/
              s/^rpc_servers = .*/rpc_servers = "'"$RPC_SERVERS"'"/
            }' /data/config/config.toml || true
          fi
        fi
        if [ "${chainId}" = "provider" ]; then
          if ! awk '/^\\[statesync\\]/{p=1;next} /^\\[/{p=0} p && /^enable = true/{ok=1} END{exit ok?0:1}' /data/config/config.toml; then
            echo "cosmos state-sync not enabled in [statesync]; refusing InitChain" >&2
            exit 1
          fi
        fi
        ${RESOLVE_PUBLIC_IP_SH.split('\n').join('\n        ')}
        if [ -n "$PUB" ]; then
          gaiad config set config p2p.external_address "tcp://$PUB:26656" --home /data 2>/dev/null || true
          sed -i -e '/^\\[p2p\\]/,/^\\[/{s|^external_address = .*|external_address = "tcp://'"$PUB"':26656"|}' /data/config/config.toml || true
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

const SUI_TESTNET_SEEDS = `
p2p-config:
  listen-address: "0.0.0.0:8084"
  seed-peers:
    - address: /dns/yto-tnt-ssfn-01.testnet.sui.io/udp/8084
      peer-id: 2ed53564d5581ded9b6773970ac2f1c84d39f9edf01308ff5a1ffe09b1add7b3
    - address: /dns/yto-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: 6563732e5ab33b4ae09c73a98fd37499b71b8f03c27b5cc51acc26934974aff2
    - address: /dns/nrt-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: 23a1f7cd901b6277cbedaa986b3fc183f171d800cabba863d48f698f518967e1
    - address: /dns/ewr-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: df8a8d128051c249e224f95fcc463f518a0ebed8986bbdcc11ed751181fecd38
    - address: /dns/lax-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: f9a72a0a6c17eed09c27898eab389add704777c03e135846da2428f516a0c11d
    - address: /dns/lhr-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: 9393d6056bb9c9d8475a3cf3525c747257f17c6a698a7062cbbd1875bc6ef71e
    - address: /dns/mel-tnt-ssfn-00.testnet.sui.io/udp/8084
      peer-id: c88742f46e66a11cb8c84aca488065661401ef66f726cb9afeb8a5786d83456e
`;

const SUI_MAINNET_SEEDS = `
p2p-config:
  listen-address: "0.0.0.0:8084"
  seed-peers:
    - address: /dns/mel-00.mainnet.sui.io/udp/8084
      peer-id: d32b55bdf1737ec415df8c88b3bf91e194b59ee3127e3f38ea46fd88ba2e7849
    - address: /dns/ewr-00.mainnet.sui.io/udp/8084
      peer-id: c7bf6cb93ca8fdda655c47ebb85ace28e6931464564332bf63e27e90199c50ee
    - address: /dns/ewr-01.mainnet.sui.io/udp/8084
      peer-id: 3227f8a05f0faa1a197c075d31135a366a1c6f3d4872cb8af66c14dea3e0eb66
    - address: /dns/lhr-00.mainnet.sui.io/udp/8084
      peer-id: c619a5e0f8f36eac45118c1f8bda28f0f508e2839042781f1d4a9818043f732c
`;

export function suiFullnodeYaml(network: string): string {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet';
  const p2p = net === 'mainnet' ? SUI_MAINNET_SEEDS : SUI_TESTNET_SEEDS;
  return `# ysk-server generated Sui ${net} fullnode
db-path: /data/suidb
network-address: /ip4/0.0.0.0/tcp/8080/http
metrics-address: 0.0.0.0:9184
json-rpc-address: 0.0.0.0:9000
enable-index-processing: false
genesis:
  genesis-file-location: /data/genesis.blob
${p2p}`;
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
  const p2p = spec.ports.p2p ?? 8084;
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
      - "0.0.0.0:${p2p}:8084/udp"
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
  - network_id: "public"
    discovery_method: "onchain"
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
        soft: 1048576
        hard: 1048576
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
  const gossip = spec.ports.p2p ?? 8000;
  const gossipEnd = gossip + 20;
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
      - --no-voting
      - --limit-ledger-size
    ports:
      - "127.0.0.1:${rpc}:8899"
      - "0.0.0.0:${gossip}-${gossipEnd}:8000-8020/tcp"
      - "0.0.0.0:${gossip}-${gossipEnd}:8000-8020/udp"
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
