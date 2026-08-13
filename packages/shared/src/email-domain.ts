/**
 * Email domain control-plane rows + DNS bundle for panel.
 * Complements EmailDnsRecord / EmailHealthReport in dto.ts.
 */

export interface EmailDomainDto {
  id: string;
  domain: string;
  health_score: number;
  server_ip: string;
  apply_status?: string;
  last_apply?: Record<string, unknown>;
  /** Control-plane suspend flag — not live MTA reject unless system-applied */
  suspended?: boolean;
  status?: string;
  autoreply_enabled?: boolean;
  autoreply_subject?: string;
  autoreply_body?: string;
  catchall_address?: string | null;
  /** Outbound rate limit (msgs/hour); null/omit = use defaults */
  rate_limit_per_hour?: number | null;
  /** Domain antispam flag (Rspamd multimap) */
  antispam?: boolean;
}

/**
 * Lightweight DNS / health bundle returned by create + dns endpoints.
 * (Full EmailHealthReport lives in dto.ts for richer checks.)
 */
export interface EmailDomainBundleDto {
  records: Array<{ type: string; name: string; value: string; description: string }>;
  externalTodos: Array<{
    id: string;
    title: string;
    description: string;
    completed: boolean;
  }>;
  health: { score: number; maxScore: number; messages: string[] };
}

export type EmailDomain = EmailDomainDto;
export type EmailBundle = EmailDomainBundleDto;
