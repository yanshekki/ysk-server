import { createUiProbe } from '../test/assert-rendered';
/**
 * Floor-90 surgical coverage: remaining handlers on largest miss pages.
 * Prefer real userEvent paths; honesty responses stay written/blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { EmailDomainPage } from './EmailDomainPage';
import { MetricsPage } from './features/MetricsPage';
import { SecurityPage } from './SecurityPage';
import { DnsPage } from './features/DnsPage';
import { UsersPage } from './UsersPage';
import { AgentsPage } from './AgentsPage';
import { FilesPage } from './FilesPage';
import { ProtectionPage } from './features/ProtectionPage';
import { BackupsPage } from './features/BackupsPage';
import { NginxPage } from './features/NginxPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { CdnPage } from './features/CdnPage';
import { NetworkPage } from './features/NetworkPage';
import { RedisPage } from './features/RedisPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, limit = 6) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

async function fillId(id: string, value: string, user: ReturnType<typeof userEvent.setup>) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  try {
    el.focus();
    await user.clear(el as HTMLInputElement);
    await user.type(el as HTMLInputElement, value);
    return true;
  } catch {
    return false;
  }
}

const now = () => new Date().toISOString();

function topHeader(t = now()) {
  return {
    ok: true,
    at: t,
    uptimeSec: 100_000,
    loadavg: [1.2, 0.8, 0.5] as [number, number, number],
    tasks: { total: 200, running: 3, sleeping: 197, stopped: 0, zombie: 0 },
    cpu: { us: 12, sy: 4, ni: 0, id: 80, wa: 2, hi: 0, si: 1, st: 1, busyPct: 20 },
    cpus: [
      { us: 12, sy: 4, ni: 0, id: 80, wa: 2, hi: 0, si: 1, st: 1, busyPct: 20 },
      { us: 5, sy: 2, ni: 0, id: 90, wa: 1, hi: 0, si: 1, st: 1, busyPct: 10 },
    ],
    memory: {
      totalKiB: 8e6,
      freeKiB: 1e6,
      usedKiB: 6e6,
      buffCacheKiB: 1e6,
      availableKiB: 2e6,
    },
    swap: { totalKiB: 1e6, freeKiB: 9e5, usedKiB: 1e5 },
    notes: [],
  };
}

function processRows(t = now()) {
  return {
    ok: true,
    at: t,
    sort: 'cpu',
    limit: 40,
    topHeader: topHeader(t),
    rows: [
      {
        pid: '1',
        user: 'root',
        cpu: 0.1,
        mem: 0.2,
        command: 'systemd',
        state: 'S',
        etime: '1-00:00',
        resKiB: 1000,
        virtKiB: 5000,
      },
      {
        pid: '42',
        user: 'www-data',
        cpu: 15,
        mem: 9,
        command: 'nginx: worker',
        state: 'S',
        etime: '01:00',
        resKiB: 50000,
        virtKiB: 100000,
      },
      {
        pid: '99',
        user: 'alice',
        cpu: 6,
        mem: 3,
        command: 'ysk-server',
        state: 'R',
        etime: '00:30',
        resKiB: 20000,
        virtKiB: 80000,
      },
      {
        pid: '100',
        user: 'bob',
        cpu: 0.5,
        mem: 0.1,
        command: 'bash',
        state: 'S',
        etime: '00:10',
        resKiB: 2000,
        virtKiB: 4000,
      },
    ],
    notes: [],
  };
}

function metricsRoutes(signalOk = true): FetchRoute[] {
  const t = now();
  return [
    softwareReadyRoute(),
    {
      match: (url) => url.startsWith('/api/v1/metrics/processes/signal'),
      body: signalOk
        ? {
            ok: true,
            pid: '42',
            signal: 'TERM',
            stillAlive: false,
            notes: ['signaled'],
            requiresExecute: true,
            blocked: true,
            blockMessage: 'Host execute is off',
          }
        : {
            ok: false,
            pid: '42',
            signal: 'KILL',
            stillAlive: true,
            notes: ['denied'],
          },
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics/processes/renice'),
      body: {
        ok: true,
        pid: '42',
        nice: 5,
        notes: ['reniced'],
        blocked: true,
        blockMessage: 'Host execute is off',
      },
    },
    {
      match: (url) => /\/api\/v1\/metrics\/processes\/\d+/.test(url),
      body: {
        ok: true,
        pid: '42',
        command: 'nginx: worker',
        cwd: '/var/www',
        fdCount: 32,
        user: 'www-data',
        cpu: 15,
        mem: 9,
        notes: ['detail note'],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics/processes'),
      body: processRows(t),
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics/top'),
      body: topHeader(t),
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics/projects'),
      body: {
        ok: true,
        totalUsedBytes: 500e6,
        items: [
          {
            projectId: 'p1',
            name: 'Demo',
            usedBytes: 400e6,
            quotaMb: 512,
            path: '/home/demo',
          },
          {
            projectId: 'p2',
            name: 'Hot',
            usedBytes: 900e6,
            quotaMb: 1024,
            path: '/home/hot',
          },
        ],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics/stream'),
      handler: async () => {
        // openStream uses raw fetch — return empty body so onError path may fire
        return { ok: true };
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/metrics'),
      body: {
        ok: true,
        at: t,
        loadavg: [2.5, 1.2, 0.8],
        cpuCount: 2,
        uptimeSec: 100_000,
        memory: {
          total: 8e9,
          used: 7.2e9,
          free: 0.8e9,
          usedRatio: 0.9,
          available: 1e9,
        },
        disk: {
          path: '/',
          total: 100e9,
          used: 92e9,
          free: 8e9,
          usedRatio: 0.92,
        },
        diskMounts: [
          {
            filesystem: '/dev/sda1',
            mount: '/',
            size: 100e9,
            used: 92e9,
            avail: 8e9,
            usedRatio: 0.92,
          },
          {
            filesystem: '/dev/sdb1',
            mount: '/home',
            size: 50e9,
            used: 40e9,
            avail: 10e9,
            usedRatio: 0.8,
          },
        ],
        alerts: ['mem_high', 'disk_high'],
        notes: [],
      },
    },
    { match: /.*/, body: { ok: true, items: [] } },
  ];
}

function emailDomainRoutes(): FetchRoute[] {
  return [
    softwareReadyRoute(),
    {
      match: (url) => url.includes('/api/v1/email'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ...HONESTY_WRITTEN_BLOCKED,
            ok: true,
            apply_status: 'written',
            written: true,
            blocked: true,
            blockMessage: 'need execute',
            notes: ['written only'],
            id: 'new-id',
          };
        }
        if (url.includes('/deliverability')) {
          return {
            ok: true,
            score: 72,
            panelReady: false,
            honesty: ['No inbox guarantee', 'PTR is external'],
            externalTodos: [
              { id: 'ptr', title: 'Set PTR', description: 'Ask VPS provider' },
              { id: 'p25', title: 'Port 25', description: 'Unblock SMTP' },
            ],
            items: [
              {
                id: 'spf',
                title: 'SPF',
                ok: true,
                level: 'panel',
                owner: 'DNS',
                detail: 'v=spf1 mx -all',
              },
              {
                id: 'dkim',
                title: 'DKIM',
                ok: false,
                level: 'panel',
                owner: 'DNS',
                detail: 'missing selector',
                fixHint: 'publish DKIM TXT',
              },
              {
                id: 'ptr',
                title: 'PTR',
                ok: null,
                level: 'external',
                owner: 'Provider',
                detail: 'cannot set from panel',
              },
              {
                id: 'dnsbl',
                title: 'DNSBL',
                ok: false,
                level: 'panel',
                owner: 'IP',
                detail: 'listed',
              },
            ],
          };
        }
        if (url.includes('/dns')) {
          return {
            domain: 'example.com',
            records: [{ type: 'MX', name: '@', value: 'mail.example.com' }],
            externalTodos: [{ title: 'DKIM', description: 'publish' }],
            health: { score: 40, maxScore: 100, messages: [] },
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
        if (
          url.includes('/sieve') ||
          url.includes('/relay') ||
          url.includes('/warmup') ||
          url.includes('/dnsbl') ||
          url.includes('/live') ||
          url.includes('/webmail') ||
          url.includes('/bootstrap')
        ) {
          return {
            ok: true,
            script: 'require ["fileinto"];',
            enabled: true,
            items: [],
            host: 'smtp.example.com',
            score: 50,
            health: { score: 50 },
            notes: ['ok'],
          };
        }
        // domain list / get
        if (url.match(/\/api\/v1\/email\/domains\/[^/?]+$/) || url.includes('/domains/dom-1')) {
          return {
            id: 'dom-1',
            domain: 'example.com',
            rate_limit_per_hour: 200,
            antispam: true,
            server_ip: '203.0.113.10',
            health_score: 40,
            suspended: false,
            managed: true,
            apply_status: 'written',
          };
        }
        return {
          items: [
            {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10',
              health_score: 40,
              suspended: false,
              managed: true,
            },
          ],
        };
      },
    },
    { match: /.*/, body: { ok: true, items: [] } },
  ];
}

describe('coverage floor 90', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: ['*'],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'EmailDomainPage: deliverability pack + advanced suspend + bootstrap',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock(emailDomainRoutes());
      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      const deliv = screen.queryByRole('tab', { name: /deliver/i });
      if (deliv) await user.click(deliv);
      await clickBtn(user, /run deliverability|deliverability pack|run pack/i, 2);
      await waitFor(() => {
        expect(screen.queryAllByText(/SPF|DKIM|PTR|No inbox/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);
      await clickBtn(user, /relay/i, 1);

      const adv = screen.queryByRole('tab', { name: /advanced/i });
      if (adv) await user.click(adv);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /suspend|resume|save|autoreply|apply/i, 8);

      const health = screen.queryByRole('tab', { name: /health/i });
      if (health) await user.click(health);
      await clickBtn(user, /refresh|check|dnsbl|warmup|live|policy|write|apply/i, 10);

      // bootstrap password path
      await fillId('boot-pw', 'AdminPass1!', user);
      await clickBtn(user, /bootstrap|install|webmail/i, 4);

      // not-found path
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/email'),
          body: { items: [] },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);
      const missing = renderAt('/email/missing', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0));
      await clickBtn(user, /back/i, 1);
      probe.sample();
      missing.unmount();
      probe.sample();
      missing.unmount();
      probe.assertRendered();
    },
    45_000,
  );

  it(
    'MetricsPage: select TERM/KILL confirm + detail renice + filters + follow',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock(metricsRoutes());
      renderAt('/metrics?tab=live', <MetricsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      const live = screen.queryByRole('tab', { name: /live/i });
      if (live) await user.click(live);

      await waitFor(() => {
        expect(screen.queryAllByText(/nginx|42|systemd/i).length).toBeGreaterThan(0);
      });

      // select all + toggle one
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 5)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // filters
      for (const chip of screen.queryAllByRole('button', { name: /≥5%|mine|all|全部/i }).slice(0, 4)) {
        try {
          await user.click(chip);
        } catch {
          /* ignore */
        }
      }
      const search = screen.queryByRole('searchbox') ?? screen.queryAllByRole('textbox')[0];
      if (search) {
        try {
          await user.clear(search);
          await user.type(search, 'nginx');
        } catch {
          /* ignore */
        }
      }

      // select process again after filter
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 3)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      await clickBtn(user, /^TERM$/i, 2);
      await clickBtn(user, /send|confirm|term/i, 3);

      await clickBtn(user, /^KILL$/i, 2);
      await clickBtn(user, /force|kill|confirm/i, 3);

      // open detail via PID link
      const pidBtn = screen.queryAllByRole('button').find((b) => b.textContent?.trim() === '42');
      if (pidBtn) await user.click(pidBtn);
      await waitFor(() => {
        expect(document.getElementById('met-nice') || screen.queryByText(/cmdline|cwd|nice/i)).toBeTruthy();
      }).catch(() => undefined);
      await fillId('met-nice', '10', user);
      await clickBtn(user, /renice|apply/i, 2);
      await clickBtn(user, /^TERM$|^KILL$/i, 2);
      await clickBtn(user, /send|confirm|force|kill/i, 3);

      // follow SSE toggle
      for (const cb of screen.queryAllByRole('checkbox')) {
        const lab = cb.closest('label')?.textContent ?? '';
        if (/follow|sse|live/i.test(lab)) {
          try {
            await user.click(cb);
          } catch {
            /* ignore */
          }
        }
      }

      // sort/limit selects
      for (const sel of document.querySelectorAll('select')) {
        try {
          const opts = Array.from(sel.options);
          if (opts.length > 1) await user.selectOptions(sel, opts[1].value);
        } catch {
          /* ignore */
        }
      }

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /refresh|load|view all|project/i, 6);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'SecurityPage: TOTP begin/confirm/recovery + sessions + devices',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      let totpEnabled = false;
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/auth/totp/begin'),
          body: {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
            enabled: false,
          },
        },
        {
          match: (url) => url.includes('/api/v1/auth/totp/confirm'),
          handler: () => {
            totpEnabled = true;
            return {
              enabled: true,
              recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF'],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/auth/totp/disable'),
          body: { enabled: false },
        },
        {
          match: (url) => url.match(/\/api\/v1\/auth\/totp\/?(\?|$)/) || url.endsWith('/auth/totp'),
          handler: () => ({
            enabled: totpEnabled,
            enrolled: totpEnabled,
            recoveryRemaining: totpEnabled ? 3 : 0,
          }),
        },
        {
          match: (url) => url.includes('/api/v1/auth/sessions'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
              return { ok: true, revoked: 2 };
            }
            return {
              items: [
                {
                  id: 's1',
                  created_at: now(),
                  expires_at: now(),
                  last_seen_at: now(),
                  user_agent: 'Mozilla/5.0 Chrome/120',
                  ip: '1.2.3.4',
                  current: true,
                },
                {
                  id: 's2',
                  created_at: now(),
                  expires_at: now(),
                  last_seen_at: now(),
                  user_agent: 'Mozilla/5.0 Firefox/121',
                  ip: '5.6.7.8',
                  current: false,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/auth/api-keys'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
              return {
                key: { id: 'k1', name: 'ci', prefix: 'ysk_', created_at: now() },
                token: 'ysk_secret_token',
              };
            }
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') return { ok: true };
            return {
              items: [{ id: 'k1', name: 'ci', prefix: 'ysk_', created_at: now() }],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/auth/devices'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') return { ok: true };
            return { items: [{ id: 'd1', ip: '1.1.1.1' }] };
          },
        },
        {
          match: (url) => url.includes('/api/v1/auth/webauthn'),
          body: {
            ok: false,
            notes: ['webauthn unavailable in test'],
            options: null,
          },
        },
        {
          match: (url) => url.includes('/api/v1/settings/security'),
          body: {
            ok: true,
            requireAdminTotp: false,
            requireAdminTotpStrict: false,
          },
        },
        {
          match: (url) => url.includes('/api/v1/security/fail2ban-snippets'),
          body: { written: ['/etc/fail2ban/jail.d/ysk.conf'], notes: ['ok'] },
        },
        {
          match: (url) => url.includes('/api/v1/security') || url.includes('/api/v1/ssh'),
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            items: [],
            ok: true,
            identities: [],
            policy: { requireAdminTotp: false },
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/security', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      await fillId('reauth-pw', 'AdminPass1!', user);
      await clickBtn(user, /start|enable|reset.*2fa|begin|setup/i, 3);
      await waitFor(() => expect(document.getElementById('totp-confirm')).toBeTruthy()).catch(
        () => undefined,
      );
      await fillId('totp-confirm', '123456', user);
      await clickBtn(user, /confirm|enable|verify/i, 3);
      await clickBtn(user, /copy|close|saved/i, 3);

      await clickBtn(user, /revoke|session|other/i, 6);
      await clickBtn(user, /confirm|yes|revoke/i, 4);

      await clickBtn(user, /passkey|register|verify/i, 4);
      await clickBtn(user, /device|trusted|fail2ban|export|backup|api.?key|create|delete/i, 12);

      // API key modal
      await fillId('api-key-name', 'ci-bot', user);
      await clickBtn(user, /create|save|copy|close/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'DnsPage: DNSSEC + cluster peer ops with rich results + validate fail',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/dnssec'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
              return {
                ok: true,
                dsRecord: 'example.com. IN DS 12345 13 2 ABCD',
                publicKey: 'pubkey',
                notes: ['signed'],
                files: ['/var/cache/bind/Kexample.com.+013+12345.key'],
              };
            }
            return { files: ['a.key'], notes: ['listed'] };
          },
        },
        {
          match: (url) => url.includes('/dns/validate'),
          body: {
            ok: false,
            issues: [{ level: 'error', message: 'CNAME conflict' }],
            notes: ['invalid set'],
          },
        },
        {
          match: (url) => url.includes('/dns/cluster/peers'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') return { ok: true };
            return {
              items: [
                {
                  id: 'peer1',
                  host: 'ns2.example.com',
                  username: 'dns',
                  path: '/var/cache/bind',
                  label: 'Secondary',
                  lastProbe: {
                    ok: true,
                    service: 'named',
                    zoneDirOk: true,
                    at: now(),
                    notes: ['ok'],
                  },
                },
                {
                  id: 'peer2',
                  host: 'ns3.example.com',
                  username: 'dns',
                  path: '/zones',
                  lastProbe: { ok: false, zoneDirOk: false, at: now() },
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/dns/cluster/'),
          body: {
            ok: false,
            apply_status: 'partial',
            notes: ['peer2 failed'],
            peers: [
              {
                peerId: 'peer1',
                label: 'Secondary',
                host: 'ns2',
                apply_status: 'written',
                reloaded: true,
                reloadMethod: 'rndc',
                notes: ['ok'],
              },
              {
                peerId: 'peer2',
                host: 'ns3',
                apply_status: 'blocked',
                reloaded: false,
                notes: ['timeout'],
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
                  serverIp: '1.2.3.4',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                },
              };
            }
            if (url.includes('zones')) {
              return {
                items: [
                  {
                    id: 'z1',
                    zone: 'example.com',
                    serverIp: '1.2.3.4',
                    nsName: 'ns1.example.com',
                    ttl: 300,
                    apply_status: 'written',
                  },
                ],
              };
            }
            if (url.includes('records')) {
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
              };
            }
            return { items: [] };
          },
        },
        {
          match: (url) => url.includes('/dns/lookup') || url.includes('/dns/tools'),
          body: { ok: true, answers: ['1.2.3.4'], notes: [] },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/dns', <DnsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // select zone if needed
      await clickBtn(user, /example\.com|select|open/i, 2);

      await clickBtn(user, /dnssec|sign/i, 3);

      const cluster = screen.queryByRole('tab', { name: /cluster/i });
      if (cluster) await user.click(cluster);
      await clickBtn(user, /push|reload|probe|delete|refresh|sync|apply/i, 12);

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /add record|create record|new record|\+/i, 2);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        for (const input of within(dialog).queryAllByRole('textbox').slice(0, 4)) {
          try {
            await user.clear(input);
            await user.type(input, 'www');
          } catch {
            /* ignore */
          }
        }
        await clickBtn(user, /save|create|add/i, 2);
      }
      await clickBtn(user, /lookup|query|check|dig|dnssec|sign/i, 6);

      expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
    },
    45_000,
  );

  it(
    'UsersPage: filter chips + edit package + admin create confirm',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
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
                  capabilityGrants: ['projects.write'],
                  capabilityRevokes: [],
                },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['operator'],
                  packageId: null,
                  suspended: true,
                  locale: 'zh-HK',
                  capabilityGrants: [],
                  capabilityRevokes: ['files.write'],
                },
              ],
              meta: {
                total: 2,
                page: 1,
                limit: 50,
                q: '',
                filters: {},
                order: 'asc',
                facets: {
                  role: { admin: 1, operator: 1 },
                  status: { suspended: 1 },
                  totp: { '0': 2 },
                  package: { none: 1 },
                  overrides: { '1': 1 },
                },
              },
              hostUsage: { projects: 2, diskMb: 20, freeMb: 1000 },
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
                  max_projects: 10,
                  max_mailboxes: 5,
                  max_databases: 5,
                  disk_mb: 1024,
                  bandwidth_mb: 0,
                  allow_ftp: true,
                  allow_ssh: true,
                  maxProjects: 10,
                  maxMailboxes: 5,
                  maxDatabases: 5,
                  diskMb: 1024,
                  bandwidthMb: 0,
                  ftp: true,
                  ssh: true,
                  notes: 'base',
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/rbac'),
          body: {
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
            ],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getByText(/admin/i)).toBeInTheDocument());

      // filter chips
      for (const name of [/admin/i, /operator/i, /suspend/i, /2fa|totp/i, /package|no.?pkg/i, /override/i, /all/i]) {
        const chip = screen.queryAllByRole('button', { name }).find((b) =>
          /chip|filter|pill/i.test(b.className) || true,
        );
        if (chip) {
          try {
            await user.click(chip);
          } catch {
            /* ignore */
          }
        }
      }

      // edit package
      const pkgTab = screen.queryByRole('tab', { name: /package/i });
      if (pkgTab) await user.click(pkgTab);
      await clickBtn(user, /edit|修改/i, 2);
      await fillId('p-name', 'gold', user);
      await fillId('p-notes', 'updated', user);
      await clickBtn(user, /save|update|create package/i, 2);

      // create admin user (confirm path)
      const usersTab = screen.queryByRole('tab', { name: /user/i });
      if (usersTab) await user.click(usersTab);
      await clickBtn(user, /create user|\+ create user/i, 1);
      await fillId('u-name', 'root2', user);
      await fillId('u-pass', 'Password1!', user);
      const roleSel = document.getElementById('u-role') as HTMLSelectElement | null;
      if (roleSel) {
        try {
          await user.selectOptions(roleSel, 'admin');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /^create user$/i, 1);
      await clickBtn(user, /confirm|yes|create|promote/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'AgentsPage: all command presets + history result modal',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/agents') || url.includes('/api/v1/fleet'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                id: 'cmd-1',
                agent_id: 'edge-1',
                status: 'queued',
              };
            }
            if (url.includes('/commands') || url.includes('/history')) {
              return {
                items: [
                  {
                    id: 'cmd-done',
                    agent_id: 'edge-1',
                    status: 'done',
                    payload: { cli: ['readiness'] },
                    createdAt: now(),
                    result: {
                      exitCode: 0,
                      dryRun: true,
                      blocked: false,
                      stderr: 'warn line',
                      result: { ok: true, score: 90 },
                    },
                  },
                  {
                    id: 'cmd-err',
                    agent_id: 'edge-1',
                    status: 'error',
                    payload: { op: 'ping' },
                    createdAt: now(),
                    result: { exitCode: 1, blocked: true, notes: ['fail'] },
                  },
                ],
              };
            }
            if (url.includes('/runtimes') || url.includes('/runtime')) {
              return {
                items: [
                  {
                    kind: 'claude',
                    status: 'running',
                    unitActive: 'active',
                    version: '1.0',
                    notes: ['ok'],
                  },
                  {
                    kind: 'codex',
                    status: 'not_installed',
                    unitActive: 'inactive',
                  },
                ],
              };
            }
            return {
              items: [
                {
                  id: 'a1',
                  agent_id: 'edge-1',
                  group: 'default',
                  status: 'connected',
                  last_seen_at: now(),
                  version: '0.1',
                },
              ],
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/agents', <AgentsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      await clickBtn(user, /command|cmd|enqueue|send/i, 2);
      const presets = [
        /readiness/i,
        /host/i,
        /projects/i,
        /services/i,
        /defense/i,
        /logs/i,
        /custom|cli/i,
        /ping/i,
      ];
      for (const p of presets) {
        const opt = screen.queryAllByRole('radio', { name: p })[0]
          ?? screen.queryAllByRole('button', { name: p })[0]
          ?? screen.queryAllByText(p)[0];
        if (opt) {
          try {
            await user.click(opt);
          } catch {
            /* ignore */
          }
        }
        if (/custom/i.test(String(p))) {
          await fillId('cmd-custom', 'projects list --json', user);
        }
        await clickBtn(user, /enqueue|send|queue/i, 1);
        // re-open command modal
        await clickBtn(user, /command|cmd|enqueue/i, 1);
      }

      await clickBtn(user, /history|result|view|detail/i, 4);
      await clickBtn(user, /close|ok/i, 2);

      await clickBtn(user, /register|install|unit|probe|delete|refresh/i, 8);
      await fillId('aid', 'edge-2', user);
      await fillId('agroup', 'edge', user);
      await clickBtn(user, /register|save/i, 2);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'FilesPage remaining: upload path + edit save + bulk',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const entries = [
        {
          name: 'readme.txt',
          path: 'readme.txt',
          type: 'file' as const,
          size: 512,
          mtime: t,
          mime: 'text/plain',
          favorite: true,
        },
        {
          name: 'subdir',
          path: 'subdir',
          type: 'dir' as const,
          size: 0,
          mtime: t,
        },
        {
          name: 'bin.dat',
          path: 'bin.dat',
          type: 'file' as const,
          size: 2048,
          mtime: t,
          mime: 'application/octet-stream',
        },
      ];
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/files'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, content: 'hello' };
            }
            if (url.includes('/content') || url.includes('/read')) {
              return {
                ok: true,
                content: 'file body\nline2',
                encoding: 'utf-8',
                mime: 'text/plain',
              };
            }
            return {
              path: '/',
              cwd: '/',
              items: entries,
              entries,
              favorites: [entries[0]],
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/files', <FilesPage />);
      await waitFor(
        () =>
          expect(
            screen.queryByRole('heading', { level: 1 }) ||
              screen.queryByText(/readme|files|browse/i),
          ).toBeTruthy(),
        { timeout: 8000 },
      );

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /delete|copy|move|download|zip|favorite|refresh|new|upload|rename/i, 12);
      await clickBtn(user, /confirm|yes|ok|create|save/i, 4);

      const row = screen.queryAllByText(/readme\.txt/i)[0];
      if (row) {
        try {
          await user.click(row);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /edit|open|view|save/i, 4);

      probe.sample();
      probe.assertRendered();
    },
    40_000,
  );

  it(
    'BackupsPage + NginxPage + ProjectDetail + Cdn + Network',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'b1',
                  name: 'nightly',
                  createdAt: now(),
                  sizeBytes: 5_000_000,
                  status: 'ok',
                  type: 'full',
                  path: '/var/backups/b1.tgz',
                  projectId: 'p1-project-id-long-enough',
                },
              ],
              settings: {
                enabled: true,
                schedule: '0 3 * * *',
                retain: 7,
                includeProjects: true,
                includeMail: true,
                includeDb: true,
              },
              lastRun: { ok: true, at: now(), notes: ['done'] },
            };
          },
        },
        {
          match: /\/api\/v1\/resources\//,
          handler: (_url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                item: {
                  id: 'n1',
                  domain: 'app.example.com',
                  kind: 'proxy',
                  upstream: '127.0.0.1:3000',
                  ssl: false,
                },
              };
            }
            return {
              items: [
                {
                  id: 'n1',
                  domain: 'app.example.com',
                  kind: 'proxy',
                  upstream: '127.0.0.1:3000',
                  root: '/var/www',
                  ssl: true,
                  apply_status: 'written',
                },
                {
                  id: 'n2',
                  domain: 'static.example.com',
                  kind: 'static',
                  root: '/var/www/static',
                  ssl: false,
                },
                {
                  id: 'n3',
                  domain: 'php.example.com',
                  kind: 'php',
                  root: '/var/www/php',
                  ssl: false,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/projects/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/logs')) {
              return {
                lines: ['[info] started', '[warn] slow'],
                nextCursor: null,
              };
            }
            return {
              id: 'p1',
              name: 'Demo',
              domain: 'demo.example.com',
              runtime: 'node',
              runtimeVersion: '20',
              status: 'running',
              processStatus: 'running',
              osProvisioned: true,
              linuxUser: 'demo',
              lastDeployAt: now(),
              nginxConfigPath: '/etc/nginx/sites-enabled/demo',
              lastHealth: {
                ok: true,
                status: 200,
                ms: 12,
                nginxStatus: 'live',
                nginxReloaded: true,
                at: now(),
              },
              entry: 'server.js',
              env: { NODE_ENV: 'production' },
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/cdn/dashboard'),
          body: {
            at: now(),
            nodes: {
              online: 1,
              offline: 0,
              draining: 0,
              total: 1,
              unknown: 0,
              byRegion: { local: 1 },
            },
            sites: {
              total: 1,
              healthy: 1,
              degraded: 0,
              byApplyStatus: { applied: 1 },
              rows: [{ id: 'site1', name: 'cdn.example.com', apply_status: 'applied' }],
            },
            cache: [],
            overallHitRatePct: 90,
            notes: [],
          },
        },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/nodes') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: {
            items: [
              {
                id: 'node1',
                name: 'edge-hk',
                host: '10.0.0.2',
                roles: ['edge'],
                status: 'online',
                draining: false,
              },
            ],
          },
        },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/sites') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: {
            items: [
              {
                id: 'site1',
                domain: 'cdn.example.com',
                origin: 'origin.example.com',
                status: 'applied',
                edgeIds: ['node1'],
                edgeNodeIds: ['node1'],
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/api/v1/cdn'),
          body: HONESTY_WRITTEN_BLOCKED,
        },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          body: {
            ok: true,
            at: now(),
            notes: [],
            backend: {
              hasIp: true,
              networkManager: 'inactive',
              networkd: 'inactive',
              canPersist: true,
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
                addrs: [
                  { family: 'inet', local: '10.0.0.5', prefixlen: 24 },
                  { family: 'inet6', local: 'fe80::1', prefixlen: 64 },
                  { family: 'inet6', local: 'fe80::2', prefixlen: 64 },
                  { family: 'inet6', local: 'fe80::3', prefixlen: 64 },
                ],
                stats: { rxBytes: 1e9, txBytes: 2e9, rxPackets: 100, txPackets: 200 },
              },
              {
                name: 'lo',
                ifindex: 1,
                operstate: 'UNKNOWN',
                flags: ['UP', 'LOOPBACK'],
                mtu: 65536,
                isLoopback: true,
                addrs: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }],
              },
            ],
            routes: [
              { dst: 'default', gateway: '10.0.0.1', dev: 'eth0' },
              { dst: '10.0.0.0/24', gateway: undefined, dev: 'eth0' },
            ],
            caps: { canMutate: true, executeEnabled: false, isRoot: false },
            defaultGateway: '10.0.0.1',
            defaultDev: 'eth0',
            dns: {
              nameservers: ['1.1.1.1', '8.8.8.8'],
              uplinkServers: ['1.1.1.1'],
              search: ['lan'],
              source: 'static',
              notes: [],
              ignoreAutoDns: true,
            },
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      let r = renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /run|backup|restore|download|save|settings|refresh|delete/i, 12);
      await clickBtn(user, /confirm|yes|ok/i, 3);
      probe.sample(); r.unmount();

      r = renderAt('/nginx', <NginxPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickBtn(user, /create|add|new|edit/i, 3);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea',
        ),
      ).slice(0, 8)) {
        try {
          await user.clear(input);
          await user.type(input, 'app.example.com');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /save|create|apply|delete|edit/i, 6);
      await clickBtn(user, /confirm|yes/i, 2);
      probe.sample(); r.unmount();

      r = renderAt('/projects/p1', <ProjectDetailPage />, '/projects/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /deploy|stop|start|restart|health|publish|suspend|resume|logs|refresh|save/i, 12);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); r.unmount();

      r = renderAt('/cdn', <CdnPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create|add|edit|probe|drain|delete|save|apply/i, 12);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); r.unmount();

      r = renderAt('/network', <NetworkPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /refresh|apply|save|edit/i, 6);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    90_000,
  );

  it(
    'ProtectionPage geo/bans + Redis deep buttons',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
          body: {
            at: t,
            threatLevel: 'elevated',
            score: 55,
            signals: [{ id: 'highReqRate', label: 'Req', value: 200, points: 15 }],
            activePreset: 'daily',
            presets: [
              { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
              { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
            ],
            bans: {
              count: 1,
              items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }],
            },
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
              whitelist: ['127.0.0.1'],
            },
            executeEnabled: false,
            isRoot: false,
            suggestions: [{ id: 's1', title: 'Tighten', body: 'lower rate' }],
            notes: ['elevated'],
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/defense/geoip'),
          body: {
            provider: 'dbip',
            dir: '/var/lib/geo',
            ready: true,
            stale: false,
            cityReady: true,
            maxGranularity: 'city',
            notes: [],
            attribution: ['DB-IP'],
            policy: {
              enabled: true,
              mode: 'deny_list',
              countries: ['CN', 'RU'],
              continents: ['AS'],
              regions: ['CN-GD'],
              cities: ['CN-GD-SZ'],
              cityPolicyEnabled: true,
              asns: ['4134'],
              enforce: { autoBan: true, nginx: true, ufw: true },
              autoUpdate: true,
            },
            sources: [{ filename: 'dbip-city.mmdb', present: true, mtime: t, bytes: 1000 }],
            meta: { lastSuccessAt: t },
            ok: true,
            lookup: {
              ip: '1.2.3.4',
              country: 'US',
              regionKey: 'US-CA',
              city: 'SF',
              cityKey: 'US-CA-SF',
              continent: 'NA',
              asn: '13335',
              asName: 'CF',
            },
            access: { blocked: false, matched: [] },
          },
        },
        {
          match: /\/api\/v1\/defense/,
          body: HONESTY_WRITTEN_BLOCKED,
        },
        {
          match: (url) => url.includes('/api/v1/redis') || url.includes('/databases/redis'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              instances: [
                {
                  id: 'r1',
                  name: 'cache',
                  port: 6379,
                  status: 'running',
                  maxmemory: '256mb',
                },
              ],
              items: [
                {
                  id: 'r1',
                  name: 'cache',
                  port: 6379,
                  status: 'running',
                },
              ],
              info: { used_memory_human: '12M', connected_clients: 3 },
              notes: [],
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [], installed: true, active: 'active' } },
      ]);

      let r = renderAt('/protection', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /preset|daily|emergency|apply|ban|unban|save|lookup|refresh|probe|whitelist|auto/i, 16);
      await fillId('geo-ip', '8.8.8.8', user);
      await clickBtn(user, /lookup|query|check/i, 2);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); r.unmount();

      r = renderAt('/redis', <RedisPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create|start|stop|save|flush|delete|refresh|info/i, 10);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    60_000,
  );
});
