/**
 * Cosmos Hub staking identity — consensus pubkey only.
 * Never returns priv_validator_key priv_key.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CosmosStakingIdentityDto, ValidatorInstanceDto } from 'ysk-server-shared';
import {
  buildCosmosCreateValidatorCommand,
  cosmosConsensusPubkeyJson,
  cosmosStakingChainId,
  emptyCosmosStakingIdentity,
} from 'ysk-server-shared';

const MAX_BYTES = 64 * 1024;
const SECRET_RE = /priv_key|private_key|secret/i;

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    if (raw.length > MAX_BYTES) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    if (raw.length > MAX_BYTES) return null;
    return raw;
  } catch {
    return null;
  }
}

function pickExternalAddress(toml: string): string | null {
  const m = toml.match(/^\s*external_address\s*=\s*"([^"]+)"/m);
  const addr = m?.[1]?.trim();
  if (!addr || SECRET_RE.test(addr)) return null;
  return addr;
}

export function readCosmosStakingIdentity(
  spec: Pick<ValidatorInstanceDto, 'network' | 'dataPath'>,
): CosmosStakingIdentityDto {
  const network = spec.network;
  const base = emptyCosmosStakingIdentity(network);
  const data = String(spec.dataPath ?? '').replace(/\/+$/, '');
  if (!data) return base;
  const keyFile = readJsonObject(join(data, 'config', 'priv_validator_key.json'));
  const pub = keyFile?.pub_key;
  const pubObj =
    pub && typeof pub === 'object' && !Array.isArray(pub) ? (pub as Record<string, unknown>) : null;
  const consensusPubkey = cosmosConsensusPubkeyJson({
    type: typeof pubObj?.type === 'string' ? pubObj.type : null,
    value: typeof pubObj?.value === 'string' ? pubObj.value : null,
  });
  const toml = readText(join(data, 'config', 'config.toml'));
  const externalAddress = toml ? pickExternalAddress(toml) : null;
  return {
    consensusPubkey,
    chainId: cosmosStakingChainId(network),
    externalAddress,
    createCommand: buildCosmosCreateValidatorCommand({ network, consensusPubkey }),
  };
}
