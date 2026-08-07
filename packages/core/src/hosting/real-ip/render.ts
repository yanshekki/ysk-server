/**
 * Render Nginx real_ip + Apache RemoteIP snippets.
 */

import {
  getRealIpProvider,
  listRealIpProviders,
  normalizeCidrList,
} from './providers.js';
import type {
  RealIpHostConfig,
  RealIpProviderId,
} from './types.js';
import { DEFAULT_REAL_IP_CONFIG } from './types.js';

export interface ResolveRealIpInput {
  /** Explicit provider (project override). */
  provider?: RealIpProviderId | 'inherit' | null;
  /** Host config; default none. */
  host?: RealIpHostConfig;
  /**
   * Legacy flag from older callers.
   * true → cloudflare when provider unset; false → none.
   */
  cloudflareRealIp?: boolean;
}

/**
 * Resolve effective provider for a site.
 */
export function resolveRealIpProvider(input: ResolveRealIpInput): RealIpProviderId {
  const host = input.host ?? DEFAULT_REAL_IP_CONFIG;
  if (input.provider && input.provider !== 'inherit') {
    return input.provider;
  }
  if (input.cloudflareRealIp === false) return 'none';
  if (input.provider === 'inherit' || input.provider == null) {
    if (input.cloudflareRealIp === true && host.defaultProvider === 'none') {
      // Legacy publish always passed cloudflareRealIp:true — keep CF when host still default none
      return 'cloudflare';
    }
    return host.defaultProvider;
  }
  return host.defaultProvider;
}

function cidrsForProvider(
  id: RealIpProviderId,
  host: RealIpHostConfig,
): { ipv4: string[]; ipv6: string[] } {
  if (id === 'none') return { ipv4: [], ipv6: [] };
  if (id === 'custom') {
    return { ipv4: normalizeCidrList(host.customCidrs), ipv6: [] };
  }
  const def = getRealIpProvider(id);
  const cached = host.cachedCidrs?.[id];
  return {
    ipv4: normalizeCidrList(cached?.ipv4?.length ? cached.ipv4 : def.snapshotIpv4),
    ipv6: normalizeCidrList(cached?.ipv6?.length ? cached.ipv6 : def.snapshotIpv6),
  };
}

/**
 * Nginx server-context snippet: set_real_ip_from + real_ip_header.
 * Empty string when provider is none.
 */
export function renderNginxRealIpBlock(input: ResolveRealIpInput): string {
  const host = input.host ?? DEFAULT_REAL_IP_CONFIG;
  const provider = resolveRealIpProvider(input);
  if (provider === 'none') return '';

  let header: string;
  let ipv4: string[] = [];
  let ipv6: string[] = [];

  if (host.trustMode === 'xff_merged') {
    header = 'X-Forwarded-For';
    const ids = new Set<RealIpProviderId>([
      ...host.enabledProviders,
      ...(provider !== 'custom' ? [provider] : []),
    ]);
    for (const id of ids) {
      if (id === 'none' || id === 'custom') continue;
      const c = cidrsForProvider(id, host);
      ipv4.push(...c.ipv4);
      ipv6.push(...c.ipv6);
    }
    ipv4.push(...normalizeCidrList(host.customCidrs));
  } else {
    const def = getRealIpProvider(provider);
    header =
      provider === 'custom'
        ? host.customHeader?.trim() || 'X-Forwarded-For'
        : def.clientIpHeader;
    if (!header) return '';
    const c = cidrsForProvider(provider, host);
    ipv4 = c.ipv4;
    ipv6 = c.ipv6;
    if (provider === 'custom') {
      ipv4 = normalizeCidrList([...host.customCidrs, ...ipv4]);
    } else {
      ipv4 = normalizeCidrList([...ipv4, ...host.customCidrs]);
    }
  }

  ipv4 = normalizeCidrList(ipv4);
  ipv6 = normalizeCidrList(ipv6);
  if (ipv4.length === 0 && ipv6.length === 0) {
    // custom with no CIDRs — refuse (would trust nothing useful or everything)
    if (provider === 'custom') return '';
  }

  const lines: string[] = [
    `# YSK real_ip — provider=${provider} mode=${host.trustMode}`,
  ];
  for (const c of ipv4) lines.push(`set_real_ip_from ${c};`);
  for (const c of ipv6) lines.push(`set_real_ip_from ${c};`);
  // Safe header name: alnum + hyphen only
  const safeHeader = header.replace(/[^A-Za-z0-9-]/g, '');
  if (!safeHeader) return '';
  lines.push(`real_ip_header ${safeHeader};`);
  lines.push('real_ip_recursive on;');
  return lines.join('\n');
}

/**
 * Apache RemoteIP for PHP backend behind local Nginx.
 * Trusts only loopback (Nginx on same host).
 */
export function renderApacheRemoteIpConf(opts?: {
  /** Extra internal proxies (e.g. other local nginx). */
  internalProxies?: string[];
}): string {
  const proxies = normalizeCidrList([
    '127.0.0.1',
    '::1',
    ...(opts?.internalProxies ?? []),
  ]);
  const lines = [
    '# YSK RemoteIP — Nginx (local) already restored client IP into X-Forwarded-For',
    'RemoteIPHeader X-Forwarded-For',
  ];
  for (const p of proxies) {
    lines.push(`RemoteIPInternalProxy ${p}`);
  }
  return lines.join('\n') + '\n';
}

export function realIpProviderSummary(): Array<{
  id: RealIpProviderId;
  label: string;
  clientIpHeader: string;
  snapshotCount: number;
}> {
  return listRealIpProviders().map((p) => ({
    id: p.id,
    label: p.label,
    clientIpHeader: p.clientIpHeader,
    snapshotCount: p.snapshotIpv4.length + p.snapshotIpv6.length,
  }));
}
