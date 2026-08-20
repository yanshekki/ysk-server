/**
 * Persist validator instances under dataDir (JSON file, same pattern as BT tracker).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultUpgradePolicyForNetworkKind,
  isValidatorChainId,
  isValidatorInstanceId,
  isValidatorProfileId,
  isValidatorUpgradePolicy,
  type ValidatorChainId,
  type ValidatorInstanceDto,
  type ValidatorProfileId,
  type ValidatorUpgradePolicy,
} from 'ysk-server-shared';
import { getValidatorNetwork } from './registry.js';

export type ValidatorStoreFile = {
  version: 1;
  instances: ValidatorInstanceDto[];
};

function storeDir(dataDir: string): string {
  return join(dataDir, 'validators');
}

function storePath(dataDir: string): string {
  return join(storeDir(dataDir), 'instances.json');
}

export function validatorsRoot(dataDir: string): string {
  return storeDir(dataDir);
}

export function instanceDir(dataDir: string, id: string): string {
  return join(storeDir(dataDir), id);
}

export function defaultInstanceDataPath(dataDir: string, id: string): string {
  return join(instanceDir(dataDir, id), 'data');
}

export function loadValidatorStore(dataDir: string): ValidatorStoreFile {
  const p = storePath(dataDir);
  if (!existsSync(p)) return { version: 1, instances: [] };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<ValidatorStoreFile>;
    const instances = Array.isArray(raw.instances)
      ? raw.instances.map(normalizeInstance).filter((x): x is ValidatorInstanceDto => x != null)
      : [];
    return { version: 1, instances };
  } catch {
    return { version: 1, instances: [] };
  }
}

export function saveValidatorStore(dataDir: string, store: ValidatorStoreFile): void {
  mkdirSync(storeDir(dataDir), { recursive: true });
  const next: ValidatorStoreFile = {
    version: 1,
    instances: store.instances.map((i) => normalizeInstance(i)).filter((x): x is ValidatorInstanceDto => x != null),
  };
  writeFileSync(storePath(dataDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function listValidatorInstances(dataDir: string): ValidatorInstanceDto[] {
  return loadValidatorStore(dataDir).instances;
}

export function getValidatorInstance(
  dataDir: string,
  id: string,
): ValidatorInstanceDto | undefined {
  return listValidatorInstances(dataDir).find((i) => i.id === id);
}

export function upsertValidatorInstance(
  dataDir: string,
  instance: ValidatorInstanceDto,
): ValidatorInstanceDto {
  const norm = normalizeInstance(instance);
  if (!norm) {
    throw new Error('invalid validator instance');
  }
  const store = loadValidatorStore(dataDir);
  const idx = store.instances.findIndex((i) => i.id === norm.id);
  const now = new Date().toISOString();
  const next: ValidatorInstanceDto = {
    ...norm,
    updatedAt: now,
    createdAt: idx >= 0 ? store.instances[idx]!.createdAt : norm.createdAt || now,
  };
  if (idx >= 0) store.instances[idx] = next;
  else store.instances.push(next);
  saveValidatorStore(dataDir, store);
  return next;
}

export function deleteValidatorInstance(dataDir: string, id: string): boolean {
  const store = loadValidatorStore(dataDir);
  const next = store.instances.filter((i) => i.id !== id);
  if (next.length === store.instances.length) return false;
  saveValidatorStore(dataDir, { version: 1, instances: next });
  return true;
}

export function nextValidatorInstanceId(
  dataDir: string,
  chain: ValidatorChainId,
  network: string,
): string {
  const prefix = `${chain}-${network}-`;
  const used = new Set(listValidatorInstances(dataDir).map((i) => i.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function buildValidatorInstance(input: {
  dataDir: string;
  chain: ValidatorChainId;
  network: string;
  profile: ValidatorProfileId;
  slug?: string;
  upgradePolicy?: ValidatorUpgradePolicy;
  rpcHost?: string;
  clients?: ValidatorInstanceDto['clients'];
  ports?: Record<string, number>;
  dataPath?: string;
  limits?: ValidatorInstanceDto['limits'];
}): ValidatorInstanceDto {
  const id = input.slug
    ? `${input.chain}-${input.network}-${input.slug}`
    : nextValidatorInstanceId(input.dataDir, input.chain, input.network);
  if (!isValidatorInstanceId(id)) {
    throw new Error('invalid validator instance id');
  }
  const now = new Date().toISOString();
  const net = getValidatorNetwork(input.chain, input.network);
  const policy =
    input.upgradePolicy ??
    defaultUpgradePolicyForNetworkKind(net?.kind === 'mainnet' ? 'mainnet' : 'testnet');
  return {
    id,
    chain: input.chain,
    network: input.network,
    profile: input.profile,
    slug: input.slug ?? id.slice(`${input.chain}-${input.network}-`.length),
    dataPath: input.dataPath?.trim() || defaultInstanceDataPath(input.dataDir, id),
    rpcHost: (input.rpcHost ?? '127.0.0.1').trim() || '127.0.0.1',
    upgradePolicy: policy,
    desiredState: 'stopped',
    createdAt: now,
    updatedAt: now,
    clients: input.clients ?? {},
    ports: input.ports ?? {},
    limits: input.limits,
  };
}

function normalizeInstance(raw: unknown): ValidatorInstanceDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  const chain = String(o.chain ?? '').trim();
  const network = String(o.network ?? '').trim();
  const profile = String(o.profile ?? '').trim();
  if (!isValidatorInstanceId(id)) return null;
  if (!isValidatorChainId(chain)) return null;
  if (!network) return null;
  if (!isValidatorProfileId(profile)) return null;
  const policyRaw = String(o.upgradePolicy ?? 'manual');
  const upgradePolicy = isValidatorUpgradePolicy(policyRaw) ? policyRaw : 'manual';
  const desiredState = o.desiredState === 'running' ? 'running' : 'stopped';
  const clients: ValidatorInstanceDto['clients'] = {};
  if (o.clients && typeof o.clients === 'object') {
    for (const [k, v] of Object.entries(o.clients as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const c = v as Record<string, unknown>;
      const cid = String(c.id ?? k).trim();
      const image = String(c.image ?? '').trim();
      const tag = String(c.tag ?? '').trim();
      if (!cid || !image) continue;
      clients[k] = { id: cid, image, tag: tag || 'latest' };
    }
  }
  const ports: Record<string, number> = {};
  if (o.ports && typeof o.ports === 'object') {
    for (const [k, v] of Object.entries(o.ports as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0 && n <= 65535) ports[k] = n;
    }
  }
  const now = new Date().toISOString();
  return {
    id,
    chain,
    network,
    profile,
    slug: String(o.slug ?? '').trim() || id,
    dataPath: String(o.dataPath ?? '').trim() || defaultInstanceDataPath('.', id),
    rpcHost: String(o.rpcHost ?? '127.0.0.1').trim() || '127.0.0.1',
    upgradePolicy,
    desiredState,
    createdAt: String(o.createdAt ?? now),
    updatedAt: String(o.updatedAt ?? now),
    clients,
    ports,
    lastUpgrade:
      o.lastUpgrade && typeof o.lastUpgrade === 'object'
        ? (o.lastUpgrade as ValidatorInstanceDto['lastUpgrade'])
        : undefined,
    lastMithril:
      o.lastMithril && typeof o.lastMithril === 'object'
        ? (o.lastMithril as ValidatorInstanceDto['lastMithril'])
        : undefined,
    cardanoProducer:
      o.cardanoProducer && typeof o.cardanoProducer === 'object'
        ? (o.cardanoProducer as ValidatorInstanceDto['cardanoProducer'])
        : undefined,
    limits:
      o.limits && typeof o.limits === 'object'
        ? (o.limits as ValidatorInstanceDto['limits'])
        : undefined,
    lastStatus:
      o.lastStatus && typeof o.lastStatus === 'object'
        ? (o.lastStatus as ValidatorInstanceDto['lastStatus'])
        : undefined,
  };
}
