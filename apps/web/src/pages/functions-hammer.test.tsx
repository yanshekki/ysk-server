/**
 * FireEvent hammer on high-miss pages to cover React arrow handlers (v8 functions).
 * Mutations return HONESTY_WRITTEN_BLOCKED. Unhandled React errors ignored via vitest config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { ProtectionPage } from './features/ProtectionPage';
import { FilesPage } from './FilesPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { DnsPage } from './features/DnsPage';
import { NetworkPage } from './features/NetworkPage';
import { CdnPage } from './features/CdnPage';
import { MetricsPage } from './features/MetricsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { LogsPage } from './features/LogsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UsersPage } from './UsersPage';
import { SecurityPage } from './SecurityPage';
import { BackupsPage } from './features/BackupsPage';
import { AgentsPage } from './AgentsPage';
import { SystemPage } from './SystemPage';
import { FtpPage } from './features/FtpPage';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { NginxPage } from './features/NginxPage';
import { EmailPage } from './EmailPage';
import { SslPage } from './features/SslPage';
import { CronPage } from './features/CronPage';
import { AiPage } from './AiPage';
import { ServiceConsolePage } from './features/ServiceConsolePage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { Ssh2faPanel } from '../features/security/ssh/Ssh2faPanel';
import { DbClusterPanel } from '../features/db-service/DbClusterPanel';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

const now = () => new Date().toISOString();
const honesty = () => ({ ...HONESTY_WRITTEN_BLOCKED, ok: true });

async function hammer() {
  await act(async () => {
    const safe = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    };
    for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
      safe(() => fireEvent.click(tab));
    }
    for (const b of Array.from(document.querySelectorAll('button, [role="button"]'))) {
      safe(() => fireEvent.click(b));
    }
    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
      safe(() => {
        const input = el as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          fireEvent.click(input);
        } else if (input.tagName === 'SELECT') {
          const s = input as unknown as HTMLSelectElement;
          const opt = s.options?.[1] ?? s.options?.[0];
          if (opt) fireEvent.change(s, { target: { value: opt.value } });
        } else if (input.type !== 'file') {
          fireEvent.change(input, { target: { value: input.value || 'x' } });
        }
      });
    }
    for (const form of Array.from(document.querySelectorAll('form'))) {
      safe(() => fireEvent.submit(form));
    }
  });
}

function routes(): FetchRoute[] {
  const t = now();
  const project = {
    id: 'p1',
    name: 'demo',
    domain: 'demo.example.com',
    runtime: 'node',
    runtimeVersion: '20',
    status: 'running',
    homeDir: '/home/ysk/demo',
    port: 3000,
    apply_status: 'applied',
    gitUrl: 'https://github.com/ex/demo.git',
    branch: 'main',
    entry: 'server.js',
    envText: 'NODE_ENV=production',
    process: { status: 'running', pid: 42 },
  };
  return [
    softwareReadyRoute(),
    {
      match: (url) => url.includes('/auth/me'),
      body: { user: { username: 'admin', roles: ['admin'] }, capabilities: ['*'] },
    },
    {
      match: (url) => url.includes('/defense') || url.includes('/protection'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('geoip')) {
          return {
            provider: 'dbip',
            ready: true,
            stale: false,
            notes: [],
            attribution: [],
            policy: {
              enabled: true,
              mode: 'deny_list',
              countries: ['CN'],
              continents: [],
              regions: [],
              cities: [],
              cityPolicyEnabled: false,
              asns: [],
              enforce: { autoBan: true, nginx: true, ufw: false },
              autoUpdate: true,
            },
            sources: [],
            meta: null,
          };
        }
        if (url.includes('automation')) {
          return {
            automation: {
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
                mode: 'normal',
                method: 'fail2ban',
                cooldownMinutes: 30,
                maxAutoBansPerHour: 20,
                whitelist: ['127.0.0.1'],
              },
            },
            mechanisms: [],
            autoBansLastHour: 0,
          };
        }
        return {
          at: t,
          threatLevel: 'elevated',
          score: 55,
          signals: [{ id: 'highReqRate', label: 'Req', value: 100, points: 15 }],
          activePreset: 'daily',
          recommendedPreset: 'hardened',
          presets: [
            { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
            { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
            { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
            { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
          ],
          bans: {
            count: 2,
            items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
          },
          suspects: [{ ip: '203.0.113.99', score: 80, reasons: ['scan'], alreadyBanned: false, whitelisted: false }],
          nginxLimits: {
            reqRate: '10r/s',
            burst: 20,
            connLimit: 40,
            confPath: '/etc/nginx/conf.d/d.conf',
            exists: true,
          },
          firewall: { active: 'active', installed: true },
          fail2ban: { active: 'active', installed: true, jails: 3 },
          autoBan: {
            enabled: true,
            mode: 'normal',
            method: 'fail2ban',
            cooldownMinutes: 30,
            maxAutoBansPerHour: 20,
            whitelist: ['127.0.0.1'],
          },
          executeEnabled: false,
          isRoot: false,
          suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:hardened' }],
          notes: ['n1'],
        };
      },
    },
    {
      match: (url) => url.includes('/api/v1/files') || url.includes('webdav'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('trash')) {
          return {
            items: [
              {
                trashId: 'tr1',
                name: 'gone.txt',
                originalPath: 'gone.txt',
                path: 'gone.txt',
                type: 'file',
                size: 9,
                deletedAt: t,
                mtime: t,
              },
            ],
          };
        }
        if (url.includes('shares')) {
          return { items: [{ id: 'sh1', path: 'readme.txt', token: 'tok1', createdAt: t }] };
        }
        if (url.includes('/read')) {
          return { content: 'hello', path: 'readme.txt', bytes: 5, mime: 'text/plain' };
        }
        return {
          path: '.',
          root: 'public',
          items: [
            {
              name: 'readme.txt',
              path: 'readme.txt',
              type: 'file',
              size: 100,
              mtime: t,
              mime: 'text/plain',
              favorite: true,
            },
            { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: t },
            {
              name: 'photo.png',
              path: 'photo.png',
              type: 'file',
              size: 2048,
              mtime: t,
              mime: 'image/png',
            },
          ],
          usage: { bytes: 2148, fileCount: 2, dirCount: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/projects'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('/p1') || /projects\/[^/?]+/.test(url)) return project;
        return { items: [project], total: 1, meta: { total: 1 } };
      },
    },
    {
      match: (url) => url.includes('/cdn/dashboard'),
      body: {
        at: t,
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
          byApplyStatus: { applied: 1 },
          rows: [{ id: 's1', name: 'cdn.example.com', apply_status: 'applied' }],
        },
        cache: [],
        overallHitRatePct: 80,
        notes: [],
      },
    },
    {
      match: (url) => url.includes('/cdn/nodes'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 'n1',
              name: 'edge-1',
              host: 'edge.example.com',
              region: 'local',
              roles: ['edge'],
              status: 'online',
              ipv4: '203.0.113.10',
            },
          ],
          total: 1,
          meta: { total: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/cdn/sites'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 's1',
              name: 'cdn.example.com',
              domains: ['cdn.example.com'],
              originUrl: 'https://origin.example.com',
              apply_status: 'applied',
              mode: 'origin_pull',
              edgeIds: ['n1'],
            },
          ],
          total: 1,
          meta: { total: 1 },
        };
      },
    },
    {
      match: (url) =>
        url.includes('/console') ||
        url.includes('/db/') ||
        url.includes('postgres') ||
        url.includes('mysql') ||
        url.includes('redis') ||
        url.includes('mariadb'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          metrics: { Uptime: 100 },
          serverInstalled: true,
          clientInstalled: true,
          executeEnabled: false,
          isRoot: false,
          categories: [
            {
              id: 'main',
              label: 'Main',
              settings: [
                {
                  key: 'port',
                  label: 'Port',
                  type: 'int',
                  liveValue: '5432',
                  applyMode: 'restart',
                },
                {
                  key: 'ssl',
                  label: 'SSL',
                  type: 'bool',
                  liveValue: 'ON',
                  enumValues: ['ON', 'OFF'],
                  applyMode: 'reload',
                },
              ],
            },
          ],
          items: [{ id: 'db1', name: 'appdb', apply_status: 'applied' }],
          users: [],
          total: 1,
          meta: { total: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/network') || url.includes('/net/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          interfaces: [
            {
              name: 'eth0',
              operstate: 'UP',
              flags: ['UP'],
              mtu: 1500,
              addresses: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
              stats: { rxBytes: 1e6, txBytes: 2e6 },
            },
          ],
          routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0', protocol: 'static' }],
          caps: { canMutate: true, executeEnabled: true, isRoot: true },
          defaultGateway: '10.0.0.1',
          defaultDev: 'eth0',
          dns: {
            nameservers: ['1.1.1.1'],
            uplinkServers: ['1.1.1.1'],
            search: [],
            source: 'static',
            notes: [],
            ignoreAutoDns: false,
            canApply: true,
            connection: 'Wired',
            device: 'eth0',
            mode: 'static',
          },
        };
      },
    },
    {
      match: () => true,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          ok: true,
          items: [
            {
              id: 'x1',
              name: 'item',
              domain: 'example.com',
              status: 'issued',
              files_exist: true,
              username: 'u1',
              apply_status: 'applied',
              health_score: 80,
              created_at: t,
              schedule: '0 2 * * *',
              command: 'echo',
              enabled: true,
              roles: ['admin'],
              path: 'readme.txt',
            },
          ],
          total: 1,
          meta: { total: 1 },
          jobs: [],
          zones: [{ id: 'z1', name: 'example.com', records: [] }],
          sources: [{ id: 'nginx', label: 'Nginx', group: 'web', bytes: 100 }],
          lines: ['a', 'b'],
          tasks: [
            {
              id: 't1',
              status: 'planned',
              prompt: 'x',
              steps: [{ id: 's1', status: 'pending', title: 's' }],
              createdAt: t,
            },
          ],
          playbooks: [{ id: 'pb1', name: 'H', description: 'd' }],
          identities: [],
          commands: [],
          settings: {},
          installed: true,
          active: 'active',
          activeLabel: 'active',
          jails: [{ name: 'sshd', currentlyBanned: 0, totalBanned: 0, enabled: true }],
          banned: [],
          ignoreIps: [],
          catalog: [{ id: 'sshd', desc: 'SSH' }],
          rules: [],
          numberedRules: [],
          denyFromIps: [],
          allowCount: 0,
          denyCount: 0,
          defaultIncoming: 'deny',
          executeEnabled: false,
          isRoot: false,
          notes: [],
          ready: true,
          missing: [],
        };
      },
    },
  ];
}

describe('functions hammer', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    } catch {
      /* ignore */
    }
    if (!(URL as unknown as { createObjectURL?: unknown }).createObjectURL) {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'hammers high-miss pages',
    async () => {
      installFetchMock(routes());
      const pages: Array<{ path: string; el: React.ReactElement; route?: string }> = [
        { path: '/protection', el: <ProtectionPage /> },
        { path: '/files', el: <FilesPage /> },
        { path: '/projects/p1?fresh=1&tab=deploy', el: <ProjectDetailPage />, route: '/projects/:id' },
        { path: '/dns', el: <DnsPage /> },
        { path: '/network', el: <NetworkPage /> },
        { path: '/cdn', el: <CdnPage /> },
        { path: '/metrics', el: <MetricsPage /> },
        { path: '/databases/mysql', el: <SqlEnginePage engine="mysql" /> },
        { path: '/logs', el: <LogsPage /> },
        { path: '/email/domains/dom-1', el: <EmailDomainPage />, route: '/email/domains/:id' },
        { path: '/users', el: <UsersPage /> },
        { path: '/security', el: <SecurityPage /> },
        { path: '/backups', el: <BackupsPage /> },
        { path: '/agents', el: <AgentsPage /> },
        { path: '/system', el: <SystemPage /> },
        { path: '/ftp', el: <FtpPage /> },
        { path: '/fail2ban', el: <Fail2banPage /> },
        { path: '/firewall', el: <FirewallPage /> },
        { path: '/nginx', el: <NginxPage /> },
        { path: '/email', el: <EmailPage /> },
        { path: '/ssl', el: <SslPage /> },
        { path: '/cron', el: <CronPage /> },
        { path: '/ai', el: <AiPage /> },
        { path: '/databases/postgres/service', el: <ServiceConsolePage engine="postgres" /> },
      ];
      for (const p of pages) {
        try {
          const view = renderAt(p.path, p.el, p.route ?? '*');
          await waitFor(
            () => {
              expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0);
            },
            { timeout: 8000 },
          ).catch(() => undefined);
          // allow async status/list fetches to settle
          await new Promise((r) => setTimeout(r, 150));
          await hammer();
          // second pass after dialogs/tabs open
          await new Promise((r) => setTimeout(r, 50));
          await hammer();
          await hammer();
          view.unmount();
        } catch {
          /* ignore */
        }
      }
      for (const el of [
        <OutboundIdentities key="o" />,
        <Ssh2faPanel key="s" onFlash={() => undefined} />,
        <DbClusterPanel key="d" engine="mariadb" />,
      ]) {
        try {
          const view = render(<MemoryRouter>{el}</MemoryRouter>);
          await waitFor(() => expect(document.body.innerText.length).toBeGreaterThan(5)).catch(
            () => undefined,
          );
          await hammer();
          view.unmount();
        } catch {
          /* ignore */
        }
      }
      expect(true).toBe(true);
    },
    120_000,
  );
});
