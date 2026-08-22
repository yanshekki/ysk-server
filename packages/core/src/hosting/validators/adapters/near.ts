/**
 * NEAR adapter — neard. RPC vs validator-ready share the same binary;
 * validator keys are never written by the panel. Public fields only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NearStakingIdentityDto, ValidatorInstanceDto } from 'ysk-server-shared';
import {
  buildNearCreateStakingPoolCommand,
  emptyNearStakingIdentity,
  NEAR_STAKING_STORAGE_NEAR,
  nearStakingFactory,
} from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';
import { readRpcJson } from '../rpc-json.js';
import { composeCommandScript, RESOLVE_PUBLIC_IP_SH } from './p2p-public-ip.js';

const NEAR_KEY_MAX_BYTES = 64 * 1024;
const NEAR_PUBKEY_RE = /^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,100}$/;
const SECRET_FIELD = /secret_key|private_key/i;

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
${composeCommandScript(`set -e
if [ ! -f /data/config.json ]; then
  neard --home /data init --chain-id ${chainId} --download-genesis --download-config
fi
${RESOLVE_PUBLIC_IP_SH}
if [ -n "$PUB" ] && [ -f /data/config.json ]; then
  if grep -q '"public_addr"' /data/config.json; then
    sed -i "s/\\"public_addr\\": \\"[^\\"]*\\"/\\"public_addr\\": \\"$PUB:${p2p}\\"/" /data/config.json || true
  else
    sed -i "s/\\"addr\\": \\"0.0.0.0:24567\\"/\\"addr\\": \\"0.0.0.0:24567\\",\\n    \\"public_addr\\": \\"$PUB:${p2p}\\"/" /data/config.json || true
  fi
fi
neard --home /data run`)}
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

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    if (raw.length > NEAR_KEY_MAX_BYTES) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asNearPublicKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return NEAR_PUBKEY_RE.test(s) ? s : null;
}

function asAccountId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 64 || SECRET_FIELD.test(s)) return null;
  return s;
}

function pickPublicAddr(config: Record<string, unknown>): string | null {
  const nested = config.network;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const addr = (nested as Record<string, unknown>).public_addr;
    if (typeof addr === 'string' && addr.trim() && !SECRET_FIELD.test(addr)) return addr.trim();
  }
  if (typeof config.public_addr === 'string' && config.public_addr.trim() && !SECRET_FIELD.test(config.public_addr)) {
    return config.public_addr.trim();
  }
  return null;
}

/**
 * Public staking identity from disk. Never returns secret_key.
 * Keys exist after `neard init` — do not wait for RPC.
 */
export function readNearStakingIdentity(
  spec: Pick<ValidatorInstanceDto, 'network' | 'dataPath'>,
): NearStakingIdentityDto {
  const network = spec.network;
  const base = emptyNearStakingIdentity(network);
  const data = String(spec.dataPath ?? '').replace(/\/+$/, '');
  if (!data) return base;
  const keyFile = readJsonObject(join(data, 'validator_key.json'));
  const stakePublicKey = keyFile ? asNearPublicKey(keyFile.public_key) : null;
  const accountId = keyFile ? asAccountId(keyFile.account_id) : null;
  const config = readJsonObject(join(data, 'config.json'));
  const publicAddr = config ? pickPublicAddr(config) : null;
  const factory = nearStakingFactory(network);
  return {
    stakePublicKey,
    accountId,
    publicAddr,
    factoryAccount: factory.factoryAccount,
    poolAccountSuffix: factory.poolAccountSuffix,
    storageNear: NEAR_STAKING_STORAGE_NEAR,
    createCommand: buildNearCreateStakingPoolCommand({ network, stakePublicKey }),
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
