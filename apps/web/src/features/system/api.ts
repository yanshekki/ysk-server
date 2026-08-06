/**
 * System feature — apply wizards API surface.
 */
import type {
  ProductionReadinessDto,
  HostOverviewDto,
  FirewallStatusDto,
  Fail2banStatusDto,
  ServiceMatrixDto,
} from '@ysk/shared';
import { api } from '../../shared/services/api';
import i18n from '../../shared/lib/i18n';

export type {
  ReadinessLevel,
  ReadinessItemDto,
  ProductionReadinessDto,
  HostOverviewDto,
  FirewallStatusDto,
  Fail2banStatusDto,
  ServiceMatrixDto,
} from '@ysk/shared';

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
    api.requestRaw<FirewallStatusDto>('/api/v1/system/firewall/status'),
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
  /** port: number | "80" | "30000:30100"; proto includes both (TCP+UDP) */
  firewallAllowPort: (port: number | string, proto: 'tcp' | 'udp' | 'both' = 'tcp') =>
    api.requestRaw('/api/v1/system/firewall/allow-port', {
      method: 'POST',
      body: JSON.stringify({ port, proto }),
    }),
  firewallServicePorts: () =>
    api.requestRaw<{
      ok: boolean;
      chips: Array<{
        value: string;
        label: string;
        proto: 'tcp' | 'udp';
        port: string;
        privateRecommended?: boolean;
        service: string;
        category: string;
        hint?: string;
      }>;
    }>('/api/v1/system/firewall/service-ports'),
  fail2banStatus: () =>
    api.requestRaw<Fail2banStatusDto>('/api/v1/system/fail2ban/status'),
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
  timezones: () =>
    api.requestRaw<{
      timezones: string[];
      current: string | null;
      source: 'timedatectl' | 'fallback';
    }>('/api/v1/system/timezones'),
  hostOverview: () => api.requestRaw<HostOverviewDto>('/api/v1/system/host'),
  setHostIdentity: (body: {
    hostname?: string;
    timezone?: string;
    prettyHostname?: string;
  }) =>
    api.requestRawAllowStatus<{
      ok?: boolean;
      blocked?: boolean;
      notes?: string[];
    }>('/api/v1/system/host-identity', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  panelTlsStatus: () =>
    api.requestRaw<{
      ok: boolean;
      tlsEnabled: boolean;
      servingHttps: boolean;
      panelDomain?: string;
      certPath?: string;
      keyPath?: string;
      certExists: boolean;
      keyExists: boolean;
      expiresAt?: string | null;
      listenPort: number;
      listenHost: string;
      httpsUrl?: string;
      httpUrl?: string;
      notes: string[];
      restartRequired: boolean;
      configPath?: string | null;
    }>('/api/v1/system/panel-tls'),
  panelTlsIssue: (body: { domain: string; email?: string; restart?: boolean }) =>
    api.requestRawAllowStatus<{
      ok: boolean;
      notes?: string[];
      blocked?: boolean;
      blockMessage?: string;
      restartRequired?: boolean;
      status?: Record<string, unknown>;
    }>('/api/v1/system/panel-tls/issue', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  panelTlsEnable: (body: {
    domain: string;
    certPath?: string;
    keyPath?: string;
    restart?: boolean;
  }) =>
    api.requestRawAllowStatus<{
      ok: boolean;
      notes?: string[];
      blocked?: boolean;
      restartRequired?: boolean;
    }>('/api/v1/system/panel-tls/enable', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  panelTlsDisable: (body?: { restart?: boolean }) =>
    api.requestRawAllowStatus<{
      ok: boolean;
      notes?: string[];
      restartRequired?: boolean;
    }>('/api/v1/system/panel-tls/disable', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      allowStatuses: [403, 422],
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
    api.requestRaw<ServiceMatrixDto>('/api/v1/system/services/matrix'),
  /** Product catalog apt upgrade status (software hub) */
  softwareUpgrades: () =>
    api.requestRaw<{
      items: Array<{
        id: string;
        packageName: string;
        installed: boolean;
        currentVersion?: string;
        candidateVersion?: string;
        upgradable: boolean;
        source?: string;
        notes?: string[];
      }>;
      upgradableCount: number;
    }>('/api/v1/system/software/upgrades'),
  /**
   * Dynamic version discovery (no hardcoded latest pins).
   * Runtime = upstream APIs; services = apt Candidate.
   */
  softwareVersions: (query: { id?: string; ids?: string[]; refresh?: boolean }) => {
    const sp = new URLSearchParams();
    if (query.id) sp.set('id', query.id);
    if (query.ids?.length) sp.set('ids', query.ids.join(','));
    if (query.refresh) sp.set('refresh', '1');
    const qs = sp.toString();
    return api.requestRaw<{
      id?: string;
      title?: string;
      updateKind?: 'runtime' | 'apt' | 'none';
      installed?: boolean;
      currentVersion?: string;
      latestVersion?: string;
      upgradable?: boolean;
      candidates?: Array<{ version: string; label: string; source: string }>;
      packageName?: string;
      source?: string;
      fetchedAt?: string;
      notes?: string[];
      items?: Array<{
        id: string;
        title: string;
        updateKind: 'runtime' | 'apt' | 'none';
        installed: boolean;
        currentVersion?: string;
        latestVersion?: string;
        upgradable: boolean;
        candidates: Array<{ version: string; label: string; source: string }>;
        packageName?: string;
        source?: string;
        notes?: string[];
      }>;
      upgradableCount?: number;
    }>(`/api/v1/system/software/versions${qs ? `?${qs}` : ''}`);
  },
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
    kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
    version: string;
    install?: boolean;
    /** PHP: extension ids (mysql, gd, redis, …) */
    extensions?: string[];
    /** Companion tools: node pm2, python poetry, go air, … */
    plugins?: string[];
  }) =>
    // Install failures return 403 (blocked) / 422 (failed) with full ops body —
    // must not throw on those so notes / requires* reach OpsResultPanel.
    api.requestRawAllowStatus('/api/v1/hosting/runtimes/install', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  /**
   * Live SSE install — streams apt/curl lines to onLog, returns final ops result.
   * Prefer this for UI installs longer than a few seconds.
   */
  runtimeInstallStream: (
    body: {
      kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
      version: string;
      install?: boolean;
      extensions?: string[];
      plugins?: string[];
    },
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
        at?: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-runtime-install').then((m) =>
      m.streamRuntimeInstall(body, opts),
    ),
  /** Switch active default for multi-version Go / Rust (no reinstall) */
  runtimeSwitch: (body: { kind: 'go' | 'rust'; version: string }) =>
    api.requestRawAllowStatus('/api/v1/hosting/runtimes/switch', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  runtimePlugins: (kind: string, opts?: { bust?: boolean }) => {
    const q = new URLSearchParams({ kind });
    if (opts?.bust) q.set('_', String(Date.now()));
    return api.requestRaw<{
      kind: string;
      plugins: Array<{
        id: string;
        label: string;
        hint?: string;
        group?: string;
        recommended: boolean;
        required: boolean;
        installer: string;
        bins?: string[];
        installed?: boolean;
      }>;
      defaults: string[];
      useExtensions?: boolean;
    }>(`/api/v1/hosting/runtimes/plugins?${q.toString()}`);
  },
  /** Install companion tools only (no full runtime stack) */
  runtimePluginsInstall: (body: {
    kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
    plugins: string[];
  }) =>
    api.requestRawAllowStatus('/api/v1/hosting/runtimes/plugins/install', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  runtimePluginsInstallStream: (
    body: {
      kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
      plugins: string[];
    },
    opts?: {
      onLog?: (line: {
        stream: 'stdout' | 'stderr' | 'status';
        line: string;
        at?: string;
      }) => void;
      signal?: AbortSignal;
    },
  ) =>
    import('../runtimes/stream-sse').then(async (m) => {
      const { ops } = await m.postSseJson(
        '/api/v1/hosting/runtimes/plugins/install',
        body as unknown as Record<string, unknown>,
        opts,
      );
      return ops;
    }),
  /** Uninstall companion tools (pm2, poetry, …) — not PHP extensions */
  runtimePluginsUninstall: (body: {
    kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
    plugins: string[];
  }) =>
    api.requestRawAllowStatus('/api/v1/hosting/runtimes/plugins/uninstall', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  /** Unified addons: PHP extensions or companion plugins */
  runtimeAddons: (kind: string, version?: string, opts?: { bust?: boolean }) => {
    const q = new URLSearchParams({ kind });
    if (version) q.set('version', version);
    if (opts?.bust) q.set('_', String(Date.now()));
    return api.requestRaw<{
      kind: string;
      mode: 'extensions' | 'plugins';
      version?: string;
      items: Array<{
        id: string;
        label: string;
        hint?: string;
        group?: string;
        recommended: boolean;
        required: boolean;
        installed?: boolean;
        package?: string;
        installer?: string;
        bins?: string[];
      }>;
      defaults: string[];
    }>(`/api/v1/hosting/runtimes/addons?${q.toString()}`);
  },
  runtimeLatest: (kind: string, refresh = false) =>
    api.requestRaw<{
      kind: string;
      panelLatest: string;
      remoteLatest?: string;
      newerThanPanel?: boolean;
      source?: string;
      fetchedAt?: string;
      notes: string[];
    }>(
      `/api/v1/hosting/runtimes/latest?kind=${encodeURIComponent(kind)}${
        refresh ? '&refresh=1' : ''
      }`,
    ),
  phpExtensionsUninstall: (body: { version: string; extensions: string[] }) =>
    api.requestRawAllowStatus('/api/v1/hosting/php/extensions/uninstall', {
      method: 'POST',
      body: JSON.stringify(body),
      allowStatuses: [403, 422],
    }),
  phpExtensions: (version = '8.2', opts?: { bust?: boolean }) => {
    const q = new URLSearchParams({ version });
    if (opts?.bust) q.set('_', String(Date.now()));
    return api.requestRaw<{
      version: string;
      supportedVersions: string[];
      extensions: Array<{
        id: string;
        group: string;
        label: string;
        hint?: string;
        recommended: boolean;
        required: boolean;
        package: string;
        installed?: boolean;
      }>;
      defaults: string[];
    }>(`/api/v1/hosting/php/extensions?${q.toString()}`);
  },
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
   * Must use requestRawAllowStatus so Accept-Language matches the UI locale.
   */
  readiness: async (): Promise<ProductionReadinessDto> => {
    const data = await api.requestRawAllowStatus<ProductionReadinessDto>(
      '/api/v1/readiness',
      { allowStatuses: [503] },
    );
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
      throw new Error(i18n.t('readiness.reportFormatError'));
    }
    return data;
  },
  publicFilesApply: (body: { serverName: string; quotaMb?: number; reload?: boolean }) =>
    api.requestRaw('/api/v1/hosting/files/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
