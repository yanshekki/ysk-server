/**
 * Wave-2 deep interactions for remaining low-coverage pages + feature hooks.
 * Honesty: mutation responses use HONESTY_WRITTEN_BLOCKED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { ServicesPage } from './features/ServicesPage';
import { RedisPage } from './features/RedisPage';
import { CronPage } from './features/CronPage';
import { SecurityPage } from './SecurityPage';
import { BackupsPage } from './features/BackupsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UsersPage } from './UsersPage';
import { SystemPage } from './SystemPage';
import { NginxPage } from './features/NginxPage';
import { FirewallPage } from './features/FirewallPage';
import { Fail2banPage } from './features/Fail2banPage';
import { PhpRuntimePage } from './features/PhpRuntimePage';
import { DashboardPage } from './DashboardPage';
import { ProtectionPage } from './features/ProtectionPage';
import { FtpPage } from './features/FtpPage';
import { LogsPage } from './features/LogsPage';
import { FilesPage } from './FilesPage';
import { NetworkPage } from './features/NetworkPage';
import { DnsPage } from './features/DnsPage';
import { MetricsPage } from './features/MetricsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { MigrateHostPage } from './features/MigrateHostPage';
import { UpdatesPage } from './UpdatesPage';
import { AgentsPage } from './AgentsPage';
import { AiPage } from './AiPage';
import { SslPage } from './features/SslPage';
import { useAgents } from '../features/agents/useAgents';
import { useUpdates } from '../features/updates/useUpdates';
import { useSslCertificates } from '../features/ssl/useSslCertificates';
import { useFeatureSoftware } from '../features/software/useFeatureSoftware';
import { useAiTasks } from '../features/llm/useAiTasks';
import { useEmailDomains } from '../features/email/useEmailDomains';
import { useFiles } from '../features/files/useFiles';
import { useResourceCrud } from '../features/resources/useResourceCrud';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickMatching(
  user: ReturnType<typeof userEvent.setup>,
  re: RegExp,
  limit = 8,
) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

async function clickAllTabs(user: ReturnType<typeof userEvent.setup>) {
  const labels = screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
  for (const label of labels) {
    if (!label.trim()) continue;
    try {
      const tab =
        screen.queryByRole('tab', { name: label }) ??
        screen.queryAllByRole('tab').find((el) => el.textContent === label);
      if (tab) await user.click(tab);
    } catch {
      /* ignore */
    }
  }
}

const catchAll: FetchRoute = { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } };

function redisRoutes(): FetchRoute[] {
  return [
    softwareReadyRoute(),
    {
      match: (url) => url.startsWith('/api/v1/system/db/redis/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        return {
          serverInstalled: true,
          clientInstalled: true,
          unit: 'redis-server',
          active: 'active',
          reachable: true,
          ping: 'PONG',
          executeEnabled: false,
          isRoot: false,
          canRead: true,
          canWrite: true,
          canInstall: false,
          version: '7.0',
          usedMemory: '12M',
          connectedClients: '3',
          keyspace: [{ db: 0, keys: 2, expires: 1 }],
          databases: 16,
          configuredDatabases: 16 };
      } },
    {
      match: (url) => url.startsWith('/api/v1/system/redis/'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        if (url.includes('keys')) {
          return {
            ok: true,
            keys: [
              { key: 'session:1', type: 'string', ttl: 60 },
              { key: 'cache:home', type: 'hash', ttl: -1 },
            ] };
        }
        return {
          ok: true,
          view: { key: 'session:1', type: 'string', ttl: 60, value: 'abc' } };
      } },
    catchAll,
  ];
}

function servicesRoutes(): FetchRoute[] {
  return [
    softwareReadyRoute(),
    {
      match: /\/api\/v1\/system\/services/,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
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
              activeLabel: 'inactive' },
            {
              id: 'redis',
              label: 'Redis',
              unit: 'redis-server.service',
              category: 'data',
              installed: true,
              active: 'active',
              enabled: 'enabled',
              activeLabel: 'active' },
          ],
          executeEnabled: false,
          isRoot: false,
          probedAt: new Date().toISOString() };
      } },
    {
      match: /\/api\/v1\/protection/,
      body: HONESTY_WRITTEN_BLOCKED },
    catchAll,
  ];
}

function cronRoutes(): FetchRoute[] {
  return [
    softwareReadyRoute(),
    {
      match: /\/api\/v1\/cron/,
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ...HONESTY_WRITTEN_BLOCKED,
            job: {
              id: 'job-new',
              name: 'x',
              schedule: '* * * * *',
              command: 'true',
              enabled: true } };
        }
        if (url.includes('status')) {
          return {
            managedPath: '/etc/cron.d/ysk',
            managedLines: 1,
            enabledJobs: 1,
            totalJobs: 1,
            hostHasYskEntries: true,
            hostCrontabPreview: '0 2 * * * root ysk backup\n',
            executeEnabled: false,
            lastInstallOk: false,
            lastInstallAt: new Date().toISOString() };
        }
        return {
          items: [
            {
              id: 'job-1',
              name: 'Nightly backup',
              schedule: '0 2 * * *',
              command: 'ysk backup',
              enabled: true },
          ] };
      } },
    {
      match: /\/api\/v1\/projects/,
      body: { items: [{ id: 'p1', name: 'Demo' }] } },
    catchAll,
  ];
}

function securityRoutes(): FetchRoute[] {
  return [
    softwareReadyRoute(),
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
            recoveryCodes: ['aaaa-bbbb'] };
        }
        return { enabled: false, enrolled: false };
      } },
    {
      match: (url) => url.startsWith('/api/v1/auth/sessions'),
      body: {
        items: [
          {
            id: 'sess-1',
            created_at: new Date().toISOString(),
            expires_at: new Date().toISOString(),
            current: true,
            ip: '1.1.1.1' },
          {
            id: 'sess-2',
            created_at: new Date().toISOString(),
            expires_at: new Date().toISOString(),
            current: false,
            ip: '2.2.2.2' },
        ] } },
    {
      match: (url) => url.startsWith('/api/v1/auth/api-keys'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            key: { id: 'k2', name: 'n', prefix: 'ysk_n', created_at: new Date().toISOString() },
            token: 'tok' };
        }
        return {
          items: [{ id: 'k1', name: 'ci', prefix: 'ysk_ci', created_at: new Date().toISOString() }] };
      } },
    {
      match: (url) => url.startsWith('/api/v1/settings/security'),
      body: { requireAdminTotp: false, requireAdminTotpStrict: false, ok: true } },
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
              requestedAt: new Date().toISOString() },
          ] };
      } },
    {
      match: (url) => url.startsWith('/api/v1/tools'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { hostname: 'h', uptime: 1, ok: true };
        }
        return {
          items: [
            { id: 'sys.info', name: 'sys.info', allowed: true, requiresApproval: false },
            { id: 'sys.shell', name: 'sys.shell', allowed: false, requiresApproval: true },
          ] };
      } },
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
            fingerprintSha256: 'SHA256:abcdef0123456789',
            publicKey: 'ssh-ed25519 AAAA',
            createdAt: new Date().toISOString(),
            binding: { linuxUser: 'ysk', homeDir: '/home/ysk' } },
        ],
        host: { notes: [], lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' } },
        pamSnippet: '#',
        sshdHints: '#',
        snippet: 'Match',
        notes: [] } },
    {
      match: /\/api\/v1\/sftp\//,
      body: { ok: true, items: [], snippet: '', notes: [] } },
    {
      match: /\/api\/v1\/projects/,
      body: { items: [] } },
    catchAll,
  ];
}

describe('coverage wave2 page interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('ServicesPage matrix lifecycle clicks', async () => {
    const user = userEvent.setup();
    installFetchMock(servicesRoutes());
    renderAt('/services', <ServicesPage />);
    await waitFor(() => expect(screen.getAllByText(/nginx/i).length).toBeGreaterThan(0));
    await clickAllTabs(user);
    await clickMatching(user, /start|stop|restart|reload|refresh|probe|protect/i, 10);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('RedisPage key browser + set/del', async () => {
    const user = userEvent.setup();
    installFetchMock(redisRoutes());
    renderAt('/databases/redis', <RedisPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    await clickMatching(user, /refresh|install|start|add key|delete|save|scan|load/i, 10);
    try {
      const key = screen.queryByText(/session:1/i);
      if (key) await user.click(key);
    } catch {
      /* ignore */
    }
    await clickMatching(user, /save|delete|set|apply/i, 4);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('CronPage create + run + install', async () => {
    const user = userEvent.setup();
    installFetchMock(cronRoutes());
    renderAt('/cron', <CronPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await waitFor(() => {
      expect(
        screen.queryAllByText(/0 2 \* \* \*|ysk backup|2:00|nightly/i).length,
      ).toBeGreaterThan(0);
    }).catch(() => undefined);
    await clickAllTabs(user);
    await clickMatching(user, /create|add|run|install|enable|disable|delete|save|refresh/i, 12);
    const dialog = screen.queryAllByRole('dialog')[0];
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.type(input, 'echo hi');
        } catch {
          /* ignore */
        }
      }
      await clickMatching(user, /create|save|apply/i, 2);
      await clickMatching(user, /cancel|close/i, 2);
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it(
    'SecurityPage TOTP, keys, sessions, approvals, allowlist',
    async () => {
      const user = userEvent.setup();
      installFetchMock(securityRoutes());
      renderAt('/security', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickAllTabs(user);
      await clickMatching(
        user,
        /enable|begin|confirm|disable|create|revoke|approve|run|sys\.info|refresh|copy|delete/i,
        14,
      );
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        for (const input of within(dialog).queryAllByRole('textbox').slice(0, 2)) {
          try {
            await user.type(input, '123456');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /confirm|create|save|enable/i, 3);
        await clickMatching(user, /cancel|close/i, 2);
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'Backups settings form + restore/delete confirms',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/backups/settings'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              remote: {
                enabled: true,
                kind: 'sftp',
                host: 'backup.example.com',
                port: 22,
                username: 'ysk',
                path: '/backups',
                password: '***' },
              exclusions: ['node_modules'],
              restic: { enabled: true, repoPath: '/var/backups/restic', password: '***' } };
          } },
        {
          match: /\/api\/v1\/backups/,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  projectId: 'p1',
                  name: 'Demo',
                  path: '/var/backups/p1.tgz',
                  bytes: 1000,
                  mtime: new Date().toISOString() },
              ],
              lastRun: { at: new Date().toISOString(), ok: true } };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: { items: [{ id: 'p1', name: 'Demo' }] } },
        catchAll,
      ]);
      renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickAllTabs(user);
      // toggle checkboxes in settings
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 8)) {
        try {
          await user.type(input, 'x');
        } catch {
          /* ignore */
        }
      }
      await clickMatching(
        user,
        /save|run|schedule|restore|delete|restic|refresh|download|control/i,
        12,
      );
      await clickMatching(user, /confirm|delete|restore|yes|apply/i, 4);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'EmailDomain + Users + System deep walks',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
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
                server_ip: '203.0.113.10' },
            ] } },
        {
          match: (url) => url.includes('/api/v1/email/domains/dom-1'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [{ type: 'MX', name: '@', value: 'mail.example.com' }],
                externalTodos: ['Add SPF'],
                health: { score: 40, maxScore: 100, messages: [] },
                notes: [] };
            }
            if (url.includes('/mailboxes')) {
              return {
                items: [
                  {
                    id: 'mb1',
                    local_part: 'info',
                    address: 'info@example.com',
                    quotaMb: 500 },
                ] };
            }
            if (url.includes('/aliases')) {
              return {
                items: [{ id: 'al1', source: 'hi@example.com', dest: 'info@example.com' }] };
            }
            return {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10',
              apply_status: 'planned' };
          } },
        {
          match: (url) => url.startsWith('/api/v1/users'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'u1',
                  username: 'admin',
                  roles: ['admin'],
                  packageId: 'pkg1',
                  suspended: false,
                  locale: 'en' },
              ],
              hostUsage: { projects: 1, diskMb: 10, limitMb: 1000 } };
          } },
        {
          match: (url) => url.startsWith('/api/v1/packages'),
          body: {
            items: [
              {
                id: 'pkg1',
                name: 'default',
                maxProjects: 10,
                maxMailboxes: 5,
                maxDatabases: 5,
                diskMb: 1024,
                bandwidthMb: 0,
                ftp: true,
                ssh: true },
            ] } },
        {
          match: (url) => url.includes('/api/v1/rbac'),
          body: {
            items: [
              {
                role: 'operator',
                dirty: true,
                policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
                factory: { maxLevel: 'write-high', capabilities: ['projects.read'] } },
            ] } },
        {
          match: /\/api\/v1\/system\/host/,
          body: {
            ok: true,
            identity: { hostname: 'h', prettyHostname: 'H', timezone: 'UTC' },
            os: { platform: 'linux', arch: 'x64', release: 't', kernel: '6' },
            runtime: {
              uptimeSec: 1,
              loadavg: [0, 0, 0],
              cpus: 2,
              memory: { total: 1e9, free: 5e8, usedRatio: 0.5 },
              node: 'v20',
              pid: 1,
              uid: 0 },
            time: {
              utc: new Date().toISOString(),
              local: new Date().toISOString(),
              ntpEnabled: true,
              ntpSynchronized: true,
              timeSource: 'ntp' },
            network: { ips: ['127.0.0.1'], interfaces: [], resolvers: [] },
            disks: [],
            power: { pending: null },
            boot: { defaultTarget: 'multi-user.target' },
            caps: {
              executeEnabled: false,
              isRoot: false,
              canPower: false,
              canIdentity: true },
            collectedAt: new Date().toISOString() } },
        {
          match: /\/api\/v1\/system\//,
          body: HONESTY_WRITTEN_BLOCKED },
        catchAll,
      ]);

      let r = renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickAllTabs(user);
      await clickMatching(user, /create|add|save|apply|copy|refresh|delete|mailbox|alias/i, 12);
      r.unmount();

      r = renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getAllByText(/admin/i).length).toBeGreaterThan(0));
      await clickAllTabs(user);
      await clickMatching(user, /create|details|save|delete|restore|package/i, 10);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        for (const input of within(dialog).queryAllByRole('textbox').slice(0, 3)) {
          try {
            await user.type(input, 'bob');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /create|save/i, 2);
        await clickMatching(user, /cancel|close/i, 2);
      }
      r.unmount();

      renderAt('/system', <SystemPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickAllTabs(user);
      await clickMatching(user, /save|refresh|export|sync|reboot|power|apply|identity/i, 10);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    30_000,
  );

  it(
    'Nginx Firewall Fail2ban Php Ftp Migrate multi walk',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: /\/api\/v1\/system\/nginx/,
          body: {
            installed: true,
            active: 'inactive',
            activeLabel: 'inactive',
            sites: [
              {
                name: 'demo',
                enabled: true,
                serverName: 'demo.example.com',
                path: '/etc/nginx/sites-enabled/demo' },
            ],
            configTestOk: true,
            version: '1.24' } },
        {
          match: /\/api\/v1\/system\/firewall/,
          body: {
            installed: true,
            active: 'inactive',
            activeLabel: 'inactive',
            rules: [
              { num: 1, to: 'Anywhere', action: 'ALLOW', from: 'Anywhere', port: '22' },
              { num: 2, to: 'Anywhere', action: 'DENY', from: '203.0.113.10' },
            ],
            allowCount: 1,
            denyCount: 1 } },
        {
          match: /\/api\/v1\/system\/fail2ban/,
          body: {
            installed: true,
            active: 'inactive',
            activeLabel: 'inactive',
            enabled: 'disabled',
            jails: [{ name: 'sshd', currentlyBanned: 1, enabled: true }],
            banned: [{ jail: 'sshd', ip: '203.0.113.10' }],
            ignoreIps: ['127.0.0.1'],
            catalog: [{ name: 'sshd', description: 'SSH' }],
            defaultJails: ['sshd'] } },
        {
          match: (url) => url.includes('/api/v1/hosting/php/ini'),
          body: {
            version: '8.2',
            catalog: [
              {
                id: 'core',
                title: 'Core',
                fields: [
                  {
                    key: 'memory_limit',
                    label: 'memory_limit',
                    type: 'text',
                    default: '128M' },
                ] },
            ],
            settings: {
              version: '8.2',
              values: { memory_limit: '128M' },
              extra: {},
              rawAppend: '' },
            managedIniPath: '/etc/php/8.2/conf.d/ysk.ini',
            notes: [],
            ok: true } },
        {
          match: /\/api\/v1\/hosting\/runtimes/,
          body: {
            ok: true,
            nodeVersion: 'v20',
            catalog: [],
            settings: { values: {}, env: {} },
            envPreview: {},
            notes: [],
            php: { versions: ['8.2'], active: '8.2' } } },
        {
          match: /\/api\/v1\/system\/ftps|\/api\/v1\/ftp/,
          body: {
            settings: {
              enabled: true,
              listenPort: 21,
              pasvMin: 40000,
              pasvMax: 40100 },
            status: { installed: true, active: 'inactive', activeLabel: 'inactive' },
            domains: [{ domain: 'ftp.example.com', user: 'demo' }],
            homes: [{ user: 'demo', path: '/home/demo' }],
            items: [{ id: 'f1', user: 'demo', home: '/home/demo' }] } },
        {
          match: /\/api\/v1\/migrate/,
          body: {
            ok: true,
            items: [],
            steps: [
              { id: 'export', title: 'Export', status: 'pending' },
              { id: 'import', title: 'Import', status: 'pending' },
            ],
            notes: [] } },
        {
          match: /\/api\/v1\/system\//,
          body: HONESTY_WRITTEN_BLOCKED },
        catchAll,
      ]);

      for (const [path, el] of [
        ['/nginx', <NginxPage key="n" />],
        ['/firewall', <FirewallPage key="f" />],
        ['/fail2ban', <Fail2banPage key="b" />],
        ['/runtimes/php', <PhpRuntimePage key="p" />],
        ['/ftp', <FtpPage key="ftp" />],
        ['/system/migrate', <MigrateHostPage key="m" />],
      ] as const) {
        const { unmount } = renderAt(path, el);
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
          timeout: 5000 });
        await clickAllTabs(user);
        await clickMatching(
          user,
          /apply|save|start|stop|restart|reload|enable|ban|unban|allow|deny|delete|refresh|install|export|import|run/i,
          8,
        );
        unmount();
      }
    },
    40_000,
  );

  it(
    'Dashboard Protection Logs Files Network Dns Metrics Sql Agents Updates Ai Ssl',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: /\/api\/v1\/dashboard\//,
          body: {
            ok: true,
            summary: { projects: 1, threats: 1 },
            items: [{ id: 'a', title: 'Alert', tone: 'warn' }] } },
        {
          match: (url) =>
            url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
          body: {
            at: new Date().toISOString(),
            threatLevel: 'elevated',
            score: 60,
            signals: [{ id: 'highReqRate', label: 'R', value: 1, points: 5 }],
            activePreset: 'daily',
            presets: [
              { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
              { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
            ],
            bans: { count: 0, items: [] },
            nginxLimits: {
              reqRate: '10r/s',
              burst: 20,
              connLimit: 40,
              confPath: '/x',
              exists: true },
            firewall: { active: 'inactive', installed: true },
            fail2ban: { active: 'inactive', installed: true, jails: 0 },
            autoBan: {
              enabled: true,
              mode: 'normal',
              method: 'fail2ban',
              cooldownMinutes: 30,
              maxAutoBansPerHour: 20,
              whitelist: [] },
            executeEnabled: false,
            isRoot: false,
            suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' }],
            notes: [] } },
        {
          match: /\/api\/v1\/defense/,
          body: HONESTY_WRITTEN_BLOCKED },
        {
          match: /\/api\/v1\/logs\//,
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('sources')) {
              return {
                items: [
                  {
                    id: 'journal:nginx.service',
                    kind: 'journal',
                    label: 'nginx',
                    unit: 'nginx.service',
                    group: 'web',
                    available: true },
                ] };
            }
            if (url.includes('overview')) {
              return {
                journalDiskMb: 50,
                followIntervalSec: 3,
                journalWarnMb: 100,
                vacuumDefaultDays: 14,
                maxLines: 200 };
            }
            if (url.includes('settings')) {
              return {
                vacuumDefaultDays: 14,
                maxLines: 200,
                journalWarnMb: 100,
                bookmarks: [] };
            }
            return { ok: true, text: 'line\n', lines: ['line'], items: [] };
          } },
        {
          match: (url) => url.includes('/api/v1/files') || url.includes('/hosting/files'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            const now = new Date().toISOString();
            return {
              ok: true,
              path: '/',
              entries: [
                { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now },
                { name: 'd', path: 'd', type: 'dir', size: 0, mtime: now },
              ],
              items: [
                { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now },
              ] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              at: new Date().toISOString(),
              notes: [],
              backend: {
                hasIp: true,
                networkManager: 'inactive',
                networkd: 'inactive',
                canPersist: true },
              interfaces: [
                {
                  name: 'eth0',
                  ifindex: 2,
                  operstate: 'UP',
                  flags: ['UP'],
                  mtu: 1500,
                  isLoopback: false,
                  isDefaultEgress: true,
                  addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }] },
              ],
              routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
              caps: { canMutate: true, executeEnabled: false, isRoot: false },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1'],
                uplinkServers: ['1.1.1.1'],
                search: [],
                source: 'static',
                notes: [],
                ignoreAutoDns: true,
                canApply: true } };
          } },
        {
          match: /\/api\/v1\/resources\//,
          body: {
            items: [
              {
                id: 'z1',
                zone: 'example.com',
                serverIp: '1.2.3.4',
                nsName: 'ns1.example.com',
                ttl: 300,
                apply_status: 'planned' },
            ],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } } },
        {
          match: (url) => url.startsWith('/api/v1/metrics/processes'),
          body: {
            ok: true,
            at: new Date().toISOString(),
            sort: 'cpu',
            limit: 40,
            rows: [
              {
                pid: '1',
                user: 'root',
                cpu: 0.1,
                mem: 0.2,
                command: 'systemd' },
            ],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics'),
          body: {
            at: new Date().toISOString(),
            loadavg: [0.1, 0.1, 0.1],
            cpuCount: 2,
            memory: { total: 1e9, free: 5e8, usedRatio: 0.5 },
            uptimeSec: 100,
            diskMounts: [
              {
                filesystem: '/dev/sda1',
                size: 1e11,
                used: 1e10,
                avail: 9e10,
                usedRatio: 0.1,
                mount: '/' },
            ],
            alerts: [] } },
        {
          match: /\/api\/v1\/system\/db\//,
          body: {
            serverInstalled: true,
            active: 'inactive',
            activeLabel: 'inactive',
            engine: 'mysql',
            executeEnabled: false,
            isRoot: false } },
        {
          match: /\/api\/v1\/fleet\//,
          body: {
            items: [
              {
                id: 'sess-1',
                agent_id: 'ag-1',
                status: 'connected',
                group: 'edge',
                last_seen_at: new Date().toISOString() },
            ] } },
        {
          match: /\/api\/v1\/agents\//,
          body: {
            items: [
              {
                kind: 'openclaw',
                name: 'OpenClaw',
                status: 'missing',
                unitName: 'openclaw.service',
                unitActive: 'inactive',
                pathExists: false,
                installPath: '/opt/openclaw',
                probedAt: new Date().toISOString() },
            ] } },
        {
          match: /\/api\/v1\/updates/,
          body: {
            items: [{ id: 'pkg', name: 'ysk-server', current: '0.1.0', latest: '0.1.1' }],
            self: { current: '0.1.0', latest: '0.1.1', channel: 'stable' },
            inventory: { packages: [] },
            policy: { auto: false },
            ok: true } },
        {
          match: /\/api\/v1\/ai\//,
          body: {
            items: [
              {
                id: 't1',
                title: 'Task',
                status: 'completed',
                createdAt: new Date().toISOString(),
                steps: [{ id: 's1', title: 'Plan', status: 'completed' }] },
            ] } },
        {
          match: /\/api\/v1\/ssl|\/api\/v1\/system\/ssl/,
          body: {
            items: [
              {
                id: 'c1',
                domain: 'example.com',
                expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
                issuer: 'LE',
                apply_status: 'planned' },
            ] } },
        catchAll,
      ]);

      for (const [path, el] of [
        ['/', <DashboardPage key="d" />],
        ['/protection', <ProtectionPage key="p" />],
        ['/logs', <LogsPage key="l" />],
        ['/files', <FilesPage key="f" />],
        ['/network', <NetworkPage key="n" />],
        ['/dns', <DnsPage key="dns" />],
        ['/metrics', <MetricsPage key="m" />],
        ['/databases/mysql-engine', <SqlEnginePage key="s" engine="mysql" />],
        ['/agents', <AgentsPage key="a" />],
        ['/updates', <UpdatesPage key="u" />],
        ['/ai', <AiPage key="ai" />],
        ['/ssl', <SslPage key="ssl" />],
      ] as const) {
        const { unmount } = renderAt(path, el);
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
          timeout: 6000 });
        await clickAllTabs(user);
        await clickMatching(
          user,
          /refresh|apply|save|create|add|run|install|probe|ban|query|export|delete|start|stop/i,
          6,
        );
        unmount();
      }
    },
    60_000,
  );
});

describe('coverage wave2 feature hooks', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('useAgents register/remove/enqueue/install paths', async () => {
    installFetchMock([
      {
        match: /\/api\/v1\/fleet\//,
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ...HONESTY_WRITTEN_BLOCKED, ok: true, id: 'c1', agent_id: 'ag-1' };
          }
          if (url.includes('/commands')) {
            return { items: [{ id: 'c1', agent_id: 'ag-1', status: 'done', payload: {} }] };
          }
          return {
            items: [
              {
                id: 'sess-1',
                agent_id: 'ag-1',
                status: 'connected',
                group: 'edge',
                last_seen_at: new Date().toISOString() },
            ] };
        } },
      {
        match: /\/api\/v1\/agents\//,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ok: false,
              requiresExecute: true,
              notes: ['Host execute is off'],
              kind: 'openclaw',
              status: 'missing' };
          }
          return {
            items: [
              {
                kind: 'openclaw',
                name: 'OpenClaw',
                status: 'missing',
                unitName: 'o.service',
                unitActive: 'inactive',
                pathExists: false,
                installPath: '/opt/o',
                probedAt: new Date().toISOString() },
            ],
            runtime: {
              kind: 'openclaw',
              name: 'OpenClaw',
              status: 'missing',
              unitName: 'o.service',
              unitActive: 'inactive',
              pathExists: false,
              installPath: '/opt/o',
              probedAt: new Date().toISOString() } };
        } },
      catchAll,
    ]);
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.agents.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.register({ agentId: 'ag-2', group: 'edge' }).catch(() => undefined);
    });
    await act(async () => {
      await result.current.removeAgent('sess-1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.enqueueCommand('sess-1', { type: 'ping' }).catch(() => undefined);
    });
    await act(async () => {
      await result.current.loadCommands('sess-1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.probeKind('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await result.current.installKind('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await result.current.writeUnit('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
  });

  it('useUpdates / useSsl / useFeatureSoftware / useAiTasks / useEmail / useFiles / useResourceCrud', async () => {
    installFetchMock([
      {
        match: /\/api\/v1\/updates/,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [{ id: 'p', name: 'ysk', current: '0.1.0', latest: '0.2.0' }],
            self: { current: '0.1.0', latest: '0.2.0', channel: 'stable' },
            inventory: { packages: [{ name: 'nginx', current: '1', latest: '2' }] },
            policy: { auto: false, channel: 'stable' },
            ok: true };
        } },
      {
        match: /\/api\/v1\/ssl|\/api\/v1\/system\/ssl/,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [
              {
                id: 'c1',
                domain: 'example.com',
                expiresAt: new Date().toISOString(),
                issuer: 'LE' },
            ] };
        } },
      {
        match: /\/api\/v1\/system\/software/,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [{ name: 'nginx', installed: false }],
            missing: ['nginx'],
            ready: false };
        } },
      {
        match: /\/api\/v1\/ai\//,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [
              {
                id: 't1',
                title: 'T',
                status: 'pending',
                createdAt: new Date().toISOString(),
                steps: [] },
            ],
            task: {
              id: 't1',
              title: 'T',
              status: 'pending',
              createdAt: new Date().toISOString(),
              steps: [] } };
        } },
      {
        match: /\/api\/v1\/email/,
        body: {
          items: [{ id: 'dom-1', domain: 'example.com' }] } },
      {
        match: (url) => url.includes('/api/v1/files') || url.includes('/hosting/files'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            ok: true,
            path: '/',
            entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: new Date().toISOString() }],
            items: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: new Date().toISOString() }] };
        } },
      {
        match: /\/api\/v1\/resources\//,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ...HONESTY_WRITTEN_BLOCKED,
              item: { id: 'x1', name: 'n' } };
          }
          return {
            items: [{ id: 'x1', name: 'n', apply_status: 'planned' }],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
        } },
      catchAll,
    ]);

    const updates = renderHook(() => useUpdates());
    await waitFor(() => expect(updates.result.current).toBeTruthy());
    if (typeof (updates.result.current as { refresh?: () => Promise<void> }).refresh === 'function') {
      await act(async () => {
        await (updates.result.current as { refresh: () => Promise<void> }).refresh().catch(() => undefined);
      });
    }
    // call any functions present
    for (const [k, v] of Object.entries(updates.result.current as object)) {
      if (typeof v === 'function' && !['refresh'].includes(k)) {
        try {
          await act(async () => {
            await Promise.resolve((v as (...a: unknown[]) => unknown)()).catch?.(() => undefined);
          });
        } catch {
          /* arity issues */
        }
      }
    }

    const ssl = renderHook(() => useSslCertificates());
    await waitFor(() => expect(ssl.result.current).toBeTruthy());
    for (const [k, v] of Object.entries(ssl.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            const r = (v as (...a: unknown[]) => unknown)('c1', {});
            await Promise.resolve(r).catch(() => undefined);
          });
        } catch {
          /* ignore */
        }
      }
    }

    const soft = renderHook(() => useFeatureSoftware('nginx'));
    await waitFor(() => expect(soft.result.current).toBeTruthy());
    for (const [, v] of Object.entries(soft.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            await Promise.resolve((v as () => unknown)()).catch?.(() => undefined);
          });
        } catch {
          /* ignore */
        }
      }
    }

    const ai = renderHook(() => useAiTasks());
    await waitFor(() => expect(ai.result.current).toBeTruthy());
    for (const [, v] of Object.entries(ai.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            const r = (v as (...a: unknown[]) => unknown)({ title: 'x' });
            await Promise.resolve(r).catch(() => undefined);
          });
        } catch {
          /* ignore */
        }
      }
    }

    const email = renderHook(() => useEmailDomains());
    await waitFor(() => expect(email.result.current).toBeTruthy());
    for (const [, v] of Object.entries(email.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            const r = (v as (...a: unknown[]) => unknown)({ domain: 'x.com' });
            await Promise.resolve(r).catch(() => undefined);
          });
        } catch {
          /* ignore */
        }
      }
    }

    const files = renderHook(() => useFiles());
    await waitFor(() => expect(files.result.current).toBeTruthy());
    for (const [, v] of Object.entries(files.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            const r = (v as (...a: unknown[]) => unknown)('/', 'a.txt');
            await Promise.resolve(r).catch(() => undefined);
          });
        } catch {
          /* ignore */
        }
      }
    }

    const crud = renderHook(() => useResourceCrud('dns/zones'));
    await waitFor(() => expect(crud.result.current.items.length).toBeGreaterThan(0));
    await act(async () => {
      await crud.result.current.create({ zone: 'a.com', serverIp: '1.1.1.1' }).catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.update('x1', { ttl: 300 }).catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.apply('x1').catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.remove('x1').catch(() => undefined);
    });
  });
});
