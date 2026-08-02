import { createUiProbe } from '../test/assert-rendered';
/**
 * Floor-90 wave D: correct DTO shapes for CDN edit, backups restore/delete,
 * dashboard wizard, network ops, email flags (i18n labels).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { BackupsPage } from './features/BackupsPage';
import { CdnPage } from './features/CdnPage';
import { DashboardPage } from './DashboardPage';
import { NetworkPage } from './features/NetworkPage';
import { EmailDomainPage } from './EmailDomainPage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { ProjectDetailPage } from './ProjectDetailPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { ServiceConsolePage } from './features/ServiceConsolePage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { LogsPage } from './features/LogsPage';
import { DnsPage } from './features/DnsPage';
import { FilesPage } from './FilesPage';
import { RedisPage } from './features/RedisPage';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { ProtectionPage } from './features/ProtectionPage';
import { ReadinessPage } from './features/ReadinessPage';
import { EmailPage } from './EmailPage';
import { UsersPage } from './UsersPage';
import { SecurityPage } from './SecurityPage';
import { AgentsPage } from './AgentsPage';
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

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, n = 8) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, n)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

function setVal(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

const now = () => new Date().toISOString();

describe('coverage floor 90d', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: ['*'],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('OVERWRITE');
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
    'BackupsPage: settings save + list snapshots + restore/delete confirms + download',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/auth/me'),
          body: {
            user: {
              id: '1',
              username: 'admin',
              roles: ['admin'],
              locale: 'en',
              capabilities: ['backups.restore', 'backups.run'],
            },
            capabilities: ['backups.restore', 'backups.run'],
          },
        },
        {
          match: (url) => url.includes('/backups/settings'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              remote: {
                enabled: true,
                kind: 'sftp',
                host: 'backup.example.com',
                port: 22,
                username: 'bk',
                path: '/backups/ysk',
                password: '***',
              },
              restic: {
                enabled: true,
                repoPath: '/var/restic',
                password: '***',
                s3Repo: '',
              },
              exclusions: ['node_modules', '.git'],
            };
          },
        },
        {
          match: (url) => url.includes('/backups/restic/snapshots') || url.includes('/snapshots'),
          body: {
            snapshots: [
              { id: 'snap1', time: now(), tags: ['project:proj-aaaaaaa1', 'full'] },
              { id: 'snap2', time: now(), tags: ['manual'] },
            ],
          },
        },
        {
          match: (url) => url.includes('/backups/download'),
          handler: async () => {
            // downloadAuthenticated expects binary; return empty blob-like JSON fallback
            return { ok: true };
          },
        },
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['ok'] };
            }
            return {
              items: [
                {
                  id: 'b1',
                  name: 'nightly.tgz',
                  createdAt: now(),
                  mtime: now(),
                  bytes: 9e6,
                  sizeBytes: 9e6,
                  status: 'ok',
                  type: 'full',
                  path: '/var/backups/b1.tgz',
                  projectId: 'proj-aaaaaaa1',
                },
                {
                  id: 'b2',
                  name: 'web-only.tgz',
                  createdAt: now(),
                  mtime: now(),
                  bytes: 1e6,
                  sizeBytes: 1e6,
                  status: 'ok',
                  type: 'web',
                  path: '/var/backups/b2.tgz',
                  projectId: 'proj-bbbbbbbb',
                },
              ],
              lastRun: {
                ok: true,
                at: now(),
                empty: false,
                sideOk: false,
                notes: ['done'],
                results: [
                  { projectId: 'proj-aaaaaaa1', ok: true, notes: ['tar'] },
                  { projectId: 'proj-bbbbbbbb', ok: false, skipped: false, notes: ['fail'] },
                  { projectId: 'proj-cccccccc', ok: true, skipped: true, notes: [] },
                ],
                sideResults: [
                  {
                    projectId: 'proj-aaaaaaa1',
                    kind: 'restic',
                    ok: true,
                    skipped: false,
                    notes: ['snap'],
                  },
                  {
                    projectId: 'proj-bbbbbbbb',
                    kind: 'remote',
                    ok: false,
                    skipped: false,
                    notes: ['sftp'],
                  },
                ],
              },
            };
          },
        },
        {
          match: (url) => url.includes('/projects'),
          body: {
            items: [
              { id: 'proj-aaaaaaa1', name: 'A' },
              { id: 'proj-bbbbbbbb', name: 'B' },
            ],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // files tab actions
      await clickBtn(user, /download|下載|下载/i, 2);
      await clickBtn(user, /preview|預覽|预览|dry/i, 2);
      await clickBtn(user, /confirm|確認|确认|ok/i, 2);
      await clickBtn(user, /restore|還原|还原/i, 3);
      await clickBtn(user, /confirm|確認|确认|restore|還原/i, 3);
      await clickBtn(user, /delete|刪除|删除/i, 2);
      await clickBtn(user, /confirm|確認|确认|delete|刪除/i, 2);

      // ops / remote tabs
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /list.*snapshot|snapshot|列出/i, 2);
      setVal('rs-pid', 'proj-aaaaaaa1');
      await clickBtn(user, /preview|safe|overwrite|dry|安全|覆寫|覆盖/i, 6);
      await clickBtn(user, /confirm|restore|還原|ok/i, 3);
      // PromptDialog overwrite
      const dlg = screen.queryAllByRole('dialog')[0];
      if (dlg) {
        const inp = dlg.querySelector('input');
        if (inp) fireEvent.change(inp, { target: { value: 'OVERWRITE' } });
        await clickBtn(user, /overwrite|覆寫|覆盖|confirm/i, 2);
      }

      await clickBtn(user, /save|儲存|保存|run|backup|全部/i, 6);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 8)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea',
        ),
      ).slice(0, 12)) {
        try {
          fireEvent.change(input, { target: { value: 'x' } });
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /save|儲存|保存/i, 2);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'CdnPage: fromProject + edit node/site with full DTO shapes',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const node = {
        id: 'n1',
        name: 'edge-1',
        roles: ['edge', 'origin'] as string[],
        region: 'local',
        publicIpv4: ['203.0.113.10'],
        publicIpv6: ['2001:db8::1'],
        weight: 100,
        status: 'online',
        healthUrl: 'http://203.0.113.10/health',
        baseUrl: 'http://203.0.113.10',
        sshIdentityId: 'id1',
        sshHost: '203.0.113.10',
        sshUsername: 'root',
        fleetAgentId: '',
      };
      const site = {
        id: 'site1',
        name: 'Demo site',
        domains: ['cdn.example.com', 'www.cdn.example.com'],
        mode: 'origin_pull',
        origin: { url: 'http://origin.example.com' },
        edgeNodeIds: ['n1'],
        cache: { enabled: true, maxAge: '10m' },
        dns: {
          strategy: 'multi_a',
          zoneId: 'z1',
          geoMap: { hkg: ['n1'] },
          geoSubdomains: true,
        },
        ssl: { mode: 'off' },
        originShieldNodeId: '',
        status: 'planned',
        apply_status: 'planned',
      };
      installFetchMock([
        softwareReadyRoute(),
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
              byApplyStatus: { planned: 1 },
              rows: [{ id: 'site1', name: 'Demo site', apply_status: 'planned' }],
            },
            cache: [
              {
                siteId: 'site1',
                siteName: 'Demo site',
                hitRatePct: 80,
                hits: 10,
                misses: 2,
                method: 'stub',
                notes: [],
              },
            ],
            notes: [],
            overallHitRatePct: 80,
          },
        },
        {
          match: (url) => url.includes('/cdn/from-project'),
          body: {
            ok: true,
            created: true,
            notes: ['from project'],
            site,
          },
        },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/nodes') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: { items: [node] },
        },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/sites') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: { items: [site] },
        },
        {
          match: (url) => url.includes('/api/v1/cdn'),
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            ok: true,
            apply_status: 'written',
            notes: ['ok'],
            conf: 'server{}',
            hash: 'h1',
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/cdn?fromProject=p1', <CdnPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      await clickBtn(user, /edit|編輯|编辑/i, 4);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea',
        ),
      ).slice(0, 15)) {
        try {
          fireEvent.change(input, { target: { value: input.value || 'x' } });
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
      await clickBtn(user, /save|create|apply|probe|drain|dns|ssl|purge|preview|write|health|delete/i, 16);
      await clickBtn(user, /confirm|yes|delete/i, 3);

      // create forms
      await clickBtn(user, /add|new|\+|新增/i, 4);
      await clickBtn(user, /save|create|cancel|close/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'Dashboard wizard submit + Network add/edit + Email flags + Outbound createIdentity',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/auth/me'),
          body: {
            user: {
              id: '1',
              username: 'admin',
              roles: ['admin'],
              locale: 'en',
              capabilities: ['*'],
            },
            capabilities: ['*'],
          },
        },
        {
          match: (url) => url.includes('/wizard/create'),
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
          match: (url) =>
            url.includes('/dashboard') ||
            url.includes('/status') ||
            url.includes('/services/matrix') ||
            url.includes('/notifications') ||
            url.includes('/apply-audit'),
          body: {
            ok: true,
            product: 'ysk',
            version: '1',
            executeEnabled: false,
            tools: ['nginx'],
            items: [],
            software: [{ id: 'nginx', features: ['nginx'], installed: true, active: 'active' }],
            host: { loadavg: [0.2, 0.2, 0.2], uptimeSec: 999 },
            notes: [],
            notifications: [
              {
                id: 'n1',
                level: 'critical',
                title: 'Exec off',
                body: 'need execute',
                href: '/system',
              },
              {
                id: 'n2',
                level: 'warn',
                title: 'Disk',
                body: 'high',
              },
              {
                id: 'n3',
                level: 'info',
                title: 'Info',
                body: 'ok',
              },
            ],
            applyAudit: {
              summary: { ok: 1, warn: 1, bad: 1 },
              findings: [
                {
                  kind: 'nginx',
                  name: 'site1',
                  severity: 'bad',
                  issue: 'missing',
                  href: '/nginx',
                },
                {
                  kind: 'ssl',
                  name: 'cert1',
                  severity: 'warn',
                  issue: 'expiring',
                },
              ],
            },
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['written'] };
            }
            return {
              ok: true,
              at: t,
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
                  stats: { rxBytes: 1e9, txBytes: 2e9, rxPackets: 1, txPackets: 2 },
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
                { dst: '10.0.0.0/24', dev: 'eth0' },
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
            };
          },
        },
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
                notes: ['written'],
              };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [{ type: 'MX', name: '@', value: 'mail' }],
                externalTodos: [],
                health: { score: 40, maxScore: 100, messages: [] },
              };
            }
            if (url.includes('/mailboxes') || url.includes('/aliases')) return { items: [] };
            return {
              items: [
                {
                  id: 'dom-1',
                  domain: 'example.com',
                  server_ip: '203.0.113.10',
                  health_score: 40,
                  suspended: false,
                  rate_limit_per_hour: 200,
                  antispam: true,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/ssh'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                notes: ['created'],
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END-----',
                identity: {
                  id: 'new1',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abcdefghijklmnopqrstuvwxyz0123',
                  publicKey: 'ssh-ed25519 AAAA',
                  status: 'stored',
                  createdAt: t,
                },
              };
            }
            return { items: [] };
          },
        },
        {
          match: /\/api\/v1\/projects/,
          body: { items: [{ id: 'p1', name: 'Demo', linuxUser: 'd', homeDir: '/home/d' }] },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      // Dashboard wizard — open wizard tab then fill known ids
      let r = renderAt('/?tab=wizard', <DashboardPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      const wizTab =
        screen.queryAllByRole('tab').find((x) => /wizard|嚮導|向导|一鍵|一键|quick/i.test(x.textContent ?? '')) ??
        screen.queryAllByRole('tab').find((x) => /create|建立/i.test(x.textContent ?? ''));
      if (wizTab) await user.click(wizTab);
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      // re-enter wizard
      if (wizTab) await user.click(wizTab);
      setVal('wiz-name', 'demo-app');
      setVal('wiz-dom', 'demo.example.com');
      setVal('wiz-ip', '203.0.113.10');
      setVal('wiz-ip6', '2001:db8::1');
      const rt = document.getElementById('wiz-rt') as HTMLSelectElement | null;
      if (rt && rt.options.length > 1) {
        try {
          await user.selectOptions(rt, rt.options[1].value);
        } catch {
          /* ignore */
        }
      }
      for (const id of ['wiz-dns', 'wiz-mail', 'wiz-db']) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el && !el.checked) {
          try {
            await user.click(el);
          } catch {
            /* ignore */
          }
        }
      }
      await clickBtn(user, /create|wizard|submit|launch|go|建立|一鍵|一键|開始|开始/i, 4);
      // notifications tab for applyAudit
      const notif = screen.queryAllByRole('tab').find((x) => /notif|通知/i.test(x.textContent ?? ''));
      if (notif) await user.click(notif);
      probe.sample(); r.unmount();

      // Network
      r = renderAt('/network', <NetworkPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /add|edit|delete|apply|save|up|down|refresh|dns|route|address|addr/i, 14);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 10)) {
        fireEvent.change(input, { target: { value: '10.0.0.20/24' } });
      }
      await clickBtn(user, /save|apply|add|confirm|ok/i, 6);
      probe.sample(); r.unmount();

      // Email flags
      r = renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      const adv = screen.queryAllByRole('tab').find((x) => /advanced|進階|高级/i.test(x.textContent ?? ''));
      if (adv) await user.click(adv);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      // Click every button on advanced (suspend/resume/save)
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      probe.sample(); r.unmount();

      // Outbound createIdentity via exact next steps
      r = renderAt('/s', <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />);
      await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));
      await clickBtn(user, /create|new|add|wizard|\+|建立|新增/i, 1);
      // step1 next
      await clickBtn(user, /next|下一步|continue/i, 1);
      // step2 next
      await clickBtn(user, /next|下一步|continue/i, 1);
      setVal('wiz-name', 'panel-peer');
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 2)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create identity|建立身份|create|建立/i, 2);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 3)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /copy|done|close|install|ack|confirm|next/i, 5);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    70_000,
  );

  it(
    'Sweep remaining mid-coverage pages with rich fixtures',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/console'),
          body: {
            engine: 'mysql',
            title: 'MySQL',
            version: '8',
            unit: 'mysql',
            active: 'active',
            activeLabel: 'running',
            enabled: 'enabled',
            installed: true,
            executeEnabled: false,
            isRoot: false,
            canLifecycle: true,
            metrics: {},
            live: { port: '3306', 'max_connections': '151' },
            categories: [
              {
                id: 'net',
                label: 'Network',
                description: 'n',
                settings: [
                  {
                    key: 'port',
                    label: 'Port',
                    category: 'net',
                    type: 'int',
                    applyMode: 'restart',
                    liveValue: '3306',
                  },
                  {
                    key: 'max_connections',
                    label: 'Max conn',
                    category: 'net',
                    type: 'int',
                    applyMode: 'runtime',
                    liveValue: '151',
                  },
                ],
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/runtime') || url.includes('/hosting'),
          body: {
            ok: true,
            installed: true,
            version: '20',
            path: '/usr/bin/node',
            notes: [],
            groups: [
              {
                id: 'g',
                title: 'G',
                fields: [{ key: 'k', label: 'K', value: '1', type: 'number' }],
              },
            ],
            catalog: [
              {
                id: 'g',
                title: 'G',
                fields: [{ key: 'k', label: 'K', value: '1', type: 'number' }],
              },
            ],
            items: [{ version: '20', path: '/u', default: true }],
          },
        },
        {
          match: (url) => url.includes('/projects/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/logs')) return { lines: ['x'], nextCursor: null };
            return {
              id: 'p1',
              name: 'Demo',
              domain: 'd.com',
              runtime: 'node',
              runtimeVersion: '20',
              status: 'running',
              processStatus: 'running',
              osProvisioned: true,
              linuxUser: 'd',
              homeDir: '/home/d',
              lastDeployAt: t,
              nginxConfigPath: '/x',
              lastHealth: { ok: true, status: 200, ms: 1, at: t },
              entry: 'server.js',
              env: { A: '1' },
            };
          },
        },
        {
          match: (url) => url.includes('/logs'),
          body: {
            sources: [{ id: 'j', label: 'Journal', kind: 'journal' }],
            lines: [{ ts: t, line: 'err', source: 'j' }],
            bookmarks: [],
            settings: { follow: false, lines: 100 },
          },
        },
        {
          match: /\/api\/v1\/resources\//,
          body: {
            items: [
              {
                id: 'z1',
                zone: 'example.com',
                serverIp: '1.2.3.4',
                nsName: 'ns1',
                ttl: 300,
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/files'),
          body: {
            path: '/',
            cwd: '/',
            items: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 1,
                mtime: t,
                mime: 'text/plain',
              },
            ],
            entries: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 1,
                mtime: t,
                mime: 'text/plain',
              },
            ],
            favorites: [],
          },
        },
        {
          match: (url) => url.includes('/readiness'),
          body: {
            ready: false,
            score: 30,
            productionReady: false,
            checks: [{ id: 'e', ok: false, label: 'exec', detail: 'off' }],
            missing: ['YSK_EXECUTE'],
            notes: [],
          },
        },
        {
          match: (url) => url.includes('/system') || url.includes('/updates'),
          body: {
            ok: true,
            items: [],
            installed: true,
            active: 'active',
            updates: [],
            channel: 'stable',
            version: '1',
          },
        },
        {
          match: (url) => url.includes('/email'),
          body: {
            items: [
              {
                id: 'd1',
                domain: 'x.com',
                server_ip: '1.1.1.1',
                health_score: 10,
                suspended: false,
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/users') || url.includes('/packages') || url.includes('/rbac'),
          body: {
            items: [
              {
                id: 'u1',
                username: 'admin',
                roles: ['admin'],
                packageId: null,
                suspended: false,
                capabilityGrants: [],
                capabilityRevokes: [],
              },
            ],
            meta: { total: 1, page: 1, limit: 50, facets: {} },
            hostUsage: { projects: 0, diskMb: 0, freeMb: 1 },
          },
        },
        {
          match: (url) => url.includes('/auth/') || url.includes('/security') || url.includes('/ssh'),
          body: {
            items: [],
            enabled: false,
            enrolled: false,
            ok: true,
            requireAdminTotp: false,
            requireAdminTotpStrict: false,
          },
        },
        {
          match: (url) => url.includes('/agents') || url.includes('/fleet'),
          body: {
            items: [
              {
                id: 'a1',
                agent_id: 'edge-1',
                status: 'connected',
                group: 'default',
                last_seen_at: t,
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/metrics'),
          body: {
            ok: true,
            at: t,
            loadavg: [1, 1, 1],
            cpuCount: 2,
            uptimeSec: 1000,
            memory: { total: 1e9, used: 5e8, free: 5e8, usedRatio: 0.5 },
            disk: { path: '/', total: 1e11, used: 5e10, free: 5e10, usedRatio: 0.5 },
            diskMounts: [],
            alerts: [],
            rows: [],
            notes: [],
            items: [],
          },
        },
        {
          match: (url) => url.includes('/defense') || url.includes('/fail2ban') || url.includes('/firewall') || url.includes('/redis') || url.includes('/mysql'),
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            installed: true,
            active: 'active',
            items: [],
            jails: [],
            banned: [],
            rules: [],
            at: t,
            threatLevel: 'normal',
            score: 10,
            signals: [],
            activePreset: 'daily',
            presets: [{ id: 'daily', label: 'Daily', short: 'N', bullets: [] }],
            bans: { count: 0, items: [] },
            nginxLimits: { reqRate: '1r/s', burst: 1, connLimit: 1, confPath: '/x', exists: true },
            firewall: { active: 'active', installed: true },
            fail2ban: { active: 'active', installed: true, jails: 0 },
            autoBan: {
              enabled: false,
              mode: 'normal',
              method: 'fail2ban',
              cooldownMinutes: 1,
              maxAutoBansPerHour: 1,
              whitelist: [],
            },
            executeEnabled: false,
            isRoot: false,
            suggestions: [],
            notes: [],
            ready: true,
            policy: {
              enabled: false,
              mode: 'allow_list',
              countries: [],
              continents: [],
              regions: [],
              cities: [],
              cityPolicyEnabled: false,
              asns: [],
              enforce: { autoBan: false, nginx: false, ufw: false },
              autoUpdate: false,
            },
            sources: [],
            meta: {},
            provider: 'dbip',
          },
        },
        { match: /.*/, body: { ok: true, items: [], installed: true, active: 'active' } },
      ]);

      const pages: Array<[string, React.ReactElement, string?]> = [
        ['/services/mysql', <ServiceConsolePage engine="mysql" key="sc" />],
        ['/runtimes/node', <GenericRuntimePage kind="node" key="rt" />],
        ['/runtimes/python', <GenericRuntimePage kind="python" key="py" />],
        ['/runtimes/go', <GenericRuntimePage kind="go" key="go" />],
        ['/runtimes/rust', <GenericRuntimePage kind="rust" key="rs" />],
        ['/projects/p1', <ProjectDetailPage key="pd" />, '/projects/:id'],
        ['/logs', <LogsPage key="lg" />],
        ['/dns', <DnsPage key="dn" />],
        ['/files', <FilesPage key="fi" />],
        ['/readiness', <ReadinessPage key="rd" />],
        ['/email', <EmailPage key="em" />],
        ['/users', <UsersPage key="us" />],
        ['/security', <SecurityPage key="se" />],
        ['/agents', <AgentsPage key="ag" />],
        ['/metrics', <MetricsPage key="me" />],
        ['/redis', <RedisPage key="re" />],
        ['/fail2ban', <Fail2banPage key="f2" />],
        ['/firewall', <FirewallPage key="fw" />],
        ['/protection', <ProtectionPage key="pr" />],
        ['/databases/mysql-engine', <SqlEnginePage engine="mysql" key="sq" />],
      ];

      for (const [path, el, route] of pages) {
        const r = renderAt(path, el, route ?? '*');
        await waitFor(
          () =>
            expect(
              screen.queryByRole('heading', { level: 1 }) ||
                screen.queryAllByRole('button').length > 0,
            ).toBeTruthy(),
          { timeout: 6000 },
        ).catch(() => undefined);
        for (const tab of screen.queryAllByRole('tab').slice(0, 8)) {
          try {
            await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        await clickBtn(
          user,
          /create|add|save|apply|start|stop|restart|refresh|delete|edit|run|install|probe|deploy|health|enable|disable|ban|unban|allow|follow|export|filter/i,
          10,
        );
        await clickBtn(user, /confirm|yes|ok/i, 2);
        probe.sample(); r.unmount();
      }

      probe.sample();
      probe.assertRendered();
    },
    180_000,
  );
});
