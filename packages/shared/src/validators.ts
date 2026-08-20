/**
 * Validator / L1 node manager — DTOs shared by core, API, CLI, and web.
 * Non-custodial: these types never include private keys or seed phrases.
 */

export type ValidatorChainId =
  | 'eth'
  | 'avax'
  | 'near'
  | 'ada'
  | 'btc'
  | 'cosmos'
  | 'sui'
  | 'aptos'
  | 'dot'
  | 'sol';

export type ValidatorNetworkKind = 'testnet' | 'mainnet';

export type ValidatorProfileId = 'minimal' | 'pruned' | 'validator-ready' | 'rpc';

export type ValidatorUpgradePolicy = 'manual' | 'notify' | 'auto-safe' | 'auto-all';

export type ValidatorDesiredState = 'stopped' | 'running';

export const VALIDATOR_RUNTIME_STATUSES = [
  'unknown',
  'stopped',
  'created',
  'missing',
  'starting',
  'rpc_wait',
  'running',
  'syncing',
  'error',
] as const;

export type ValidatorRuntimeStatus = (typeof VALIDATOR_RUNTIME_STATUSES)[number];

/** Container is up (or coming up). Do not treat as stopped for auto-clear. */
export function isLiveValidatorStatus(code: string | undefined | null): boolean {
  return code === 'running' || code === 'syncing' || code === 'starting' || code === 'rpc_wait';
}

export type ValidatorClientRole = 'el' | 'cl' | 'node';

export type ValidatorClientSpec = {
  id: string;
  role: ValidatorClientRole;
  image: string;
  tag: string;
  /** Shipped in the current v1 adapter set */
  v1: boolean;
};

export type ValidatorNetworkSpec = {
  id: string;
  kind: ValidatorNetworkKind;
  recommended?: boolean;
  v1: boolean;
};

export type ValidatorChainSpec = {
  id: ValidatorChainId;
  title: string;
  v1: boolean;
  /** Extra disk / IOPS warning (e.g. Solana). */
  heavy?: boolean;
  networks: ValidatorNetworkSpec[];
  profiles: ValidatorProfileId[];
  clients: ValidatorClientSpec[];
  /** Conservative minimum free bytes: network → profile → bytes */
  minFreeBytes: Record<string, Partial<Record<ValidatorProfileId, number>>>;
};

export type CardanoProducerStatusDto = {
  attached: boolean;
  kesPresent: boolean;
  vrfPresent: boolean;
  opcertPresent: boolean;
  kesFp: string | null;
  vrfFp: string | null;
  opcertFp: string | null;
  attachedAt: string | null;
};

export type ValidatorInstanceClient = {
  id: string;
  image: string;
  tag: string;
};

export type ValidatorInstanceDto = {
  id: string;
  chain: ValidatorChainId;
  network: string;
  profile: ValidatorProfileId;
  slug: string;
  dataPath: string;
  rpcHost: string;
  upgradePolicy: ValidatorUpgradePolicy;
  desiredState: ValidatorDesiredState;
  createdAt: string;
  updatedAt: string;
  clients: Record<string, ValidatorInstanceClient>;
  ports: Record<string, number>;
  lastUpgrade?: {
    at: string;
    clientId: string;
    fromTag: string;
    toTag: string;
    result: 'applied' | 'rolled-back' | 'failed';
    notes?: string[];
  };
  lastMithril?: {
    at: string;
    network: string;
    digest?: string;
  };
  /** Cardano SPO hot keys on disk — never the key material. */
  cardanoProducer?: CardanoProducerStatusDto;
  limits?: {
    memory?: string;
    cpus?: string;
  };
  lastStatus?: {
    at: string;
    status: ValidatorRuntimeStatus;
    running: boolean;
    syncProgress: number | null;
    peers: number | null;
    diskUsedBytes: number | null;
    lastError: string | null;
  };
};

export type ValidatorSettingsDto = {
  autoClear: boolean;
};

export type ValidatorOfficialVersionDto = {
  gitTag: string;
  dockerTag: string;
  prerelease: boolean;
  htmlUrl: string;
};

export type ValidatorStaleInstanceDto = {
  id: string;
  tag: string;
};

export type ValidatorSoftwareImageDto = {
  chain: string;
  clientId: string;
  role: string;
  image: string;
  tag: string;
  ref: string;
  present: boolean | null;
  size?: string | null;
  usedBy: string[];
  registryHost: string;
  sourceGithub: string | null;
  changelogUrl: string | null;
  officialTag: string | null;
  officialDockerTag: string | null;
  officialAt: string | null;
  officialError: string | null;
  staleInstances: ValidatorStaleInstanceDto[];
};

export type ValidatorClientVersionsDto = {
  clientId: string;
  image: string;
  pin: string;
  latest: string | null;
  github: string | null;
  changelogUrl: string | null;
  registryHost: string;
  at: string | null;
  error: string | null;
  versions: ValidatorOfficialVersionDto[];
};

export type ValidatorSoftwareReportDto = {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  composeAvailable: boolean;
  dockerVersion: string | null;
  composeVersion: string | null;
  images: ValidatorSoftwareImageDto[];
  officialAt: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
};

export const DEFAULT_VALIDATOR_SETTINGS: ValidatorSettingsDto = { autoClear: false };

export function isSafeValidatorLimitMemory(value: string): boolean {
  return /^\d+[mMgGkK]$/.test(String(value ?? '').trim());
}

/** Heavy chains OOM the host when the wizard leaves memory unlimited. */
export function defaultValidatorMemoryLimit(chain: string): string | undefined {
  if (chain === 'near') return '12g';
  if (chain === 'sui' || chain === 'aptos' || chain === 'sol') return '4g';
  return undefined;
}

/** Parse compose-style `12g` / `512m` into bytes. */
export function parseValidatorMemoryBytes(value: string | undefined): number | undefined {
  const m = /^(\d+)([mMgGkK])$/.exec(String(value ?? '').trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const u = m[2]!.toLowerCase();
  const mul = u === 'k' ? 1024 : u === 'm' ? 1024 ** 2 : 1024 ** 3;
  return n * mul;
}

/** Keep this much RAM for the host when a chain sets a memory cap. */
export const VALIDATOR_MEMORY_HEADROOM_BYTES = 1024 ** 3;

export function isSafeValidatorLimitCpus(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(String(value ?? '').trim());
}

/** Absolute host path for chain data. Rejects traversal and system prefixes. */
export function isSafeValidatorDataPath(value: string): boolean {
  const p = String(value ?? '').trim();
  if (!p.startsWith('/') || p.includes('..') || p.includes('\0') || p.length < 5 || p.length > 256) {
    return false;
  }
  if (!/^\/[\w./-]+$/.test(p)) return false;
  const blocked = ['/etc', '/boot', '/proc', '/sys', '/dev', '/root', '/bin', '/sbin', '/lib', '/lib64', '/run'];
  for (const b of blocked) {
    if (p === b || p.startsWith(`${b}/`)) return false;
  }
  return p !== '/';
}

export type ValidatorNetIoDto = {
  id: string;
  rxBytes: number | null;
  txBytes: number | null;
  rxRateBps: number | null;
  txRateBps: number | null;
};

export type ValidatorSummaryDto = {
  id: string;
  status: ValidatorRuntimeStatus;
  running: boolean;
  syncProgress: number | null;
  peers: number | null;
  diskUsedBytes: number | null;
  lastError: string | null;
  upgrade: {
    clientId: string;
    currentTag: string;
    nextTag: string;
    breaking: boolean;
    changelogUrl?: string;
  } | null;
  rxBytes: number | null;
  txBytes: number | null;
  rxRateBps: number | null;
  txRateBps: number | null;
};

export type ValidatorDiskTone = 'ok' | 'warn' | 'danger';

export type ValidatorDiskInstance = {
  id: string;
  dataPath: string;
  usedBytes: number;
};

export type ValidatorDiskLeftover = {
  name: string;
  path: string;
  usedBytes: number;
};

export type ValidatorDiskReport = {
  rootPath: string;
  /** du of the validators root (not the whole filesystem). */
  usedBytes: number | null;
  leftoverBytes: number;
  leftovers: ValidatorDiskLeftover[];
  /** Filesystem that holds rootPath — used for create-gate free space. */
  fsUsedBytes: number | null;
  fsAvailBytes: number | null;
  fsTotalBytes: number | null;
  fsUsePct: number | null;
  /** Alias of fsAvailBytes (wizard / KPI free space). */
  availBytes: number | null;
  /** Host MemAvailable from /proc/meminfo (create-gate for capped chains). */
  memAvailableBytes: number | null;
  totalBytes: number | null;
  usePct: number | null;
  tone: ValidatorDiskTone;
  instances: ValidatorDiskInstance[];
  notes: string[];
};

export const VALIDATOR_DISK_WARN_PCT = 70;
export const VALIDATOR_DISK_DANGER_PCT = 85;

export const VALIDATOR_CHAIN_IDS: readonly ValidatorChainId[] = [
  'eth',
  'avax',
  'near',
  'ada',
  'btc',
  'cosmos',
  'sui',
  'aptos',
  'dot',
  'sol',
];

/** Brand names — never machine-translate. */
export const VALIDATOR_CHAIN_LABEL: Record<ValidatorChainId, string> = {
  eth: 'Ethereum',
  avax: 'Avalanche',
  near: 'NEAR',
  ada: 'Cardano',
  btc: 'Bitcoin',
  cosmos: 'Cosmos Hub',
  sui: 'Sui',
  aptos: 'Aptos',
  dot: 'Polkadot',
  sol: 'Solana',
};

/** Network proper nouns — never machine-translate. Generic kinds (mainnet/testnet) stay i18n. */
export const VALIDATOR_NETWORK_PROPER: Record<string, string> = {
  hoodi: 'Hoodi',
  sepolia: 'Sepolia',
  fuji: 'Fuji',
  westend: 'Westend',
  preview: 'Preview',
  preprod: 'Preprod',
};

/** Display name for a (chain, network) pair. Generic `testnet` includes the chain. */
export function validatorNetworkLabelFor(chain: string, network: string): string | null {
  const proper = VALIDATOR_NETWORK_PROPER[network];
  if (proper) return proper;
  if (network === 'testnet' && isValidatorChainId(chain)) {
    return `${VALIDATOR_CHAIN_LABEL[chain]} Testnet`;
  }
  return null;
}

export function validatorChainLabel(id: string, title?: string | null): string {
  if (title && title.trim()) return title.trim();
  if (isValidatorChainId(id)) return VALIDATOR_CHAIN_LABEL[id];
  return id;
}

export function validatorNetworkLabel(id: string): string | null {
  return VALIDATOR_NETWORK_PROPER[id] ?? null;
}

export const VALIDATOR_PROFILE_IDS: readonly ValidatorProfileId[] = [
  'minimal',
  'pruned',
  'validator-ready',
  'rpc',
];

export const VALIDATOR_UPGRADE_POLICIES: readonly ValidatorUpgradePolicy[] = [
  'manual',
  'notify',
  'auto-safe',
  'auto-all',
];

/** Instance ids: chain-network-slug, e.g. eth-hoodi-1 */
const INSTANCE_ID_RE = /^[a-z][a-z0-9]*-[a-z0-9]+-[a-z0-9][a-z0-9-]{0,40}$/;

export function isValidatorChainId(value: string): value is ValidatorChainId {
  return (VALIDATOR_CHAIN_IDS as readonly string[]).includes(value);
}

export function isValidatorProfileId(value: string): value is ValidatorProfileId {
  return (VALIDATOR_PROFILE_IDS as readonly string[]).includes(value);
}

export function isValidatorUpgradePolicy(value: string): value is ValidatorUpgradePolicy {
  return (VALIDATOR_UPGRADE_POLICIES as readonly string[]).includes(value);
}

export function isValidatorInstanceId(value: string): boolean {
  return INSTANCE_ID_RE.test(String(value ?? '').trim());
}

export function validatorDiskTone(usePct: number | null | undefined): ValidatorDiskTone {
  if (usePct == null || !Number.isFinite(usePct)) return 'ok';
  if (usePct >= VALIDATOR_DISK_DANGER_PCT) return 'danger';
  if (usePct >= VALIDATOR_DISK_WARN_PCT) return 'warn';
  return 'ok';
}

export function defaultUpgradePolicyForNetworkKind(
  kind: ValidatorNetworkKind,
): ValidatorUpgradePolicy {
  return kind === 'mainnet' ? 'manual' : 'notify';
}
