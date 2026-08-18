/**
 * Per-chain staking playbook — official links + i18n key map.
 * The panel never generates, uploads, or stores staking keys.
 */
import { VALIDATOR_CHAIN_IDS, type ValidatorChainId } from './validators.js';

export const STAKING_MODELS = [
  'deposit-contract',
  'p-chain-nodeid',
  'cosmos-create-validator',
  'cardano-pool',
  'near-pool',
  'sol-vote',
  'polkadot-session',
  'sui-validator',
  'aptos-validator',
  'not-pos',
] as const;
export type StakingModel = (typeof STAKING_MODELS)[number];

export type StakingPlaybookLink = { label: string; href: string };

export type StakingPlaybookMeta = {
  chain: ValidatorChainId;
  model: StakingModel;
  links: readonly StakingPlaybookLink[];
};

const OFFICIAL_HOSTS = new Set([
  'launchpad.ethereum.org',
  'hoodi.launchpad.ethereum.org',
  'staking.ethereum.org',
  'core.app',
  'build.avax.network',
  'docs.cardano.org',
  'docs.near.org',
  'near-nodes.io',
  'docs.cosmos.network',
  'docs.anza.xyz',
  'docs.polkadot.com',
  'docs.sui.io',
  'aptos.dev',
  'bitcoin.org',
]);

export const STAKING_PLAYBOOKS: readonly StakingPlaybookMeta[] = [
  {
    chain: 'eth',
    model: 'deposit-contract',
    links: [
      { label: 'Hoodi launchpad', href: 'https://hoodi.launchpad.ethereum.org' },
      { label: 'Mainnet launchpad', href: 'https://launchpad.ethereum.org' },
      { label: 'staking.ethereum.org', href: 'https://staking.ethereum.org' },
    ],
  },
  {
    chain: 'avax',
    model: 'p-chain-nodeid',
    links: [
      { label: 'Core', href: 'https://core.app' },
      {
        label: 'Turn node into validator',
        href: 'https://build.avax.network/docs/primary-network/validate/node-validator',
      },
    ],
  },
  {
    chain: 'ada',
    model: 'cardano-pool',
    links: [
      {
        label: 'Cardano stake-pool operators',
        href: 'https://docs.cardano.org/stake-pool-operators/operating-a-stake-pool',
      },
    ],
  },
  {
    chain: 'near',
    model: 'near-pool',
    links: [
      { label: 'NEAR validators', href: 'https://docs.near.org/protocol/network/validators' },
      { label: 'near-nodes.io', href: 'https://near-nodes.io/' },
    ],
  },
  {
    chain: 'cosmos',
    model: 'cosmos-create-validator',
    links: [
      {
        label: 'Cosmos Hub validator setup',
        href: 'https://docs.cosmos.network/hub/latest/validators/validator-setup',
      },
    ],
  },
  {
    chain: 'sol',
    model: 'sol-vote',
    links: [
      { label: 'Agave operations', href: 'https://docs.anza.xyz/operations' },
      {
        label: 'Validator stake',
        href: 'https://docs.anza.xyz/operations/guides/validator-stake',
      },
    ],
  },
  {
    chain: 'dot',
    model: 'polkadot-session',
    links: [
      {
        label: 'Set up a validator',
        href: 'https://docs.polkadot.com/node-infrastructure/run-a-validator/onboarding-and-offboarding/set-up-validator/',
      },
    ],
  },
  {
    chain: 'sui',
    model: 'sui-validator',
    links: [
      { label: 'Sui validator tasks', href: 'https://docs.sui.io/guides/operator/validator/validator-tasks' },
    ],
  },
  {
    chain: 'aptos',
    model: 'aptos-validator',
    links: [
      { label: 'Aptos staking', href: 'https://aptos.dev/network/blockchain/staking' },
      { label: 'Run a validator', href: 'https://aptos.dev/network/nodes/validator-node' },
    ],
  },
  {
    chain: 'btc',
    model: 'not-pos',
    links: [{ label: 'Bitcoin.org', href: 'https://bitcoin.org/en/full-node' }],
  },
];

export function stakingPlaybookAnchor(chain: string): string {
  return `stake-${chain}`;
}

export function stakingPlaybookMeta(chain: string): StakingPlaybookMeta | undefined {
  return STAKING_PLAYBOOKS.find((p) => p.chain === chain);
}

export function isOfficialStakingHref(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && OFFICIAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Every shipped chain has a playbook row (Bitcoin included as not-pos). */
export function stakingPlaybookCoversAllChains(): boolean {
  const have = new Set(STAKING_PLAYBOOKS.map((p) => p.chain));
  return VALIDATOR_CHAIN_IDS.every((id) => have.has(id));
}
