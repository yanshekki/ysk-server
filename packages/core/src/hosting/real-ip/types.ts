/**
 * Multi-CDN / multi-proxy real client IP configuration.
 */

export type RealIpProviderId =
  | 'none'
  | 'cloudflare'
  | 'fastly'
  | 'bunny'
  | 'cloudfront'
  | 'azure_frontdoor'
  | 'gcore'
  | 'custom';

/** How to trust headers when multiple edges may hit origin. */
export type RealIpTrustMode =
  /** One provider header + that provider's CIDRs (safest). */
  | 'single_provider'
  /** X-Forwarded-For + union of enabledProviders CIDRs. */
  | 'xff_merged';

export interface RealIpHostConfig {
  /** Default provider for sites without override. */
  defaultProvider: RealIpProviderId;
  trustMode: RealIpTrustMode;
  /** Providers whose CIDRs are refreshed / merged in xff_merged mode. */
  enabledProviders: RealIpProviderId[];
  /** Extra trusted CIDRs (always merged). */
  customCidrs: string[];
  /** Header when defaultProvider=custom (e.g. X-Real-IP). */
  customHeader?: string;
  lastRefreshAt?: string;
  /** Cached CIDRs by provider id (from refresh). */
  cachedCidrs?: Partial<Record<RealIpProviderId, { ipv4: string[]; ipv6: string[] }>>;
}

export interface RealIpProviderDef {
  id: RealIpProviderId;
  label: string;
  /** Nginx real_ip_header name (single_provider mode). */
  clientIpHeader: string;
  cidrSources?: { ipv4?: string; ipv6?: string };
  snapshotIpv4: string[];
  snapshotIpv6: string[];
}

export const DEFAULT_REAL_IP_CONFIG: RealIpHostConfig = {
  defaultProvider: 'none',
  trustMode: 'single_provider',
  enabledProviders: ['cloudflare', 'fastly', 'bunny', 'cloudfront'],
  customCidrs: [],
};
