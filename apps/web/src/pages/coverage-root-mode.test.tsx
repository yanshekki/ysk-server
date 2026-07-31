/**
 * Remount key pages with executeEnabled+isRoot so disabled action branches open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { ProtectionPage } from './features/ProtectionPage';
import { SystemPage } from './SystemPage';
import { NetworkPage } from './features/NetworkPage';
import { FirewallPage } from './features/FirewallPage';
import { Fail2banPage } from './features/Fail2banPage';
import { ServicesPage } from './features/ServicesPage';
import { SystemdUnitPage } from './features/SystemdUnitPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { RedisPage } from './features/RedisPage';
import { CronPage } from './features/CronPage';
import { NginxPage } from './features/NginxPage';
import { MetricsPage } from './features/MetricsPage';
import { BackupsPage } from './features/BackupsPage';
import { UpdatesPage } from './UpdatesPage';
import { AgentsPage } from './AgentsPage';
import { PhpRuntimePage } from './features/PhpRuntimePage';

function renderAt(path: string, el: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

function rootRoutes(): FetchRoute[] {
  const now = new Date().toISOString();
  const applied = {
    ok: true,
    apply_status: 'applied' as const,
    requiresExecute: false,
    notes: ['applied on host'],
    executeEnabled: true,
    isRoot: true,
  };
  return [
    softwareReadyRoute(),
    {
      match: (url) =>
        url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
      body: {
        at: now,
        threatLevel: 'elevated',
        score: 55,
        signals: [{ id: 'highReqRate', label: 'R', value: 1, points: 5 }],
        activePreset: 'daily',
        presets: [
          { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
          { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
          { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
        ],
        bans: { count: 1, items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }] },
        nginxLimits: {
          reqRate: '10r/s',
          burst: 20,
          connLimit: 40,
          confPath: '/x',
          exists: true,
        },
        firewall: { active: 'active', installed: true },
        fail2ban: { active: 'active', installed: true, jails: 2 },
        autoBan: {
          enabled: true,
          mode: 'normal',
          method: 'fail2ban',
          cooldownMinutes: 30,
          maxAutoBansPerHour: 20,
          whitelist: [],
        },
        executeEnabled: true,
        isRoot: true,
        suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' }],
        notes: [],
      },
    },
    {
      match: /\/api\/v1\/defense/,
      body: applied,
    },
    {
      match: /\/api\/v1\/system\/host/,
      body: {
        ok: true,
        identity: { hostname: 'h', prettyHostname: 'H', timezone: 'UTC' },
        os: { platform: 'linux', arch: 'x64', release: 't', kernel: '6' },
        runtime: {
          uptimeSec: 100,
          loadavg: [0.1, 0.1, 0.1],
          cpus: 2,
          memory: { total: 1e9, free: 5e8, usedRatio: 0.5 },
          node: 'v20',
          pid: 1,
          uid: 0,
        },
        time: {
          utc: now,
          local: now,
          ntpEnabled: true,
          ntpSynchronized: true,
          timeSource: 'ntp',
        },
        network: { ips: ['127.0.0.1'], interfaces: [], resolvers: [] },
        disks: [],
        power: { pending: null },
        boot: { defaultTarget: 'multi-user.target' },
        caps: {
          executeEnabled: true,
          isRoot: true,
          canPower: true,
          canIdentity: true,
        },
        collectedAt: now,
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/network'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return applied;
        return {
          ok: true,
          at: now,
          notes: [],
          backend: {
            hasIp: true,
            networkManager: 'active',
            networkd: 'inactive',
            canPersist: true,
          },
          interfaces: [
            {
              name: 'eth0',
              ifindex: 2,
              operstate: 'UP',
              flags: ['UP'],
              mtu: 1500,
              isLoopback: false,
              isDefaultEgress: true,
              addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
            },
          ],
          routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
          caps: { canMutate: true, executeEnabled: true, isRoot: true },
          defaultGateway: '10.0.0.1',
          defaultDev: 'eth0',
          dns: {
            nameservers: ['1.1.1.1'],
            uplinkServers: ['1.1.1.1'],
            search: [],
            source: 'static',
            notes: [],
            ignoreAutoDns: true,
            canApply: true,
          },
        };
      },
    },
    {
      match: /\/api\/v1\/system\/firewall/,
      body: {
        installed: true,
        active: 'active',
        activeLabel: 'active',
        executeEnabled: true,
        isRoot: true,
        rules: [
          { num: 1, to: 'Anywhere', action: 'ALLOW', from: 'Anywhere', port: '22' },
          { num: 2, to: 'Anywhere', action: 'DENY', from: '203.0.113.10' },
        ],
        allowCount: 1,
        denyCount: 1,
      },
    },
    {
      match: /\/api\/v1\/system\/fail2ban/,
      body: {
        installed: true,
        active: 'active',
        activeLabel: 'active',
        enabled: 'enabled',
        executeEnabled: true,
        isRoot: true,
        jails: [{ name: 'sshd', currentlyBanned: 1, enabled: true, totalBanned: 3 }],
        banned: [{ jail: 'sshd', ip: '203.0.113.10' }],
        ignoreIps: ['127.0.0.1'],
        catalog: [{ id: 'sshd', desc: 'SSH' }],
        defaultJails: ['sshd'],
      },
    },
    {
      match: /\/api\/v1\/system\/services/,
      body: {
        items: [
          {
            id: 'nginx',
            label: 'Nginx',
            unit: 'nginx.service',
            category: 'web',
            installed: true,
            active: 'active',
            enabled: 'enabled',
            activeLabel: 'active',
          },
        ],
        executeEnabled: true,
        isRoot: true,
        probedAt: now,
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/system/systemd'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return applied;
        return {
          unit: 'ysk-server',
          unitPathHint: '/etc/systemd/system/ysk-server.service',
          active: 'inactive',
          enabled: 'disabled',
          executeEnabled: true,
          isRoot: true,
          canInstall: true,
          systemUnitExists: false,
          managedUnitPath: '/var/lib/ysk/systemd/ysk-server.service',
          managedUnitExists: true,
          show: {
            mainPid: null,
            activeEnterTimestamp: null,
            fragmentPath: null,
            description: 'YSK',
          },
        };
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/system/db/redis'),
      body: {
        serverInstalled: true,
        clientInstalled: true,
        unit: 'redis-server',
        active: 'active',
        reachable: true,
        ping: 'PONG',
        executeEnabled: true,
        isRoot: true,
        canRead: true,
        canWrite: true,
        canInstall: true,
        version: '7',
        usedMemory: '10M',
        connectedClients: '1',
        keyspace: [{ db: 0, keys: 2 }],
        databases: 16,
        configuredDatabases: 16,
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/system/redis'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return applied;
        return {
          ok: true,
          keys: [{ key: 'k1', type: 'string', ttl: 60 }],
          view: { key: 'k1', type: 'string', ttl: 60, value: 'v' },
        };
      },
    },
    {
      match: /\/api\/v1\/system\/db\//,
      body: {
        serverInstalled: true,
        active: 'active',
        activeLabel: 'active',
        engine: 'mysql',
        executeEnabled: true,
        isRoot: true,
      },
    },
    {
      match: /\/api\/v1\/system\/nginx/,
      body: {
        installed: true,
        active: 'active',
        activeLabel: 'active',
        sites: [{ name: 'demo', enabled: true, serverName: 'demo.example.com' }],
        configTestOk: true,
        executeEnabled: true,
        isRoot: true,
      },
    },
    {
      match: /\/api\/v1\/cron/,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return applied;
        if (_u.includes('status')) {
          return {
            managedPath: '/etc/cron.d/ysk',
            managedLines: 1,
            enabledJobs: 1,
            totalJobs: 1,
            hostHasYskEntries: true,
            hostCrontabPreview: '0 2 * * * root true\n',
            executeEnabled: true,
            lastInstallOk: true,
            lastInstallAt: now,
          };
        }
        return {
          items: [
            {
              id: 'job-1',
              schedule: '0 2 * * *',
              command: 'true',
              enabled: true,
              user: 'root',
              last_install: { ok: true },
            },
          ],
        };
      },
    },
    {
      match: /\/api\/v1\/backups/,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return applied;
        if (_u.includes('settings')) {
          return {
            remote: {
              enabled: true,
              kind: 'sftp',
              host: 'b.example.com',
              port: 22,
              username: 'ysk',
              path: '/b',
              password: '***',
            },
            exclusions: [],
            restic: { enabled: true, repoPath: '/r', password: '***' },
          };
        }
        return {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              path: '/b/p1.tgz',
              bytes: 100,
              mtime: now,
            },
          ],
          lastRun: { at: now, ok: true },
        };
      },
    },
    {
      match: /\/api\/v1\/updates/,
      body: {
        inventory: [
          {
            packageName: 'nginx',
            currentVersion: '1.0',
            candidateVersion: '1.1',
            risk: 'low',
          },
        ],
        advice: [
          {
            packageName: 'nginx',
            currentVersion: '1.0',
            candidateVersion: '1.1',
            advice: 'upgrade',
            risk: 'low',
            cves: [],
            requiresApproval: false,
            summary: 'bump',
          },
        ],
        self: {
          ok: true,
          checked: true,
          updateAvailable: true,
          currentVersion: '0.1.0',
          latestVersion: '0.2.0',
        },
        items: [],
        ok: true,
        collectedAt: now,
      },
    },
    {
      match: /\/api\/v1\/fleet\//,
      body: {
        items: [
          {
            id: 'sess-1',
            agent_id: 'ag-1',
            status: 'connected',
            group: 'edge',
            last_seen_at: now,
          },
        ],
      },
    },
    {
      match: /\/api\/v1\/agents\//,
      body: {
        items: [
          {
            kind: 'openclaw',
            name: 'OpenClaw',
            status: 'missing',
            unitName: 'o.service',
            unitActive: 'inactive',
            pathExists: false,
            installPath: '/opt/o',
            probedAt: now,
          },
        ],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics'),
      body: {
        at: now,
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
            mount: '/',
          },
        ],
        alerts: [],
        ok: true,
        sort: 'cpu',
        limit: 40,
        rows: [{ pid: '1', user: 'root', cpu: 0.1, mem: 0.1, command: 'init' }],
        notes: [],
        items: [],
      },
    },
    {
      match: /\/api\/v1\/hosting\/php\/ini/,
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
                default: '128M',
              },
            ],
          },
        ],
        settings: {
          version: '8.2',
          values: { memory_limit: '256M' },
          extra: {},
          rawAppend: '',
        },
        managedIniPath: '/etc/php/8.2/conf.d/ysk.ini',
        notes: [],
        ok: true,
      },
    },
    {
      match: /\/api\/v1\/hosting\/runtimes/,
      body: {
        ok: true,
        catalog: [],
        settings: { values: {}, env: {} },
        envPreview: {},
        notes: [],
        php: { versions: ['8.2', '8.3'], active: '8.2' },
      },
    },
    {
      match: /\/api\/v1\/resources\//,
      body: {
        items: [
          {
            id: 'db1',
            name: 'app',
            engine: 'mysql',
            apply_status: 'planned',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        item: { id: 'db1', name: 'app' },
        ...applied,
      },
    },
    {
      match: /\/api\/v1\/system\//,
      body: applied,
    },
    { match: /.*/, body: { ...applied, items: [], ready: true, missing: [] } },
  ];
}

describe('root/execute-enabled page interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'clicks apply/start/install paths with root caps',
    async () => {
      const user = userEvent.setup();
      installFetchMock(rootRoutes());

      const pages: Array<[string, React.ReactElement]> = [
        ['/protection', <ProtectionPage key="p" />],
        ['/system', <SystemPage key="s" />],
        ['/network', <NetworkPage key="n" />],
        ['/firewall', <FirewallPage key="f" />],
        ['/fail2ban', <Fail2banPage key="b" />],
        ['/services', <ServicesPage key="svc" />],
        ['/systemd', <SystemdUnitPage key="sd" />],
        ['/databases/mysql-engine', <SqlEnginePage key="sql" engine="mysql" />],
        ['/databases/redis', <RedisPage key="r" />],
        ['/cron', <CronPage key="c" />],
        ['/nginx', <NginxPage key="ng" />],
        ['/metrics', <MetricsPage key="m" />],
        ['/backups', <BackupsPage key="bk" />],
        ['/updates', <UpdatesPage key="u" />],
        ['/agents', <AgentsPage key="a" />],
        ['/runtimes/php', <PhpRuntimePage key="php" />],
      ];

      for (const [path, el] of pages) {
        const { unmount } = renderAt(path, el);
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
          timeout: 6000,
        });
        for (const label of screen.queryAllByRole('tab').map((t) => t.textContent ?? '')) {
          if (!label.trim()) continue;
          try {
            const tab = screen.queryAllByRole('tab', { name: label })[0];
            if (tab) await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        for (const b of screen
          .queryAllByRole('button', {
            name: /apply|start|stop|restart|reload|install|enable|ban|unban|save|run|probe|backup|schedule|update|write|template/i,
          })
          .slice(0, 12)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
        for (const b of screen
          .queryAllByRole('button', { name: /confirm|yes|apply|emERGENCY/i })
          .slice(0, 3)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
        unmount();
      }
    },
    90_000,
  );
});
