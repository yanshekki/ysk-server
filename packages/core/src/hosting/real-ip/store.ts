/**
 * Persist host real-ip config under dataDir.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_REAL_IP_CONFIG,
  type RealIpHostConfig,
  type RealIpProviderId,
  type RealIpTrustMode,
} from './types.js';
import { normalizeCidrList } from './providers.js';

const VALID_PROVIDERS = new Set<RealIpProviderId>([
  'none',
  'cloudflare',
  'fastly',
  'bunny',
  'cloudfront',
  'azure_frontdoor',
  'gcore',
  'custom',
]);

function configPath(dataDir: string): string {
  return join(dataDir, 'config', 'real-ip.json');
}

export function loadRealIpConfig(dataDir: string): RealIpHostConfig {
  const path = configPath(dataDir);
  if (!existsSync(path)) return { ...DEFAULT_REAL_IP_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<RealIpHostConfig>;
    return normalizeRealIpConfig(raw);
  } catch {
    return { ...DEFAULT_REAL_IP_CONFIG };
  }
}

export function saveRealIpConfig(dataDir: string, cfg: RealIpHostConfig): string {
  const path = configPath(dataDir);
  mkdirSync(join(dataDir, 'config'), { recursive: true });
  const clean = normalizeRealIpConfig(cfg);
  writeFileSync(path, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return path;
}

export function normalizeRealIpConfig(raw: Partial<RealIpHostConfig>): RealIpHostConfig {
  const defaultProvider = VALID_PROVIDERS.has(raw.defaultProvider as RealIpProviderId)
    ? (raw.defaultProvider as RealIpProviderId)
    : DEFAULT_REAL_IP_CONFIG.defaultProvider;
  const trustMode: RealIpTrustMode =
    raw.trustMode === 'xff_merged' ? 'xff_merged' : 'single_provider';
  const enabledProviders = (raw.enabledProviders ?? DEFAULT_REAL_IP_CONFIG.enabledProviders)
    .filter((p): p is RealIpProviderId => VALID_PROVIDERS.has(p as RealIpProviderId) && p !== 'none')
    .filter((p, i, a) => a.indexOf(p) === i);
  return {
    defaultProvider,
    trustMode,
    enabledProviders:
      enabledProviders.length > 0 ? enabledProviders : [...DEFAULT_REAL_IP_CONFIG.enabledProviders],
    customCidrs: normalizeCidrList(raw.customCidrs ?? []),
    customHeader:
      typeof raw.customHeader === 'string' && raw.customHeader.trim()
        ? raw.customHeader.trim().slice(0, 64)
        : undefined,
    lastRefreshAt: typeof raw.lastRefreshAt === 'string' ? raw.lastRefreshAt : undefined,
    cachedCidrs: raw.cachedCidrs && typeof raw.cachedCidrs === 'object' ? raw.cachedCidrs : undefined,
  };
}

export function patchRealIpConfig(
  dataDir: string,
  patch: Partial<RealIpHostConfig>,
): RealIpHostConfig {
  const prev = loadRealIpConfig(dataDir);
  const next = normalizeRealIpConfig({ ...prev, ...patch });
  saveRealIpConfig(dataDir, next);
  return next;
}
