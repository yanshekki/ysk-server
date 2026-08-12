/**
 * Email feature — API surface.
 */
import type { EmailDomain, EmailBundle } from '@yanshekki/shared';
import { api } from '../../shared/services/api';

export type { EmailDomain, EmailBundle } from '@yanshekki/shared';

export const emailApi = {
  list: () => api.requestRaw<{ items: EmailDomain[] }>('/api/v1/email/domains'),
  create: (body: { domain: string; serverIp: string; serverIpv6?: string }) =>
    api.requestRaw<EmailBundle & { domain: EmailDomain }>('/api/v1/email/domains', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Same safety model as projectsApi.remove — type domain name + optional removeData */
  deleteDomain: (
    id: string,
    body: { confirmName: string; removeData?: boolean },
  ) =>
    api.requestRaw<{
      ok: boolean;
      domain: string;
      removedMailboxes: number;
      removedAliases: number;
      notes: string[];
      written: string[];
      warnings?: string[];
    }>(`/api/v1/email/domains/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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
  deleteMailbox: (domainId: string, mailboxId: string) =>
    api.requestRaw<Record<string, unknown>>(
      `/api/v1/email/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      { method: 'DELETE' },
    ),
  /** Update mailbox password and/or login status (active | disabled). */
  updateMailbox: (
    domainId: string,
    mailboxId: string,
    body: { password?: string; status?: 'active' | 'disabled' },
  ) =>
    api.requestRaw<Record<string, unknown>>(
      `/api/v1/email/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
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
    /** PHP project path (Adminer/phpMyAdmin model) */
    asProject?: boolean;
    projectName?: string;
    tool?: 'roundcube' | 'snappymail';
    mailDomain?: string;
    reinstall?: boolean;
    projectId?: string;
    forceHttps?: boolean;
    installSsoPlugin?: boolean;
  }) =>
    // 403/422 still return full ops body (notes, projectId) — do not throw first note as page error
    api.requestRawAllowStatus<Record<string, unknown>>('/api/v1/email/webmail/apply', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
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
  /** Apply existing LE cert under /etc/letsencrypt/live/mail.<domain> to Postfix/Dovecot */
  applyMailTls: (body: { domain: string; mailHost?: string; applyDovecot?: boolean }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/mail-tls/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Unified deliverability pack (PTR/DNSBL/warmup/relay honesty) */
  deliverability: (id: string) =>
    api.requestRaw<{
      at: string;
      domain: string;
      score: number;
      honesty: string[];
      items: Array<{
        id: string;
        title: string;
        ok: boolean | null;
        level: string;
        detail: string;
        owner: string;
        fixHint?: string;
      }>;
      externalTodos: Array<{ id: string; title?: string; description?: string }>;
      warmup: Record<string, unknown>;
      panelReady: boolean;
      deliveryGuaranteed: false;
      relayConfigured: boolean;
    }>(`/api/v1/email/domains/${id}/deliverability`),
  deliverabilityOverview: () =>
    api.requestRaw<{
      at: string;
      items: Array<{
        domainId: string;
        domain: string;
        score: number;
        panelReady: boolean;
        blocked?: string[];
      }>;
      honesty: string[];
    }>('/api/v1/email/deliverability/overview'),
  dnsbl: (ip: string) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/dnsbl/check', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    }),
  dnsblMulti: (ips: string[]) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/dnsbl/multi', {
      method: 'POST',
      body: JSON.stringify({ ips }),
    }),
  dnsblLast: () =>
    api.requestRaw<{ last: Record<string, unknown> | null }>('/api/v1/email/dnsbl/last'),
  webmailSso: (body: {
    email: string;
    domain: string;
    ttlMinutes?: number;
    password?: string;
    webmailBaseUrl?: string;
  }) =>
    api.requestRaw<{
      ok: boolean;
      token?: string;
      loginUrl?: string;
      expiresAt?: string;
      notes: string[];
    }>('/api/v1/email/webmail/sso', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listSieve: (mailbox: string) =>
    api.requestRaw<{ items: Array<Record<string, unknown>> }>(
      `/api/v1/email/sieve?mailbox=${encodeURIComponent(mailbox)}`,
    ),
  writeSieve: (body: { mailbox: string; name?: string; content: string }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/email/sieve', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteSieve: (mailbox: string, name: string) =>
    api.requestRaw(
      `/api/v1/email/sieve?mailbox=${encodeURIComponent(mailbox)}&name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),
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
      /** Live Postfix suspend map + Dovecot sieve (needs EXECUTE+root) */
      applySystem?: boolean;
    },
  ) =>
    api.requestRaw<{
      ok: boolean;
      apply_status: string;
      notes: string[];
      written?: string[];
      blocked?: boolean;
      blockMessage?: string;
      domain: EmailDomain;
    }>(`/api/v1/email/domains/${domainId}/flags`, {
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
  /** Outbound rate + antispam → Postfix anvil / Rspamd (written vs applySystem) */
  applyPolicy: (
    domainId: string,
    body: {
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      applySystem?: boolean;
    },
  ) =>
    api.requestRaw<{
      ok: boolean;
      notes: string[];
      written?: string[];
      blocked?: boolean;
      blockMessage?: string;
      apply_status: string;
    }>(`/api/v1/email/domains/${domainId}/policy`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
