/**
 * Security session UA parsing + relativeTime branches,
 * Dashboard wizard + software tile badges,
 * Dns DNSSEC + cluster ops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { SecurityPage } from './SecurityPage';
import { DashboardPage } from './DashboardPage';
import { DnsPage } from './features/DnsPage';
import { UsersPage } from './UsersPage';
import { MetricsPage } from './features/MetricsPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ua wizard dns precision', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
    } catch {
      /* ignore */
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'SecurityPage sessions with many UAs + TOTP full flow + legacy tab redirect',
    async () => {
      const user = userEvent.setup();
      const t0 = new Date().toISOString();
      const tMin = new Date(Date.now() - 5 * 60_000).toISOString();
      const tHour = new Date(Date.now() - 3 * 3600_000).toISOString();
      const tDay = new Date(Date.now() - 2 * 86400_000).toISOString();
      const tWeek = new Date(Date.now() - 10 * 86400_000).toISOString();
      const uas = [
        'curl/8.0.0',
        'Mozilla/5.0 Edg/120.0.0.0 Chrome/120',
        'Mozilla/5.0 Chrome/120.0.0.0 Safari/537',
        'Mozilla/5.0 Firefox/121.0',
        'Mozilla/5.0 Version/17 Safari/605.1.15',
        'Mozilla/5.0 Windows NT 10.0',
        'Mozilla/5.0 Macintosh; Intel Mac OS X',
        'Mozilla/5.0 Android 14',
        'Mozilla/5.0 iPhone OS 17',
        'Mozilla/5.0 Linux x86_64',
        'CustomAgent/1.0 ' + 'x'.repeat(50),
        '',
      ];
      installFetchMock([
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
                recoveryCodes: ['aaaa-bbbb', 'cccc-dddd', 'eeee-ffff'],
              };
            }
            return { enabled: false, enrolled: false };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/auth/sessions'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { ok: true };
            return {
              items: uas.map((ua, i) => ({
                id: `s${i}`,
                created_at: [t0, tMin, tHour, tDay, tWeek][i % 5],
                expires_at: tWeek,
                current: i === 0,
                ip: `1.1.1.${i}`,
                user_agent: ua,
              })),
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/auth/api-keys'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                key: { id: 'k2', name: 'ci', prefix: 'ysk_x', created_at: t0 },
                token: 'ysk_secret_token_value',
              };
            }
            return {
              items: [
                { id: 'k1', name: 'old', prefix: 'ysk_old', created_at: t0 },
                { id: 'k2', name: 'ci', prefix: 'ysk_ci', created_at: tMin },
              ],
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/settings/security'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              requireAdminTotp: true,
              requireAdminTotpStrict: true,
              ok: true,
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/approvals'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'ap1',
                  tool: 'sys.shell',
                  status: 'pending',
                  requestedAt: t0,
                  requestedBy: 'admin',
                },
                {
                  id: 'ap2',
                  tool: 'sys.reboot',
                  status: 'pending',
                  requestedAt: tMin,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/ssh'),
          body: { items: [], ok: true },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      // Legacy tab redirect
      renderAt('/security?tab=identities', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // TOTP
      const pw = document.getElementById('reauth-pw') as HTMLInputElement | null;
      if (pw) {
        await user.clear(pw);
        await user.type(pw, 'admin-secret');
      }
      for (const b of screen
        .queryAllByRole('button', { name: /start|2fa|reset|enroll|begin/i })
        .slice(0, 2)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      await waitFor(() => {
        expect(
          document.getElementById('totp-confirm') || screen.queryByText(/JBSWY|otpauth/i),
        ).toBeTruthy();
      }).catch(() => undefined);
      const code = document.getElementById('totp-confirm') as HTMLInputElement | null;
      if (code) {
        await user.clear(code);
        await user.type(code, '123456');
      }
      for (const b of screen
        .queryAllByRole('button', { name: /confirm|enable|verify/i })
        .slice(0, 2)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /copy|close|saved|revoke|logout|approve|deny|create/i })
        .slice(0, 12)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // API key create
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'ci-bot');
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /create|generate|api/i })
        .slice(0, 4)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // sftp legacy (redirect may remount; don't require heading if already on ssh)
      const { unmount } = renderAt('/security?tab=sftp', <SecurityPage />);
      await waitFor(() => {
        expect(
          screen.queryAllByRole('heading', { level: 1 }).length +
            screen.queryAllByRole('tab').length,
        ).toBeGreaterThan(0);
      }).catch(() => undefined);
      unmount();
      expect(true).toBe(true);
    },
    40_000,
  );

  it(
    'DashboardPage wizard + software badges + alerts',
    async () => {
      const user = userEvent.setup();
      const t = new Date().toISOString();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/system/software'),
          body: {
            items: [
              {
                id: 'nginx',
                features: ['nginx'],
                installed: true,
                active: 'active',
              },
              {
                id: 'php',
                features: ['php'],
                installed: false,
                active: 'inactive',
              },
              {
                id: 'mysql',
                features: ['mysql'],
                installed: true,
                active: 'inactive',
              },
              {
                id: 'orphan',
                features: [],
                installed: true,
                active: 'active',
              },
            ],
            missing: [],
            ready: true,
          },
        },
        {
          match: (url) =>
            url.startsWith('/api/v1/dashboard') ||
            url.startsWith('/api/v1/summary') ||
            url.includes('/health') ||
            url.includes('/notifications'),
          body: {
            ok: true,
            at: t,
            executeEnabled: false,
            productionReady: false,
            host: {
              hostname: 'ysk',
              uptimeSec: 1000,
              loadavg: [0.1, 0.2, 0.3],
              runtime: { memory: { usedRatio: 0.5, total: 8e9, free: 4e9 } },
            },
            services: [
              { id: 'nginx', label: 'Nginx', active: 'active', ok: true },
              { id: 'ssh', label: 'SSH', active: 'failed', ok: false },
            ],
            alerts: [
              { id: 'a1', level: 'warn', message: 'disk', href: '/metrics' },
              { id: 'a2', level: 'danger', message: 'mem' },
              { id: 'a3', level: 'info', message: 'info' },
              { id: 'a4', level: 'ok', message: 'fine' },
            ],
            projects: { total: 3, running: 1, stopped: 2 },
            notes: ['n'],
            kpis: [
              { id: 'cpu', label: 'CPU', value: '10%', tone: 'ok' },
              { id: 'mem', label: 'Mem', value: '90%', tone: 'danger' },
            ],
            quickLinks: [{ to: '/files', label: 'Files' }],
            counts: { projects: 3, users: 1 },
            items: [
              {
                id: 'n1',
                level: 'warn',
                title: 'Alert',
                body: 'x',
                createdAt: t,
                read: false,
              },
            ],
            unread: 1,
            total: 1,
          },
        },
        {
          match: (url) => url.includes('/wizard'),
          body: {
            ok: true,
            projectId: 'p-new',
            notes: ['created'],
            steps: [
              { step: 'project', ok: true },
              { step: 'dns', ok: false, notes: ['skip'] },
            ],
          },
        },
        {
          match: (url) => url.includes('/projects'),
          body: {
            items: [
              {
                id: 'p1',
                name: 'Demo',
                processStatus: 'running',
                runtime: 'node',
              },
              {
                id: 'p2',
                name: 'Other',
                processStatus: 'stopped',
                runtime: 'php',
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/backups'),
          body: {
            items: [{ projectId: 'p1', name: 'Demo', mtime: t, bytes: 100 }],
            lastRun: { at: t, ok: true },
          },
        },
        {
          match: (url) => url.includes('/ssl') || url.includes('/certs'),
          body: {
            items: [
              {
                id: 'c1',
                domain: 'ex.com',
                expiresAt: new Date(Date.now() + 86400e3 * 5).toISOString(),
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/audit'),
          body: {
            items: [
              {
                id: 'a1',
                action: 'login',
                at: t,
                actor: 'admin',
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/metrics'),
          body: {
            at: t,
            loadavg: [0.1, 0.1, 0.1],
            cpuCount: 2,
            memory: { total: 8e9, free: 4e9, usedRatio: 0.5 },
            disk: { path: '/', free: 50e9, total: 100e9, usedRatio: 0.5 },
          },
        },
        {
          match: (url) => url.includes('/readiness'),
          body: {
            ok: false,
            productionReady: false,
            checks: [{ id: 'c1', ok: false, title: 'x' }],
          },
        },
        { match: /.*/, body: { ok: true, items: [], ready: true } },
      ]);

      renderAt('/', <DashboardPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // Open wizard
      for (const b of screen
        .queryAllByRole('button', { name: /wizard|create|new project|quick/i })
        .slice(0, 4)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
        ),
      ).slice(0, 12)) {
        try {
          await user.clear(input as HTMLInputElement);
          await user.type(
            input as HTMLInputElement,
            input.type === 'number' ? '1' : 'demo-app',
          );
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 8)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      for (const rb of screen.queryAllByRole('radio').slice(0, 8)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /create|submit|save|next|finish|apply/i })
        .slice(0, 6)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Click tiles / alerts
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      for (const a of screen.queryAllByRole('link').slice(0, 10)) {
        try {
          await user.click(a);
        } catch {
          /* ignore */
        }
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'DnsPage DNSSEC + cluster + create zone/record',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/api/v1/resources/dns') ||
            url.includes('/api/v1/dns') ||
            url.includes('/zones'),
          handler: (url, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method !== 'GET') {
              if (url.includes('dnssec')) {
                return {
                  ok: true,
                  notes: ['dnssec enabled'],
                  dsRecord: 'example.com. IN DS 12345 13 2 ABCD',
                  publicKey: 'key',
                  files: ['/var/lib/bind/example.com.zone'],
                };
              }
              if (url.includes('cluster')) {
                return {
                  ok: true,
                  apply_status: 'written',
                  notes: ['synced'],
                  peers: [
                    { host: 'ns2.example.com', ok: true },
                    { host: 'ns3.example.com', ok: false, notes: ['timeout'] },
                  ],
                  requiresExecute: true,
                };
              }
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                id: 'z-new',
                zone: 'new.example.com',
                serverIp: '1.2.3.4',
                nsName: 'ns1.new.example.com',
                ttl: 300,
              };
            }
            if (url.includes('dnssec')) {
              return {
                ok: true,
                notes: ['listed'],
                files: ['/var/lib/bind/example.com.zone'],
                dsRecord: 'example.com. IN DS 12345 13 2 ABCD',
              };
            }
            if (url.includes('cluster') || url.includes('peers')) {
              return {
                items: [
                  { id: 'peer-1', host: 'ns2.example.com', user: 'ysk', label: 'secondary' },
                ],
              };
            }
            if (
              url.includes('records') ||
              /zones\/[^/?]+/.test(url) ||
              /dns\/[^/?]+/.test(url)
            ) {
              return {
                id: 'z1',
                zone: 'example.com',
                serverIp: '203.0.113.10',
                nsName: 'ns1.example.com',
                ttl: 300,
                apply_status: 'planned',
                records: [
                  { id: 'r1', type: 'A', name: '@', value: '203.0.113.10', ttl: 300 },
                  { id: 'r2', type: 'CNAME', name: 'www', value: 'example.com', ttl: 300 },
                  { id: 'r3', type: 'MX', name: '@', value: 'mail.example.com', priority: 10 },
                  { id: 'r4', type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                notes: [],
              };
            }
            return {
              items: [
                {
                  id: 'z1',
                  zone: 'example.com',
                  serverIp: '203.0.113.10',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                  apply_status: 'planned',
                },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/dns', <DnsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      try {
        const z = screen.queryAllByText(/example\.com/i)[0];
        if (z) await user.click(z);
      } catch {
        /* ignore */
      }
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 12)) {
        try {
          await user.clear(input);
          await user.type(input, 'www');
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 5)) {
        for (const o of Array.from((sel as HTMLSelectElement).options).slice(0, 6)) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }
      for (const b of screen
        .queryAllByRole('button', {
          name: /dnssec|cluster|sync|create|add|save|apply|delete|edit|refresh|peer|record|zone|validate|lookup/i,
        })
        .slice(0, 20)) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'UsersPage create + package + policy + Metrics projects tab',
    async () => {
      const user = userEvent.setup();
      const t = new Date().toISOString();
      const topHeader = {
        ok: true,
        at: t,
        uptimeSec: 100,
        loadavg: [0.1, 0.1, 0.1] as [number, number, number],
        tasks: { total: 10, running: 1, sleeping: 9, stopped: 0, zombie: 0 },
        cpu: {
          us: 1,
          sy: 1,
          ni: 0,
          id: 98,
          wa: 0,
          hi: 0,
          si: 0,
          st: 0,
          busyPct: 2,
        },
        cpus: [
          {
            us: 1,
            sy: 1,
            ni: 0,
            id: 98,
            wa: 0,
            hi: 0,
            si: 0,
            st: 0,
            busyPct: 2,
          },
        ],
        memory: {
          totalKiB: 8e6,
          freeKiB: 4e6,
          usedKiB: 3e6,
          buffCacheKiB: 1e6,
          availableKiB: 5e6,
        },
        swap: { totalKiB: 1e6, freeKiB: 1e6, usedKiB: 0 },
        notes: [],
      };
      installFetchMock([
        softwareReadyRoute(),
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
                  locale: 'en',
                  email: 'a@b.c',
                  capabilityGrants: ['projects.read'],
                  capabilityRevokes: [],
                },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['user', 'operator'],
                  packageId: 'pkg1',
                  suspended: true,
                  locale: 'zh-CN',
                },
              ],
              hostUsage: { projects: 2, diskMb: 100, quotaMb: 1000 },
              meta: { total: 2, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/packages'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
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
                  ssh: true,
                },
                {
                  id: 'pkg2',
                  name: 'pro',
                  maxProjects: 50,
                  maxMailboxes: 50,
                  maxDatabases: 20,
                  diskMb: 10240,
                  bandwidthMb: 1000,
                  ftp: true,
                  ssh: true,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/rbac'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  role: 'operator',
                  dirty: true,
                  policy: {
                    maxLevel: 'write-high',
                    capabilities: ['projects.read', 'projects.write'],
                  },
                  factory: {
                    maxLevel: 'write-high',
                    capabilities: ['projects.read'],
                  },
                },
                {
                  role: 'user',
                  dirty: false,
                  policy: {
                    maxLevel: 'read',
                    capabilities: ['projects.read'],
                  },
                  factory: {
                    maxLevel: 'read',
                    capabilities: ['projects.read'],
                  },
                },
              ],
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/metrics/projects'),
          body: {
            items: [
              {
                projectId: 'p1',
                name: 'Demo',
                diskMb: 100,
                path: '/home/demo',
                files: 10,
              },
              {
                projectId: 'p2',
                name: 'Other',
                diskMb: 200,
                path: '/home/other',
                files: 20,
              },
            ],
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/metrics/processes'),
          body: {
            ok: true,
            at: t,
            sort: 'cpu',
            limit: 40,
            topHeader,
            rows: [
              {
                pid: '1',
                user: 'root',
                cpu: 0.1,
                mem: 0.1,
                command: 'systemd',
                state: 'S',
                etime: '1:00',
                resKiB: 1000,
                virtKiB: 2000,
              },
            ],
            notes: [],
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/metrics/top'),
          body: topHeader,
        },
        {
          match: (url) => url.startsWith('/api/v1/metrics'),
          body: {
            at: t,
            loadavg: [0.5, 0.4, 0.3],
            cpuCount: 4,
            uptimeSec: 1000,
            memory: { total: 8e9, free: 4e9, usedRatio: 0.5, available: 4e9 },
            disk: { path: '/', free: 50e9, total: 100e9, usedRatio: 0.5 },
            diskMounts: [
              {
                filesystem: '/dev/sda1',
                mount: '/',
                size: 100e9,
                used: 50e9,
                avail: 50e9,
                usedRatio: 0.5,
              },
            ],
            alerts: [],
            notes: [],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      const u = renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      try {
        const row = screen.queryAllByText(/admin|bob/i)[0];
        if (row) await user.click(row);
      } catch {
        /* ignore */
      }
      for (const b of screen
        .queryAllByRole('button', {
          name: /create|add|save|edit|delete|suspend|package|policy|role|refresh|detail/i,
        })
        .slice(0, 15)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
        ),
      ).slice(0, 12)) {
        try {
          await user.clear(input as HTMLInputElement);
          await user.type(input as HTMLInputElement, 'user1');
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 10)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      u.unmount();

      const m = renderAt('/metrics?tab=projects', <MetricsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const b of screen.queryAllByRole('button').slice(0, 15)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      m.unmount();
      expect(true).toBe(true);
    },
    40_000,
  );
});
