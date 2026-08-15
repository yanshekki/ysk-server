/**
 * Per-chain adapter contract. Implementations land in later PRs.
 * Routes and CLI must not talk to chain RPC — only adapters do.
 */
import type {
  ValidatorChainId,
  ValidatorInstanceDto,
  ValidatorProfileId,
  ValidatorRuntimeStatus,
} from 'ysk-server-shared';

export type ValidatorHostPlan = {
  notes: string[];
  composePath?: string;
  composeYaml: string;
  dataPath: string;
  images: string[];
  jwtHex?: string;
  jwtPath?: string;
  ports?: Record<string, number>;
};

export type ValidatorNodeStatus = {
  status: ValidatorRuntimeStatus;
  running: boolean;
  syncProgress: number | null;
  peers: number | null;
  version: string | null;
  diskUsedBytes: number | null;
  lastError: string | null;
  notes: string[];
};

export type ValidatorLogChunk = {
  lines: string[];
  notes: string[];
};

export type ValidatorUpgradeOffer = {
  currentTag: string;
  nextTag: string;
  clientId: string;
  breaking: boolean;
  changelogUrl?: string;
};

export interface ChainAdapter {
  id: ValidatorChainId;
  planInstall(spec: ValidatorInstanceDto): ValidatorHostPlan;
  start(spec: ValidatorInstanceDto): Promise<ValidatorNodeStatus>;
  stop(spec: ValidatorInstanceDto): Promise<ValidatorNodeStatus>;
  restart(spec: ValidatorInstanceDto): Promise<ValidatorNodeStatus>;
  status(spec: ValidatorInstanceDto): Promise<ValidatorNodeStatus>;
  logs(spec: ValidatorInstanceDto, tail?: number): Promise<ValidatorLogChunk>;
  prune?(spec: ValidatorInstanceDto): Promise<{ ok: boolean; notes: string[] }>;
  detectUpgrade(spec: ValidatorInstanceDto): Promise<ValidatorUpgradeOffer | null>;
  applyUpgrade(spec: ValidatorInstanceDto, offer: ValidatorUpgradeOffer): Promise<ValidatorNodeStatus>;
  clearData(spec: ValidatorInstanceDto): Promise<{ ok: boolean; notes: string[] }>;
  snapshotRestore?(
    spec: ValidatorInstanceDto,
    source: string,
  ): Promise<{ ok: boolean; notes: string[] }>;
}

export function profileIsMainnetSafe(profile: ValidatorProfileId): boolean {
  return profile === 'pruned' || profile === 'validator-ready' || profile === 'minimal';
}
