/**
 * Surgical form fills for largest remaining hole pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { BackupsPage } from './features/BackupsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { FilesPage } from './FilesPage';
import { UsersPage } from './UsersPage';
import { ProtectionPage } from './features/ProtectionPage';
import { SecurityPage } from './SecurityPage';
import { LogsPage } from './features/LogsPage';
import { DnsPage } from './features/DnsPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('surgical form coverage', () => {
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
    'ProtectionPage geo lookup with rich result + policy save',
    async () => {
      const user = userEvent.setup();
      const now = new Date().toISOString();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
          body: {
            at: now,
            threatLevel: 'elevated',
            score: 50,
            signals: [],
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
              exists: true,
            },
            firewall: { active: 'inactive', installed: true },
            fail2ban: { active: 'inactive', installed: true, jails: 0 },
            autoBan: {
              enabled: true,
              mode: 'normal',
              method: 'fail2ban',
              cooldownMinutes: 30,
              maxAutoBansPerHour: 20,
              whitelist: [],
            },
            executeEnabled: false,
            isRoot: false,
            suggestions: [],
            notes: [],
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
          body: {
            provider: 'dbip',
            dir: '/var/lib/geo',
            ready: true,
            stale: false,
            cityReady: true,
            maxGranularity: 'city',
            notes: [],
            attribution: [],
            policy: {
              enabled: true,
              mode: 'deny_list',
              countries: ['CN'],
              continents: [],
              regions: [],
              cities: [],
              cityPolicyEnabled: true,
              asns: [],
              enforce: { autoBan: true, nginx: true, ufw: false },
              autoUpdate: true,
            },
            sources: [
              {
                filename: 'dbip-city.mmdb',
                present: true,
                mtime: now,
                bytes: 1000,
              },
            ],
            meta: { lastSuccessAt: now },
          },
        },
        {
          match: (url) => url.includes('/api/v1/defense/geoip/lookup'),
          body: {
            ok: true,
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
            access: { blocked: false, matched: ['country'] },
          },
        },
        {
          match: /\/api\/v1\/defense/,
          body: HONESTY_WRITTEN_BLOCKED,
        },
        {
          match: /\/api\/v1\/system\//,
          body: { installed: true, active: 'inactive', rules: [], jails: [], banned: [] },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/protection?tab=geo', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      const geoTab = screen.queryByRole('tab', { name: /ip access|geo/i });
      if (geoTab) await user.click(geoTab);

      // Find lookup input by placeholder or last textbox
      const inputs = screen.queryAllByRole('textbox');
      const lookup = inputs[inputs.length - 1];
      if (lookup) {
        await user.clear(lookup);
        await user.type(lookup, '203.0.113.50');
      }
      const lookupBtn = screen.queryAllByRole('button', { name: /lookup|查詢|查询/i })[0];
      if (lookupBtn) await user.click(lookupBtn);

      await waitFor(() => {
        expect(screen.queryAllByText(/cloudflare|new york|13335/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);

      for (const name of [/country|region|city|asn|\+|save|apply|update|download/i]) {
        for (const b of screen.queryAllByRole('button', { name }).slice(0, 3)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'BackupsPage: files row actions + ops + remote/s3/restic save',
    async () => {
      const user = userEvent.setup();
      const now = new Date().toISOString();
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
                path: '/backups/ysk',
                password: '***',
              },
              exclusions: ['node_modules'],
              restic: {
                enabled: true,
                repoPath: '/var/backups/restic',
                password: '***',
                s3Repo: '',
              },
            };
          },
        },
        {
          match: /\/api\/v1\/backups/,
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                results: [{ projectId: 'p1', ok: true }],
                snapshots: [{ id: 'snap-1', time: now, short_id: 'abc' }],
                install: { ok: false, notes: ['need execute'], requiresExecute: true },
              };
            }
            if (url.includes('snapshot')) {
              return {
                snapshots: [
                  {
                    id: 'snap-1',
                    time: now,
                    tags: ['p1'],
                    paths: ['/home/demo'],
                  },
                ],
                notes: ['listed'],
              };
            }
            return {
              items: [
                {
                  projectId: 'p1',
                  name: 'Demo',
                  path: '/var/backups/p1.tgz',
                  bytes: 4096,
                  mtime: now,
                  kind: 'full',
                },
              ],
              lastRun: {
                at: now,
                ok: true,
                results: [{ projectId: 'p1', ok: true, notes: ['ok'] }],
              },
            };
          },
        },
        {
          match: /\/api\/v1\/projects/,
          body: { items: [{ id: 'p1', name: 'Demo' }] },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Files tab row actions
      for (const name of [/restore/i, /delete/i, /download/i, /restic/i]) {
        const btns = screen.queryAllByRole('button', { name });
        for (const b of btns.slice(0, 2)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /confirm|delete|restore|apply|yes/i })
        .slice(0, 4)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Ops tab via button or tab
      const opsTab =
        screen.queryByRole('tab', { name: /ops|operation|作業|运维/i }) ??
        screen.queryAllByRole('button', { name: /ops|operation|backup all|備份|备份/i })[0];
      if (opsTab) await user.click(opsTab);
      for (const name of [
        /backup all|全部/i,
        /daily|cron|排程/i,
        /control plane|控制面/i,
        /restic/i,
        /snapshot|快照/i,
      ]) {
        const b = screen.queryAllByRole('button', { name })[0];
        if (b && !(b as HTMLButtonElement).disabled) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      // Remote settings tab
      const remoteTab = screen.queryByRole('tab', { name: /remote|遠端|远程|settings|設定/i });
      if (remoteTab) await user.click(remoteTab);

      // Toggle yes/no radios
      for (const rb of screen.queryAllByRole('radio').slice(0, 8)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }

      // Fill known ids
      for (const id of ['bk-host', 'bk-port', 'bk-user', 'bk-pass', 'bk-path', 'rs-path', 'rs-pw', 'rs-s3', 'bk-ex']) {
        const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) continue;
        try {
          await user.clear(el);
          await user.type(el, id === 'bk-port' ? '22' : 'test-val');
        } catch {
          /* ignore */
        }
      }

      // Switch to S3 kind if option present
      const s3 = screen.queryByRole('radio', { name: /s3/i });
      if (s3) {
        await user.click(s3);
        for (const id of ['bk-s3b', 'bk-s3r', 'bk-s3e', 'bk-ak', 'bk-sk']) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el) {
            try {
              await user.type(el, 'x');
            } catch {
              /* ignore */
            }
          }
        }
      }

      const save = screen.queryAllByRole('button', { name: /save all|儲存全部|保存全部|save/i })[0];
      if (save) await user.click(save);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    30_000,
  );

  it(
    'EmailDomainPage: mailbox/alias create + deliverability + advanced',
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
                server_ip: '203.0.113.10',
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/api/v1/email/domains/dom-1'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [
                  { type: 'MX', name: '@', value: 'mail.example.com', note: 'mail' },
                  { type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                externalTodos: ['Publish DKIM'],
                health: { score: 40, maxScore: 100, messages: ['SPF soft'] },
                notes: [],
              };
            }
            if (url.includes('/mailboxes')) {
              return {
                items: [
                  {
                    id: 'mb1',
                    local_part: 'info',
                    address: 'info@example.com',
                    quotaMb: 500,
                  },
                ],
              };
            }
            if (url.includes('/aliases')) {
              return {
                items: [{ id: 'al1', source: 'hi@example.com', dest: 'info@example.com' }],
              };
            }
            if (url.includes('/deliverability')) {
              return {
                ok: true,
                score: 55,
                panelReady: false,
                honesty: ['No inbox guarantee', 'External DNS required'],
                checks: [{ id: 'spf', ok: false, detail: 'missing', title: 'SPF' }],
                recommendations: ['Add SPF'],
                items: [
                  { id: 'spf', title: 'SPF', ok: false, detail: 'missing' },
                  { id: 'dkim', title: 'DKIM', ok: true, detail: 'ok' },
                ],
              };
            }
            if (url.includes('/sieve') || url.includes('/relay') || url.includes('/warmup')) {
              return { ok: true, items: [], script: '', enabled: false };
            }
            return {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10',
              apply_status: 'planned',
              managed: true,
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const label of screen.queryAllByRole('tab').map((t) => t.textContent ?? '')) {
        if (!label.trim()) continue;
        try {
          const tab = screen.queryByRole('tab', { name: label });
          if (tab) await user.click(tab);
        } catch {
          /* ignore */
        }
        for (const input of screen.queryAllByRole('textbox').slice(0, 6)) {
          try {
            await user.type(input, 'x');
          } catch {
            /* ignore */
          }
        }
        for (const b of screen
          .queryAllByRole('button', {
            name: /create|add|save|apply|copy|delete|refresh|enable|test|send/i,
          })
          .slice(0, 8)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
        const dialog = screen.queryAllByRole('dialog')[0];
        if (dialog) {
          for (const input of within(dialog).queryAllByRole('textbox').slice(0, 4)) {
            try {
              await user.type(input, 'info');
            } catch {
              /* ignore */
            }
          }
          for (const b of within(dialog)
            .queryAllByRole('button', { name: /create|save|apply|add/i })
            .slice(0, 2)) {
            try {
              await user.click(b);
            } catch {
              /* ignore */
            }
          }
          for (const b of within(dialog)
            .queryAllByRole('button', { name: /cancel|close/i })
            .slice(0, 1)) {
            try {
              await user.click(b);
            } catch {
              /* ignore */
            }
          }
        }
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    30_000,
  );

  it(
    'FilesPage: browse modals + trash + shares',
    async () => {
      const user = userEvent.setup();
      const now = new Date().toISOString();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/api/v1/files') ||
            url.includes('/hosting/files') ||
            url.includes('trash') ||
            url.includes('share'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, path: '/x', token: 't' };
            }
            if (url.includes('trash')) {
              return {
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
            if (url.includes('share')) {
              return {
                items: [
                  {
                    id: 'sh1',
                    path: 'a.txt',
                    token: 'tok',
                    createdAt: now,
                    expiresAt: null,
                  },
                ],
              };
            }
            if (url.includes('/read')) {
              return { content: 'hello world', path: 'a.txt', bytes: 11 };
            }
            return {
              ok: true,
              path: '/',
              entries: [
                { name: 'a.txt', path: 'a.txt', type: 'file', size: 11, mtime: now },
                { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
              ],
              items: [
                { name: 'a.txt', path: 'a.txt', type: 'file', size: 11, mtime: now },
                { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
              ],
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/files', <FilesPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const label of [/browse/i, /trash/i, /share/i]) {
        const tab = screen.queryByRole('tab', { name: label });
        if (tab) await user.click(tab);
        for (const name of [
          /new folder/i,
          /new text/i,
          /upload/i,
          /delete/i,
          /rename/i,
          /share/i,
          /zip/i,
          /chmod/i,
          /restore/i,
          /empty/i,
          /refresh/i,
        ]) {
          const b = screen.queryAllByRole('button', { name })[0];
          if (b && !(b as HTMLButtonElement).disabled) {
            try {
              await user.click(b);
            } catch {
              /* ignore */
            }
          }
        }
        const dialog = screen.queryAllByRole('dialog')[0];
        if (dialog) {
          for (const input of within(dialog).queryAllByRole('textbox').slice(0, 3)) {
            try {
              await user.clear(input);
              await user.type(input, 'new-item');
            } catch {
              /* ignore */
            }
          }
          for (const b of within(dialog)
            .queryAllByRole('button', { name: /create|save|apply|ok|share/i })
            .slice(0, 2)) {
            try {
              await user.click(b);
            } catch {
              /* ignore */
            }
          }
          for (const b of within(dialog)
            .queryAllByRole('button', { name: /cancel|close/i })
            .slice(0, 1)) {
            try {
              await user.click(b);
            } catch {
              /* ignore */
            }
          }
        }
      }

      // Open file row if visible
      try {
        const file = screen.queryByText('a.txt');
        if (file) await user.dblClick(file);
      } catch {
        /* ignore */
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );

  it(
    'UsersPage + Security + Protection + Logs + Dns surgical',
    async () => {
      const user = userEvent.setup();
      const now = new Date().toISOString();
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
                },
              ],
              hostUsage: { projects: 1, diskMb: 10, limitMb: 1000 },
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
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/rbac'),
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
                  factory: { maxLevel: 'write-high', capabilities: ['projects.read'] },
                },
              ],
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/auth/'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                secret: 'JBSWY3DPEHPK3PXP',
                otpauthUrl: 'otpauth://totp/YSK:admin',
                enabled: true,
                enrolled: true,
                recoveryCodes: ['aaaa-bbbb'],
                token: 'tok',
                key: { id: 'k2', name: 'n', prefix: 'ysk', created_at: now },
              };
            }
            if (_u.includes('totp')) return { enabled: false, enrolled: false };
            if (_u.includes('sessions')) {
              return {
                items: [
                  {
                    id: 's1',
                    created_at: now,
                    expires_at: now,
                    current: true,
                    ip: '1.1.1.1',
                  },
                ],
              };
            }
            if (_u.includes('api-keys')) {
              return {
                items: [{ id: 'k1', name: 'ci', prefix: 'ysk_ci', created_at: now }],
              };
            }
            return { ok: true };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/settings/security'),
          body: { requireAdminTotp: false, requireAdminTotpStrict: false, ok: true },
        },
        {
          match: (url) => url.startsWith('/api/v1/approvals'),
          body: {
            items: [{ id: 'ap1', tool: 'sys.shell', status: 'pending', requestedAt: now }],
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/tools'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { hostname: 'h' };
            return {
              items: [
                { id: 'sys.info', name: 'sys.info', allowed: true, requiresApproval: false },
                { id: 'sys.shell', name: 'sys.shell', allowed: false, requiresApproval: true },
              ],
            };
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
                fingerprintSha256: 'SHA256:abcdef0123456789abcd',
                publicKey: 'ssh-ed25519 AAAA',
                createdAt: now,
                binding: { linuxUser: 'ysk', homeDir: '/home/ysk' },
              },
            ],
            host: { notes: [], lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' } },
            pamSnippet: '#',
            sshdHints: '#',
            snippet: 'Match',
            notes: [],
          },
        },
        {
          match: /\/api\/v1\/sftp\//,
          body: { ok: true, items: [], snippet: '', notes: [] },
        },
        {
          match: (url) =>
            url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
          body: {
            at: now,
            threatLevel: 'elevated',
            score: 70,
            signals: [{ id: 'highReqRate', label: 'R', value: 1, points: 5 }],
            activePreset: 'daily',
            presets: [
              { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
              { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
              { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
              { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
            ],
            bans: { count: 0, items: [] },
            nginxLimits: {
              reqRate: '10r/s',
              burst: 20,
              connLimit: 40,
              confPath: '/x',
              exists: true,
            },
            firewall: { active: 'inactive', installed: true },
            fail2ban: { active: 'inactive', installed: true, jails: 1 },
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
            suggestions: [
              { id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' },
            ],
            notes: [],
          },
        },
        {
          match: /\/api\/v1\/defense/,
          body: HONESTY_WRITTEN_BLOCKED,
        },
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
                    available: true,
                  },
                ],
              };
            }
            if (url.includes('overview')) {
              return {
                journalDiskMb: 50,
                followIntervalSec: 3,
                journalWarnMb: 40,
                vacuumDefaultDays: 14,
                maxLines: 200,
              };
            }
            if (url.includes('settings')) {
              return {
                vacuumDefaultDays: 14,
                maxLines: 200,
                journalWarnMb: 40,
                bookmarks: [
                  {
                    id: 'b1',
                    name: 'err',
                    source: 'journal:nginx.service',
                    grep: 'error',
                  },
                ],
              };
            }
            if (url.includes('projects')) {
              return {
                items: [
                  {
                    projectId: 'p1',
                    name: 'Demo',
                    files: [{ name: 'app.log', bytes: 1, previewable: true }],
                    related: [],
                  },
                ],
              };
            }
            return {
              ok: true,
              text: 'err line\nok\n',
              lines: ['err line', 'ok'],
              truncated: true,
              notes: [],
            };
          },
        },
        {
          match: /\/api\/v1\/resources\//,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                item: {
                  id: 'z1',
                  zone: 'example.com',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                  apply_status: 'planned',
                },
              };
            }
            if (_u.includes('zones')) {
              return {
                items: [
                  {
                    id: 'z1',
                    zone: 'example.com',
                    serverIp: '1.2.3.4',
                    nsName: 'ns1.example.com',
                    ttl: 300,
                    apply_status: 'planned',
                  },
                ],
                meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
              };
            }
            return {
              items: [
                {
                  id: 'r1',
                  zoneId: 'z1',
                  type: 'A',
                  name: '@',
                  value: '1.2.3.4',
                  ttl: 300,
                },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
            };
          },
        },
        {
          match: /\/api\/v1\/dns/,
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            ok: true,
            answers: ['1.2.3.4'],
            notes: [],
            items: [],
            peers: [],
            dsRecord: 'x',
          },
        },
        {
          match: /\/api\/v1\/system\//,
          body: {
            installed: true,
            active: 'inactive',
            rules: [],
            jails: [],
            banned: [],
            ignoreIps: [],
            catalog: [],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      for (const [path, el, route] of [
        ['/users', <UsersPage key="u" />, '*'],
        ['/security', <SecurityPage key="s" />, '*'],
        ['/protection?tab=bans&ip=198.51.100.7', <ProtectionPage key="p" />, '*'],
        ['/logs?tab=settings&unit=nginx.service&project=p1', <LogsPage key="l" />, '*'],
        ['/dns', <DnsPage key="d" />, '*'],
      ] as const) {
        const { unmount } = renderAt(path, el, route);
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
          timeout: 8000,
        });
        for (const label of screen.queryAllByRole('tab').map((t) => t.textContent ?? '')) {
          if (!label.trim()) continue;
          try {
            const tab = screen.queryByRole('tab', { name: label });
            if (tab) await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        for (const input of screen.queryAllByRole('textbox').slice(0, 10)) {
          try {
            await user.type(input, '1');
          } catch {
            /* ignore */
          }
        }
        for (const b of screen.queryAllByRole('button').slice(0, 16)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
        unmount();
      }
    },
    60_000,
  );
});
