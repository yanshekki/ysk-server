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

type SmokeCase = {
  name: string;
  path: string;
  routePath?: string;
  el: ReactElement;
  /** Optional heading text match (string or regex). Defaults to any h1. */
  heading?: string | RegExp;
  extraRoutes?: FetchRoute[];
};

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
  interfaces: [],
  routes: [],
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
  installed: true,
  executeEnabled: false,
  isRoot: false,
  canLifecycle: true,
  metrics: {},
  categories: [],
  live: {},
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
    match: /\/api\/v1\/hosting\/runtimes/,
    body: {
      ok: true,
      nodeVersion: 'v20.0.0',
      nodePath: '/usr/bin/node',
      probe: {},
      supported: {},
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
    body: {
      ok: true,
      items: [],
      sources: [],
      journalDiskMb: 0,
      followIntervalSec: 3,
      journalWarnMb: 1024,
      vacuumDefaultDays: 14,
      maxLines: 300,
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
    match: /\/api\/v1\/defense/,
    body: {
      ok: true,
      items: [],
      enabled: false,
      modes: [],
      whitelist: [],
      presets: [],
      automation: { enabled: false },
      mechanisms: [],
      timeline: [],
      bans: { count: 0, items: [] },
      suspects: { items: [], notes: [] },
      mode: 'observe',
      level: 'normal',
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
    body: { jobs: [] },
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
    body: emptyList,
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
    body: { ok: true, entries: [], path: '/', items: [] },
  },
  {
    match: (url, init) =>
      url.includes('/api/v1/hosting/files') &&
      !url.includes('/apply') &&
      (init?.method ?? 'GET').toUpperCase() === 'GET',
    body: { ok: true, entries: [], path: '/', items: [] },
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
    match: /\/api\/v1\/auth\//,
    body: { ok: true },
  },
  {
    match: /\/api\/v1\/security/,
    body: {
      ok: true,
      totpEnabled: false,
      webauthnCredentials: [],
      sessions: [],
      ssh: { keys: [], config: {} },
    },
  },
  {
    match: /\/api\/v1\/migrate/,
    body: { ok: true, items: [], steps: [] },
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

const smokeCases: SmokeCase[] = [
  // Top-level pages
  { name: 'DashboardPage', path: '/', el: <DashboardPage />, heading: /dashboard/i },
  { name: 'AgentsPage', path: '/agents', el: <AgentsPage />, heading: /agent/i },
  { name: 'AiPage', path: '/ai', el: <AiPage />, heading: /ai/i },
  { name: 'EmailPage', path: '/email', el: <EmailPage />, heading: /email/i },
  {
    name: 'EmailDomainPage',
    path: '/email/dom-1',
    routePath: '/email/:id',
    el: <EmailDomainPage />,
    heading: /example\.com|email/i,
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
        match: (url) => url.includes('/api/v1/email/domains/dom-1/dns'),
        body: emailBundle,
      },
      {
        match: (url) => url.includes('/api/v1/email/domains/dom-1/mailboxes'),
        body: emptyList,
      },
      {
        match: (url) => url.includes('/api/v1/email/domains/dom-1/aliases'),
        body: emptyList,
      },
    ],
  },
  { name: 'FilesPage', path: '/files', el: <FilesPage />, heading: /files/i },
  { name: 'ProjectsPage', path: '/projects', el: <ProjectsPage />, heading: /project/i },
  {
    name: 'ProjectDetailPage',
    path: '/projects/p1',
    routePath: '/projects/:id',
    el: <ProjectDetailPage />,
    heading: /demo|project/i,
    extraRoutes: [
      {
        match: /\/api\/v1\/projects/,
        body: {
          items: [
            {
              id: 'p1',
              name: 'Demo App',
              domain: 'demo.example.com',
              runtime: 'node',
              runtimeVersion: '20',
              processStatus: 'stopped',
              status: 'stopped',
              gitUrl: '',
              envVars: {},
              quotaMb: 1024,
              memoryMax: '512M',
              cpuQuotaPercent: 100,
            },
          ],
        },
      },
    ],
  },
  { name: 'SecurityPage', path: '/security', el: <SecurityPage />, heading: /security/i },
  { name: 'SystemPage', path: '/system', el: <SystemPage />, heading: /system/i },
  { name: 'UpdatesPage', path: '/updates', el: <UpdatesPage />, heading: /update/i },
  { name: 'UsersPage', path: '/users', el: <UsersPage />, heading: /user/i },
  { name: 'LoginPage', path: '/login', el: <LoginPage />, heading: /ysk/i },

  // Feature pages
  { name: 'BackupsPage', path: '/backups', el: <BackupsPage />, heading: /backup/i },
  { name: 'CdnPage', path: '/cdn', el: <CdnPage />, heading: /cdn/i },
  { name: 'CronPage', path: '/cron', el: <CronPage />, heading: /cron/i },
  { name: 'DnsPage', path: '/dns', el: <DnsPage />, heading: /dns/i },
  { name: 'Fail2banPage', path: '/fail2ban', el: <Fail2banPage />, heading: /fail2ban/i },
  { name: 'FirewallPage', path: '/firewall', el: <FirewallPage />, heading: /firewall/i },
  { name: 'FtpPage', path: '/ftp', el: <FtpPage />, heading: /ftp/i },
  {
    name: 'FtpsServicePage',
    path: '/ftp/service',
    el: <FtpsServicePage />,
    heading: /ftp|vsftpd|service/i,
  },
  {
    name: 'GenericNodeRuntimePage',
    path: '/runtimes/node',
    el: <GenericNodeRuntimePage />,
    heading: /node/i,
  },
  {
    name: 'PythonRuntimePage',
    path: '/runtimes/python',
    el: <PythonRuntimePage />,
    heading: /python/i,
  },
  { name: 'GoRuntimePage', path: '/runtimes/go', el: <GoRuntimePage />, heading: /^go$/i },
  {
    name: 'RustRuntimePage',
    path: '/runtimes/rust',
    el: <RustRuntimePage />,
    heading: /rust/i,
  },
  {
    name: 'NodeRuntimePage (standalone)',
    path: '/runtimes/node-legacy',
    el: <NodeRuntimePage />,
    heading: /node/i,
  },
  { name: 'PhpRuntimePage', path: '/runtimes/php', el: <PhpRuntimePage />, heading: /php/i },
  { name: 'LogsPage', path: '/logs', el: <LogsPage />, heading: /log/i },
  { name: 'MariadbPage', path: '/databases/mariadb', el: <MariadbPage />, heading: /mariadb|mysql/i },
  {
    name: 'MariadbServicePage',
    path: '/databases/mariadb/service',
    el: <MariadbServicePage />,
    heading: /mariadb|mysql|service/i,
  },
  { name: 'MetricsPage', path: '/metrics', el: <MetricsPage />, heading: /metric/i },
  {
    name: 'MigrateHostPage',
    path: '/system/migrate',
    el: <MigrateHostPage />,
    heading: /migrate/i,
  },
  { name: 'MysqlPage', path: '/databases/mysql', el: <MysqlPage />, heading: /mysql/i },
  {
    name: 'MysqlServicePage',
    path: '/databases/mysql/service',
    el: <MysqlServicePage />,
    heading: /mysql|service/i,
  },
  { name: 'NetworkPage', path: '/network', el: <NetworkPage />, heading: /network/i },
  { name: 'NginxPage', path: '/nginx', el: <NginxPage />, heading: /nginx/i },
  {
    name: 'PostgresPage',
    path: '/databases/postgres',
    el: <PostgresPage />,
    heading: /postgres/i,
  },
  {
    name: 'PostgresServicePage',
    path: '/databases/postgres/service',
    el: <PostgresServicePage />,
    heading: /postgres|service/i,
  },
  {
    name: 'ProtectionPage',
    path: '/protection',
    el: <ProtectionPage />,
    heading: /defense|protection/i,
  },
  {
    name: 'PublicFilesPage',
    path: '/files/public',
    el: <PublicFilesPage />,
    heading: /public/i,
  },
  {
    name: 'ReadinessPage',
    path: '/system/readiness',
    el: <ReadinessPage />,
    heading: /readiness/i,
  },
  { name: 'RedisPage', path: '/databases/redis', el: <RedisPage />, heading: /redis/i },
  {
    name: 'RedisServicePage',
    path: '/databases/redis/service',
    el: <RedisServicePage />,
    heading: /redis|service/i,
  },
  { name: 'ServicesPage', path: '/services', el: <ServicesPage />, heading: /service/i },
  { name: 'SslPage', path: '/ssl', el: <SslPage />, heading: /ssl|certificate/i },
  {
    name: 'SystemdUnitPage',
    path: '/systemd',
    el: <SystemdUnitPage />,
    heading: /systemd/i,
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
    async ({ path, routePath, el, heading, extraRoutes }) => {
      installFetchMock([... (extraRoutes ?? []), ...commonRoutes()]);
      renderAt(path, el, routePath ?? '*');
      const h1 = await waitFor(
        () => {
          const elH = screen.getByRole('heading', { level: 1 });
          expect(elH).toBeInTheDocument();
          return elH;
        },
        { timeout: 5000 },
      );
      if (heading) {
        expect(h1.textContent ?? '').toMatch(heading);
      }
    },
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
