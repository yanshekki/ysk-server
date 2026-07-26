/**
 * Email feature — API surface.
 */
import { api } from '../../shared/services/api';

export type EmailDomain = {
  id: string;
  domain: string;
  health_score: number;
  server_ip: string;
  apply_status?: string;
  last_apply?: Record<string, unknown>;
};

export type EmailBundle = {
  records: Array<{ type: string; name: string; value: string; description: string }>;
  externalTodos: Array<{ id: string; title: string; description: string; completed: boolean }>;
  health: { score: number; maxScore: number; messages: string[] };
};

export const emailApi = {
  list: () => api.requestRaw<{ items: EmailDomain[] }>('/api/v1/email/domains'),
  create: (body: { domain: string; serverIp: string }) =>
    api.requestRaw<EmailBundle & { domain: EmailDomain }>('/api/v1/email/domains', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMailboxes: (domainId?: string) =>
    domainId
      ? api.requestRaw<{ items: Array<Record<string, unknown>> }>(
          `/api/v1/email/domains/${domainId}/mailboxes`,
        )
      : api.requestRaw<{ items: Array<Record<string, unknown>> }>('/api/v1/email/mailboxes'),
  createMailbox: (
    domainId: string,
    body: { localPart: string; password?: string; provisionSystem?: boolean },
  ) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/email/domains/${domainId}/mailboxes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dovecotPassdb: (domainId: string) =>
    api.requestRaw<Record<string, unknown>>(
      `/api/v1/email/domains/${domainId}/dovecot-passdb`,
      { method: 'POST', body: '{}' },
    ),
  webmailApply: (body: {
    domain: string;
    imapHost?: string;
    smtpHost?: string;
    download?: boolean;
  }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/webmail/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bootstrap: (body: {
    domain: string;
    serverIp: string;
    adminLocalPart?: string;
    adminPassword?: string;
    installPackages?: boolean;
    webmail?: boolean;
  }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/bootstrap', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dns: (id: string) => api.requestRaw<EmailBundle>(`/api/v1/email/domains/${id}/dns`),
  liveCheck: (id: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/email/domains/${id}/live-check`, {
      method: 'POST',
      body: '{}',
    }),
  dnsbl: (ip: string) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/dnsbl/check', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    }),
  dnsblLast: () =>
    api.requestRaw<{ last: Record<string, unknown> | null }>('/api/v1/email/dnsbl/last'),
  warmup: (body: { domain: string; serverIp: string; isNewIp?: boolean }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/warmup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  warmupDomain: (id: string) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/email/domains/${id}/warmup`, {
      method: 'POST',
      body: '{}',
    }),
  getRelay: () =>
    api.requestRaw<{ settings: Record<string, unknown> | null; files: unknown }>(
      '/api/v1/email/relay',
    ),
  setRelay: (body: {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    security?: string;
    applySystem?: boolean;
  }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/relay', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listAliases: (domainId: string) =>
    api.requestRaw<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/email/domains/${domainId}/aliases`,
    ),
  createAlias: (
    domainId: string,
    body: {
      type: 'alias' | 'forward' | 'catchall';
      localPart?: string;
      destinations: string[];
    },
  ) =>
    api.requestRaw<Record<string, unknown>>(`/api/v1/email/domains/${domainId}/aliases`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteAlias: (domainId: string, aliasId: string) =>
    api.requestRaw<Record<string, unknown>>(
      `/api/v1/email/domains/${domainId}/aliases/${aliasId}`,
      { method: 'DELETE' },
    ),
  updateFlags: (
    domainId: string,
    body: {
      catchallAddress?: string | null;
      autoreplyEnabled?: boolean;
      autoreplySubject?: string;
      autoreplyBody?: string;
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      suspended?: boolean;
    },
  ) =>
    api.requestRaw<{ domain: EmailDomain }>(`/api/v1/email/domains/${domainId}/flags`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  autodiscover: (domainId: string) =>
    api.requestRaw<{
      domain: string;
      mozillaXml: string;
      outlookXml: string;
      urls: Record<string, string>;
      notes: string[];
    }>(`/api/v1/email/domains/${domainId}/autodiscover`),
  mailQueue: () =>
    api.requestRaw<{
      ok: boolean;
      items: Array<{ id: string; raw: string }>;
      notes: string[];
      blocked?: boolean;
    }>('/api/v1/email/queue'),
  flushQueue: (body?: { id?: string; all?: boolean }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/queue/flush', {
      method: 'POST',
      body: JSON.stringify(body ?? { all: true }),
    }),
};
