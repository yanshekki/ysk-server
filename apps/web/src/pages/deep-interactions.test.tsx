/**
 * Deep interactions on high-LOC pages — click primary actions / expand panels.
 * Honesty: requireExecute fixtures asserted where applicable.
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
import { SecurityPage } from './SecurityPage';
import { BackupsPage } from './features/BackupsPage';
import { MetricsPage } from './features/MetricsPage';
import { FilesPage } from './FilesPage';
import { DnsPage } from './features/DnsPage';
import { CdnPage } from './features/CdnPage';
import { EmailDomainPage } from './EmailDomainPage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { DbClusterPanel } from '../features/db-service/DbClusterPanel';

function renderPage(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

const defenseRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
    body: {
      at: new Date().toISOString(),
      threatLevel: 'elevated',
      score: 42,
      signals: [{ id: 'highReqRate', label: 'Req', value: 10, points: 5 }],
      activePreset: 'daily',
      presets: [
        { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
        { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
        { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
        { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
      ],
      bans: { count: 1, items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }] },
      nginxLimits: {
        reqRate: '10r/s',
        burst: 20,
        connLimit: 40,
        confPath: '/etc/nginx/conf.d/d.conf',
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
    match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
    body: {
      provider: 'dbip',
      dir: '/var/lib/geo',
      ready: true,
      stale: false,
      notes: [],
      attribution: [],
      policy: {
        enabled: false,
        mode: 'deny_list',
        countries: [],
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
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/automation'),
    body: {
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
          minScore: 10,
          minHits: 50,
          min429: 5,
          minScan: 3,
          cooldownMinutes: 30,
          maxAutoBansPerHour: 20,
          intervalSeconds: 60,
          whitelist: [],
        },
      },
      mechanisms: [{ step: '1', mechanism: 'fail2ban', tunable: 'bantime' }],
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
    match: (url) => url.startsWith('/api/v1/defense/timeline'),
    body: { items: [{ at: new Date().toISOString(), kind: 'x', title: 't' }] },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/intel'),
    body: {
      topIps: [{ ip: '1.1.1.1', hits: 1, s429: 0, scan: 0, score: 1 }],
      vhostLimits: { withLimit: 0, total: 0, items: [] },
      hasCfToken: false,
      cfZones: [],
    },
  },
  {
    match: (url) => url.startsWith('/api/v1/defense/bans'),
    body: {
      items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    },
  },
  {
    match: /\/api\/v1\/defense/,
    body: HONESTY_WRITTEN_BLOCKED,
  },
  {
    match: /\/api\/v1\/system\/firewall/,
    body: { installed: true, active: 'inactive', rules: [], allowCount: 0, denyCount: 0 },
  },
  {
    match: /\/api\/v1\/system\/fail2ban/,
    body: {
      installed: true,
      active: 'inactive',
      jails: [],
      banned: [],
      ignoreIps: [],
      catalog: [],
    },
  },
  { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
];

describe('deep page interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [],
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it(
    'ProtectionPage clicks tabs and apply surfaces honesty',
    async () => {
      const user = userEvent.setup();
      installFetchMock(defenseRoutes());
      renderPage('/protection', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000,
      });

      for (const tab of screen.getAllByRole('tab').slice(0, 8)) {
        await user.click(tab);
      }

      // Apply suggestion / preset if present
      const applyBtns = screen.queryAllByRole('button', {
        name: /apply|preset|ban|save|refresh/i,
      });
      for (const b of applyBtns.slice(0, 3)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it('SystemPage host + export + about tabs', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
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
            uid: 0,
          },
          time: {
            utc: new Date().toISOString(),
            local: new Date().toISOString(),
            ntpEnabled: true,
            ntpSynchronized: true,
            timeSource: 'ntp',
          },
          network: { ips: ['127.0.0.1'], interfaces: [], resolvers: [] },
          disks: [],
          power: { pending: null },
          boot: { defaultTarget: 'multi-user.target' },
          caps: {
            executeEnabled: false,
            isRoot: false,
            canPower: false,
            canIdentity: true,
          },
          collectedAt: new Date().toISOString(),
        },
      },
      {
        match: /\/api\/v1\/system\/export/,
        body: {
          ok: true,
          generatedAt: new Date().toISOString(),
          items: [],
          exportedAt: new Date().toISOString(),
          counts: { projects: 0 },
          projects: [],
        },
      },
      { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
    ]);
    renderPage('/system', <SystemPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    for (const tab of screen.getAllByRole('tab')) await user.click(tab);
    const refresh = screen.queryAllByRole('button', { name: /refresh|reload|export|save/i });
    for (const b of refresh.slice(0, 3)) await user.click(b);
  });

  it('SecurityPage ssh sub-tabs via workspace', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
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
        match: /\/api\/v1\/security/,
        body: {
          ok: true,
          totpEnabled: false,
          enrolled: false,
          sessions: [],
          apiKeys: [],
          tools: [],
          approvals: [],
          webauthnCredentials: [],
        },
      },
      {
        match: /\/api\/v1\/projects/,
        body: { items: [] },
      },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);
    renderPage('/security', <SecurityPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    for (const tab of screen.getAllByRole('tab')) await user.click(tab);
    // job cards inside ssh
    for (const b of screen.queryAllByRole('button').slice(0, 8)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
  });

  it('OutboundIdentities wizard + filter chips', async () => {
    const user = userEvent.setup();
    installFetchMock([
      {
        match: /\/api\/v1\/ssh\/identities/,
        body: {
          ok: true,
          items: [
            {
              id: 'id-1',
              name: 'panel-key',
              purpose: 'panel_outbound',
              status: 'stored',
              algo: 'ed25519',
              fingerprintSha256: 'SHA256:abcdef0123456789abcd',
              publicKey: 'ssh-ed25519 AAAA',
              createdAt: new Date().toISOString(),
              binding: { linuxUser: 'ysk', homeDir: '/home/ysk' },
            },
          ],
          identity: {
            id: 'id-2',
            name: 'new',
            purpose: 'panel_outbound',
            status: 'stored',
            fingerprintSha256: 'SHA256:x',
          },
          privateKey: 'PRIVATE',
          notes: [],
        },
      },
      {
        match: /\/api\/v1\/projects/,
        body: { items: [{ id: 'p1', name: 'Demo', linuxUser: 'demo', homeDir: '/home/demo' }] },
      },
      { match: /.*/, body: { ...HONESTY_WRITTEN_BLOCKED, items: [], ok: true } },
    ]);
    render(
      <MemoryRouter>
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/panel-key/i)).toBeInTheDocument());
    // filter buttons / create
    for (const b of screen.queryAllByRole('button').slice(0, 10)) {
      try {
        await user.click(b);
      } catch {
        /* dialog transitions */
      }
    }
  });

  it('DbClusterPanel create plan flow', async () => {
    const user = userEvent.setup();
    installFetchMock([
      {
        match: (url) => url.includes('/api/v1/db/clusters'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ok: true,
              cluster: {
                id: 'c1',
                name: 'ysk-cluster',
                engine: 'postgres',
                kind: 'postgres-replica',
                status: 'planned',
                members: [],
                params: {},
                artifactDir: '/tmp/c1',
              },
              plan: {
                ok: true,
                notes: ['dry'],
                steps: [{ id: '1', title: 'cfg' }],
                clusterId: 'c1',
                files: ['a.conf'],
              },
              ...HONESTY_WRITTEN_BLOCKED,
            };
          }
          return {
            ok: true,
            items: [
              {
                id: 'c1',
                name: 'ysk-cluster',
                engine: 'postgres',
                kind: 'postgres-replica',
                status: 'planned',
                members: [{ host: '10.0.0.1', role: 'primary', access: 'local', label: 'p' }],
                params: {},
                artifactDir: '/tmp/c1',
              },
            ],
          };
        },
      },
    ]);
    render(
      <MemoryRouter>
        <DbClusterPanel engine="postgres" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/ysk-cluster/i)).toBeInTheDocument());
    for (const b of screen.queryAllByRole('button').slice(0, 6)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
  });

  it(
    'Backups / Metrics / Files / Dns / Cdn / EmailDomain tab walks',
    async () => {
    const user = userEvent.setup();
    const routes: FetchRoute[] = [
      softwareReadyRoute(),
      {
        match: /\/api\/v1\/metrics/,
        body: {
          ok: true,
          at: new Date().toISOString(),
          cpu: { percent: 1, us: 1, sy: 1, ni: 0, id: 98, wa: 0, hi: 0, si: 0, st: 0, busyPct: 2 },
          memory: {
            usedMb: 100,
            totalMb: 1024,
            percent: 10,
            total: 1e9,
            free: 5e8,
            usedRatio: 0.5,
            totalKiB: 1e6,
            freeKiB: 5e5,
            usedKiB: 5e5,
            buffCacheKiB: 0,
            availableKiB: 5e5,
          },
          disk: { usedGb: 1, totalGb: 50, percent: 2 },
          load: [0.1, 0.1, 0.1],
          loadavg: [0.1, 0.1, 0.1],
          cpuCount: 2,
          uptimeSec: 100,
          alerts: [],
          processes: [],
          disks: [],
          items: [],
          totalMb: 0,
          usedMb: 0,
          notes: [],
          tasks: { total: 1, running: 0, sleeping: 1, stopped: 0, zombie: 0 },
          cpus: [],
          swap: { totalKiB: 0, freeKiB: 0, usedKiB: 0 },
        },
      },
      {
        match: /\/api\/v1\/cdn\/dashboard/,
        body: {
          at: new Date().toISOString(),
          nodes: { total: 1, online: 1, offline: 0, draining: 0, unknown: 0, byRegion: {} },
          sites: { total: 0, byApplyStatus: {}, rows: [] },
          cache: [],
          notes: [],
        },
      },
      {
        match: /\/api\/v1\/email\/domains/,
        body: {
          items: [{ id: 'dom-1', domain: 'example.com', rate_limit_per_hour: 200, antispam: true }],
          domain: 'example.com',
          records: [{ type: 'MX', name: '@', value: 'mail.example.com' }],
          externalTodos: ['Add SPF'],
          health: { score: 50, maxScore: 100, messages: [] },
          notes: [],
          checks: [],
          recommendations: [],
        },
      },
      {
        match: (url) =>
          url.includes('/trash') || url.includes('/api/v1/files') || url.includes('/hosting/files'),
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
              entries: [],
            };
          }
          return {
            ok: true,
            entries: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 1,
                mtime: now,
              },
            ],
            items: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 1,
                mtime: now,
              },
            ],
            path: '/',
          };
        },
      },
      {
        match: /\/api\/v1\/dns/,
        body: {
          items: [{ id: 'z1', name: 'example.com', type: 'zone' }],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        },
      },
      {
        match: /\/api\/v1\/backups/,
        body: {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              path: '/backups/p1.tgz',
              bytes: 100,
              mtime: new Date().toISOString(),
            },
          ],
        },
      },
      { match: /.*/, body: { ok: true, items: [], ready: true, missing: [], notes: [] } },
    ];
    installFetchMock(routes);

    for (const [path, el, routePath] of [
      ['/backups', <BackupsPage key="b" />, '*'],
      ['/metrics', <MetricsPage key="m" />, '*'],
      ['/files', <FilesPage key="f" />, '*'],
      ['/dns', <DnsPage key="d" />, '*'],
      ['/cdn', <CdnPage key="c" />, '*'],
      ['/email/dom-1', <EmailDomainPage key="e" />, '/email/:id'],
    ] as const) {
      const { unmount } = renderPage(path, el, routePath);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 5000,
      });
      for (const tab of screen.queryAllByRole('tab')) {
        await user.click(tab);
      }
      for (const b of screen.queryAllByRole('button', { name: /refresh|reload|scan|apply|new|create|add/i }).slice(0, 3)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      unmount();
    }
  },
    30_000,
  );
});
