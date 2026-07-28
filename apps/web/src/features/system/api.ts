/**
 * System feature — apply wizards API surface.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type ReadinessLevel = 'ready' | 'degraded' | 'missing' | 'unknown';

export type ReadinessItemDto = {
  id: string;
  category: string;
  title: string;
  level: ReadinessLevel;
  detail: string;
  spec?: string;
  fixHint?: string;
  fixHref?: string;
  severity?: 'critical' | 'recommended' | 'optional';
};

export type ProductionReadinessDto = {
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
};

export type HostOverviewDto = {
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
};

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
      activeLabel: string;
      statusText: string;
      numberedRules: string[];
      rules: Array<{
        num?: number;
        action: string;
        direction?: string;
        to?: string;
        from?: string;
        raw: string;
      }>;
      denyFromIps: string[];
      allowCount: number;
      denyCount: number;
      defaultIncoming?: string;
      defaultOutgoing?: string;
      executeEnabled: boolean;
      isRoot: boolean;
      notes: string[];
    }>('/api/v1/system/firewall/status'),
  firewallApply: (body: { allowSmtp?: boolean; apply?: boolean; extraTcpPorts?: number[] }) =>
    api.requestRaw('/api/v1/system/firewall/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  firewallEnable: (enabled: boolean) =>
    api.requestRaw('/api/v1/system/firewall/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  firewallDeny: (ip: string) =>
    api.requestRaw('/api/v1/system/firewall/deny', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    }),
  firewallDeleteDeny: (ip: string) =>
    api.requestRaw('/api/v1/system/firewall/delete-deny', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    }),
  firewallDeleteRule: (num: number) =>
    api.requestRaw('/api/v1/system/firewall/delete-rule', {
      method: 'POST',
      body: JSON.stringify({ num }),
    }),
  firewallAllowPort: (port: number, proto: 'tcp' | 'udp' = 'tcp') =>
    api.requestRaw('/api/v1/system/firewall/allow-port', {
      method: 'POST',
      body: JSON.stringify({ port, proto }),
    }),
  fail2banStatus: () =>
    api.requestRaw<{
      installed: boolean;
      active: string;
      enabled: string;
      activeLabel: string;
      jails: Array<{ name: string; currentlyBanned?: number; totalBanned?: number }>;
      banned: Array<{ jail: string; ip: string }>;
      ignoreIps: string[];
      catalog: Array<{ id: string; label: string; desc: string; group: string }>;
      executeEnabled: boolean;
      isRoot: boolean;
      notes: string[];
      /** legacy compat */
      defaultJails?: string[];
    }>('/api/v1/system/fail2ban/status'),
  fail2banApply: (body: {
    apply?: boolean;
    jails?: string[];
    bantime?: string;
    findtime?: string;
    maxretry?: number;
  }) =>
    api.requestRaw('/api/v1/system/fail2ban/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fail2banService: (action: 'start' | 'stop' | 'restart' | 'reload' | 'enable') =>
    api.requestRaw('/api/v1/system/fail2ban/service', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  fail2banBan: (jail: string, ip: string) =>
    api.requestRaw('/api/v1/system/fail2ban/ban', {
      method: 'POST',
      body: JSON.stringify({ jail, ip }),
    }),
  fail2banBanned: (jail?: string) =>
    api.requestRaw<{
      ok: boolean;
      items: Array<{ jail: string; ip: string }>;
      notes: string[];
      blocked?: boolean;
    }>(`/api/v1/system/fail2ban/banned${jail ? `?jail=${encodeURIComponent(jail)}` : ''}`),
  fail2banUnban: (jail: string, ip: string) =>
    api.requestRaw('/api/v1/system/fail2ban/unban', {
      method: 'POST',
      body: JSON.stringify({ jail, ip }),
    }),
  fail2banIgnoreIp: (ip: string, action: 'add' | 'remove' = 'add') =>
    api.requestRaw('/api/v1/system/fail2ban/ignoreip', {
      method: 'POST',
      body: JSON.stringify({ ip, action }),
    }),
  hostIdentity: () =>
    api.requestRaw<{
      hostname: string | null;
      timezone: string | null;
      prettyHostname?: string | null;
      executeEnabled: boolean;
      isRoot: boolean;
    }>('/api/v1/system/host-identity'),
  hostOverview: () => api.requestRaw<HostOverviewDto>('/api/v1/system/host'),
  setHostIdentity: (body: {
    hostname?: string;
    timezone?: string;
    prettyHostname?: string;
  }) =>
    api.requestRaw('/api/v1/system/host-identity', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  hostNtpSync: () =>
    api.requestRaw<{ ok: boolean; blocked?: boolean; notes?: string[]; blockMessage?: string }>(
      '/api/v1/system/host/ntp-sync',
      { method: 'POST', body: '{}' },
    ),
  hostPower: (body: {
    action: 'reboot' | 'poweroff' | 'cancel';
    confirm?: string;
    delaySec?: number;
  }) =>
    api.requestRaw<{
      ok: boolean;
      blocked?: boolean;
      blockMessage?: string;
      notes?: string[];
      action?: string;
      delaySec?: number;
      scheduledAt?: string;
    }>('/api/v1/system/host/power', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  nginxPurgeCache: () =>
    api.requestRaw('/api/v1/system/nginx/purge-cache', { method: 'POST', body: '{}' }),
  dbDump: (body: {
    engine: 'mysql' | 'mariadb' | 'postgres';
    dbName: string;
    username?: string;
    password?: string;
  }) =>
    api.requestRaw('/api/v1/system/db/dump', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dbDumps: (engine?: string) =>
    api.requestRaw<{
      items: Array<{ engine: string; name: string; path: string; bytes: number; mtime: string }>;
    }>(`/api/v1/system/db/dumps${engine ? `?engine=${engine}` : ''}`),
  dbImport: (body: {
    engine: 'mysql' | 'mariadb' | 'postgres';
    dbName: string;
    sqlPath?: string;
    name?: string;
    username?: string;
    password?: string;
  }) =>
    api.requestRaw('/api/v1/system/db/import', {
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
      canInstall?: boolean;
      systemUnitExists?: boolean;
      managedUnitPath?: string | null;
      managedUnitExists?: boolean;
      show?: {
        mainPid: string | null;
        activeEnterTimestamp: string | null;
        fragmentPath: string | null;
        description: string | null;
      };
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
  runtimeInstall: (body: {
    kind: 'node' | 'php' | 'python' | 'go' | 'rust';
    version: string;
    install?: boolean;
  }) =>
    api.requestRaw('/api/v1/hosting/runtimes/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  phpIniGet: (version = '8.2') =>
    api.requestRaw<{
      version: string;
      catalog: Array<{
        id: string;
        title: string;
        description?: string;
        fields: Array<{
          key: string;
          label: string;
          type: string;
          default: string | number | boolean;
          hint?: string;
          danger?: boolean;
          options?: Array<{ value: string; label: string }>;
        }>;
      }>;
      settings: {
        version: string;
        values: Record<string, string | number | boolean>;
        extra: Record<string, string>;
        rawAppend?: string;
        updatedAt?: string;
      };
      managedIniPath: string;
      notes: string[];
    }>(`/api/v1/hosting/php/ini?version=${encodeURIComponent(version)}`),
  phpIniSave: (body: {
    version?: string;
    values: Record<string, string | number | boolean>;
    extra?: Record<string, string>;
    rawAppend?: string;
  }) =>
    api.requestRaw('/api/v1/hosting/php/ini', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  phpIniApply: (version = '8.2') =>
    api.requestRaw('/api/v1/hosting/php/ini/apply', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),
  runtimeTuningGet: (
    kind: 'node' | 'python' | 'go' | 'rust',
    version = 'default',
  ) =>
    api.requestRaw<{
      kind: string;
      version: string;
      catalog: Array<{
        id: string;
        title: string;
        fields: Array<{
          key: string;
          label: string;
          type: string;
          default: string | number | boolean;
          hint?: string;
          options?: Array<{ value: string; label: string }>;
        }>;
      }>;
      settings: {
        kind: string;
        version: string;
        values: Record<string, string | number | boolean>;
        env: Record<string, string>;
        updatedAt?: string;
      };
      envPreview: Record<string, string>;
      notes: string[];
    }>(
      `/api/v1/hosting/runtimes/${kind}/tuning?version=${encodeURIComponent(version)}`,
    ),
  runtimeTuningSave: (
    kind: 'node' | 'python' | 'go' | 'rust',
    body: {
      version?: string;
      values: Record<string, string | number | boolean>;
      env?: Record<string, string>;
    },
  ) =>
    api.requestRaw(`/api/v1/hosting/runtimes/${kind}/tuning`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /**
   * Full production readiness report.
   * HTTP 503 when not productionReady still returns the JSON body (honest gate).
   */
  readiness: async (): Promise<ProductionReadinessDto> => {
    const token = authStore.getToken();
    const res = await fetch('/api/v1/readiness', {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const data = (await res.json()) as ProductionReadinessDto;
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
      throw new Error(
        res.ok ? '就緒報告格式錯誤' : `就緒檢查失敗（${res.status}）`,
      );
    }
    return data;
  },
  publicFilesApply: (body: { serverName: string; quotaMb?: number; reload?: boolean }) =>
    api.requestRaw('/api/v1/hosting/files/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
