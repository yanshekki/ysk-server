/**
 * Host WAN Dynamic DNS — DTOs shared by core, API, CLI, and web.
 * Not a second zone editor. Does not include provider secrets.
 */

export const DDNS_PROVIDERS = ['cloudflare', 'rfc2136', 'local'] as const;
export type DdnsProviderId = (typeof DDNS_PROVIDERS)[number];

export const DDNS_RECORD_TYPES = ['A', 'AAAA'] as const;
export type DdnsRecordType = (typeof DDNS_RECORD_TYPES)[number];

export function isDdnsProviderId(v: string): v is DdnsProviderId {
  return (DDNS_PROVIDERS as readonly string[]).includes(v);
}

export function isDdnsRecordType(v: string): v is DdnsRecordType {
  return (DDNS_RECORD_TYPES as readonly string[]).includes(v);
}

export const DDNS_ERROR_CODES = [
  'requiresExecute',
  'missingToken',
  'rfc2136NeedKey',
  'rfc2136KeyMissing',
  'noPublicIpv4',
  'noPublicIpv6',
  'notPublicIpv4',
  'notPublicIpv6',
  'probeFailed',
  'localNoZone',
  'localNeedsDb',
  'managedByClash',
  'unknownProvider',
  'nsupdateFailed',
  'updateFailed',
  'invalidFqdn',
  'invalidType',
  'invalidProvider',
  'notFound',
  'confirmMismatch',
  'schedulerDisabled',
  'provider',
] as const;
export type DdnsErrorCode = (typeof DDNS_ERROR_CODES)[number];

export function isDdnsErrorCode(v: string): v is DdnsErrorCode {
  return (DDNS_ERROR_CODES as readonly string[]).includes(v);
}

export type DdnsRecordDto = {
  id: string;
  fqdn: string;
  type: DdnsRecordType;
  provider: DdnsProviderId;
  zone?: string;
  ttl: number;
  /** Cloudflare orange-cloud. Default false (DNS only). */
  proxied?: boolean;
  enabled: boolean;
  lastPublished?: string;
  lastChangeAt?: string;
  lastError?: string | null;
  lastProviderCode?: string | null;
};

export type DdnsSettingsDto = {
  intervalSeconds: number;
  /** Write detected IPv4 into DDNS status for other features. */
  updateIdentity: boolean;
  primaryFqdn?: string;
  /** In-process scheduler. Manual probe / update still run when false. */
  enabled: boolean;
};

export type DdnsDetectedDto = {
  ipv4: string | null;
  ipv6: string | null;
  at: string | null;
  error: string | null;
};

export type DdnsStatusDto = {
  settings: DdnsSettingsDto;
  records: DdnsRecordDto[];
  detected: DdnsDetectedDto;
  requiresExecute: boolean;
  executeEnabled: boolean;
  lastRunAt: string | null;
  lastWanIpv4?: string | null;
  nextRunAt: string | null;
  hasCloudflareToken: boolean;
  hasRfc2136Key: boolean;
  rfc2136Server?: string;
  rfc2136KeyFile?: string;
  history: DdnsHistoryRow[];
  notes: string[];
};

export type DdnsHistoryRow = {
  at: string;
  fqdn: string;
  type: DdnsRecordType;
  from?: string;
  to?: string;
  provider: DdnsProviderId;
  ok: boolean;
  note?: string;
};

export const DDNS_INTERVAL_MIN = 60;
export const DDNS_INTERVAL_MAX = 86_400;
export const DDNS_INTERVAL_DEFAULT = 300;
export const DDNS_HISTORY_MAX = 200;
export const DDNS_INTERVAL_PRESETS = [60, 300, 600, 3600, 86_400] as const;
