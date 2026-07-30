/**
 * CDN multi-node contracts (YSK self-hosted edge network).
 * Implemented incrementally; types are the product contract.
 */

import type { ApplyStatus } from './ops.js';

export type CdnNodeRole = 'control' | 'origin' | 'edge' | 'dns';

export type CdnNodeStatus = 'online' | 'offline' | 'draining' | 'unknown';

export type CdnSiteMode = 'origin_pull' | 'reverse_proxy' | 'static_edge';

export type CdnDnsStrategy =
  | 'single'
  | 'multi_a'
  | 'failover'
  | 'weighted'
  | 'geo';

export interface CdnNodeDto {
  id: string;
  name: string;
  baseUrl?: string;
  fleetAgentId?: string;
  sshIdentityId?: string;
  /** SSH target for fan-out (PR-C3); falls back to publicIpv4[0] */
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  /** Remote path for ysk-cdn-*.conf (default /etc/nginx/conf.d) */
  remoteNginxConfDir?: string;
  roles: CdnNodeRole[];
  region: string;
  publicIpv4: string[];
  publicIpv6: string[];
  healthUrl?: string;
  weight: number;
  status: CdnNodeStatus;
  lastHeartbeatAt?: string;
  lastHealth?: { ok: boolean; latencyMs?: number; at: string };
}

export interface CdnSiteDto {
  id: string;
  name: string;
  domains: string[];
  mode: CdnSiteMode;
  origin: {
    kind: 'project' | 'url';
    projectId?: string;
    url?: string;
    sni?: string;
  };
  edgeNodeIds: string[];
  dns: {
    zoneId?: string;
    strategy: CdnDnsStrategy;
    ttlHealthy: number;
    ttlUnhealthy: number;
    minHealthyEdges: number;
    geoMap?: Record<string, string[]>;
  };
  cache: {
    enabled: boolean;
    zoneSize: string;
    maxAge: string;
    bypassCookies?: boolean;
    bypassAuth?: boolean;
  };
  ssl: {
    mode: 'off' | 'le_http01' | 'le_dns01' | 'upload';
    certId?: string;
  };
  apply_status: ApplyStatus;
  edge_status: Record<string, ApplyStatus>;
}
