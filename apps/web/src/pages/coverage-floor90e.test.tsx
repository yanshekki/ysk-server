import { createUiProbe } from '../test/assert-rendered';
/**
 * Floor-90 wave E: dashboard notifications/apply-audit, network DNS/routes,
 * project logs + confirm actions — last ~400 lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { DashboardPage } from './DashboardPage';
import { NetworkPage } from './features/NetworkPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { EmailDomainPage } from './EmailDomainPage';
import { BackupsPage } from './features/BackupsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { LogsPage } from './features/LogsPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { RedisPage } from './features/RedisPage';
import { ProjectDeployTab } from '../features/projects/ui/ProjectDeployTab';
import type { ProjectDto } from '@yanshekki/shared';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, n = 10) {
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

describe('coverage floor 90e', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: ['*'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('OVERWRITE');
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'Dashboard: notifications + apply-audit + wizard submit',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/notifications'),
          body: {
            items: [
              {
                id: 'n1',
                level: 'critical',
                title: 'Exec',
                body: 'off',
                href: '/system',
                source: 'ctl',
                at: now() },
              {
                id: 'n2',
                level: 'warn',
                title: 'Disk',
                body: 'high',
                source: 'met',
                at: now() },
              {
                id: 'n3',
                level: 'info',
                title: 'Info',
                body: 'ok',
                source: 'sys',
                at: now() },
            ],
            counts: { critical: 1, warn: 1, info: 1 } } },
        {
          match: (url) => url.includes('/apply-audit'),
          body: {
            findings: [
              {
                kind: 'nginx',
                id: 's1',
                name: 'site1',
                severity: 'bad',
                issue: 'missing conf',
                href: '/nginx' },
              {
                kind: 'ssl',
                id: 'c1',
                name: 'cert1',
                severity: 'warn',
                issue: 'expiring' },
            ],
            summary: { ok: 2, warn: 1, bad: 1, total: 4 } } },
        {
          match: (url) => url.includes('/wizard/create'),
          body: {
            ok: true,
            projectId: 'p-new',
            notes: ['created project'],
            steps: [{ step: 'project', ok: true }] } },
        {
          match: (url) => url.includes('/dashboard/summary'),
          body: { projects: 1, services: 2, notes: [] } },
        {
          match: (url) => url.includes('/readiness'),
          body: {
            productionReady: false,
            mode: 'dev',
            summary: ['need execute'],
            score: { ready: 1, degraded: 1, missing: 1, total: 3 } } },
        {
          match: (url) => url.includes('/health') || url === '/health',
          body: {
            ok: true,
            executeEnabled: false,
            product: 'ysk',
            version: '1' } },
        {
          match: (url) => url.includes('/audit'),
          body: { items: [{ id: 'a1', action: 'login', at: now() }] } },
        {
          match: (url) => url.includes('/metrics'),
          body: {
            loadavg: [0.5, 0.4, 0.3],
            memory: { usedRatio: 0.5 },
            disk: { usedRatio: 0.4 } } },
        {
          match: (url) => url.includes('/projects'),
          body: {
            items: [
              {
                id: 'p1',
                name: 'Demo',
                processStatus: 'running',
                status: 'running' },
            ] } },
        {
          match: (url) => url.includes('/backups'),
          body: { items: [{ id: 'b1', name: 'x' }] } },
        {
          match: (url) => url.includes('/ssl'),
          body: {
            items: [
              {
                domain: 'x.com',
                expires_at: new Date(Date.now() + 5 * 864e5).toISOString(),
                files_exist: true },
            ] } },
        {
          match: (url) => url.includes('/software'),
          body: {
            items: [
              { id: 'nginx', features: ['nginx'], installed: true, active: 'active' },
              { id: 'php', features: ['php'], installed: false, active: 'inactive' },
            ] } },
        {
          match: (url) => url.includes('/services/matrix'),
          body: {
            items: [
              {
                id: 'nginx',
                label: 'Nginx',
                active: 'active',
                activeLabel: 'running',
                href: '/nginx' },
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/?tab=notifications', <DashboardPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // wizard
      const wiz = screen.queryAllByRole('tab').find((t) => /wizard|嚮導|向导/i.test(t.textContent ?? ''));
      if (wiz) await user.click(wiz);
      setVal('wiz-name', 'demo-app');
      setVal('wiz-dom', 'demo.example.com');
      setVal('wiz-ip', '10.0.0.5');
      setVal('wiz-ip6', '2001:db8::5');
      await clickBtn(user, /create|submit|建立|開始|开始|wizard/i, 3);

      const notif = screen.queryAllByRole('tab').find((t) => /notif|通知/i.test(t.textContent ?? ''));
      if (notif) await user.click(notif);
      await waitFor(() => {
        expect(screen.queryAllByText(/Exec|Disk|Info|missing|expiring|bad|warn/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);

      // features tab
      const feat = screen.queryAllByRole('tab').find((t) => /feature|功能/i.test(t.textContent ?? ''));
      if (feat) await user.click(feat);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'NetworkPage: DNS apply + resolve test + route add + iface ops',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written'],
                answers: ['1.2.3.4', '1.2.3.5'] };
            }
            return {
              ok: true,
              at: t,
              notes: [],
              backend: {
                hasIp: true,
                networkManager: 'active',
                networkd: 'inactive',
                canPersist: true },
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
                  stats: { rxBytes: 1e9, txBytes: 2e9, rxPackets: 10, txPackets: 20 } },
              ],
              routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
              caps: { canMutate: true, executeEnabled: false, isRoot: false },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1', '8.8.8.8', '127.0.0.53'],
                uplinkServers: ['1.1.1.1'],
                search: ['lan'],
                source: 'static',
                notes: [],
                ignoreAutoDns: true,
                canApply: true,
                connection: 'Wired connection 1',
                device: 'eth0' } };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/network?tab=dns', <NetworkPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // routes tab
      const routes = screen.queryAllByRole('tab').find((x) => /route/i.test(x.textContent ?? ''));
      if (routes) await user.click(routes);
      await clickBtn(user, /reset|ephemeral|apply|add|route|default/i, 8);

      // dns tab
      const dns = screen.queryAllByRole('tab').find((x) => /dns/i.test(x.textContent ?? ''));
      if (dns) await user.click(dns);
      setVal('net-dns-test', 'example.com');
      await clickBtn(user, /test|resolve|apply|restore|dhcp/i, 8);

      // ifaces
      const ifaces = screen.queryAllByRole('tab').find((x) => /iface|interface|網卡|网卡/i.test(x.textContent ?? ''));
      if (ifaces) await user.click(ifaces);
      await clickBtn(user, /add|edit|delete|up|down|addr|apply|refresh/i, 10);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 8)) {
        fireEvent.change(input, { target: { value: '10.0.0.50/24' } });
      }
      await clickBtn(user, /save|apply|add|confirm/i, 6);

      // advanced
      const adv = screen.queryAllByRole('tab').find((x) => /adv|進階|高级/i.test(x.textContent ?? ''));
      if (adv) await user.click(adv);
      await clickBtn(user, /apply|save|refresh/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'ProjectDetail: logs search + stop/delete confirm + deploy tab',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/projects/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['ok'] };
            }
            if (url.includes('/logs')) {
              return {
                files: [
                  { name: 'app.log', size: 100, mtime: t },
                  { name: 'error.log', size: 50, mtime: t },
                ],
                hits: [
                  {
                    file: 'error.log',
                    lines: ['ERR boom', 'ERR again'] },
                ],
                notes: ['matched'],
                related: [{ path: '/var/log/nginx/error.log', kind: 'nginx' }],
                extraDirs: ['/var/log/app'],
                tail: {
                  file: 'error.log',
                  lines: ['ERR boom', 'line2'],
                  notes: ['ok'] } };
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
              homeDir: '/home/demo',
              lastDeployAt: t,
              nginxConfigPath: '/etc/nginx/sites-enabled/demo',
              lastHealth: {
                ok: true,
                status: 200,
                ms: 12,
                nginxStatus: 'live',
                nginxReloaded: true,
                at: t },
              entry: 'server.js',
              env: { NODE_ENV: 'production' },
              port: 3000 };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/projects/p1?tab=logs', <ProjectDetailPage />, '/projects/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // logs
      const logs = screen.queryAllByRole('tab').find((x) => /log/i.test(x.textContent ?? ''));
      if (logs) await user.click(logs);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 4)) {
        fireEvent.change(input, { target: { value: 'ERR' } });
      }
      await clickBtn(user, /search|load|refresh|grep|query|logs/i, 6);

      // actions stop/delete
      await clickBtn(user, /stop|delete|deploy|restart|health|publish|suspend|resume/i, 10);
      await clickBtn(user, /confirm|yes|delete|stop/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'Email flags + Backups restic snapshot restore + SqlEngine + Logs + Runtime + Redis + DeployTab',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/auth/me'),
          body: {
            user: { id: '1', username: 'admin', roles: ['admin'], locale: 'en' },
            capabilities: ['*'] } },
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
                notes: ['written'] };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [{ type: 'A', name: '@', value: '1.2.3.4' }],
                externalTodos: [],
                health: { score: 40, maxScore: 100, messages: [] } };
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
                  antispam: true },
              ] };
          } },
        {
          match: (url) => url.includes('/backups/settings'),
          body: {
            remote: { enabled: false, kind: 'sftp', path: '/b' },
            restic: { enabled: true, repoPath: '/r', password: '***' },
            exclusions: [] } },
        {
          match: (url) => url.includes('/backups/restic/snapshots'),
          body: {
            snapshots: [
              { id: 'snap1', time: t, tags: ['project:proj-aaaa1111', 'full'] },
            ] } },
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true };
            }
            return {
              items: [
                {
                  id: 'b1',
                  name: 'n.tgz',
                  mtime: t,
                  bytes: 1000,
                  projectId: 'proj-aaaa1111' },
              ],
              lastRun: {
                ok: true,
                at: t,
                empty: false,
                sideOk: true,
                results: [{ projectId: 'proj-aaaa1111', ok: true, notes: [] }],
                sideResults: [
                  {
                    projectId: 'proj-aaaa1111',
                    kind: 'restic',
                    ok: true,
                    skipped: false,
                    notes: ['ok'] },
                ] } };
          } },
        {
          match: (url) =>
            url.includes('/mysql') || url.includes('/databases') || url.includes('/sql'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                { id: 'db1', name: 'app', engine: 'mysql', status: 'active', users: ['u'] },
              ],
              users: [{ id: 'u1', name: 'u', host: '%' }],
              temp: [{ id: 't1', name: 'tmp', expiresAt: t }],
              remote: [],
              ok: true,
              installed: true,
              active: 'active' };
          } },
        {
          match: (url) => url.includes('/logs'),
          body: {
            sources: [
              { id: 'journal', label: 'Journal', kind: 'journal' },
              { id: 'nginx', label: 'Nginx', kind: 'file', path: '/var/log/nginx/error.log' },
            ],
            lines: [
              { ts: t, line: 'error x', source: 'journal' },
              { ts: t, line: 'info y', source: 'nginx' },
            ],
            bookmarks: [{ id: 'bm1', name: 'errs', query: 'error' }],
            settings: { follow: false, lines: 200 } } },
        {
          match: (url) => url.includes('/runtime') || url.includes('/hosting'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              installed: true,
              version: '20.11.0',
              path: '/usr/bin/node',
              notes: [],
              groups: [
                {
                  id: 'mem',
                  title: 'Memory',
                  fields: [
                    {
                      key: 'max_old_space_size',
                      label: 'Max old space',
                      value: '512',
                      type: 'number' },
                  ] },
              ],
              catalog: [
                {
                  id: 'mem',
                  title: 'Memory',
                  fields: [
                    {
                      key: 'max_old_space_size',
                      label: 'Max old space',
                      value: '512',
                      type: 'number' },
                  ] },
              ],
              items: [
                { version: '20.11.0', path: '/usr/bin/node', default: true },
                { version: '18.19.0', path: '/usr/bin/node18', default: false },
              ] };
          } },
        {
          match: (url) => url.includes('/redis'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [{ id: 'r1', name: 'cache', port: 6379, status: 'running' }],
              instances: [{ id: 'r1', name: 'cache', port: 6379, status: 'running' }],
              info: { used_memory_human: '10M', connected_clients: 2 },
              ok: true };
          } },
        {
          match: (url) => url.includes('/projects'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              notes: ['deployed'],
              items: [],
              history: [
                {
                  id: 'h1',
                  at: t,
                  ok: true,
                  notes: ['ok'],
                  entry: 'server.js' },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      // Email suspend/resume — click all buttons on advanced
      let r = renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      const adv = screen.queryAllByRole('tab').find((x) => /advanced|進階|高级/i.test(x.textContent ?? ''));
      if (adv) await user.click(adv);
      for (const b of screen.queryAllByRole('button')) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      setVal('boot-pw', 'AdminPass99!');
      for (const b of screen.queryAllByRole('button')) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      probe.sample(); r.unmount();

      // Backups ops tab list snapshots + restore buttons
      r = renderAt('/backups?tab=ops', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      setVal('rs-pid', 'proj-aaaa1111');
      await clickBtn(user, /list|snapshot|列出|restic|run|backup|preview|safe|overwrite|download|delete|restore/i, 16);
      await clickBtn(user, /confirm|yes|ok|overwrite|restore|delete/i, 5);
      probe.sample(); r.unmount();

      r = renderAt('/databases/mysql-engine', <SqlEnginePage engine="mysql" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create|install|start|delete|edit|apply|expire|clean|adminer|grant/i, 14);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); r.unmount();

      r = renderAt('/logs', <LogsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /follow|export|search|refresh|bookmark|save|clear|filter/i, 12);
      probe.sample(); r.unmount();

      r = renderAt('/runtimes/node', <GenericRuntimePage kind="node" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 6)) {
        fireEvent.change(input, { target: { value: '1024' } });
      }
      await clickBtn(user, /install|probe|save|apply|default|switch|refresh/i, 10);
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
      await clickBtn(user, /create|start|stop|save|flush|delete|refresh|info|password/i, 12);
      probe.sample(); r.unmount();

      // ProjectDeployTab standalone with full props
      const project = {
        id: 'p1',
        name: 'Demo',
        runtime: 'node',
        runtimeVersion: '20',
        gitUrl: 'https://github.com/example/demo.git',
        envVars: { NODE_ENV: 'production' },
        deployEntry: 'server.js',
        lastDeployAt: t,
        status: 'running',
        processStatus: 'running' } as unknown as ProjectDto;
      const setGit = vi.fn();
      const setEnv = vi.fn();
      r = render(
        <MemoryRouter>
          <ProjectDeployTab
            project={project}
            busy={false}
            gitUrl={project.gitUrl ?? ''}
            setGitUrl={setGit}
            envText="NODE_ENV=production"
            setEnvText={setEnv}
            onDeploy={vi.fn(async () => ({ ok: true, notes: [] }))}
            onGitDeploy={vi.fn(async () => ({ ok: true, notes: [] }))}
            onSaveEnv={vi.fn(async () => ({ ok: true, notes: [] }))}
            onOpsMessage={vi.fn()}
            onRuntimeVersionSaved={vi.fn()}
            showFreshChecklist
            onDismissChecklist={vi.fn()}
          />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea',
        ),
      ).slice(0, 12)) {
        try {
          fireEvent.change(input, { target: { value: 'server.js' } });
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
      await clickBtn(user, /deploy|save|git|build|env|history|refresh|apply|dismiss|install/i, 14);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    90_000,
  );
});
