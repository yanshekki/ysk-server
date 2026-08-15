/**
 * System / host / readiness / defense status DTOs.
 */

export type ReadinessLevel = 'ready' | 'degraded' | 'missing' | 'unknown';

export interface ReadinessItemDto {
  id: string;
  category: string;
  title: string;
  level: ReadinessLevel;
  detail: string;
  spec?: string;
  fixHint?: string;
  /** Navigate to a UI page for manual fix */
  fixHref?: string;
  /**
   * Built-in one-click fix id (e.g. harden-datadir).
   * UI POSTs /api/v1/system/readiness/fix with { action }.
   */
  fixAction?: string;
  severity?: 'critical' | 'recommended' | 'optional';
}

export interface ProductionReadinessDto {
  product: string;
  generatedAt: string;
  mode: 'production_capable' | 'degraded' | string;
  executeEnabled: boolean;
  isRoot: boolean;
  score: { ready: number; degraded: number; missing: number; total: number };
  items: ReadinessItemDto[];
  summary: string[];
  productionReady: boolean;
  blockers?: ReadinessItemDto[];
  categories?: string[];
}

/** Core alias */
export type ProductionReadinessReport = ProductionReadinessDto;
export type ReadinessItem = ReadinessItemDto;

export interface HostOverviewDto {
  identity: {
    hostname: string | null;
    prettyHostname: string | null;
    timezone: string | null;
  };
  os: {
    platform: string;
    arch: string;
    release: string;
    kernel: string | null;
  };
  runtime: {
    uptimeSec: number;
    loadavg: number[];
    cpus: number;
    memory: { total: number; free: number; usedRatio: number };
    node: string;
    pid: number;
    uid: number | null;
  };
  time: {
    utc: string;
    local: string;
    ntpEnabled: boolean | null;
    ntpSynchronized: boolean | null;
    timeSource: string | null;
  };
  network: {
    ips: string[];
    interfaces: Array<{ name: string; addrs: string[] }>;
    resolvers: string[];
  };
  disks: Array<{
    filesystem: string;
    type: string;
    size: string;
    used: string;
    avail: string;
    usePct: number | null;
    mount: string;
  }>;
  power: {
    pending: { raw: string; actionHint: string | null } | null;
  };
  boot: {
    defaultTarget: string | null;
  };
  caps: {
    executeEnabled: boolean;
    isRoot: boolean;
    canPower: boolean;
    canIdentity: boolean;
  };
  collectedAt: string;
}

export type HostOverview = HostOverviewDto;

export interface FirewallRuleDto {
  num?: number;
  action: string;
  direction?: string;
  to?: string;
  from?: string;
  raw: string;
}

export interface FirewallStatusDto {
  installed: boolean;
  active: string;
  activeLabel: string;
  statusText: string;
  numberedRules: string[];
  rules: FirewallRuleDto[];
  denyFromIps: string[];
  allowCount: number;
  denyCount: number;
  /** From /etc/ufw/user.rules when UFW is inactive (not kernel-enforced). */
  configuredDenyFromIps?: string[];
  configuredDenyCount?: number;
  defaultIncoming?: string;
  defaultOutgoing?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
}

export interface Fail2banJailDto {
  name: string;
  currentlyBanned?: number;
  totalBanned?: number;
}

export interface Fail2banCatalogItemDto {
  id: string;
  label: string;
  desc: string;
  group: string;
}

export interface Fail2banStatusDto {
  installed: boolean;
  active: string;
  enabled: string;
  activeLabel: string;
  jails: Fail2banJailDto[];
  banned: Array<{ jail: string; ip: string }>;
  ignoreIps: string[];
  ignoreipFile?: string;
  catalog: Fail2banCatalogItemDto[];
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
  defaultJails?: string[];
}

export interface ServiceMatrixItemDto {
  id: string;
  label: string;
  unit: string;
  href?: string;
  category: string;
  installed: boolean;
  active: string;
  enabled: string;
  activeLabel: string;
}

export interface ServiceMatrixDto {
  items: ServiceMatrixItemDto[];
  executeEnabled: boolean;
  isRoot: boolean;
  probedAt: string;
}
