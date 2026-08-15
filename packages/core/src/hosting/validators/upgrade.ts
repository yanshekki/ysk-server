/**
 * Detect / apply client tag upgrades from the pinned registry.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidatorInstanceDto, ValidatorUpgradePolicy } from 'ysk-server-shared';
import { getValidatorNetwork, v1ValidatorClients } from './registry.js';
import { listValidatorInstances, upsertValidatorInstance, instanceDir } from './store.js';
import { planInstallFor } from './adapters/index.js';
import {
  composeFilePath,
  composeProjectName,
  composePull,
  composeUp,
  writeComposeFile,
} from './compose-runner.js';
import type { HostExecutor } from '../../host/executor.js';
import type { ValidatorUpgradeOffer } from './adapters/base.js';

export type StoredUpgradeOffer = ValidatorUpgradeOffer & { instanceId: string };

export function parseVersionParts(tag: string): { major: number; minor: number; patch: number } {
  const m = String(tag).replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function tagIsNewer(current: string, next: string): boolean {
  const a = parseVersionParts(current);
  const b = parseVersionParts(next);
  if (b.major !== a.major) return b.major > a.major;
  if (b.minor !== a.minor) return b.minor > a.minor;
  return b.patch > a.patch;
}

export function tagIsBreaking(current: string, next: string): boolean {
  return parseVersionParts(next).major > parseVersionParts(current).major;
}

export function detectUpgradeForInstance(spec: ValidatorInstanceDto): ValidatorUpgradeOffer | null {
  const pinned = v1ValidatorClients(spec.chain);
  for (const pin of pinned) {
    const have = Object.values(spec.clients).find((c) => c.id === pin.id);
    const current = have?.tag ?? pin.tag;
    if (tagIsNewer(current, pin.tag)) {
      return {
        currentTag: current,
        nextTag: pin.tag,
        clientId: pin.id,
        breaking: tagIsBreaking(current, pin.tag),
      };
    }
  }
  return null;
}

export function scanValidatorUpgrades(dataDir: string): StoredUpgradeOffer[] {
  const out: StoredUpgradeOffer[] = [];
  for (const inst of listValidatorInstances(dataDir)) {
    const offer = detectUpgradeForInstance(inst);
    if (offer) out.push({ ...offer, instanceId: inst.id });
  }
  return out;
}

export function saveUpgradeScan(dataDir: string, offers: StoredUpgradeOffer[]): void {
  mkdirSync(join(dataDir, 'validators'), { recursive: true });
  writeFileSync(
    join(dataDir, 'validators', 'upgrade-offers.json'),
    `${JSON.stringify({ at: new Date().toISOString(), offers }, null, 2)}\n`,
  );
}

export function loadUpgradeScan(dataDir: string): StoredUpgradeOffer[] {
  const p = join(dataDir, 'validators', 'upgrade-offers.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { offers?: StoredUpgradeOffer[] };
    return Array.isArray(raw.offers) ? raw.offers : [];
  } catch {
    return [];
  }
}

export function shouldAutoApply(
  policy: ValidatorUpgradePolicy,
  offer: ValidatorUpgradeOffer,
  networkKind: 'testnet' | 'mainnet',
): boolean {
  if (networkKind === 'mainnet') return false;
  if (policy === 'auto-all') return true;
  if (policy === 'auto-safe') return !offer.breaking;
  return false;
}

export async function applyValidatorUpgrade(input: {
  dataDir: string;
  host: HostExecutor;
  spec: ValidatorInstanceDto;
  execute: boolean;
  health?: (spec: ValidatorInstanceDto) => Promise<boolean>;
  healthTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{
  ok: boolean;
  rolledBack: boolean;
  notes: string[];
  spec: ValidatorInstanceDto;
}> {
  const offer = detectUpgradeForInstance(input.spec);
  if (!offer) return { ok: true, rolledBack: false, notes: ['no upgrade'], spec: input.spec };
  const prev = input.spec;
  const nextClients = { ...input.spec.clients };
  for (const [k, c] of Object.entries(nextClients)) {
    if (c.id === offer.clientId) nextClients[k] = { ...c, tag: offer.nextTag };
  }
  const next: ValidatorInstanceDto = {
    ...input.spec,
    clients: nextClients,
    updatedAt: new Date().toISOString(),
  };
  const dir = instanceDir(input.dataDir, next.id);
  const composePath = composeFilePath(dir);
  let backupPath: string | null = null;
  if (existsSync(composePath)) {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    backupPath = join(dir, 'backups', `compose-${Date.now()}.yml`);
    copyFileSync(composePath, backupPath);
  }
  const prevYaml = existsSync(composePath) && backupPath ? readFileSync(backupPath, 'utf8') : null;
  const plan = planInstallFor(next);
  writeComposeFile(composePath, plan.composeYaml, next.id);
  upsertValidatorInstance(input.dataDir, next);
  if (!input.execute) {
    return { ok: true, rolledBack: false, notes: ['wrote compose; not applied'], spec: next };
  }

  await composePull({
    host: input.host,
    file: composePath,
    project: composeProjectName(next.id),
    execute: true,
  });
  const up = await composeUp({
    host: input.host,
    file: composePath,
    project: composeProjectName(next.id),
    execute: true,
  });
  if (!up.ok) {
    const rb = await rollbackUpgrade({
      dataDir: input.dataDir,
      host: input.host,
      prev,
      composePath,
      prevYaml,
      offer,
      reason: up.stderr || 'compose up failed',
    });
    return rb;
  }

  const { defaultHealthProbe, waitValidatorHealthy } = await import('./health.js');
  const probe =
    input.health ??
    ((spec: ValidatorInstanceDto) =>
      defaultHealthProbe(spec, { dataDir: input.dataDir, host: input.host }));
  const healthy = await waitValidatorHealthy({
    spec: next,
    probe,
    timeoutMs: input.healthTimeoutMs ?? 90_000,
    sleep: input.sleep,
  });
  if (healthy) {
    const done: ValidatorInstanceDto = {
      ...next,
      lastUpgrade: {
        at: new Date().toISOString(),
        clientId: offer.clientId,
        fromTag: offer.currentTag,
        toTag: offer.nextTag,
        result: 'applied',
      },
    };
    upsertValidatorInstance(input.dataDir, done);
    return {
      ok: true,
      rolledBack: false,
      notes: [`upgraded ${offer.clientId} ${offer.currentTag} -> ${offer.nextTag}`],
      spec: done,
    };
  }

  return rollbackUpgrade({
    dataDir: input.dataDir,
    host: input.host,
    prev,
    composePath,
    prevYaml,
    offer,
    reason: 'health check failed',
  });
}

async function rollbackUpgrade(input: {
  dataDir: string;
  host: HostExecutor;
  prev: ValidatorInstanceDto;
  composePath: string;
  prevYaml: string | null;
  offer: ValidatorUpgradeOffer;
  reason: string;
}): Promise<{ ok: boolean; rolledBack: boolean; notes: string[]; spec: ValidatorInstanceDto }> {
  if (input.prevYaml) writeComposeFile(input.composePath, input.prevYaml, input.prev.id);
  else {
    const plan = planInstallFor(input.prev);
    writeComposeFile(input.composePath, plan.composeYaml, input.prev.id);
  }
  const restored: ValidatorInstanceDto = {
    ...input.prev,
    lastUpgrade: {
      at: new Date().toISOString(),
      clientId: input.offer.clientId,
      fromTag: input.offer.currentTag,
      toTag: input.offer.nextTag,
      result: 'rolled-back',
      notes: [input.reason],
    },
    updatedAt: new Date().toISOString(),
  };
  upsertValidatorInstance(input.dataDir, restored);
  const up = await composeUp({
    host: input.host,
    file: input.composePath,
    project: composeProjectName(restored.id),
    execute: true,
  });
  if (!up.ok) {
    const failed: ValidatorInstanceDto = {
      ...restored,
      lastUpgrade: { ...restored.lastUpgrade!, result: 'failed' },
    };
    upsertValidatorInstance(input.dataDir, failed);
    return {
      ok: false,
      rolledBack: false,
      notes: [input.reason, 'rollback compose up failed', up.stderr],
      spec: failed,
    };
  }
  return {
    ok: true,
    rolledBack: true,
    notes: [
      input.reason,
      `rolled back ${input.offer.clientId} to ${input.offer.currentTag}`,
    ],
    spec: restored,
  };
}

export async function runValidatorUpgradeScan(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<StoredUpgradeOffer[]> {
  const offers = scanValidatorUpgrades(input.dataDir);
  saveUpgradeScan(input.dataDir, offers);
  for (const inst of listValidatorInstances(input.dataDir)) {
    const offer = offers.find((o) => o.instanceId === inst.id);
    if (!offer) continue;
    const kind = networkKindFor(inst);
    if (!shouldAutoApply(inst.upgradePolicy, offer, kind)) continue;
    try {
      await applyValidatorUpgrade({
        dataDir: input.dataDir,
        host: input.host,
        spec: inst,
        execute: input.host.executeEnabled(),
      });
    } catch {
      /* next interval */
    }
  }
  return offers;
}

export function networkKindFor(spec: ValidatorInstanceDto): 'testnet' | 'mainnet' {
  return getValidatorNetwork(spec.chain, spec.network)?.kind === 'mainnet' ? 'mainnet' : 'testnet';
}
