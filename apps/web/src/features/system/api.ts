/**
 * System feature — apply wizards API surface.
 */
import { api } from '../../shared/services/api';

export const systemApi = {
  post: <T = Record<string, unknown>>(path: string, body: unknown) =>
    api.requestRaw<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  listSslCertificates: () => api.listSslCertificates(),
  emailApply: (body: { domain: string; installPackages?: boolean }) =>
    api.requestRaw('/api/v1/system/email/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  phpApply: (body: { domain: string; poolName?: string; enableSite?: boolean }) =>
    api.requestRaw('/api/v1/system/php/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  nginxSite: (body: { serverName: string; upstream: string; reload?: boolean }) =>
    api.requestRaw('/api/v1/system/nginx/site', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  sslPlan: (body: { domain: string; email: string; run?: boolean }) =>
    api.requestRaw('/api/v1/system/ssl/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ftpsApply: (body: { domain: string; install?: boolean }) =>
    api.requestRaw('/api/v1/system/ftps/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  firewallApply: (body: { allowSmtp?: boolean; apply?: boolean; extraTcpPorts?: number[] }) =>
    api.requestRaw('/api/v1/system/firewall/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fail2banApply: (body: { apply?: boolean }) =>
    api.requestRaw('/api/v1/system/fail2ban/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  systemdInstall: (body: { enable?: boolean }) =>
    api.requestRaw('/api/v1/system/systemd/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  protectionProbe: () =>
    api.requestRaw('/api/v1/protection/probe', { method: 'POST', body: '{}' }),
  dnsPlan: (body: { zone: string; serverIp: string }) =>
    api.requestRaw('/api/v1/hosting/dns/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dnsZoneFile: (body: {
    zone: string;
    serverIp: string;
    mailHost?: string;
    validate?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/dns/zone-file', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dnsZoneFiles: () =>
    api.requestRaw<{ items: Array<Record<string, unknown>> }>(
      '/api/v1/hosting/dns/zone-files',
    ),
  powerDnsStatus: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/hosting/dns/powerdns/status'),
  powerDnsInstall: (body: { install?: boolean }) =>
    api.requestRaw('/api/v1/hosting/dns/powerdns/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  powerDnsLoad: (body: {
    zone: string;
    serverIp: string;
    mailHost?: string;
    load?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/dns/powerdns/load', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cloudflareApply: (body: {
    zone: string;
    serverIp: string;
    token?: string;
    dryRun?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/dns/cloudflare/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  sslUpload: (body: { domain: string; fullchainPem: string; privkeyPem: string }) =>
    api.requestRaw('/api/v1/ssl/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  postgresProvision: (body: {
    dbName: string;
    username: string;
    password: string;
    execute?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/db/postgres-provision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  redisProvision: (body: { projectId: string; dbIndex?: number; execute?: boolean }) =>
    api.requestRaw('/api/v1/hosting/db/redis-provision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
