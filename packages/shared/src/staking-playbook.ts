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
      {
        label: 'Deploy mainnet pool',
        href: 'https://near-nodes.io/validator/deploy-on-mainnet',
      },
      {
        label: 'Run a validator node',
        href: 'https://near-nodes.io/validator/compile-and-run-a-node',
      },
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
        label: 'Vote accounts',
        href: 'https://docs.anza.xyz/operations/guides/vote-accounts',
      },
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

/** Official staking-pool factory — contract does not take a server IP. */
export const NEAR_STAKING_STORAGE_NEAR = 30;
export const NEAR_STAKING_FEE = { numerator: 5, denominator: 100 } as const;

export type NearStakingFactory = {
  factoryAccount: string;
  poolAccountSuffix: string;
};

export type NearStakingIdentityDto = {
  stakePublicKey: string | null;
  accountId: string | null;
  publicAddr: string | null;
  factoryAccount: string;
  poolAccountSuffix: string;
  storageNear: number;
  createCommand: string;
};

export function nearStakingFactory(network: string): NearStakingFactory {
  if (network === 'mainnet') {
    return { factoryAccount: 'poolv1.near', poolAccountSuffix: '.poolv1.near' };
  }
  return { factoryAccount: 'pool.f863973.m0', poolAccountSuffix: '.pool.f863973.m0' };
}

/** Official near-cli form from near-nodes.io. Placeholders stay for pool / owner. */
export function buildNearCreateStakingPoolCommand(input: {
  network: string;
  stakePublicKey?: string | null;
}): string {
  const { factoryAccount } = nearStakingFactory(input.network);
  const key = input.stakePublicKey?.trim() || '<STAKE_PUBLIC_KEY>';
  const args = JSON.stringify({
    staking_pool_id: '<POOL_ID>',
    owner_id: '<OWNER_ID>',
    stake_public_key: key,
    reward_fee_fraction: {
      numerator: NEAR_STAKING_FEE.numerator,
      denominator: NEAR_STAKING_FEE.denominator,
    },
  });
  return `near call ${factoryAccount} create_staking_pool '${args}' --accountId="<OWNER_ID>" --amount=${NEAR_STAKING_STORAGE_NEAR} --gas=300000000000000`;
}

export function emptyNearStakingIdentity(network: string): NearStakingIdentityDto {
  const factory = nearStakingFactory(network);
  return {
    stakePublicKey: null,
    accountId: null,
    publicAddr: null,
    factoryAccount: factory.factoryAccount,
    poolAccountSuffix: factory.poolAccountSuffix,
    storageNear: NEAR_STAKING_STORAGE_NEAR,
    createCommand: buildNearCreateStakingPoolCommand({ network }),
  };
}

/** Matches compose `gaiad init` chain-id (ICS provider testnet, Hub mainnet). */
export function cosmosStakingChainId(network: string): string {
  return network === 'mainnet' ? 'cosmoshub-4' : 'provider';
}

export type CosmosStakingIdentityDto = {
  consensusPubkey: string | null;
  chainId: string;
  externalAddress: string | null;
  createCommand: string;
};

export function cosmosConsensusPubkeyJson(input: {
  type?: string | null;
  value?: string | null;
}): string | null {
  const value = input.value?.trim();
  if (!value || !/^[A-Za-z0-9+/]+=*$/.test(value) || value.length < 16) return null;
  const type = (input.type ?? '').trim();
  if (type && !/ed25519/i.test(type) && !/cosmos.crypto/i.test(type)) return null;
  return JSON.stringify({
    '@type': '/cosmos.crypto.ed25519.PubKey',
    key: value,
  });
}

export function buildCosmosCreateValidatorCommand(input: {
  network: string;
  consensusPubkey?: string | null;
}): string {
  const chainId = cosmosStakingChainId(input.network);
  const pubkey = input.consensusPubkey?.trim() || '<CONSENSUS_PUBKEY_JSON>';
  return [
    'gaiad tx staking create-validator',
    '--amount=<AMOUNT_uatom>',
    `--pubkey='${pubkey}'`,
    '--moniker="<MONIKER>"',
    `--chain-id=${chainId}`,
    '--commission-rate="0.10"',
    '--commission-max-rate="0.20"',
    '--commission-max-change-rate="0.01"',
    '--gas="auto"',
    '--gas-prices="0.005uatom"',
    '--from=<KEY_NAME>',
  ].join(' \\\n  ');
}

export function emptyCosmosStakingIdentity(network: string): CosmosStakingIdentityDto {
  return {
    consensusPubkey: null,
    chainId: cosmosStakingChainId(network),
    externalAddress: null,
    createCommand: buildCosmosCreateValidatorCommand({ network }),
  };
}

export type SolStakingIdentityDto = {
  identityPubkey: string | null;
};

export function ethLaunchpadHref(network: string): string | null {
  if (network === 'mainnet') return 'https://launchpad.ethereum.org';
  if (network === 'hoodi') return 'https://hoodi.launchpad.ethereum.org';
  return null;
}

/** Instance page: only the launchpad that matches this network. */
export function stakingPlaybookLinksForInstance(
  chain: string,
  network: string,
): readonly StakingPlaybookLink[] {
  const meta = stakingPlaybookMeta(chain);
  const links = meta?.links ?? [];
  if (chain !== 'eth') return links;
  const launchpad = ethLaunchpadHref(network);
  return links.filter((l) => {
    if (l.href.includes('launchpad.ethereum.org')) {
      return launchpad != null && l.href === launchpad;
    }
    return true;
  });
}
