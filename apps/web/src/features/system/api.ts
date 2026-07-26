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
  firewallStatus: () =>
    api.requestRaw<{
      installed: boolean;
      active: string;
      statusText: string;
      numberedRules: string[];
      executeEnabled: boolean;
      isRoot: boolean;
    }>('/api/v1/system/firewall/status'),
  firewallApply: (body: { allowSmtp?: boolean; apply?: boolean; extraTcpPorts?: number[] }) =>
    api.requestRaw('/api/v1/system/firewall/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fail2banStatus: () =>
    api.requestRaw<{
      installed: boolean;
      active: string;
      enabled: string;
      jails: Array<{ name: string; currentlyBanned?: number; totalBanned?: number }>;
      executeEnabled: boolean;
      isRoot: boolean;
      defaultJails: string[];
    }>('/api/v1/system/fail2ban/status'),
  fail2banApply: (body: { apply?: boolean; jails?: string[] }) =>
    api.requestRaw('/api/v1/system/fail2ban/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  systemdInstall: (body: { enable?: boolean }) =>
    api.requestRaw('/api/v1/system/systemd/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  systemdStatus: () =>
    api.requestRaw<{
      unit: string;
      unitPathHint: string;
      active: string;
      enabled: string;
      executeEnabled: boolean;
      isRoot: boolean;
    }>('/api/v1/system/systemd/status'),
  servicesMatrix: () =>
    api.requestRaw<{
      items: Array<{
        id: string;
        label: string;
        unit: string;
        href?: string;
        category: string;
        installed: boolean;
        active: string;
        enabled: string;
        activeLabel: string;
      }>;
      executeEnabled: boolean;
      isRoot: boolean;
      probedAt: string;
    }>('/api/v1/system/services/matrix'),
  serviceLifecycle: (body: {
    unit: string;
    action: 'start' | 'stop' | 'restart' | 'reload';
  }) =>
    api.requestRaw('/api/v1/system/services/lifecycle', {
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
  mysqlProvision: (body: {
    dbName: string;
    username: string;
    password: string;
    host?: string;
    execute?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/db/mysql-provision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mysqlPlan: (body: { dbName?: string; username?: string }) =>
    api.requestRaw('/api/v1/hosting/db/mysql-plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dbProbe: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/hosting/db/probe', {
      method: 'POST',
      body: '{}',
    }),
  runtimes: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/hosting/runtimes'),
  runtimeInstall: (body: { kind: 'node' | 'php'; version: string; install?: boolean }) =>
    api.requestRaw('/api/v1/hosting/runtimes/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  readiness: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/readiness'),
  publicFilesApply: (body: { serverName: string; quotaMb?: number; reload?: boolean }) =>
    api.requestRaw('/api/v1/hosting/files/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
