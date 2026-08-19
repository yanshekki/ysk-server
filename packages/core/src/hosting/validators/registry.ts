/**
 * Static chain catalog for the validators feature.
 * Adapter implementations live beside this file; this is metadata only.
 */
import type {
  ValidatorChainId,
  ValidatorChainSpec,
  ValidatorProfileId,
} from 'ysk-server-shared';

const GiB = 1024 ** 3;

export const VALIDATOR_CHAIN_CATALOG: readonly ValidatorChainSpec[] = [
  {
    id: 'eth',
    title: 'Ethereum',
    v1: true,
    networks: [
      { id: 'hoodi', kind: 'testnet', recommended: true, v1: true },
      { id: 'sepolia', kind: 'testnet', v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'reth', role: 'el', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.4.8', v1: true },
      { id: 'geth', role: 'el', image: 'ethereum/client-go', tag: 'v1.15.11', v1: true },
      { id: 'nethermind', role: 'el', image: 'nethermind/nethermind', tag: '1.31.11', v1: true },
      { id: 'lighthouse', role: 'cl', image: 'sigp/lighthouse', tag: 'v7.1.0', v1: true },
      {
        id: 'prysm',
        role: 'cl',
        image: 'gcr.io/prysmaticlabs/prysm/beacon-chain',
        tag: 'v6.0.4',
        v1: true,
      },
      { id: 'teku', role: 'cl', image: 'consensys/teku', tag: '25.4.1', v1: true },
      { id: 'nimbus', role: 'cl', image: 'statusim/nimbus-eth2', tag: 'multiarch-v25.4.1', v1: true },
    ],
    minFreeBytes: {
      hoodi: {
        minimal: 40 * GiB,
        pruned: 60 * GiB,
        'validator-ready': 80 * GiB,
        rpc: 40 * GiB,
      },
      sepolia: {
        minimal: 40 * GiB,
        pruned: 60 * GiB,
        'validator-ready': 80 * GiB,
        rpc: 40 * GiB,
      },
      mainnet: {
        minimal: 800 * GiB,
        pruned: 900 * GiB,
        'validator-ready': 1200 * GiB,
        rpc: 800 * GiB,
      },
    },
  },
  {
    id: 'avax',
    title: 'Avalanche',
    v1: true,
    networks: [
      { id: 'fuji', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      {
        id: 'avalanchego',
        role: 'node',
        image: 'avaplatform/avalanchego',
        tag: 'v1.13.5',
        v1: true,
      },
    ],
    minFreeBytes: {
      fuji: {
        minimal: 20 * GiB,
        pruned: 30 * GiB,
        'validator-ready': 40 * GiB,
        rpc: 20 * GiB,
      },
      mainnet: {
        minimal: 200 * GiB,
        pruned: 250 * GiB,
        'validator-ready': 400 * GiB,
        rpc: 200 * GiB,
      },
    },
  },
  {
    id: 'near',
    title: 'NEAR',
    v1: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      {
        id: 'neard',
        role: 'node',
        image: 'nearprotocol/nearcore',
        tag: '2.5.0',
        v1: true,
      },
    ],
    minFreeBytes: {
      testnet: {
        minimal: 50 * GiB,
        pruned: 80 * GiB,
        'validator-ready': 100 * GiB,
        rpc: 50 * GiB,
      },
      mainnet: {
        minimal: 400 * GiB,
        pruned: 500 * GiB,
        'validator-ready': 700 * GiB,
        rpc: 400 * GiB,
      },
    },
  },
  {
    id: 'ada',
    title: 'Cardano',
    v1: true,
    networks: [
      { id: 'preview', kind: 'testnet', recommended: true, v1: true },
      { id: 'preprod', kind: 'testnet', v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      {
        id: 'cardano-node',
        role: 'node',
        image: 'ghcr.io/intersectmbo/cardano-node',
        tag: '11.0.1',
        v1: true,
      },
    ],
    minFreeBytes: {
      preview: {
        minimal: 20 * GiB,
        pruned: 30 * GiB,
        'validator-ready': 40 * GiB,
        rpc: 20 * GiB,
      },
      preprod: {
        minimal: 30 * GiB,
        pruned: 40 * GiB,
        'validator-ready': 50 * GiB,
        rpc: 30 * GiB,
      },
      mainnet: {
        minimal: 150 * GiB,
        pruned: 200 * GiB,
        'validator-ready': 250 * GiB,
        rpc: 150 * GiB,
      },
    },
  },
  {
    id: 'btc',
    title: 'Bitcoin',
    v1: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'bitcoind', role: 'node', image: 'lncm/bitcoind', tag: 'v28.0', v1: true },
    ],
    minFreeBytes: {
      testnet: { minimal: 10 * GiB, pruned: 15 * GiB, 'validator-ready': 20 * GiB, rpc: 10 * GiB },
      mainnet: { minimal: 20 * GiB, pruned: 30 * GiB, 'validator-ready': 40 * GiB, rpc: 20 * GiB },
    },
  },
  {
    id: 'cosmos',
    title: 'Cosmos Hub',
    v1: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'gaiad', role: 'node', image: 'ghcr.io/cosmos/gaia', tag: 'v23.3.0', v1: true },
    ],
    minFreeBytes: {
      testnet: { minimal: 20 * GiB, pruned: 30 * GiB, 'validator-ready': 40 * GiB, rpc: 20 * GiB },
      mainnet: { minimal: 200 * GiB, pruned: 300 * GiB, 'validator-ready': 400 * GiB, rpc: 200 * GiB },
    },
  },
  {
    id: 'sui',
    title: 'Sui',
    v1: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'sui-node', role: 'node', image: 'mysten/sui-node', tag: 'mainnet-v1.44.2', v1: true },
    ],
    minFreeBytes: {
      testnet: { minimal: 40 * GiB, pruned: 60 * GiB, 'validator-ready': 80 * GiB, rpc: 40 * GiB },
      mainnet: { minimal: 400 * GiB, pruned: 500 * GiB, 'validator-ready': 700 * GiB, rpc: 400 * GiB },
    },
  },
  {
    id: 'aptos',
    title: 'Aptos',
    v1: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'aptos-node', role: 'node', image: 'aptoslabs/validator', tag: 'aptos-node-v1.27.2', v1: true },
    ],
    minFreeBytes: {
      testnet: { minimal: 40 * GiB, pruned: 60 * GiB, 'validator-ready': 80 * GiB, rpc: 40 * GiB },
      mainnet: { minimal: 400 * GiB, pruned: 500 * GiB, 'validator-ready': 700 * GiB, rpc: 400 * GiB },
    },
  },
  {
    id: 'dot',
    title: 'Polkadot',
    v1: true,
    networks: [
      { id: 'westend', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'polkadot', role: 'node', image: 'parity/polkadot', tag: 'v1.16.1', v1: true },
    ],
    minFreeBytes: {
      westend: { minimal: 30 * GiB, pruned: 40 * GiB, 'validator-ready': 50 * GiB, rpc: 30 * GiB },
      mainnet: { minimal: 200 * GiB, pruned: 300 * GiB, 'validator-ready': 400 * GiB, rpc: 200 * GiB },
    },
  },
  {
    id: 'sol',
    title: 'Solana',
    v1: true,
    heavy: true,
    networks: [
      { id: 'testnet', kind: 'testnet', recommended: true, v1: true },
      { id: 'mainnet', kind: 'mainnet', v1: true },
    ],
    profiles: ['minimal', 'pruned', 'validator-ready', 'rpc'],
    clients: [
      { id: 'agave', role: 'node', image: 'solanalabs/solana', tag: 'v2.1.11', v1: true },
    ],
    minFreeBytes: {
      testnet: { minimal: 200 * GiB, pruned: 300 * GiB, 'validator-ready': 400 * GiB, rpc: 200 * GiB },
      mainnet: { minimal: 2000 * GiB, pruned: 2200 * GiB, 'validator-ready': 2500 * GiB, rpc: 2000 * GiB },
    },
  },
];

const BY_ID = new Map(VALIDATOR_CHAIN_CATALOG.map((c) => [c.id, c]));

export function listValidatorChains(): ValidatorChainSpec[] {
  return VALIDATOR_CHAIN_CATALOG.map((c) => ({
    ...c,
    networks: c.networks.map((n) => ({ ...n })),
    profiles: [...c.profiles],
    clients: c.clients.map((cl) => ({ ...cl })),
    minFreeBytes: { ...c.minFreeBytes },
  }));
}

export function getValidatorChain(id: string): ValidatorChainSpec | undefined {
  return BY_ID.get(id as ValidatorChainId);
}

export function getValidatorNetwork(chainId: string, networkId: string) {
  const chain = getValidatorChain(chainId);
  return chain?.networks.find((n) => n.id === networkId);
}

export function minFreeBytesFor(
  chainId: string,
  networkId: string,
  profile: ValidatorProfileId,
): number | undefined {
  const chain = getValidatorChain(chainId);
  const byNet = chain?.minFreeBytes[networkId];
  if (!byNet) return undefined;
  return byNet[profile] ?? byNet.minimal ?? byNet.pruned;
}

export function defaultValidatorNetwork(chainId: string): string | undefined {
  const chain = getValidatorChain(chainId);
  if (!chain) return undefined;
  return chain.networks.find((n) => n.recommended)?.id ?? chain.networks[0]?.id;
}

export function v1ValidatorClients(chainId: string) {
  return (getValidatorChain(chainId)?.clients ?? []).filter((c) => c.v1);
}

export function resolveValidatorClients(
  chainId: string,
  want?: { el?: string; cl?: string; node?: string },
) {
  const all = v1ValidatorClients(chainId);
  const out: Record<string, { id: string; image: string; tag: string }> = {};
  if (chainId === 'eth') {
    const els = all.filter((c) => c.role === 'el');
    const cls = all.filter((c) => c.role === 'cl');
    const el = els.find((c) => c.id === want?.el) ?? els.find((c) => c.id === 'reth') ?? els[0];
    const cl = cls.find((c) => c.id === want?.cl) ?? cls.find((c) => c.id === 'lighthouse') ?? cls[0];
    if (el) out.el = { id: el.id, image: el.image, tag: el.tag };
    if (cl) out.cl = { id: cl.id, image: cl.image, tag: cl.tag };
    return out;
  }
  const node = all.find((c) => !want?.node || c.id === want.node) ?? all[0];
  if (node) out[node.role] = { id: node.id, image: node.image, tag: node.tag };
  return out;
}
