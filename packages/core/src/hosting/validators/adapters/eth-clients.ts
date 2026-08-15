/**
 * Ethereum EL × CL compose fragments. JWT + localhost RPC on every combo.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';

export const ETH_CHECKPOINT: Record<string, string> = {
  hoodi: 'https://checkpoint-sync.hoodi.ethpandaops.io',
  sepolia: 'https://checkpoint-sync.sepolia.ethpandaops.io',
  mainnet: 'https://beaconstate.info',
};

export const ETH_EL_IDS = ['reth', 'geth', 'nethermind'] as const;
export const ETH_CL_IDS = ['lighthouse', 'prysm', 'teku', 'nimbus'] as const;
export type EthElId = (typeof ETH_EL_IDS)[number];
export type EthClId = (typeof ETH_CL_IDS)[number];

export function isEthElId(v: string): v is EthElId {
  return (ETH_EL_IDS as readonly string[]).includes(v);
}
export function isEthClId(v: string): v is EthClId {
  return (ETH_CL_IDS as readonly string[]).includes(v);
}

export function ethNetworkFlag(network: string): 'hoodi' | 'sepolia' | 'mainnet' {
  if (network === 'mainnet' || network === 'sepolia') return network;
  return 'hoodi';
}

function elImage(spec: ValidatorInstanceDto): { id: string; image: string } {
  const c = spec.clients.el;
  return { id: c?.id ?? 'reth', image: `${c?.image ?? 'ghcr.io/paradigmxyz/reth'}:${c?.tag ?? 'v1.4.8'}` };
}
function clImage(spec: ValidatorInstanceDto): { id: string; image: string } {
  const c = spec.clients.cl;
  return { id: c?.id ?? 'lighthouse', image: `${c?.image ?? 'sigp/lighthouse'}:${c?.tag ?? 'v7.1.0'}` };
}

export function buildElService(spec: ValidatorInstanceDto, jwt: string): string {
  const net = ethNetworkFlag(spec.network);
  const { id, image } = elImage(spec);
  const rpc = spec.ports.rpc ?? 8545;
  const p2p = spec.ports.p2p ?? 30303;
  const data = JSON.stringify(`${spec.dataPath}/${id}`);
  if (id === 'geth') {
    const netFlag = net === 'mainnet' ? [] : [`      - --${net}`];
    return `  el:
    image: ${image}
    restart: unless-stopped
    command:
      - --datadir
      - /data/geth
      - --http
      - --http.addr
      - 0.0.0.0
      - --http.port
      - "8545"
      - --http.api
      - eth,net,web3,engine
      - --authrpc.addr
      - 0.0.0.0
      - --authrpc.port
      - "8551"
      - --authrpc.jwtsecret
      - ${jwt}
      - --port
      - "30303"
${netFlag.join('\n')}
    ports:
      - "127.0.0.1:${rpc}:8545"
      - "0.0.0.0:${p2p}:30303"
    volumes:
      - ${data}:/data/geth
      - ${JSON.stringify(jwtHost(spec))}:${jwt}:ro`;
  }
  if (id === 'nethermind') {
    return `  el:
    image: ${image}
    restart: unless-stopped
    command:
      - --config
      - ${net}
      - --datadir
      - /data/nethermind
      - --JsonRpc.Enabled
      - "true"
      - --JsonRpc.Host
      - 0.0.0.0
      - --JsonRpc.Port
      - "8545"
      - --JsonRpc.EngineHost
      - 0.0.0.0
      - --JsonRpc.EnginePort
      - "8551"
      - --JsonRpc.JwtSecretFile
      - ${jwt}
    ports:
      - "127.0.0.1:${rpc}:8545"
      - "0.0.0.0:${p2p}:30303"
    volumes:
      - ${data}:/data/nethermind
      - ${JSON.stringify(jwtHost(spec))}:${jwt}:ro`;
  }
  return `  el:
    image: ${image}
    restart: unless-stopped
    command:
      - node
      - --chain
      - ${net}
      - --datadir
      - /data/reth
      - --http
      - --http.addr
      - 0.0.0.0
      - --http.port
      - "8545"
      - --http.api
      - eth,net,web3,engine
      - --authrpc.addr
      - 0.0.0.0
      - --authrpc.port
      - "8551"
      - --authrpc.jwtsecret
      - ${jwt}
      - --port
      - "30303"
    ports:
      - "127.0.0.1:${rpc}:8545"
      - "0.0.0.0:${p2p}:30303"
    volumes:
      - ${data}:/data/reth
      - ${JSON.stringify(jwtHost(spec))}:${jwt}:ro`;
}

export function jwtHost(spec: ValidatorInstanceDto): string {
  const trimmed = spec.dataPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  const dir = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  return `${dir}/jwt.hex`;
}

export function buildClService(spec: ValidatorInstanceDto, jwt: string): string {
  const net = ethNetworkFlag(spec.network);
  const { id, image } = clImage(spec);
  const p2pCl = spec.ports.p2pCl ?? 9000;
  const beacon = spec.ports.beacon ?? 5052;
  const cp = ETH_CHECKPOINT[net] ?? ETH_CHECKPOINT.hoodi;
  const data = JSON.stringify(`${spec.dataPath}/${id}`);
  const jwtBind = JSON.stringify(jwtHost(spec));
  if (id === 'prysm') {
    return `  cl:
    image: ${image}
    restart: unless-stopped
    depends_on:
      - el
    command:
      - --${net}
      - --datadir
      - /data/prysm
      - --execution-endpoint
      - http://el:8551
      - --jwt-secret
      - ${jwt}
      - --checkpoint-sync-url
      - ${cp}
      - --accept-terms-of-use
      - --grpc-gateway-host
      - 0.0.0.0
      - --grpc-gateway-port
      - "3500"
      - --p2p-tcp-port
      - "9000"
    ports:
      - "127.0.0.1:${beacon}:3500"
      - "0.0.0.0:${p2pCl}:9000"
    volumes:
      - ${data}:/data/prysm
      - ${jwtBind}:${jwt}:ro`;
  }
  if (id === 'teku') {
    return `  cl:
    image: ${image}
    restart: unless-stopped
    depends_on:
      - el
    command:
      - --network=${net}
      - --data-path=/data/teku
      - --ee-endpoint=http://el:8551
      - --ee-jwt-secret-file=${jwt}
      - --checkpoint-sync-url=${cp}
      - --rest-api-enabled=true
      - --rest-api-interface=0.0.0.0
      - --rest-api-port=5051
      - --p2p-port=9000
    ports:
      - "127.0.0.1:${beacon}:5051"
      - "0.0.0.0:${p2pCl}:9000"
    volumes:
      - ${data}:/data/teku
      - ${jwtBind}:${jwt}:ro`;
  }
  if (id === 'nimbus') {
    return `  cl:
    image: ${image}
    restart: unless-stopped
    depends_on:
      - el
    command:
      - --network=${net}
      - --data-dir=/data/nimbus
      - --web3-url=http://el:8551
      - --jwt-secret=${jwt}
      - --trusted-node-url=${cp}
      - --rest
      - --rest-address=0.0.0.0
      - --rest-port=5052
      - --tcp-port=9000
      - --non-interactive
    ports:
      - "127.0.0.1:${beacon}:5052"
      - "0.0.0.0:${p2pCl}:9000"
    volumes:
      - ${data}:/data/nimbus
      - ${jwtBind}:${jwt}:ro`;
  }
  return `  cl:
    image: ${image}
    restart: unless-stopped
    depends_on:
      - el
    command:
      - lighthouse
      - bn
      - --network
      - ${net}
      - --datadir
      - /data/lighthouse
      - --execution-endpoint
      - http://el:8551
      - --execution-jwt
      - ${jwt}
      - --checkpoint-sync-url
      - ${cp}
      - --http
      - --http-address
      - 0.0.0.0
      - --http-port
      - "5052"
      - --port
      - "9000"
      - --disable-deposit-contract-sync
    ports:
      - "127.0.0.1:${beacon}:5052"
      - "0.0.0.0:${p2pCl}:9000"
    volumes:
      - ${data}:/data/lighthouse
      - ${jwtBind}:${jwt}:ro`;
}
