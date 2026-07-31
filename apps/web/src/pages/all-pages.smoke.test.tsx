/**
 * Systematic smoke renders for major pages under src/pages and src/pages/features.
 * Goal: maximize line coverage via partial mounts with mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { DashboardPage } from './DashboardPage';
import { AgentsPage } from './AgentsPage';
import { AiPage } from './AiPage';
import { EmailPage } from './EmailPage';
import { EmailDomainPage } from './EmailDomainPage';
import { FilesPage } from './FilesPage';
import { ProjectsPage } from './ProjectsPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { SecurityPage } from './SecurityPage';
import { SystemPage } from './SystemPage';
import { UpdatesPage } from './UpdatesPage';
import { UsersPage } from './UsersPage';
import { LoginPage } from './LoginPage';

import { BackupsPage } from './features/BackupsPage';
import { CdnPage } from './features/CdnPage';
import { CronPage } from './features/CronPage';
import { DnsPage } from './features/DnsPage';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { FtpPage } from './features/FtpPage';
import { FtpsServicePage } from './features/FtpsServicePage';
import {
  GoRuntimePage,
  NodeRuntimePage as GenericNodeRuntimePage,
  PythonRuntimePage,
  RustRuntimePage,
} from './features/GenericRuntimePage';
import { LogsPage } from './features/LogsPage';
import { MariadbPage } from './features/MariadbPage';
import { MariadbServicePage } from './features/MariadbServicePage';
import { MetricsPage } from './features/MetricsPage';
import { MigrateHostPage } from './features/MigrateHostPage';
import { MysqlPage } from './features/MysqlPage';
import { MysqlServicePage } from './features/MysqlServicePage';
import { NetworkPage } from './features/NetworkPage';
import { NginxPage } from './features/NginxPage';
import { NodeRuntimePage } from './features/NodeRuntimePage';
import { PhpRuntimePage } from './features/PhpRuntimePage';
import { PostgresPage } from './features/PostgresPage';
import { PostgresServicePage } from './features/PostgresServicePage';
import { ProtectionPage } from './features/ProtectionPage';
import { PublicFilesPage } from './features/PublicFilesPage';
import { ReadinessPage } from './features/ReadinessPage';
import { RedisPage } from './features/RedisPage';
import { RedisServicePage } from './features/RedisServicePage';
import { ServicesPage } from './features/ServicesPage';
import { SslPage } from './features/SslPage';
import { SystemdUnitPage } from './features/SystemdUnitPage';
import { SqlEnginePage } from './features/SqlEnginePage';

type SmokeCase = {
  name: string;
  path: string;
  routePath?: string;
  el: ReactElement;
  /** Optional heading text match (string or regex). Defaults to any h1. */
  heading?: string | RegExp;
  extraRoutes?: FetchRoute[];
  /** Click every role=tab after mount (covers conditional tab panels). */
  clickTabs?: boolean;
};

/** Click every tab once to force-render tab-gated branches. */
async function clickAllTabs(user: ReturnType<typeof userEvent.setup>) {
  // Snapshot labels first — DOM tabs remount when active changes
  const labels = screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
  for (const label of labels) {
    if (!label.trim()) continue;
    try {
      const tab = screen.queryByRole('tab', { name: label }) ??
        screen.queryAllByRole('tab').find((el) => el.textContent === label);
      if (tab) {
        await user.click(tab);
        await new Promise((r) => setTimeout(r, 30));
      }
    } catch {
      /* tab may unmount during navigation */
    }
  }
}

const emptyList = { items: [], meta: { total: 0, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };

const hostOverview = {
  ok: true,
  identity: {
    hostname: 'ysk-test',
    prettyHostname: 'YSK Test',
    timezone: 'UTC',
  },
  os: {
    platform: 'linux',
    arch: 'x64',
    release: 'Test OS',
    kernel: '6.0',
  },
  runtime: {
    uptimeSec: 100,
    loadavg: [0.1, 0.1, 0.1],
    cpus: 2,
    memory: { total: 8_000_000_000, free: 4_000_000_000, usedRatio: 0.5 },
    node: 'v20.0.0',
    pid: 1,
    uid: 0,
  },
  time: {
    utc: new Date().toISOString(),
    local: new Date().toISOString(),
    ntpEnabled: true,
    ntpSynchronized: true,
    timeSource: 'ntp',
  },
  network: { ips: ['127.0.0.1'], interfaces: [], resolvers: ['1.1.1.1'] },
  disks: [],
  power: { pending: null },
  boot: { defaultTarget: 'multi-user.target' },
  caps: {
    executeEnabled: false,
    isRoot: false,
    canPower: false,
    canIdentity: false,
  },
  collectedAt: new Date().toISOString(),
};

const emailBundle = {
  domain: 'example.com',
  records: [],
  externalTodos: [],
  health: { score: 50, maxScore: 100, messages: [] },
  notes: [],
};

const networkSnap = {
  ok: true,
  at: new Date().toISOString(),
  notes: [],
  backend: {
    hasIp: true,
    networkManager: 'inactive',
    networkd: 'inactive',
    canPersist: false,
  },
  interfaces: [
    {
      name: 'eth0',
      ifindex: 2,
      operstate: 'UP',
      flags: ['UP', 'BROADCAST'],
      mac: 'aa:bb:cc:dd:ee:ff',
      mtu: 1500,
      isLoopback: false,
      isDefaultEgress: true,
      addrs: [{ family: 'inet' as const, local: '10.0.0.5', prefixlen: 24 }],
      stats: { rxBytes: 1000, txBytes: 2000, rxPackets: 10, txPackets: 10 },
    },
  ],
  routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0', protocol: 'static' }],
  caps: { canMutate: true, executeEnabled: false, isRoot: false },
  defaultGateway: '10.0.0.1',
  defaultDev: 'eth0',
  dns: {
    nameservers: ['1.1.1.1'],
    uplinkServers: ['1.1.1.1'],
    search: ['example.com'],
    source: 'static',
    notes: [],
    ignoreAutoDns: true,
    canApply: true,
    mode: 'static' as const,
  },
};

const readinessReport = {
  productionReady: false,
  mode: 'degraded',
  summary: ['execute policy off'],
  score: { ready: 1, degraded: 1, missing: 1, total: 3 },
  items: [
    {
      id: 'execute-policy',
      category: 'security',
      level: 'missing',
      severity: 'critical',
      title: 'Execute',
      detail: 'Host execute is off',
      fixHint: 'Enable execute',
    },
  ],
  blockers: [],
  categories: ['security'],
};

const dbConsole = {
  engine: 'postgres',
  title: 'PostgreSQL',
  unit: 'postgresql',
  active: 'inactive',
  activeLabel: 'inactive',
  enabled: 'disabled',
  installed: true,
  executeEnabled: false,
  isRoot: false,
  canLifecycle: true,
  blockMessage: 'Host execute is off',
  metrics: { connections: '0', uptime: '0' },
  categories: [
    {
      id: 'memory',
      label: 'Memory',
      description: 'Memory settings',
      settings: [
        {
          key: 'shared_buffers',
          label: 'Shared buffers',
          category: 'memory',
          type: 'text',
          applyMode: 'restart',
          liveValue: '128MB',
          description: 'Buffer pool',
        },
        {
          key: 'log_level',
          label: 'Log level',
          category: 'memory',
          type: 'enum',
          enumValues: ['info', 'warn', 'error'],
          applyMode: 'reload',
          liveValue: 'info',
        },
        {
          key: 'danger_flag',
          label: 'Danger',
          category: 'memory',
          type: 'bool',
          applyMode: 'runtime',
          liveValue: 'off',
          danger: true,
          advanced: true,
        },
      ],
    },
  ],
  live: { shared_buffers: '128MB' },
};

const defenseStatus = {
  at: new Date().toISOString(),
  threatLevel: 'elevated' as const,
  score: 42,
  signals: [
    { id: 'highReqRate', label: 'Req rate', value: 120, points: 10, detail: 'elevated' },
    { id: 'f2bBans', label: 'F2b bans', value: 2, points: 5 },
  ],
  activePreset: 'daily',
  presets: [
    {
      id: 'daily',
      label: 'Daily',
      short: 'Normal',
      bullets: ['rate limits', 'fail2ban'],
    },
    {
      id: 'hardened',
      label: 'Hardened',
      short: 'Firm',
      bullets: ['tighter limits'],
    },
    {
      id: 'under_attack',
      label: 'Under attack',
      short: 'Alert',
      bullets: ['aggressive'],
      danger: true,
    },
    {
      id: 'emergency',
      label: 'Emergency',
      short: 'Critical',
      bullets: ['lockdown'],
      danger: true,
    },
  ],
  bans: {
    count: 1,
    items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }],
  },
  nginxLimits: {
    reqRate: '10r/s',
    burst: 20,
    connLimit: 40,
    confPath: '/etc/nginx/conf.d/ysk-defense.conf',
    exists: true,
  },
  firewall: { active: 'inactive', installed: true },
  fail2ban: { active: 'inactive', installed: true, jails: 1 },
  labels: {
    firewall: { short: 'off', tone: 'warn' as const },
    fail2ban: { short: 'off', tone: 'warn' as const },
    apply: { short: 'written', tone: 'info' as const },
    autoBan: { short: 'on', tone: 'ok' as const },
  },
  autoBan: {
    enabled: true,
    mode: 'normal' as const,
    method: 'fail2ban' as const,
    cooldownMinutes: 30,
    maxAutoBansPerHour: 20,
    whitelist: ['127.0.0.1'],
    autoBansLastHour: 1,
  },
  protectionMode: 'observe',
  executeEnabled: false,
  isRoot: false,
  suggestions: [
    {
      id: 's1',
      title: 'Apply daily preset',
      body: 'Baseline protection',
      action: 'preset:daily',
    },
    {
      id: 's2',
      title: 'Review bans',
      body: 'Check ban list',
      action: 'tab:bans',
    },
  ],
  notes: ['written ≠ applied on host'],
};

const geoipStatus = {
  provider: 'dbip',
  dir: '/var/lib/ysk/geoip',
  ready: true,
  stale: false,
  cityReady: true,
  maxGranularity: 'city',
  notes: [],
  attribution: ['DB-IP'],
  policy: {
    enabled: false,
    mode: 'deny_list' as const,
    countries: ['CN'],
    continents: [],
    regions: [],
    cities: [],
    cityPolicyEnabled: false,
    asns: [],
    enforce: { autoBan: true, nginx: true, ufw: false },
    autoUpdate: true,
  },
  sources: [
    {
      filename: 'dbip-country.mmdb',
      present: true,
      mtime: new Date().toISOString(),
      bytes: 1000,
      license: 'free',
      updateHint: 'weekly',
    },
  ],
  meta: { lastSuccessAt: new Date().toISOString() },
  scheduler: { intervalMs: 86400000 },
};

const defenseAutomation = {
  enabled: true,
  autoPreset: {
    enabled: true,
    escalateToHardenedAt: 40,
    escalateToUnderAttackAt: 70,
    suggestEmergencyAt: 90,
    deescalateEnabled: true,
    deescalateToDailyBelow: 20,
    holdMinutes: 30,
  },
  autoBan: {
    enabled: true,
    mode: 'normal' as const,
    method: 'fail2ban' as const,
    minScore: 10,
    minHits: 50,
    min429: 5,
    minScan: 3,
    cooldownMinutes: 30,
    maxAutoBansPerHour: 20,
    intervalSeconds: 60,
    whitelist: ['127.0.0.1'],
    syncFail2banIgnoreip: true,
  },
  signalWeights: {
    networkDown: 20,
    highReqRate: 10,
    ddosHeuristic: 15,
    tcpInuse: 5,
    ufwInactive: 5,
    f2bBans: 5,
  },
  cloudflare: {
    enabled: false,
    zones: [],
    onAutoEscalate: false,
  },
  lastTickAt: new Date().toISOString(),
  lastTickNotes: ['ok'],
  suggestEmergency: false,
};

const commonRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  { match: '/health', body: { ok: true, status: 'ok', version: 'test' } },
  { match: '/api/v1/health', body: { ok: true, status: 'ok' } },
  {
    match: '/api/v1/readiness',
    body: readinessReport,
  },
  {
    match: /\/api\/v1\/system\/host/,
    body: hostOverview,
  },
  {
    match: /\/api\/v1\/network/,
    body: networkSnap,
  },
  {
    match: /\/api\/v1\/system\/db\/\w+\/console/,
    body: dbConsole,
  },
  {
    match: (url) => url.startsWith('/api/v1/system/db/redis/status'),
    body: {
      serverInstalled: true,
      clientInstalled: true,
      unit: 'redis-server',
      active: 'active',
      reachable: true,
      ping: 'PONG',
      executeEnabled: false,
      isRoot: false,
      canRead: true,
      canWrite: false,
      canInstall: false,
      version: '7.0',
      usedMemory: '12M',
      connectedClients: '3',
      keyspace: [
        { db: 0, keys: 12, expires: 2 },
        { db: 1, keys: 0 },
      ],
      databases: 16,
      configuredDatabases: 16,
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/system/redis/'),
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return HONESTY_WRITTEN_BLOCKED;
      }
      if (url.includes('/keys')) {
        return {
          ok: true,
          keys: [
            { key: 'session:1', type: 'string', ttl: 3600 },
            { key: 'cache:home', type: 'hash', ttl: -1 },
          ],
          notes: [],
        };
      }
      return {
        ok: true,
        view: {
          key: 'session:1',
          type: 'string',
          ttl: 3600,
          value: 'user-1',
        },
        notes: [],
      };
    },
  },
  {
    match: /\/api\/v1\/system\/db\/\w+\/status/,
    body: {
      serverInstalled: true,
      active: 'inactive',
      activeLabel: 'inactive',
      engine: 'mysql',
      executeEnabled: false,
      isRoot: false,
    },
  },
  {
    match: /\/api\/v1\/system\/fail2ban\/status/,
    body: {
      installed: true,
      active: 'inactive',
      activeLabel: 'inactive',
      enabled: 'disabled',
      jails: [],
      banned: [],
      ignoreIps: [],
      catalog: [],
      defaultJails: [],
    },
  },
  {
    match: /\/api\/v1\/system\/firewall/,
    body: {
      installed: true,
      active: 'inactive',
      activeLabel: 'inactive',
      rules: [],
      allowCount: 0,
      denyCount: 0,
    },
  },
  {
    match: /\/api\/v1\/system\/ftps/,
    body: {
      settings: {
        enabled: false,
        listenPort: 21,
        pasvMin: 40000,
        pasvMax: 40100,
      },
      status: { installed: true, active: 'inactive', activeLabel: 'inactive' },
      domains: [],
      homes: [],
    },
  },
  {
    match: /\/api\/v1\/system\/nginx/,
    body: {
      installed: true,
      active: 'inactive',
      activeLabel: 'inactive',
      sites: [],
      configTestOk: true,
    },
  },
  {
    match: (url) => /\/api\/v1\/hosting\/runtimes\/\w+\/tuning/.test(url),
    body: {
      kind: 'node',
      version: '20',
      catalog: [
        {
          id: 'process',
          title: 'Process',
          fields: [
            {
              key: 'max_old_space',
              label: 'Heap',
              type: 'number',
              default: 512,
              hint: 'MB',
            },
          ],
        },
      ],
      settings: {
        kind: 'node',
        version: '20',
        values: { max_old_space: 512 },
        env: { NODE_ENV: 'production' },
      },
      envPreview: { NODE_ENV: 'production' },
      notes: [],
    },
  },
  {
    match: (url) => url.includes('/api/v1/hosting/php/ini'),
    body: {
      version: '8.2',
      catalog: [
        {
          id: 'core',
          title: 'Core',
          description: 'php.ini',
          fields: [
            {
              key: 'memory_limit',
              label: 'memory_limit',
              type: 'text',
              default: '128M',
              hint: 'RAM',
            },
          ],
        },
      ],
      settings: {
        version: '8.2',
        values: { memory_limit: '128M' },
        extra: {},
        rawAppend: '',
      },
      managedIniPath: '/etc/php/8.2/conf.d/ysk.ini',
      notes: [],
      ok: true,
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/runtimes/tools'),
    body: {
      composer: { present: true, version: '2' },
      wpCli: { present: false },
    },
  },
  {
    match: /\/api\/v1\/hosting\/runtimes/,
    body: {
      ok: true,
      nodeVersion: 'v20.0.0',
      nodePath: '/usr/bin/node',
      probe: {},
      supported: {},
      catalog: [],
      settings: { values: {}, env: {} },
      envPreview: {},
      notes: [],
    },
  },
  {
    match: /\/api\/v1\/cron/,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          item: {
            id: 'job-1',
            name: 'Nightly backup',
            schedule: '0 2 * * *',
            command: 'ysk backup',
            enabled: true,
          },
        };
      }
      if (url.includes('/status') || url.includes('status')) {
        return {
          managedPath: '/etc/cron.d/ysk',
          managedLines: 2,
          enabledJobs: 1,
          totalJobs: 1,
          hostHasYskEntries: true,
          hostCrontabPreview: '0 2 * * * root ysk backup\n',
          executeEnabled: false,
          lastInstallOk: false,
          lastInstallAt: new Date().toISOString(),
          notes: ['written ≠ applied'],
        };
      }
      return {
        items: [
          {
            id: 'job-1',
            name: 'Nightly backup',
            schedule: '0 2 * * *',
            command: 'ysk backup',
            enabled: true,
            projectId: 'p1',
          },
          {
            id: 'job-2',
            name: 'Health ping',
            schedule: '*/5 * * * *',
            command: 'curl -fsS localhost/health',
            enabled: false,
          },
        ],
        managedPath: '/etc/cron.d/ysk',
        managedLines: 2,
        enabledJobs: 1,
        totalJobs: 2,
        hostHasYskEntries: true,
        hostCrontabPreview: '0 2 * * * root ysk backup\n',
        executeEnabled: false,
        lastInstallOk: null,
        lastInstallAt: null,
      };
    },
  },
  {
    match: /\/api\/v1\/logs\//,
    handler: (url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        return { ...HONESTY_WRITTEN_BLOCKED, text: 'line1\nline2', lines: ['line1', 'line2'] };
      }
      if (url.includes('/projects')) {
        return {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              files: [{ name: 'app.log', bytes: 100, previewable: true, path: '/var/log/demo/app.log' }],
              related: [{ id: 'journal:ysk-project-p1.service', label: 'unit' }],
            },
          ],
        };
      }
      if (url.includes('/sources')) {
        return {
          items: [
            {
              id: 'journal:nginx.service',
              kind: 'journal',
              label: 'nginx',
              unit: 'nginx.service',
              group: 'web',
              available: true,
            },
            {
              id: 'file:nginx-access',
              kind: 'file',
              label: 'nginx access',
              path: '/var/log/nginx/access.log',
              group: 'web',
              available: true,
            },
          ],
        };
      }
      if (url.includes('/journal/units')) {
        return {
          items: [
            { unit: 'nginx.service', active: 'active' },
            { unit: 'ysk-project-p1.service', active: 'inactive' },
          ],
        };
      }
      if (url.includes('/overview')) {
        return {
          ok: true,
          journalDiskMb: 120,
          followIntervalSec: 3,
          journalWarnMb: 1024,
          vacuumDefaultDays: 14,
          maxLines: 300,
          sources: 2,
          units: 2,
          projects: 1,
        };
      }
      if (url.includes('/settings')) {
        return {
          vacuumDefaultDays: 14,
          maxLines: 300,
          journalWarnMb: 1024,
          followIntervalSec: 3,
          bookmarks: [{ id: 'b1', name: 'nginx errors', source: 'journal:nginx.service', grep: 'error' }],
        };
      }
      if (url.includes('/query') || url.includes('/tail') || url.includes('/read')) {
        return {
          ok: true,
          text: 'access ok\nerror denied\n',
          lines: ['access ok', 'error denied'],
          truncated: false,
          notes: [],
        };
      }
      return {
        ok: true,
        items: [],
        sources: [],
        units: [],
        quickUnits: [],
        journalDiskMb: 120,
        followIntervalSec: 3,
        journalWarnMb: 1024,
        vacuumDefaultDays: 14,
        maxLines: 300,
        text: 'sample log line',
        lines: ['sample log line'],
        settings: {},
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics/projects'),
    body: {
      ok: true,
      items: [
        {
          projectId: 'p1',
          name: 'Demo',
          usedMb: 120,
          quotaMb: 1024,
          path: '/home/demo',
        },
      ],
      totalMb: 1024,
      usedMb: 120,
      at: new Date().toISOString(),
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics/processes'),
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          pid: 42,
          signal: 'TERM',
          stillAlive: true,
        };
      }
      if (url.includes('/detail') || /\/processes\/\d+/.test(url)) {
        return {
          ok: true,
          pid: 42,
          user: 'root',
          cmd: 'nginx: master',
          cpu: 0.5,
          mem: 1.2,
          nice: 0,
          state: 'S',
          threads: 2,
          start: new Date().toISOString(),
          cwd: '/',
          exe: '/usr/sbin/nginx',
        };
      }
      return {
        ok: true,
        at: new Date().toISOString(),
        sort: 'cpu',
        limit: 40,
        rows: [
          {
            pid: '42',
            user: 'root',
            cpu: 1.5,
            mem: 2.1,
            command: 'nginx: master process',
            state: 'S',
            etime: '01:00',
            resKiB: 20000,
            virtKiB: 100000,
          },
          {
            pid: '99',
            user: 'demo',
            cpu: 5.0,
            mem: 3.0,
            command: 'node server.js',
            state: 'R',
            etime: '00:30',
            resKiB: 40000,
            virtKiB: 200000,
          },
        ],
        notes: [],
        topHeader: {
          ok: true,
          at: new Date().toISOString(),
          uptimeSec: 3600,
          loadavg: [0.2, 0.3, 0.4],
          tasks: { total: 100, running: 2, sleeping: 98, stopped: 0, zombie: 0 },
          cpu: {
            us: 5,
            sy: 3,
            ni: 0,
            id: 88,
            wa: 2,
            hi: 0,
            si: 0,
            st: 0,
            busyPct: 12,
          },
          cpus: [
            {
              us: 5,
              sy: 2,
              ni: 0,
              id: 93,
              wa: 0,
              hi: 0,
              si: 0,
              st: 0,
              busyPct: 7,
            },
          ],
          memory: {
            totalKiB: 2e6,
            freeKiB: 1e6,
            usedKiB: 5e5,
            buffCacheKiB: 5e5,
            availableKiB: 1.5e6,
          },
          swap: { totalKiB: 1e6, freeKiB: 9e5, usedKiB: 1e5 },
          notes: [],
        },
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics'),
    body: {
      at: new Date().toISOString(),
      loadavg: [0.2, 0.3, 0.4],
      cpuCount: 4,
      memory: {
        total: 2e9,
        free: 1e9,
        usedRatio: 0.25,
        available: 1.5e9,
      },
      uptimeSec: 3600,
      disk: { path: '/', free: 9e10, total: 1e11, usedRatio: 0.1 },
      diskMounts: [
        {
          filesystem: '/dev/sda1',
          size: 1e11,
          used: 1e10,
          avail: 9e10,
          usedRatio: 0.1,
          mount: '/',
        },
        {
          filesystem: '/dev/sda2',
          size: 5e10,
          used: 5e9,
          avail: 4.5e10,
          usedRatio: 0.1,
          mount: '/var',
        },
      ],
      alerts: ['disk_high'],
      notes: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
    body: geoipStatus,
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/geoip/'),
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET' && !url.includes('lookup')) {
        return HONESTY_WRITTEN_BLOCKED;
      }
      return {
        ok: true,
        ...HONESTY_WRITTEN_BLOCKED,
        lookup: {
          ip: '203.0.113.50',
          country: 'US',
          regionKey: 'US-NY',
          regionName: 'New York',
          city: 'New York',
          cityKey: 'US-NY-NYC',
          continent: 'NA',
          latitude: 40.7,
          longitude: -74.0,
          asn: '13335',
          asName: 'Cloudflare',
          source: 'dbip',
        },
        access: { blocked: false, matched: [] },
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
    body: defenseStatus,
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/timeline'),
    body: {
      items: [
        {
          at: new Date().toISOString(),
          kind: 'preset',
          title: 'Preset daily',
          detail: 'applied in panel',
        },
      ],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/suspects'),
    body: {
      items: [
        {
          ip: '198.51.100.7',
          score: 30,
          hits: 100,
          reasons: ['scan'],
          sources: ['nginx'],
          lastSeen: new Date().toISOString(),
        },
      ],
      notes: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/automation'),
    body: {
      automation: defenseAutomation,
      mechanisms: [
        { step: '1', mechanism: 'fail2ban', tunable: 'bantime' },
        { step: '2', mechanism: 'nginx', tunable: 'limit_req' },
      ],
      autoBansLastHour: 1,
      schedNext: new Date(Date.now() + 60_000).toISOString(),
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/intel'),
    body: {
      topIps: [{ ip: '203.0.113.10', hits: 50, s429: 2, scan: 3, score: 20 }],
      vhostLimits: {
        withLimit: 1,
        total: 2,
        items: [{ name: 'demo.example.com', hasDefenseMarker: true }],
      },
      hasCfToken: false,
      cfZones: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/bans'),
    body: {
      items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/whitelist'),
    body: { items: ['127.0.0.1'], ok: true },
  },
  {
    match: /\/api\/v1\/defense/,
    body: {
      ...HONESTY_WRITTEN_BLOCKED,
      items: [],
      enabled: false,
      modes: [],
      whitelist: ['127.0.0.1'],
      presets: defenseStatus.presets,
      automation: defenseAutomation,
      mechanisms: [],
      timeline: [],
      bans: defenseStatus.bans,
      suspects: { items: [], notes: [] },
      mode: 'observe',
      level: 'elevated',
    },
  },
  {
    match: /\/api\/v1\/ssh\//,
    body: {
      ok: true,
      items: [
        {
          id: 'id-1',
          name: 'panel-key',
          purpose: 'panel_outbound',
          status: 'installed',
          algo: 'ed25519',
          fingerprintSha256: 'SHA256:abc',
          publicKey: 'ssh-ed25519 AAAA',
          createdAt: new Date().toISOString(),
          binding: { linuxUser: 'ysk', homeDir: '/home/ysk' },
        },
      ],
      host: {
        notes: ['pam ready'],
        lights: { package: 'ok', pam: 'ok', kbdInteractive: 'warn' },
      },
      pamSnippet: '# pam',
      sshdHints: '# sshd',
      strictSnippet: '# strict',
      strictNotes: [],
      snippet: 'Match User ysk',
      notes: [],
    },
  },
  {
    match: /\/api\/v1\/sftp\//,
    body: {
      ok: true,
      items: [
        {
          id: 'k1',
          projectId: 'p1',
          publicKey: 'ssh-ed25519 AAAA',
          comment: 'laptop',
          fingerprint: 'SHA256:xyz',
        },
      ],
      snippet: 'Match Group sftp',
      notes: [],
    },
  },
  {
    match: /\/api\/v1\/db\/clusters/,
    body: {
      ok: true,
      items: [
        {
          id: 'c1',
          name: 'ysk-cluster',
          engine: 'postgres',
          kind: 'postgres-replica',
          status: 'planned',
          members: [
            { host: '10.0.0.1', role: 'primary', access: 'local', label: 'primary' },
            { host: '10.0.0.2', role: 'replica', access: 'ssh', label: 'replica-1' },
          ],
          params: {},
          artifactDir: '/var/lib/ysk/clusters/c1',
        },
      ],
      cluster: {
        id: 'c1',
        name: 'ysk-cluster',
        engine: 'postgres',
        kind: 'postgres-replica',
        status: 'planned',
        members: [],
        params: {},
      },
      plan: {
        ok: true,
        notes: ['dry-run plan'],
        steps: [{ id: '1', title: 'Write config', detail: 'pg_hba' }],
        clusterId: 'c1',
        files: ['pg_hba.conf'],
      },
    },
  },
  {
    match: /\/api\/v1\/ssl/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/dns/,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          dsRecord: 'example.com. IN DS 12345 13 2 ABCD',
          publicKey: 'key',
          files: ['/var/lib/bind/example.com.zone'],
          answers: ['203.0.113.10'],
          notes: ['written ≠ applied'],
          peers: [{ host: 'peer.example.com', ok: false }],
        };
      }
      if (url.includes('/cluster/peers')) {
        return {
          items: [
            {
              id: 'peer-1',
              host: 'peer.example.com',
              user: 'ysk',
              label: 'peer',
            },
          ],
        };
      }
      return emptyList;
    },
  },
  {
    match: (url) => url.includes('/api/v1/cdn/dashboard') || url.includes('/cdn/dashboard'),
    body: {
      at: new Date().toISOString(),
      nodes: {
        total: 1,
        online: 1,
        offline: 0,
        draining: 0,
        unknown: 0,
        byRegion: { local: 1 },
      },
      sites: {
        total: 1,
        byApplyStatus: { planned: 1 },
        rows: [{ id: 'site-1', name: 'Demo site', apply_status: 'planned' }],
      },
      cache: [
        {
          siteId: 'site-1',
          siteName: 'Demo site',
          hitRatePct: 80,
          hits: 100,
          misses: 20,
          method: 'stub',
          notes: [],
        },
      ],
      overallHitRatePct: 80,
      notes: [],
    },
  },
  {
    match: (url, init) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      return url.startsWith('/api/v1/cdn/nodes') && m === 'GET' && !url.includes('/probe');
    },
    body: {
      items: [
        {
          id: 'n1',
          name: 'edge-1',
          roles: ['edge'],
          region: 'local',
          publicIpv4: ['203.0.113.10'],
          publicIpv6: [],
          weight: 100,
          status: 'online',
          healthUrl: 'http://203.0.113.10/health',
          baseUrl: 'http://203.0.113.10',
          lastHeartbeatAt: new Date().toISOString(),
          lastHealth: { ok: true, latencyMs: 12, at: new Date().toISOString() },
        },
      ],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: (url, init) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      return url.startsWith('/api/v1/cdn/sites') && m === 'GET';
    },
    body: {
      items: [
        {
          id: 'site-1',
          name: 'Demo site',
          domains: ['cdn.example.com'],
          mode: 'origin_pull',
          origin: { kind: 'url', url: 'https://origin.example.com' },
          edgeNodeIds: ['n1'],
          dns: { strategy: 'multi_a', ttlHealthy: 60, ttlUnhealthy: 30, minHealthyEdges: 1 },
          cache: { enabled: true, zoneSize: '10m', maxAge: '10m' },
          ssl: { mode: 'off' },
          apply_status: 'planned',
          edge_status: { n1: 'planned' },
        },
      ],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: /\/api\/v1\/cdn/,
    handler: (_url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          contentHash: 'abc',
          conf: '# nginx conf',
        };
      }
      return emptyList;
    },
  },
  {
    match: (url) => /\/api\/v1\/email\/domains\/[^/]+\/dns/.test(url),
    body: emailBundle,
  },
  {
    match: (url) => /\/api\/v1\/email\/domains\/[^/]+\/mailboxes/.test(url),
    body: emptyList,
  },
  {
    match: (url) => /\/api\/v1\/email\/domains\/[^/]+\/aliases/.test(url),
    body: emptyList,
  },
  {
    match: /\/api\/v1\/email/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/scheduler/,
    body: { jobs: [], items: [] },
  },
  {
    match: /\/api\/v1\/projects/,
    body: emptyList,
  },
  {
    match: (url) => url.startsWith('/api/v1/backups/settings'),
    handler: (_url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
      return {
        remote: {
          enabled: true,
          kind: 'sftp',
          host: 'backup.example.com',
          port: 22,
          username: 'ysk',
          path: '/backups/ysk',
          password: '***',
        },
        exclusions: ['node_modules', '.git'],
        restic: {
          enabled: true,
          repoPath: '/var/backups/restic',
          password: '***',
        },
      };
    },
  },
  {
    match: /\/api\/v1\/backups/,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ...HONESTY_WRITTEN_BLOCKED, snapshots: [] };
      }
      if (url.includes('restic') && url.includes('snapshot')) {
        return {
          items: [
            {
              id: 'snap-1',
              time: new Date().toISOString(),
              hostname: 'ysk',
              paths: ['/home/demo'],
              short_id: 'abc123',
            },
          ],
        };
      }
      return {
        items: [
          {
            projectId: 'p1',
            name: 'Demo',
            path: '/var/backups/p1-2026.tgz',
            bytes: 1_024_000,
            mtime: new Date().toISOString(),
            kind: 'full',
          },
        ],
        lastRun: {
          at: new Date().toISOString(),
          ok: true,
          notes: ['completed'],
        },
      };
    },
  },
  {
    match: /\/api\/v1\/users/,
    body: {
      items: [
        {
          id: 'u1',
          username: 'admin',
          roles: ['admin'],
          packageId: 'pkg1',
          suspended: false,
          locale: 'en',
        },
      ],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: /\/api\/v1\/packages/,
    body: {
      items: [
        {
          id: 'pkg1',
          name: 'default',
          maxProjects: 10,
          maxMailboxes: 10,
          maxDatabases: 5,
          diskMb: 10240,
          bandwidthMb: 0,
          ftp: true,
          ssh: true,
          notes: '',
        },
      ],
    },
  },
  {
    match: /\/api\/v1\/resources\//,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          item: {
            id: 'z1',
            zone: 'example.com',
            name: '@',
            type: 'A',
            value: '203.0.113.10',
            ttl: 300,
            nsName: 'ns1.example.com',
            apply_status: 'planned',
          },
          ok: true,
        };
      }
      if (url.includes('dns/zones')) {
        return {
          items: [
            {
              id: 'z1',
              zone: 'example.com',
              serverIp: '203.0.113.10',
              nsName: 'ns1.example.com',
              ttl: 300,
              apply_status: 'planned',
              backend: 'bind',
            },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      }
      if (url.includes('dns/records')) {
        return {
          items: [
            {
              id: 'r1',
              zoneId: 'z1',
              type: 'A',
              name: '@',
              value: '203.0.113.10',
              ttl: 300,
            },
            {
              id: 'r2',
              zoneId: 'z1',
              type: 'MX',
              name: '@',
              value: '10 mail.example.com.',
              ttl: 300,
            },
          ],
          meta: { total: 2, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      }
      if (url.includes('mysql/databases') || url.includes('mysql/users')) {
        return {
          items: [
            {
              id: 'db1',
              name: 'app_db',
              engine: 'mysql',
              username: 'app',
              host: 'localhost',
            },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      }
      return emptyList;
    },
  },
  {
    match: /\/api\/v1\/ai\//,
    body: {
      items: [
        {
          id: 't1',
          title: 'Task',
          status: 'completed',
          createdAt: new Date().toISOString(),
          steps: [
            { id: 's1', title: 'Plan', status: 'completed' },
            { id: 's2', title: 'Run', status: 'executed' },
          ],
        },
      ],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: /\/api\/v1\/fleet\//,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          id: 'cmd-1',
          agent_id: 'ag-1',
          status: 'queued',
        };
      }
      if (url.includes('/commands')) {
        return {
          items: [
            {
              id: 'cmd-1',
              agent_id: 'ag-1',
              status: 'done',
              payload: { type: 'ping' },
              createdAt: new Date().toISOString(),
            },
          ],
        };
      }
      return {
        items: [
          {
            id: 'sess-1',
            agent_id: 'ag-1',
            status: 'connected',
            group: 'edge',
            last_seen_at: new Date().toISOString(),
            meta: { hostname: 'edge-1' },
          },
        ],
      };
    },
  },
  {
    match: /\/api\/v1\/agents\//,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: false,
          requiresExecute: true,
          notes: ['Host execute is off'],
          kind: 'openclaw',
          status: 'missing',
        };
      }
      return {
        items: [
          {
            kind: 'openclaw',
            name: 'OpenClaw',
            status: 'missing',
            unitName: 'openclaw.service',
            unitActive: 'inactive',
            pathExists: false,
            installPath: '/opt/openclaw',
            probedAt: new Date().toISOString(),
          },
        ],
        runtime: {
          kind: 'openclaw',
          name: 'OpenClaw',
          status: 'missing',
          unitName: 'openclaw.service',
          unitActive: 'inactive',
          pathExists: false,
          installPath: '/opt/openclaw',
          probedAt: new Date().toISOString(),
        },
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/updates/inventory'),
    body: {
      inventory: [],
      advice: [],
      collectedAt: new Date().toISOString(),
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/updates/self'),
    body: {
      ok: true,
      checked: true,
      updateAvailable: false,
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      channel: 'stable',
    },
  },
  {
    match: /\/api\/v1\/updates/,
    body: {
      ok: true,
      items: [],
      inventory: [],
      advice: [],
      current: { version: '0.1.0' },
      channel: 'stable',
      pending: [],
    },
  },
  {
    match: /\/api\/v1\/files/,
    body: {
      ok: true,
      entries: [],
      path: '/',
      items: [],
    },
  },
  {
    match: (url, init) =>
      url.includes('/api/v1/hosting/files') &&
      !url.includes('/apply') &&
      (init?.method ?? 'GET').toUpperCase() === 'GET',
    handler: (url) => {
      const now = new Date().toISOString();
      if (url.includes('trash')) {
        return {
          ok: true,
          items: [
            {
              name: 'old.txt',
              path: 'old.txt',
              type: 'file',
              size: 1,
              deletedAt: now,
              mtime: now,
            },
          ],
        };
      }
      return {
        ok: true,
        entries: [
          { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now, mime: 'text/plain' },
          { name: 'pic.png', path: 'pic.png', type: 'file', size: 10, mtime: now, mime: 'image/png' },
          { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
        ],
        path: '/',
        items: [
          { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now, mime: 'text/plain' },
          { name: 'pic.png', path: 'pic.png', type: 'file', size: 10, mtime: now, mime: 'image/png' },
          { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
        ],
      };
    },
  },
  {
    match: /\/api\/v1\/system\/services/,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return HONESTY_WRITTEN_BLOCKED;
      }
      if (url.includes('/matrix') || url.includes('services')) {
        return {
          items: [
            {
              id: 'nginx',
              label: 'Nginx',
              unit: 'nginx.service',
              href: '/nginx',
              category: 'web',
              installed: true,
              active: 'inactive',
              enabled: 'disabled',
              activeLabel: 'inactive',
            },
            {
              id: 'redis',
              label: 'Redis',
              unit: 'redis-server.service',
              href: '/databases/redis',
              category: 'data',
              installed: true,
              active: 'active',
              enabled: 'enabled',
              activeLabel: 'active',
            },
            {
              id: 'postgresql',
              label: 'PostgreSQL',
              unit: 'postgresql.service',
              category: 'data',
              installed: true,
              active: 'inactive',
              enabled: 'disabled',
              activeLabel: 'inactive',
            },
          ],
          executeEnabled: false,
          isRoot: false,
          probedAt: new Date().toISOString(),
        };
      }
      return emptyList;
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/system/systemd/status'),
    body: {
      unit: 'ysk-server',
      unitPathHint: '/etc/systemd/system/ysk-server.service',
      active: 'inactive',
      enabled: 'disabled',
      executeEnabled: false,
      isRoot: false,
      canInstall: false,
      systemUnitExists: false,
      managedUnitPath: '/var/lib/ysk/systemd/ysk-server.service',
      managedUnitExists: false,
      show: {
        mainPid: null,
        activeEnterTimestamp: null,
        fragmentPath: null,
        description: 'YSK Server',
      },
    },
  },
  {
    match: (url, init) =>
      url.startsWith('/api/v1/system/systemd/') && (init?.method ?? 'GET').toUpperCase() !== 'GET',
    body: HONESTY_WRITTEN_BLOCKED,
  },
  {
    match: /\/api\/v1\/system\/systemd/,
    body: {
      unit: 'ysk-server',
      unitPathHint: '/etc/systemd/system/ysk-server.service',
      active: 'inactive',
      enabled: 'disabled',
      executeEnabled: false,
      isRoot: false,
    },
  },
  {
    match: /\/api\/v1\/dashboard\//,
    body: { ok: true, items: [], summary: {} },
  },
  {
    match: /\/api\/v1\/notifications/,
    body: { items: [], counts: { critical: 0, warn: 0, info: 0 } },
  },
  {
    match: /\/api\/v1\/system\/apply-audit/,
    body: { findings: [], summary: { ok: 0, warn: 0, bad: 0, total: 0 } },
  },
  {
    match: /\/api\/v1\/system\/export/,
    body: { ok: true, generatedAt: null, items: [] },
  },
  {
    match: /\/api\/v1\/system\/managed-nginx/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/system\/exports/,
    body: emptyList,
  },
  {
    match: (url) => url.startsWith('/api/v1/security/totp') || url.includes('/totp'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
          enabled: false,
          enrolled: true,
        };
      }
      return { enabled: false, enrolled: false, totpEnabled: false };
    },
  },
  {
    match: (url) => url.includes('/api/v1/security/api-keys') || url.includes('/api-keys'),
    body: {
      items: [
        {
          id: 'k1',
          name: 'ci',
          prefix: 'ysk_ci',
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
      ],
    },
  },
  {
    match: (url) => url.includes('/api/v1/security/sessions') || url.includes('/sessions'),
    body: {
      items: [
        {
          id: 'sess-1',
          createdAt: new Date().toISOString(),
          ip: '203.0.113.50',
          userAgent: 'vitest',
          current: true,
        },
      ],
    },
  },
  {
    match: (url) =>
      url.includes('/api/v1/security/approvals') || url.includes('/approvals'),
    body: {
      items: [
        {
          id: 'ap1',
          tool: 'sys.shell',
          status: 'pending',
          requestedAt: new Date().toISOString(),
          reason: 'debug',
        },
      ],
    },
  },
  {
    match: (url) => url.includes('/api/v1/security/tools') || url.includes('/tools'),
    body: {
      items: [
        {
          id: 'sys.info',
          name: 'sys.info',
          allowed: true,
          requiresApproval: false,
        },
        {
          id: 'sys.shell',
          name: 'sys.shell',
          allowed: false,
          requiresApproval: true,
        },
      ],
    },
  },
  {
    match: /\/api\/v1\/security/,
    body: {
      ok: true,
      totpEnabled: false,
      enrolled: false,
      enabled: false,
      requireAdminTotp: false,
      requireAdminTotpStrict: false,
      webauthnCredentials: [],
      sessions: [
        {
          id: 'sess-1',
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          userAgent: 'vitest',
          ip: '127.0.0.1',
        },
      ],
      ssh: { keys: [], config: {} },
      tools: [],
      approvals: [],
      apiKeys: [],
      items: [],
    },
  },
  {
    match: /\/api\/v1\/auth\/me/,
    body: {
      user: {
        id: 'u1',
        username: 'admin',
        roles: ['admin'],
        locale: 'en',
        capabilities: [],
      },
      capabilities: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/auth/totp'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ok: true,
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
          enabled: true,
          enrolled: true,
          recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
        };
      }
      return { enabled: false, enrolled: false, recoveryRemaining: 0 };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/auth/sessions'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ok: true, revoked: 1 };
      }
      return {
        items: [
          {
            id: 'sess-1',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            last_seen_at: new Date().toISOString(),
            user_agent: 'vitest',
            ip: '203.0.113.50',
            current: true,
          },
          {
            id: 'sess-2',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            user_agent: 'curl',
            ip: '198.51.100.1',
            current: false,
          },
        ],
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/auth/api-keys'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ok: true,
          key: {
            id: 'k2',
            name: 'new-key',
            prefix: 'ysk_nw',
            created_at: new Date().toISOString(),
          },
          token: 'ysk_nw_secret_token',
        };
      }
      return {
        items: [
          {
            id: 'k1',
            name: 'ci',
            prefix: 'ysk_ci',
            created_at: new Date().toISOString(),
          },
        ],
      };
    },
  },
  {
    match: /\/api\/v1\/auth\//,
    body: { ok: true },
  },
  {
    match: (url) => url.startsWith('/api/v1/settings/security'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ok: true,
          requireAdminTotp: true,
          requireAdminTotpStrict: false,
        };
      }
      return { requireAdminTotp: false, requireAdminTotpStrict: false };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/approvals'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { ok: true };
      return {
        items: [
          {
            id: 'ap1',
            tool: 'sys.shell',
            status: 'pending',
            requestedAt: new Date().toISOString(),
            reason: 'debug',
          },
        ],
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/tools'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ok: true, hostname: 'ysk-test', uptime: 100, notes: [] };
      }
      return {
        items: [
          {
            id: 'sys.info',
            name: 'sys.info',
            allowed: true,
            requiresApproval: false,
          },
          {
            id: 'sys.shell',
            name: 'sys.shell',
            allowed: false,
            requiresApproval: true,
          },
        ],
      };
    },
  },
  {
    match: /\/api\/v1\/migrate/,
    body: { ok: true, items: [], steps: [] },
  },
  {
    match: /\/api\/v1\/search/,
    body: {
      items: [{ kind: 'project', title: 'Demo', subtitle: 'demo.example.com', href: '/projects/p1' }],
    },
  },
  {
    match: /\/api\/v1\/rbac\//,
    body: {
      items: [
        {
          role: 'operator',
          dirty: false,
          policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
          factory: { maxLevel: 'write-high', capabilities: ['projects.read'] },
        },
      ],
    },
  },
];

function renderAt(path: string, el: ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

const demoProject = {
  id: 'p1',
  name: 'Demo App',
  domain: 'demo.example.com',
  runtime: 'node',
  runtimeVersion: '20',
  processStatus: 'stopped',
  status: 'stopped',
  gitUrl: 'https://github.com/example/demo.git',
  envVars: { NODE_ENV: 'production' },
  quotaMb: 1024,
  memoryMax: '512M',
  cpuQuotaPercent: 100,
  port: 3000,
  linuxUser: 'demo',
  homeDir: '/home/demo',
  osProvisioned: true,
  nginxConfigPath: '/etc/nginx/sites-enabled/demo',
};

const smokeCases: SmokeCase[] = [
  // Top-level pages
  { name: 'DashboardPage', path: '/', el: <DashboardPage />, heading: /dashboard/i, clickTabs: true },
  { name: 'AgentsPage', path: '/agents', el: <AgentsPage />, heading: /agent/i, clickTabs: true },
  { name: 'AiPage', path: '/ai', el: <AiPage />, heading: /ai/i, clickTabs: true },
  { name: 'EmailPage', path: '/email', el: <EmailPage />, heading: /email/i, clickTabs: true },
  {
    name: 'EmailDomainPage',
    path: '/email/dom-1',
    routePath: '/email/:id',
    el: <EmailDomainPage />,
    heading: /example\.com|email/i,
    clickTabs: true,
    extraRoutes: [
      {
        match: (url) =>
          url === '/api/v1/email/domains' || url.startsWith('/api/v1/email/domains?'),
        body: {
          items: [
            {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
            },
          ],
        },
      },
      {
        match: (url) => url.includes('/api/v1/email/domains/dom-1'),
        handler: (url) => {
          if (url.includes('/dns')) return emailBundle;
          if (url.includes('/mailboxes')) return emptyList;
          if (url.includes('/aliases')) return emptyList;
          if (url.includes('/deliverability')) {
            return {
              ok: true,
              score: 50,
              checks: [],
              recommendations: ['Add SPF'],
            };
          }
          if (url.includes('/live') || url.includes('/dnsbl') || url.includes('/warmup')) {
            return { ok: true, items: [], score: 1 };
          }
          return {
            id: 'dom-1',
            domain: 'example.com',
            rate_limit_per_hour: 200,
            antispam: true,
          };
        },
      },
    ],
  },
  { name: 'FilesPage', path: '/files', el: <FilesPage />, heading: /files/i, clickTabs: true },
  { name: 'ProjectsPage', path: '/projects', el: <ProjectsPage />, heading: /project/i, clickTabs: true },
  {
    name: 'ProjectDetailPage',
    path: '/projects/p1',
    routePath: '/projects/:id',
    el: <ProjectDetailPage />,
    heading: /demo|project/i,
    clickTabs: true,
    extraRoutes: [
      {
        match: (url) => url.includes('/api/v1/projects/p1') || url.startsWith('/api/v1/projects'),
        handler: (url) => {
          if (url.includes('/logs')) return { ok: true, lines: ['boot'], text: 'boot\n' };
          if (url.includes('/health')) return { ok: true, status: 'stopped', notes: [] };
          if (url.includes('/history') || url.includes('/deploy-history') || url.includes('history')) {
            return {
              items: [
                {
                  id: 'h1',
                  ok: true,
                  action: 'project.deploy',
                  actor: 'admin',
                  created_at: new Date().toISOString(),
                  detail: { entry: 'server.js', port: 3000 },
                },
              ],
            };
          }
          return { items: [demoProject], ...demoProject, project: demoProject };
        },
      },
    ],
  },
  { name: 'SecurityPage', path: '/security', el: <SecurityPage />, heading: /security/i, clickTabs: true },
  { name: 'SystemPage', path: '/system', el: <SystemPage />, heading: /system/i, clickTabs: true },
  { name: 'UpdatesPage', path: '/updates', el: <UpdatesPage />, heading: /update/i, clickTabs: true },
  {
    name: 'UsersPage',
    path: '/users',
    el: <UsersPage />,
    heading: /user/i,
    clickTabs: true,
    extraRoutes: [
      {
        match: (url) => url.startsWith('/api/v1/users'),
        body: {
          items: [
            {
              id: 'u1',
              username: 'admin',
              roles: ['admin'],
              packageId: 'pkg1',
              suspended: false,
              locale: 'en',
            },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
          hostUsage: { projects: 1, diskMb: 100, limitMb: 10240 },
        },
      },
      {
        match: (url) => url.startsWith('/api/v1/packages'),
        body: {
          items: [
            {
              id: 'pkg1',
              name: 'default',
              maxProjects: 10,
              maxMailboxes: 10,
              maxDatabases: 5,
              diskMb: 10240,
              bandwidthMb: 0,
              ftp: true,
              ssh: true,
              notes: '',
            },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        },
      },
      {
        match: (url) => url.includes('/api/v1/rbac'),
        body: {
          items: [
            {
              role: 'operator',
              dirty: false,
              policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
              factory: { maxLevel: 'write-high', capabilities: ['projects.read'] },
            },
            {
              role: 'viewer',
              dirty: false,
              policy: { maxLevel: 'read', capabilities: ['projects.read'] },
              factory: { maxLevel: 'read', capabilities: ['projects.read'] },
            },
            {
              role: 'admin',
              dirty: false,
              policy: { maxLevel: 'admin', capabilities: [] },
              factory: { maxLevel: 'admin', capabilities: [] },
            },
          ],
        },
      },
    ],
  },
  { name: 'LoginPage', path: '/login', el: <LoginPage />, heading: /ysk/i },

  // Feature pages
  { name: 'BackupsPage', path: '/backups', el: <BackupsPage />, heading: /backup/i, clickTabs: true },
  { name: 'CdnPage', path: '/cdn', el: <CdnPage />, heading: /cdn/i, clickTabs: true },
  { name: 'CronPage', path: '/cron', el: <CronPage />, heading: /cron/i, clickTabs: true },
  { name: 'DnsPage', path: '/dns', el: <DnsPage />, heading: /dns/i, clickTabs: true },
  { name: 'Fail2banPage', path: '/fail2ban', el: <Fail2banPage />, heading: /fail2ban/i, clickTabs: true },
  { name: 'FirewallPage', path: '/firewall', el: <FirewallPage />, heading: /firewall/i, clickTabs: true },
  { name: 'FtpPage', path: '/ftp', el: <FtpPage />, heading: /ftp/i, clickTabs: true },
  {
    name: 'FtpsServicePage',
    path: '/ftp/service',
    el: <FtpsServicePage />,
    heading: /ftp|vsftpd|service/i,
    clickTabs: true,
  },
  {
    name: 'GenericNodeRuntimePage',
    path: '/runtimes/node',
    el: <GenericNodeRuntimePage />,
    heading: /node/i,
    clickTabs: true,
  },
  {
    name: 'PythonRuntimePage',
    path: '/runtimes/python',
    el: <PythonRuntimePage />,
    heading: /python/i,
    clickTabs: true,
  },
  { name: 'GoRuntimePage', path: '/runtimes/go', el: <GoRuntimePage />, heading: /^go$/i, clickTabs: true },
  {
    name: 'RustRuntimePage',
    path: '/runtimes/rust',
    el: <RustRuntimePage />,
    heading: /rust/i,
    clickTabs: true,
  },
  {
    name: 'NodeRuntimePage (standalone)',
    path: '/runtimes/node-legacy',
    el: <NodeRuntimePage />,
    heading: /node/i,
    clickTabs: true,
  },
  { name: 'PhpRuntimePage', path: '/runtimes/php', el: <PhpRuntimePage />, heading: /php/i, clickTabs: true },
  { name: 'LogsPage', path: '/logs', el: <LogsPage />, heading: /log/i, clickTabs: true },
  {
    name: 'MariadbPage',
    path: '/databases/mariadb',
    el: <MariadbPage />,
    heading: /mariadb|mysql/i,
    clickTabs: true,
  },
  {
    name: 'MariadbServicePage',
    path: '/databases/mariadb/service',
    el: <MariadbServicePage />,
    heading: /mariadb|mysql|service/i,
    clickTabs: true,
  },
  { name: 'MetricsPage', path: '/metrics', el: <MetricsPage />, heading: /metric/i, clickTabs: true },
  {
    name: 'MigrateHostPage',
    path: '/system/migrate',
    el: <MigrateHostPage />,
    heading: /migrate/i,
    clickTabs: true,
  },
  { name: 'MysqlPage', path: '/databases/mysql', el: <MysqlPage />, heading: /mysql/i, clickTabs: true },
  {
    name: 'MysqlServicePage',
    path: '/databases/mysql/service',
    el: <MysqlServicePage />,
    heading: /mysql|service/i,
    clickTabs: true,
  },
  {
    name: 'SqlEngineMysql',
    path: '/databases/mysql-engine',
    el: <SqlEnginePage engine="mysql" />,
    heading: /mysql/i,
    clickTabs: true,
  },
  {
    name: 'SqlEngineMariadb',
    path: '/databases/mariadb-engine',
    el: <SqlEnginePage engine="mariadb" />,
    heading: /mariadb|mysql/i,
    clickTabs: true,
  },
  { name: 'NetworkPage', path: '/network', el: <NetworkPage />, heading: /network/i, clickTabs: true },
  { name: 'NginxPage', path: '/nginx', el: <NginxPage />, heading: /nginx/i, clickTabs: true },
  {
    name: 'PostgresPage',
    path: '/databases/postgres',
    el: <PostgresPage />,
    heading: /postgres/i,
    clickTabs: true,
  },
  {
    name: 'PostgresServicePage',
    path: '/databases/postgres/service',
    el: <PostgresServicePage />,
    heading: /postgres|service/i,
    clickTabs: true,
  },
  {
    name: 'ProtectionPage',
    path: '/protection',
    el: <ProtectionPage />,
    heading: /defense|protection/i,
    clickTabs: true,
  },
  {
    name: 'PublicFilesPage',
    path: '/files/public',
    el: <PublicFilesPage />,
    heading: /public/i,
    clickTabs: true,
  },
  {
    name: 'ReadinessPage',
    path: '/system/readiness',
    el: <ReadinessPage />,
    heading: /readiness/i,
    clickTabs: true,
  },
  { name: 'RedisPage', path: '/databases/redis', el: <RedisPage />, heading: /redis/i, clickTabs: true },
  {
    name: 'RedisServicePage',
    path: '/databases/redis/service',
    el: <RedisServicePage />,
    heading: /redis|service/i,
    clickTabs: true,
  },
  { name: 'ServicesPage', path: '/services', el: <ServicesPage />, heading: /service/i, clickTabs: true },
  { name: 'SslPage', path: '/ssl', el: <SslPage />, heading: /ssl|certificate/i, clickTabs: true },
  {
    name: 'SystemdUnitPage',
    path: '/systemd',
    el: <SystemdUnitPage />,
    heading: /systemd/i,
    clickTabs: true,
  },
];

describe('all pages smoke render', () => {
  beforeEach(() => {
    authStore.clear();
    authStore.setSession('test-token', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [
        'projects.read',
        'projects.write',
        'users.read',
        'users.write',
        'users.impersonate',
        'rbac.policy',
        'system.read',
        'system.write',
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it.each(smokeCases)(
    'renders $name heading',
    async ({ path, routePath, el, heading, extraRoutes, clickTabs }) => {
      installFetchMock([...(extraRoutes ?? []), ...commonRoutes()]);
      const user = userEvent.setup();
      renderAt(path, el, routePath ?? '*');
      const h1 = await waitFor(
        () => {
          const elH = screen.getByRole('heading', { level: 1 });
          expect(elH).toBeInTheDocument();
          return elH;
        },
        { timeout: 8000 },
      );
      if (heading) {
        expect(h1.textContent ?? '').toMatch(heading);
      }
      if (clickTabs) {
        await clickAllTabs(user);
      }
    },
    20_000,
  );

  it('PublicFilesPage apply surfaces honesty requiresExecute', async () => {
    const user = userEvent.setup();
    installFetchMock([
      {
        match: (url, init) =>
          url.includes('/api/v1/hosting/files/apply') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
        body: HONESTY_WRITTEN_BLOCKED,
      },
      ...commonRoutes(),
    ]);
    renderAt('/files/public', <PublicFilesPage />);
    const applyBtn = await screen.findByRole('button', { name: /apply|reload/i });
    await user.click(applyBtn);
    await waitFor(() => {
      expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });
});
