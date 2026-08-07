/**
 * Refresh CDN CIDR lists from official sources (best-effort).
 */

import type { HostExecutor } from '../../host/executor.js';
import { getRealIpProvider, normalizeCidrList } from './providers.js';
import { loadRealIpConfig, saveRealIpConfig } from './store.js';
import type { RealIpHostConfig, RealIpProviderId } from './types.js';

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ysk-server-real-ip/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseLines(body: string): string[] {
  return normalizeCidrList(
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

function parseFastlyJson(body: string): { ipv4: string[]; ipv6: string[] } {
  try {
    const j = JSON.parse(body) as { addresses?: string[]; ipv6_addresses?: string[] };
    return {
      ipv4: normalizeCidrList(j.addresses ?? []),
      ipv6: normalizeCidrList(j.ipv6_addresses ?? []),
    };
  } catch {
    return { ipv4: [], ipv6: [] };
  }
}

function parseAwsCloudFront(body: string): string[] {
  try {
    const j = JSON.parse(body) as {
      prefixes?: Array<{ ip_prefix?: string; service?: string }>;
    };
    return normalizeCidrList(
      (j.prefixes ?? [])
        .filter((p) => p.service === 'CLOUDFRONT' && p.ip_prefix)
        .map((p) => p.ip_prefix!),
    );
  } catch {
    return [];
  }
}

export async function refreshRealIpCidrs(input: {
  dataDir: string;
  host?: HostExecutor;
  /** Limit which providers to refresh */
  providers?: RealIpProviderId[];
}): Promise<{
  ok: boolean;
  config: RealIpHostConfig;
  notes: string[];
  updated: RealIpProviderId[];
}> {
  const notes: string[] = [];
  const cfg = loadRealIpConfig(input.dataDir);
  const want = input.providers?.length
    ? input.providers
    : cfg.enabledProviders.filter((p) => p !== 'custom' && p !== 'none');

  const cached = { ...(cfg.cachedCidrs ?? {}) };
  const updated: RealIpProviderId[] = [];

  for (const id of want) {
    if (id === 'none' || id === 'custom') continue;
    const def = getRealIpProvider(id);
    if (!def.cidrSources?.ipv4 && !def.cidrSources?.ipv6) {
      notes.push(`${id}: no remote source — keep snapshot`);
      continue;
    }
    try {
      let ipv4: string[] = [];
      let ipv6: string[] = [];
      if (id === 'fastly' && def.cidrSources?.ipv4) {
        const body = await fetchText(def.cidrSources.ipv4);
        const p = parseFastlyJson(body);
        ipv4 = p.ipv4;
        ipv6 = p.ipv6;
      } else if (id === 'cloudfront' && def.cidrSources?.ipv4) {
        const body = await fetchText(def.cidrSources.ipv4);
        ipv4 = parseAwsCloudFront(body);
      } else {
        if (def.cidrSources?.ipv4) {
          ipv4 = parseLines(await fetchText(def.cidrSources.ipv4));
        }
        if (def.cidrSources?.ipv6) {
          ipv6 = parseLines(await fetchText(def.cidrSources.ipv6));
        }
      }
      if (ipv4.length === 0 && ipv6.length === 0) {
        notes.push(`${id}: empty fetch — keep previous/snapshot`);
        continue;
      }
      cached[id] = { ipv4, ipv6 };
      updated.push(id);
      notes.push(`${id}: refreshed v4=${ipv4.length} v6=${ipv6.length}`);
    } catch (e) {
      notes.push(
        `${id}: refresh failed — ${e instanceof Error ? e.message : String(e)} (using snapshot)`,
      );
    }
  }

  const next: RealIpHostConfig = {
    ...cfg,
    cachedCidrs: cached,
    lastRefreshAt: new Date().toISOString(),
  };
  saveRealIpConfig(input.dataDir, next);
  return {
    ok: updated.length > 0 || want.length === 0,
    config: next,
    notes,
    updated,
  };
}
