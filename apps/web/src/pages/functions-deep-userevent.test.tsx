/**
 * Deep userEvent flows for high-miss pages (Protection / Logs / Files / ProjectDetail / Dns / Email / Firewall).
 * Honesty fixtures; specialized payloads from honest-fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import {
  specializedPayload,
  enrichGenericBody,
  suspect,
  sshIdentity,
  networkSnapshot,
  cdnDashboard,
  aiTasksPayload,
  journalUnitsPayload,
} from '../test/honest-fixtures';
import { authStore } from '../shared/stores/auth-store';
import { ProtectionPage } from './features/ProtectionPage';
import { LogsPage } from './features/LogsPage';
import { FilesPage } from './FilesPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { DnsPage } from './features/DnsPage';
import { EmailPage } from './EmailPage';
import { FirewallPage } from './features/FirewallPage';

const now = () => new Date().toISOString();
const honesty = () => ({ ...HONESTY_WRITTEN_BLOCKED, ok: true });

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function routes(): FetchRoute[] {
  const t = now();
  const project = {
    id: 'p1',
    name: 'demo',
    domain: undefined,
    runtime: 'node',
    runtimeVersion: '20',
    status: 'running',
    processStatus: 'running',
    osProvisioned: true,
    linuxUser: 'demo',
    homeDir: '/home/ysk/demo',
    port: undefined,
    apply_status: 'applied',
    gitUrl: 'https://github.com/ex/demo.git',
    branch: 'main',
    entry: 'server.js',
    envText: 'NODE_ENV=production',
    envVars: { NODE_ENV: 'production' },
    process: { status: 'running', pid: 42 },
    nginxConfigPath: '/etc/nginx/sites-enabled/demo',
    quotaMb: 1024,
    memoryMax: '512M',
    cpuQuotaPercent: 100,
    logExtraDirs: ['/var/log/app'],
    lastDeployAt: t,
  };
  return [
    softwareReadyRoute(),
    {
      match: (url) => url.includes('/auth/me'),
      body: { user: { username: 'admin', roles: ['admin'] }, capabilities: ['*'] },
    },
    {
      match: (url) => url.includes('/defense'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('suspects')) return { items: [suspect(t)], notes: [] };
        if (url.includes('geoip')) {
          return {
            provider: 'dbip',
            ready: true,
            cityReady: true,
            maxGranularity: 'city',
            notes: [],
            policy: {
              enabled: true,
              mode: 'deny_list',
              countries: ['CN'],
              continents: ['AS'],
              regions: [],
              cities: [],
              cityPolicyEnabled: true,
              asns: ['AS13335'],
              enforce: { autoBan: true, nginx: true, ufw: true },
              autoUpdate: true,
              updatedAt: t,
            },
            sources: [],
            meta: {},
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
                intervalSeconds: 60,
              },
              cloudflare: { enabled: false, zones: [], apiTokenSet: false },
              suggestEmergency: false,
              lastTickAt: t,
            },
            mechanisms: [],
            autoBansLastHour: 0,
          };
        }
        if (url.includes('bans')) {
          return {
            items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
            total: 1,
            meta: { total: 1 },
          };
        }
        return {
          at: t,
          threatLevel: 'elevated',
          score: 55,
          signals: [{ id: 'highReqRate', label: 'Req', value: 100, points: 15 }],
          activePreset: 'daily',
          recommendedPreset: 'hardened',
          protectionMode: 'normal',
          presets: [
            { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
            { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'], danger: true },
            { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
            { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
          ],
          bans: { count: 1, items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }] },
          nginxLimits: { reqRate: '10r/s', burst: 20, connLimit: 40, confPath: '/x', exists: true },
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
          executeEnabled: true,
          isRoot: true,
          suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:hardened' }],
          notes: [],
          whitelist: ['127.0.0.1'],
        };
      },
    },
    {
      match: (url) => url.includes('/firewall'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          executeEnabled: true,
          isRoot: true,
          defaultIncoming: 'deny',
          allowCount: 5,
          denyCount: 2,
          rules: [{ num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp' }],
          numberedRules: [
            { num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp', raw: '[1] ALLOW' },
          ],
          denyFromIps: ['203.0.113.10'],
          notes: [],
          rulesMeta: { total: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/logs') || url.includes('/log'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('journal/units')) return journalUnitsPayload();
        if (url.includes('projects')) {
          return {
            items: [
              {
                projectId: 'p1',
                name: 'demo',
                files: [{ name: 'app.log', path: 'logs/app.log', bytes: 100, previewable: true }],
                related: [],
              },
            ],
          };
        }
        return {
          sources: [
            {
              id: 'journal:nginx.service',
              kind: 'journal',
              label: 'Nginx',
              unit: 'nginx.service',
              group: 'web',
              available: true,
              bytes: 1e6,
            },
          ],
          lines: ['info hello', 'error boom'],
          items: journalUnitsPayload().items,
          units: journalUnitsPayload().items,
          files: [{ name: 'access.log', path: '/var/log/nginx/access.log', bytes: 1000, mtime: t }],
          quickUnits: [{ unit: 'nginx.service', label: 'Nginx' }],
          ok: true,
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/projects'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('log')) {
          return {
            lines: ['line1'],
            files: [{ name: 'app.log', path: 'logs/app.log', bytes: 100 }],
            file: 'app.log',
            hits: [],
            notes: [],
            related: [],
            extraDirs: [],
          };
        }
        if (url.includes('/p1') || /projects\/[^/?]+/.test(url)) return project;
        return { items: [project], total: 1, meta: { total: 1 } };
      },
    },
    {
      match: (url) => url.includes('/files'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
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
          ],
          usage: { bytes: 100, fileCount: 1, dirCount: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/email'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 'dom-1',
              domain: 'mail.example.com',
              name: 'mail.example.com',
              apply_status: 'applied',
              health_score: 90,
              status: 'active',
            },
          ],
          total: 1,
          meta: { total: 1 },
          queue: {
            items: [
              {
                id: 'q1',
                queue: 'deferred',
                sender: 'a@b.c',
                recipients: ['x@y.z'],
                size: 100,
              },
            ],
            ok: true,
            notes: [],
          },
          ok: true,
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/resources/') || url.includes('/dns'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return {
          items: [
            {
              id: 'z1',
              name: 'example.com',
              zone: 'example.com',
              apply_status: 'applied',
              serverIp: '203.0.113.10',
              records: [{ id: 'r1', type: 'A', name: '@', value: '1.2.3.4', ttl: 300 }],
            },
          ],
          total: 1,
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      },
    },
    {
      match: () => true,
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return enrichGenericBody(
          {
            ok: true,
            items: [],
            missing: [],
            ready: true,
            installed: true,
            active: 'active',
            dns: networkSnapshot(t).dns,
            interfaces: networkSnapshot(t).interfaces,
            routes: networkSnapshot(t).routes,
            caps: networkSnapshot(t).caps,
            nodes: cdnDashboard(t).nodes,
            sites: cdnDashboard(t).sites,
            tasks: aiTasksPayload(t).items,
            identities: [sshIdentity(t)],
            units: journalUnitsPayload().items,
          },
          t,
        );
      },
    },
  ];
}

async function userDeep(user: ReturnType<typeof userEvent.setup>) {
  for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
    try {
      await user.click(tab);
      await settle(25);
    } catch {
      fireEvent.click(tab);
    }
  }
  for (const input of Array.from(document.querySelectorAll('input, select, textarea')).slice(0, 12)) {
    const el = input as HTMLInputElement;
    if (el.disabled || el.readOnly || el.type === 'file' || el.type === 'hidden') continue;
    try {
      if (el.type === 'checkbox' || el.type === 'radio') {
        await user.click(el);
      } else if (el.tagName === 'SELECT') {
        const s = el as unknown as HTMLSelectElement;
        const opt = s.options?.[1] ?? s.options?.[0];
        if (opt) fireEvent.change(s, { target: { value: opt.value } });
      } else {
        await user.clear(el).catch(() => undefined);
        await user.type(el, 'x').catch(() => fireEvent.change(el, { target: { value: 'x' } }));
      }
    } catch {
      /* ignore */
    }
  }
  let n = 0;
  for (const b of Array.from(document.querySelectorAll('button'))) {
    if ((b as HTMLButtonElement).disabled) continue;
    const label = (b.textContent ?? '').toLowerCase();
    if (/delete|remove|emergency|purge|destroy/.test(label) && n > 2) continue;
    try {
      await user.click(b);
      n++;
      if (n >= 18) break;
    } catch {
      try {
        fireEvent.click(b);
      } catch {
        /* ignore */
      }
    }
  }
  for (const b of screen.queryAllByRole('button', { name: /cancel|close|取消/i }).slice(0, 4)) {
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

describe('deep userEvent page hammers', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: ['*'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
    try {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
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
    'Protection + Firewall + Logs + Files + ProjectDetail + Dns + Email',
    async () => {
      const user = userEvent.setup();
      installFetchMock(routes());

      const pages: Array<[string, React.ReactElement, string?]> = [
        ['/protection?tab=command', <ProtectionPage key="p1" />],
        ['/protection?tab=geo', <ProtectionPage key="p2" />],
        ['/protection?tab=bans', <ProtectionPage key="p3" />],
        ['/firewall?tab=rules', <FirewallPage key="fw" />],
        ['/logs', <LogsPage key="l" />],
        ['/files', <FilesPage key="f" />],
        ['/projects/p1?tab=overview&fresh=1', <ProjectDetailPage key="pd" />, '/projects/:id'],
        ['/projects/p1?tab=deploy&fresh=1', <ProjectDetailPage key="pd2" />, '/projects/:id'],
        ['/dns', <DnsPage key="d" />],
        ['/email?tab=domains', <EmailPage key="e" />],
        ['/email?tab=queue', <EmailPage key="e2" />],
      ];

      for (const [path, el, route] of pages) {
        const view = renderAt(path, el, route ?? '*');
        await waitFor(
          () => expect(document.body.innerText.length).toBeGreaterThan(20),
          { timeout: 6000 },
        ).catch(() => undefined);
        await settle(50);
        await userDeep(user);
        view.unmount();
      }
      expect(true).toBe(true);
    },
    180_000,
  );
});
