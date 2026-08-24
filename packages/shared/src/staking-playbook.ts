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

const NEAR_POOL_SLUG_RE = /^[a-z0-9]([a-z0-9_-]{0,30}[a-z0-9])?$/;
const NEAR_OWNER_RE = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;
const NEAR_SECRETISH = /secret_key|private_key|seed/i;

/** Pool prefix only — factory appends `.pool.f863973.m0` / `.poolv1.near`. */
export function isNearPoolSlug(value: string): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  if (s.length < 2 || s.length > 32 || s.includes('.')) return false;
  if (NEAR_SECRETISH.test(s)) return false;
  return NEAR_POOL_SLUG_RE.test(s);
}

export function isNearOwnerAccountId(value: string): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  if (s.length < 2 || s.length > 64 || s.includes('..')) return false;
  if (NEAR_SECRETISH.test(s)) return false;
  return NEAR_OWNER_RE.test(s);
}

export function resolveNearPoolAccountId(input: {
  network: string;
  poolSlug?: string | null;
  accountId?: string | null;
}): { ok: true; poolSlug: string; accountId: string } | { ok: false } {
  const { poolAccountSuffix } = nearStakingFactory(input.network);
  const rawAccount = String(input.accountId ?? '')
    .trim()
    .toLowerCase();
  const rawSlug = String(input.poolSlug ?? '')
    .trim()
    .toLowerCase();
  let slug = rawSlug;
  if (!slug && rawAccount) {
    slug = rawAccount.endsWith(poolAccountSuffix)
      ? rawAccount.slice(0, -poolAccountSuffix.length)
      : rawAccount;
  }
  if (!isNearPoolSlug(slug)) return { ok: false };
  const accountId = `${slug}${poolAccountSuffix}`;
  if (rawAccount && rawAccount !== accountId && rawAccount !== slug) return { ok: false };
  return { ok: true, poolSlug: slug, accountId };
}

/** Official near-cli form from near-nodes.io. Placeholders stay until pool / owner / key exist. */
export function buildNearCreateStakingPoolCommand(input: {
  network: string;
  stakePublicKey?: string | null;
  poolId?: string | null;
  ownerId?: string | null;
}): string {
  const { factoryAccount } = nearStakingFactory(input.network);
  const key = input.stakePublicKey?.trim() || '<STAKE_PUBLIC_KEY>';
  const pool = isNearPoolSlug(String(input.poolId ?? ''))
    ? String(input.poolId).trim().toLowerCase()
    : '<POOL_ID>';
  const owner = isNearOwnerAccountId(String(input.ownerId ?? ''))
    ? String(input.ownerId).trim().toLowerCase()
    : '<OWNER_ID>';
  const args = JSON.stringify({
    staking_pool_id: pool,
    owner_id: owner,
    stake_public_key: key,
    reward_fee_fraction: {
      numerator: NEAR_STAKING_FEE.numerator,
      denominator: NEAR_STAKING_FEE.denominator,
    },
  });
  return `near call ${factoryAccount} create_staking_pool '${args}' --accountId="${owner}" --amount=${NEAR_STAKING_STORAGE_NEAR} --gas=300000000000000`;
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
  /** gaiad v28 / SDK 0.53 body — save as validator.json; not the Hub docs flag form. */
  createValidatorJson: string;
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

export function parseCosmosAmountUatom(raw?: string | null): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+uatom$/.test(s) && s.length <= 24) return s;
  const atom = /^(\d+)(?:\.(\d{1,6}))?atom$/.exec(s);
  if (atom) {
    const whole = BigInt(atom[1]);
    const frac = BigInt((atom[2] ?? '').padEnd(6, '0') || '0');
    const u = whole * 1_000_000n + frac;
    if (u <= 0n || u > 10n ** 18n) return null;
    return `${u}uatom`;
  }
  if (/^\d+$/.test(s) && s.length <= 18) return `${s}uatom`;
  return null;
}

/** Human ATOM amount for a parsed `Nuatom` string, or null. */
export function cosmosAmountAtomLabel(uatom: string): string | null {
  const m = /^(\d+)uatom$/.exec(uatom);
  if (!m) return null;
  const n = BigInt(m[1]);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  if (frac === 0n) return `${whole} ATOM`;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr} ATOM`;
}

function cosmosAmountOrPlaceholder(raw?: string | null): string {
  return parseCosmosAmountUatom(raw) ?? '<AMOUNT_uatom>';
}

function cosmosMoniker(raw?: string | null): string {
  const s = String(raw ?? '').trim();
  if (s.length >= 1 && s.length <= 70 && !/[\\'"`$]/.test(s)) return s;
  return '<MONIKER>';
}

function cosmosFromKey(raw?: string | null): string {
  const s = String(raw ?? '').trim();
  if (s.length >= 1 && s.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(s)) return s;
  return '<KEY_NAME>';
}

function cosmosPubkeyField(raw?: string | null): unknown {
  const s = raw?.trim();
  if (!s) return '<CONSENSUS_PUBKEY_JSON>';
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === 'object') return v;
  } catch {
    /* placeholder */
  }
  return s;
}

/** gaiad v28 JSON body. Hub docs still show flags — those fail on this node. */
export function buildCosmosCreateValidatorJson(input: {
  consensusPubkey?: string | null;
  amountUatom?: string | null;
  moniker?: string | null;
}): string {
  return JSON.stringify(
    {
      pubkey: cosmosPubkeyField(input.consensusPubkey),
      amount: cosmosAmountOrPlaceholder(input.amountUatom),
      moniker: cosmosMoniker(input.moniker),
      identity: '',
      website: '',
      security: '',
      details: '',
      'commission-rate': '0.10',
      'commission-max-rate': '0.20',
      'commission-max-change-rate': '0.01',
      'min-self-delegation': '1',
    },
    null,
    2,
  );
}

export function buildCosmosCreateValidatorCommand(input: {
  network: string;
  consensusPubkey?: string | null;
  amountUatom?: string | null;
  moniker?: string | null;
  fromKey?: string | null;
}): string {
  const chainId = cosmosStakingChainId(input.network);
  const fromKey = cosmosFromKey(input.fromKey);
  return [
    'gaiad tx staking create-validator validator.json',
    `--from=${fromKey}`,
    `--chain-id=${chainId}`,
    '--gas="auto"',
    '--gas-prices="0.005uatom"',
  ].join(' \\\n  ');
}

export function cosmosCreateValidatorFilled(input: {
  consensusPubkey?: string | null;
  amountUatom?: string | null;
  moniker?: string | null;
  fromKey?: string | null;
}): boolean {
  return Boolean(
    input.consensusPubkey?.trim() &&
      parseCosmosAmountUatom(input.amountUatom) &&
      cosmosMoniker(input.moniker) !== '<MONIKER>' &&
      cosmosFromKey(input.fromKey) !== '<KEY_NAME>',
  );
}

/**
 * Copyable example only — this compose does not run a validator client.
 * Non-Lighthouse CLs: null (copy the beacon URL; do not invent a lighthouse command).
 */
export function ethValidatorClientCommand(input: {
  network: string;
  beaconUrl?: string | null;
  cl?: string | null;
}): string | null {
  const beacon = String(input.beaconUrl ?? '').trim();
  if (!beacon) return null;
  const cl = String(input.cl ?? 'lighthouse').trim().toLowerCase();
  if (cl && cl !== 'lighthouse') return null;
  const net = input.network === 'mainnet' ? 'mainnet' : input.network === 'hoodi' ? 'hoodi' : input.network;
  return `lighthouse vc --network ${net} --beacon-nodes ${beacon}`;
}

export function emptyCosmosStakingIdentity(network: string): CosmosStakingIdentityDto {
  return {
    consensusPubkey: null,
    chainId: cosmosStakingChainId(network),
    externalAddress: null,
    createCommand: buildCosmosCreateValidatorCommand({ network }),
    createValidatorJson: buildCosmosCreateValidatorJson({}),
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
