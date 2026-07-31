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
  notes: [],
  backend: { hasIp: true, hasNmcli: false, hasResolvectl: false },
  interfaces: [
    {
      name: 'eth0',
      up: true,
      operstate: 'UP',
      flags: ['UP', 'BROADCAST'],
      mac: 'aa:bb:cc:dd:ee:ff',
      addrs: ['10.0.0.5/24'],
      addresses: [{ address: '10.0.0.5', prefix: 24, family: 'inet' }],
      rxBytes: 1000,
      txBytes: 2000,
    },
  ],
  routes: [
    {
      destination: 'default',
      gateway: '10.0.0.1',
      device: 'eth0',
      dest: 'default',
      iface: 'eth0',
    },
  ],
  caps: { canMutate: false, executeEnabled: false, isRoot: false },
  dns: {
    nameservers: ['1.1.1.1'],
    uplinkServers: [],
    search: [],
    ignoreAutoDns: true,
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
    match: /\/api\/v1\/system\/db\/\w+\/status/,
    body: {
      serverInstalled: true,
      active: 'inactive',
      activeLabel: 'inactive',
      engine: 'mysql',
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
    body: {
      items: [],
      managedPath: '/etc/cron.d/ysk',
      managedLines: 0,
      enabledJobs: 0,
      totalJobs: 0,
      hostHasYskEntries: false,
      hostCrontabPreview: '',
      executeEnabled: false,
      lastInstallOk: null,
      lastInstallAt: null,
    },
  },
  {
    match: /\/api\/v1\/logs\//,
    handler: (url) => {
      if (url.includes('/projects')) {
        return {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              files: [{ name: 'app.log', bytes: 100, previewable: true }],
              related: [],
            },
          ],
        };
      }
      if (url.includes('/sources')) {
        return {
          items: [
            {
              id: 'j1',
              kind: 'journal',
              label: 'nginx',
              unit: 'nginx.service',
              group: 'journal',
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
      return {
        ok: true,
        items: [],
        sources: [],
        units: [],
        quickUnits: [],
        journalDiskMb: 0,
        followIntervalSec: 3,
        journalWarnMb: 1024,
        vacuumDefaultDays: 14,
        maxLines: 300,
        text: '',
        lines: [],
        settings: {},
      };
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics/projects'),
    body: {
      ok: true,
      items: [],
      totalMb: 0,
      usedMb: 0,
      at: new Date().toISOString(),
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics/processes'),
    body: { ok: true, items: [], notes: [], processes: [] },
  },
  {
    match: (url) => url.startsWith('/api/v1/metrics'),
    body: {
      ok: true,
      cpu: { percent: 1 },
      memory: { usedMb: 100, totalMb: 1024, percent: 10 },
      disk: { usedGb: 1, totalGb: 50, percent: 2 },
      load: [0.1, 0.1, 0.1],
      alerts: [],
      processes: [],
      disks: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
    body: geoipStatus,
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/geoip/'),
    body: {
      ok: true,
      ...HONESTY_WRITTEN_BLOCKED,
      lookup: { country: 'US', city: 'NYC' },
      access: { blocked: false, matched: [] },
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
    body: emptyList,
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
        total: 0,
        byApplyStatus: {},
        rows: [],
      },
      cache: [],
      overallHitRatePct: 0,
      notes: [],
    },
  },
  {
    match: /\/api\/v1\/cdn/,
    body: emptyList,
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
    match: /\/api\/v1\/backups/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/users/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/packages/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/resources\//,
    body: emptyList,
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
    body: emptyList,
  },
  {
    match: /\/api\/v1\/agents\//,
    body: emptyList,
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
        entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now }],
        path: '/',
        items: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now }],
      };
    },
  },
  {
    match: /\/api\/v1\/system\/services/,
    body: emptyList,
  },
  {
    match: /\/api\/v1\/system\/systemd/,
    body: emptyList,
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
    match: /\/api\/v1\/security/,
    body: {
      ok: true,
      totpEnabled: false,
      enrolled: false,
      enabled: false,
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
    match: /\/api\/v1\/auth\//,
    body: { ok: true },
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
