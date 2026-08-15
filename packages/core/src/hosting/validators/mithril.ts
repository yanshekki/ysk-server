/**
 * Cardano Mithril one-click snapshot restore (no block-producer keys).
 */
import { classifyDockerArgv } from '../docker/argv.js';
import type { HostExecutor } from '../../host/executor.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import { tl } from 'ysk-server-shared';
import {
  appliedValidatorOp,
  blockedValidatorOp,
  failedValidatorOp,
  writtenValidatorOp,
  type ValidatorOpsResult,
} from './honesty.js';
import { composeProjectName, composeFilePath, composeDown, composeUp } from './compose-runner.js';
import { getValidatorInstance, instanceDir, upsertValidatorInstance } from './store.js';
import { probeDockerCompose } from './compose-runner.js';

export const MITHRIL_CLIENT_IMAGE = 'ghcr.io/input-output-hk/mithril-client:2537.1';

export const MITHRIL_NETWORKS: Record<
  string,
  { aggregator: string; genesisKeyUrl: string }
> = {
  preview: {
    aggregator: 'https://aggregator.pre-release-preview.api.mithril.network/aggregator',
    genesisKeyUrl:
      'https://raw.githubusercontent.com/IntersectMBO/mithril/main/mithril-infra/configuration/pre-release-preview/genesis.vkey',
  },
  preprod: {
    aggregator: 'https://aggregator.release-preprod.api.mithril.network/aggregator',
    genesisKeyUrl:
      'https://raw.githubusercontent.com/IntersectMBO/mithril/main/mithril-infra/configuration/release-preprod/genesis.vkey',
  },
  mainnet: {
    aggregator: 'https://aggregator.release-mainnet.api.mithril.network/aggregator',
    genesisKeyUrl:
      'https://raw.githubusercontent.com/IntersectMBO/mithril/main/mithril-infra/configuration/release-mainnet/genesis.vkey',
  },
};

export function mithrilConfigFor(network: string) {
  return MITHRIL_NETWORKS[network] ?? MITHRIL_NETWORKS.preview!;
}

export function buildMithrilRunArgv(input: {
  instanceId: string;
  dataPath: string;
  aggregator: string;
  genesisKey: string;
}): string[] {
  return [
    'run',
    '--rm',
    '--name',
    `ysk-mithril-${input.instanceId}`.slice(0, 60),
    '-e',
    `AGGREGATOR_ENDPOINT=${input.aggregator}`,
    '-e',
    `GENESIS_VERIFICATION_KEY=${input.genesisKey}`,
    '-v',
    `${input.dataPath}:/data`,
    MITHRIL_CLIENT_IMAGE,
    'cardano-db',
    'download',
    'latest',
    '--download-dir',
    '/data',
  ];
}

export function isMithrilConfirm(id: string, confirm: string | undefined): boolean {
  const c = String(confirm ?? '').trim();
  return c === id || c.toUpperCase() === 'MITHRIL';
}

export async function restoreAdaMithril(input: {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  id: string;
  confirm?: string;
  fetchFn?: typeof fetch;
}): Promise<ValidatorOpsResult> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  }
  if (inst.chain !== 'ada') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.mithrilAdaOnly')] });
  }
  if (!isMithrilConfirm(inst.id, input.confirm)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.needMithrilConfirm')] });
  }
  const cfg = mithrilConfigFor(inst.network);
  const argv = buildMithrilRunArgv({
    instanceId: inst.id,
    dataPath: inst.dataPath,
    aggregator: cfg.aggregator,
    genesisKey: 'PENDING',
  });
  if (classifyDockerArgv(['docker', ...argv]) === 'blocked') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.mithrilBlocked')] });
  }
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [],
      notes: [tl('validators.notes.dryMithril'), cfg.aggregator],
    });
  }
  const docker = await probeDockerCompose(input.host);
  if (!docker.ok) {
    return blockedValidatorOp({
      reason: 'missing_binary',
      instanceId: inst.id,
      notes: [tl('validators.errors.needDocker'), ...docker.notes],
    });
  }
  const fetchFn = input.fetchFn ?? fetch;
  let genesisKey = '';
  try {
    const res = await fetchFn(cfg.genesisKeyUrl);
    genesisKey = (await res.text()).trim();
  } catch (e) {
    return failedValidatorOp({
      instanceId: inst.id,
      notes: [tl('validators.errors.mithrilKey'), e instanceof Error ? e.message : 'fetch failed'],
    });
  }
  if (!genesisKey || genesisKey.length < 32) {
    return failedValidatorOp({ instanceId: inst.id, notes: [tl('validators.errors.mithrilKey')] });
  }

  const composePath = composeFilePath(instanceDir(input.dataDir, inst.id));
  const project = composeProjectName(inst.id);
  await composeDown({ host: input.host, file: composePath, project, execute: true });

  const runArgv = buildMithrilRunArgv({
    instanceId: inst.id,
    dataPath: inst.dataPath,
    aggregator: cfg.aggregator,
    genesisKey,
  });
  const run = await input.host.runCommand(['docker', ...runArgv], { timeoutMs: 3_600_000 });
  if (run.exitCode !== 0) {
    return failedValidatorOp({
      instanceId: inst.id,
      notes: [tl('validators.errors.mithrilFailed'), run.stderr || run.stdout],
    });
  }

  await composeUp({ host: input.host, file: composePath, project, execute: true });
  const next: ValidatorInstanceDto = {
    ...inst,
    lastMithril: { at: new Date().toISOString(), network: inst.network },
    desiredState: 'running',
    updatedAt: new Date().toISOString(),
  };
  upsertValidatorInstance(input.dataDir, next);
  return appliedValidatorOp({ instanceId: inst.id, notes: [tl('validators.notes.mithril')] });
}
