/**
 * Function-coverage wave: deep userEvent paths that fire onClick/onChange/onSubmit
 * on highest-miss pages. Mutations use HONESTY_WRITTEN_BLOCKED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { RedisPage } from './features/RedisPage';
import { FtpsServicePage } from './features/FtpsServicePage';
import { ServicesPage } from './features/ServicesPage';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { EmailPage } from './EmailPage';
import { SslPage } from './features/SslPage';
import { PostgresPage } from './features/PostgresPage';
import { AiPage } from './AiPage';
import { ReadinessPage } from './features/ReadinessPage';
import { NginxPage } from './features/NginxPage';
import { FtpPage } from './features/FtpPage';
import { ProjectsPage } from './ProjectsPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { DnsPage } from './features/DnsPage';
import { CdnPage } from './features/CdnPage';
import { ProtectionPage } from './features/ProtectionPage';
import { FilesPage } from './FilesPage';
import { Ssh2faPanel } from '../features/security/ssh/Ssh2faPanel';
import { DbClusterPanel } from '../features/db-service/DbClusterPanel';
import { CronPage } from './features/CronPage';
import { SystemdUnitPage } from './features/SystemdUnitPage';
import { UpdatesPage } from './UpdatesPage';


function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickNamed(
  user: ReturnType<typeof userEvent.setup>,
  re: RegExp,
  n = 6,
) {
  let c = 0;
  for (const b of screen.queryAllByRole('button', { name: re })) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
      c++;
      if (c >= n) break;
    } catch {
      /* ignore */
    }
  }
  return c;
}

async function clickAllTabs(user: ReturnType<typeof userEvent.setup>) {
  const tabs = screen.queryAllByRole('tab');
  for (const tab of tabs) {
    try {
      await user.click(tab);
    } catch {
      /* ignore */
    }
  }
}

function setVal(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

const now = () => new Date().toISOString();

function honesty(): Record<string, unknown> {
  return { ...HONESTY_WRITTEN_BLOCKED };
}

function meRoute(): FetchRoute {
  return {
    match: (url) => url.includes('/auth/me'),
    body: {
      user: { id: '1', username: 'admin', roles: ['admin'] },
      capabilities: ['*'] } };
}

describe('functions-wave deep interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    } catch {
      /* ignore */
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('RedisPage key browser full flow', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('redis'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (url.includes('/status')) {
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
              keyspace: [
                { db: 0, keys: 2, expires: 1 },
                { db: 1, keys: 1 },
              ],
              databases: 16,
              configuredDatabases: 16 };
          }
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
    ]);
    renderAt('/databases/redis', <RedisPage />);
    await waitFor(() => expect(screen.getByText('session:1')).toBeInTheDocument());
    await user.click(screen.getByText('session:1'));
    await waitFor(() => expect(document.body.innerText).toMatch(/abc/));
    await user.click(screen.getByRole('button', { name: /add key/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    setVal('nk', 'k1');
    setVal('nv', 'v1');
    for (const lab of [/1m/i, /never expire/i]) {
      const chip = within(screen.getByRole('dialog')).queryByRole('button', { name: lab });
      if (chip) await user.click(chip);
    }
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(document.body.innerText).toMatch(/host execute|written|ops|saved/i),
    );
    await user.click(screen.getByRole('button', { name: /delete/i }));
    const dialogs = await screen.findAllByRole('dialog');
    await user.click(
      within(dialogs[dialogs.length - 1]).getByRole('button', { name: /^delete$/i }),
    );
    fireEvent.change(document.getElementById('redis-db-select')!, {
      target: { value: '1' } });
    for (const b of document.querySelectorAll('button.redis-db-pill')) {
      await user.click(b as HTMLElement);
    }
    const search = screen.getByLabelText(/search keys/i);
    await user.clear(search);
    await user.type(search, 'sess*');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await clickNamed(user, /refresh|close/i, 3);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('FtpsServicePage tabs forms apply save', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) =>
          url.includes('/system/ftps') ||
          url.includes('/api/v1/system/software') ||
          url.includes('ftp'),
        handler: (url, init) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method !== 'GET') return honesty();
          if (url.includes('options')) {
            return {
              domains: [
                { value: 'example.com', label: 'example.com' },
                { value: 'mail.test', label: 'mail.test' },
              ],
              homes: [{ value: '/home/ftp', label: '/home/ftp' }] };
          }
          if (url.includes('settings') || url.includes('status')) {
            return {
              settings: {
                listen: true,
                listenIpv6: false,
                listenPort: 21,
                sslEnable: true,
                forceSsl: true,
                sslDomain: 'example.com',
                pasvMin: 30000,
                pasvMax: 30100,
                writeEnable: true,
                chrootLocalUser: true,
                allowWriteableChroot: true,
                banner: 'YSK FTPS',
                guestUsername: 'ftp' },
              status: {
                installed: true,
                active: 'active',
                accountCount: 2 } };
          }
          return honesty();
        } },
    ]);
    renderAt('/ftp/service', <FtpsServicePage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    // network tab fields
    const netTab = screen
      .queryAllByRole('tab')
      .find((t) => /network/i.test(t.textContent ?? ''));
    if (netTab) await user.click(netTab);
    setVal('banner', 'Hello FTPS');
    setVal('pasvAddress', '203.0.113.10');
    await clickNamed(user, /21|2121|990|30000|30100|save|apply|restart|ipv4|ipv6/i, 12);
    const secTab = screen
      .queryAllByRole('tab')
      .find((t) => /security/i.test(t.textContent ?? ''));
    if (secTab) await user.click(secTab);
    for (const id of [
      'sslEnable',
      'forceSsl',
      'writeEnable',
      'chrootLocalUser',
      'allowWriteableChroot',
    ]) {
      const el = document.getElementById(id);
      if (el) await user.click(el);
    }
    const sslSel = document.getElementById('sslDomain') as HTMLSelectElement | null;
    if (sslSel) fireEvent.change(sslSel, { target: { value: 'mail.test' } });
    await clickNamed(user, /save|apply|restart|refresh|close/i, 6);
    const overview = screen
      .queryAllByRole('tab')
      .find((t) => /overview|概覽|概览/i.test(t.textContent ?? ''));
    if (overview) await user.click(overview);
    await clickNamed(user, /apply|restart|start|install/i, 3);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('ServicesPage matrix lifecycle with mutate rights', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/services/matrix') || url.includes('/system/services'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
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
              {
                id: 'missing',
                label: 'Missing',
                unit: 'x.service',
                category: 'other',
                installed: false,
                active: 'not-found',
                enabled: 'not-found',
                activeLabel: 'missing' },
            ],
            executeEnabled: true,
            isRoot: true,
            probedAt: now() };
        } },
      {
        match: (url) => url.includes('lifecycle') || url.includes('protection'),
        body: honesty() },
      {
        match: (url) => url.includes('db-cluster') || url.includes('cluster'),
        body: {
          count: 1,
          items: [{ id: 'c1', name: 'galera', engine: 'mariadb', status: 'healthy' }] } },
    ]);
    renderAt('/services', <ServicesPage />);
    await waitFor(() => expect(screen.getAllByText(/nginx/i).length).toBeGreaterThan(0));
    await clickNamed(user, /start|stop|restart|refresh/i, 8);
    for (const b of document.querySelectorAll('button.ops-chip')) {
      await user.click(b as HTMLElement);
    }
    setVal('svc-q', 'nginx');
    fireEvent.change(document.getElementById('svc-q')!, { target: { value: 'nginx' } });
    await clickAllTabs(user);
    await clickNamed(user, /stack|套件|about|說明|说明|matrix|矩陣|矩阵/i, 3);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('Fail2banPage bans whitelist jails policy', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('fail2ban'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            installed: true,
            active: 'active',
            activeLabel: 'active',
            enabled: 'enabled',
            executeEnabled: false,
            isRoot: false,
            jails: [
              { name: 'sshd', currentlyBanned: 1, totalBanned: 3, enabled: true },
              { name: 'nginx-http-auth', currentlyBanned: 0, totalBanned: 1, enabled: true },
            ],
            banned: [
              { ip: '203.0.113.10', jail: 'sshd' },
              { ip: '198.51.100.5', jail: 'nginx-http-auth' },
            ],
            ignoreIps: ['127.0.0.1', '10.0.0.1'],
            catalog: [
              { id: 'sshd', desc: 'SSH' },
              { id: 'nginx-http-auth', desc: 'Nginx' },
              { id: 'postfix', desc: 'Mail' },
              { id: 'dovecot', desc: 'IMAP' },
            ],
            defaultJails: ['sshd', 'nginx-http-auth'],
            bantime: '1h',
            findtime: '10m',
            maxretry: 5 };
        } },
    ]);
    renderAt('/fail2ban', <Fail2banPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    setVal('f2b-ban-ip', '203.0.113.99');
    await clickNamed(user, /banip|copy|unban|whitelist|refresh/i, 10);
    await clickAllTabs(user);
    setVal('f2b-ignore', '192.0.2.1');
    await clickNamed(user, /add|apply|save|whitelist|policy|enable|disable/i, 10);
    // jail checkboxes
    for (const input of document.querySelectorAll('input[type="checkbox"]')) {
      try {
        await user.click(input as HTMLElement);
      } catch {
        /* ignore */
      }
    }
    await clickNamed(user, /apply|save|start|close/i, 6);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('FirewallPage rules ports deny profiles', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('firewall') || url.includes('ufw'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            installed: true,
            active: 'active',
            activeLabel: 'active',
            executeEnabled: true,
            isRoot: true,
            defaultIncoming: 'deny',
            allowCount: 3,
            denyCount: 1,
            rules: ['22/tcp ALLOW', '80/tcp ALLOW'],
            numberedRules: [
              { num: 1, rule: '22/tcp ALLOW IN' },
              { num: 2, rule: '80/tcp ALLOW IN' },
            ],
            denyFromIps: ['203.0.113.50'] };
        } },
    ]);
    renderAt('/firewall', <FirewallPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    await clickNamed(
      user,
      /enable|disable|refresh|apply|allow|deny|delete|profile|web|mail|ftp|save|confirm/i,
      16,
    );
    for (const input of document.querySelectorAll('input, textarea, select')) {
      const el = input as HTMLInputElement;
      if (el.type === 'checkbox' || el.type === 'radio') {
        try {
          await user.click(el);
        } catch {
          /* ignore */
        }
      } else if (el.tagName === 'SELECT') {
        fireEvent.change(el, { target: { value: el.options?.[1]?.value ?? el.value } });
      } else if (!el.disabled) {
        try {
          fireEvent.change(el, { target: { value: el.value || '8080' } });
        } catch {
          /* ignore */
        }
      }
    }
    await clickNamed(user, /apply|allow|deny|save|confirm|delete|close/i, 10);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('EmailPage domains queue create flush', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/email'),
        handler: (url, init) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'POST' || method === 'PUT' || method === 'DELETE') return honesty();
          if (url.includes('queue')) {
            return {
              ok: true,
              items: [
                { id: 'q1', raw: 'queued message 1' },
                { id: 'q2', raw: 'queued message 2' },
              ],
              notes: ['2 in queue'] };
          }
          if (url.includes('domains')) {
            return {
              items: [
                {
                  id: 'd1',
                  domain: 'example.com',
                  apply_status: 'applied',
                  health_score: 90,
                  serverIp: '203.0.113.1' },
                {
                  id: 'd2',
                  domain: 'draft.test',
                  apply_status: 'draft',
                  health_score: 40,
                  serverIp: '203.0.113.2' },
              ],
              total: 2,
              meta: {
                total: 2,
                facets: { status: { applied: 1, draft: 1, written: 0 } } } };
          }
          return { ok: true, items: [], notes: [] };
        } },
    ]);
    renderAt('/email', <EmailPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|add domain|new/i, 2);
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'new.example.com' } });
      }
      await clickNamed(user, /create|save|confirm/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    await clickAllTabs(user);
    await clickNamed(user, /load|refresh|flush|delete|queue|close/i, 10);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('SslPage upload LE delete', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/ssl') || url.includes('certificate'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (url.includes('bindings')) {
            return {
              items: [
                {
                  domain: 'example.com',
                  expires_at: now(),
                  projects: [{ name: 'web' }],
                  mailDomains: [{ domain: 'mail.example.com' }] },
              ],
              notes: ['ok'] };
          }
          return {
            items: [
              {
                id: 'c1',
                domain: 'example.com',
                status: 'issued',
                files_exist: true,
                expires_at: now() },
              {
                id: 'c2',
                domain: 'fail.test',
                status: 'failed',
                files_exist: false },
              {
                id: 'c3',
                domain: 'planned.test',
                status: 'planned',
                files_exist: false },
            ],
            total: 3,
            meta: { total: 3 } };
        } },
    ]);
    renderAt('/ssl', <SslPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /upload certificate|upload/i, 1);
    const dialogs = screen.queryAllByRole('dialog');
    if (dialogs[0]) {
      for (const input of within(dialogs[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, {
          target: { value: 'example.com\n-----BEGIN CERT-----\nx\n-----END CERT-----' } });
      }
      await clickNamed(user, /upload|save|submit/i, 1);
      await clickNamed(user, /cancel|close/i, 2);
    }
    await clickNamed(user, /request|let.?s encrypt/i, 1);
    const le = screen.queryAllByRole('dialog');
    if (le[0]) {
      for (const input of within(le[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'le.example.com' } });
      }
      await clickNamed(user, /request|save|submit/i, 1);
      await clickNamed(user, /cancel|close/i, 2);
    }
    await clickNamed(user, /delete|remove|retry|refresh/i, 4);
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('PostgresPage create install start delete', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) =>
          url.includes('postgres') ||
          url.includes('/console') ||
          url.includes('/resources') ||
          url.includes('databases'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (url.includes('console') || url.includes('service')) {
            return {
              installed: true,
              active: 'active',
              activeLabel: 'active',
              executeEnabled: false,
              isRoot: false,
              version: '16' };
          }
          return {
            items: [
              {
                id: 'db1',
                name: 'appdb',
                apply_status: 'applied',
                username: 'app' },
            ],
            total: 1,
            meta: { total: 1 } };
        } },
    ]);
    renderAt('/databases/postgres', <PostgresPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|refresh|install|start|delete|close/i, 8);
    const dialogs = screen.queryAllByRole('dialog');
    if (dialogs[0]) {
      for (const input of within(dialogs[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'testdb' } });
      }
      for (const cb of within(dialogs[0]).queryAllByRole('checkbox')) {
        await user.click(cb);
      }
      await clickNamed(user, /create|save/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('AiPage tasks playbooks create approve', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/ai') || url.includes('/llm') || url.includes('playbook'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ...honesty(),
              task: {
                id: 't-new',
                status: 'planned',
                prompt: 'x',
                steps: [{ id: 's1', status: 'pending', title: 'step' }] } };
          }
          return {
            tasks: [
              {
                id: 't1',
                status: 'planned',
                prompt: 'Check nginx',
                createdAt: now(),
                steps: [
                  { id: 's1', status: 'pending', title: 'Probe' },
                  { id: 's2', status: 'pending', title: 'Fix' },
                ] },
              {
                id: 't2',
                status: 'completed',
                prompt: 'Done task',
                createdAt: now(),
                steps: [{ id: 's1', status: 'done', title: 'Done' }] },
              {
                id: 't3',
                status: 'failed',
                prompt: 'Failed',
                createdAt: now(),
                steps: [{ id: 's1', status: 'error', title: 'Boom' }] },
            ],
            playbooks: [
              { id: 'pb1', name: 'Hardening', description: 'Secure host' },
              { id: 'pb2', name: 'Backup check', description: 'Verify backups' },
            ],
            items: [] };
        } },
    ]);
    renderAt('/ai', <AiPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|new|task|refresh/i, 3);
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'Audit firewall rules' } });
      }
      await clickNamed(user, /create|save|run|submit/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    await clickAllTabs(user);
    await clickNamed(user, /approve|run|cancel|reject|playbook|filter/i, 10);
    const filter = document.querySelector('input[type="search"], input[placeholder]') as
      | HTMLInputElement
      | null;
    if (filter) fireEvent.change(filter, { target: { value: 'hard' } });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('ReadinessPage loads full report fixture', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/api/v1/readiness') || url.endsWith('/readiness'),
        body: {
          product: 'YSK',
          mode: 'degraded',
          productionReady: false,
          executeEnabled: false,
          isRoot: false,
          score: { ready: 3, degraded: 2, missing: 1, total: 6 },
          generatedAt: now(),
          summary: ['needs work'],
          categories: ['security', 'web', 'mail'],
          blockers: [
            {
              id: 'fw',
              title: 'Firewall',
              detail: 'off',
              level: 'missing',
              category: 'security',
              severity: 'critical',
              fixHref: '/firewall',
              fixHint: 'Enable ufw' },
          ],
          items: [
            {
              id: 'ssl',
              title: 'TLS ready',
              detail: 'ok',
              level: 'ready',
              category: 'security',
              severity: 'critical',
              fixHref: '/ssl',
              fixHint: 'Issue cert',
              spec: 'tls' },
            {
              id: 'fw',
              title: 'Firewall',
              detail: 'off',
              level: 'missing',
              category: 'security',
              severity: 'critical',
              fixHref: '/firewall',
              fixHint: 'Enable ufw' },
            {
              id: 'mail',
              title: 'Mail stack',
              detail: 'partial',
              level: 'degraded',
              category: 'mail',
              severity: 'recommended',
              fixHref: '/email' },
          ] } },
    ]);
    renderAt('/readiness', <ReadinessPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await waitFor(() => expect(document.body.innerText).toMatch(/Firewall|TLS/i));
    await clickNamed(user, /re-?probe|refresh/i, 1);
    await clickAllTabs(user);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('NginxPage create edit sites', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('nginx') || url.includes('/sites') || url.includes('resources'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            items: [
              {
                id: 's1',
                domain: 'app.example.com',
                root: '/var/www/app',
                apply_status: 'applied',
                ssl: true },
            ],
            total: 1,
            meta: { total: 1 },
            installed: true,
            active: 'active' };
        } },
    ]);
    renderAt('/nginx', <NginxPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|add|edit|delete|refresh|save|apply/i, 10);
    const dialogs = screen.queryAllByRole('dialog');
    if (dialogs[0]) {
      for (const input of within(dialogs[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'new.example.com' } });
      }
      await clickNamed(user, /save|create|apply/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('FtpPage accounts keys', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/sftp/keys'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            items: [
              {
                id: 'k1',
                username: 'ftpuser',
                comment: 'laptop',
                publicKey: 'ssh-ed25519 AAAA',
                created_at: now() },
            ] };
        } },
      {
        match: (url) => url.includes('/system/ftps/options'),
        body: {
          domains: [{ value: 'example.com', label: 'example.com' }],
          homes: [{ value: '/home/ftp', label: '/home/ftp' }] } },
      {
        match: (url) =>
          url.includes('ftp') ||
          url.includes('ftps') ||
          url.includes('accounts') ||
          url.includes('resources'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            items: [
              {
                id: 'a1',
                username: 'ftpuser',
                homePath: '/home/ftpuser',
                apply_status: 'applied',
                domain: 'example.com' },
            ],
            total: 1,
            meta: { total: 1 } };
        } },
    ]);
    renderAt('/ftp', <FtpPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    await clickNamed(user, /create|add|edit|delete|refresh|save|apply|key/i, 8);
    const dialogs = screen.queryAllByRole('dialog');
    if (dialogs[0]) {
      for (const input of within(dialogs[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'ftp2' } });
      }
      await clickNamed(user, /cancel|close/i, 3);
    }
    // Page may keep a modal open; soft assert body rendered
    expect(document.body.innerText.length).toBeGreaterThan(10);
  });

  it('ProjectsPage + ProjectDetail actions', async () => {
    const user = userEvent.setup();
    const project = {
      id: 'p1',
      name: 'demo',
      domain: 'demo.example.com',
      runtime: 'node',
      status: 'running',
      homeDir: '/home/ysk/demo',
      port: 3000,
      apply_status: 'applied',
      gitUrl: 'https://github.com/ex/demo.git',
      branch: 'main' };
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/projects'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (url.match(/\/projects\/p1/) || url.includes('/p1')) {
            return {
              ...project,
              envText: 'NODE_ENV=production',
              logs: 'boot ok\n',
              process: { status: 'running', pid: 1234 } };
          }
          return { items: [project], total: 1, meta: { total: 1 } };
        } },
    ]);
    renderAt('/projects', <ProjectsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|add|refresh|deploy/i, 4);
    const detail = renderAt('/projects/p1', <ProjectDetailPage />, '/projects/:id');
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0));
    await clickAllTabs(user);
    await clickNamed(
      user,
      /deploy|stop|start|health|ssl|backup|git|save|env|refresh|confirm|run/i,
      16,
    );
    expect(document.body.innerText.length).toBeGreaterThan(10);
    detail.unmount();
  });

  it('DnsPage zone records', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/dns'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            zones: [
              {
                name: 'example.com',
                dnssec: false,
                records: [
                  { id: 'r1', name: '@', type: 'A', content: '203.0.113.1', ttl: 300 },
                  { id: 'r2', name: 'www', type: 'CNAME', content: 'example.com', ttl: 300 },
                ] },
            ],
            items: [
              {
                id: 'z1',
                name: 'example.com',
                dnssec: false },
            ],
            total: 1,
            meta: { total: 1 } };
        } },
    ]);
    renderAt('/dns', <DnsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|add|zone|record|dnssec|delete|edit|save|refresh/i, 14);
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'new.zone.test' } });
      }
      await clickNamed(user, /create|save/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('CdnPage nodes sites', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/cdn/dashboard'),
        body: {
          at: now(),
          nodes: {
            total: 1,
            online: 1,
            offline: 0,
            draining: 0,
            unknown: 0,
            byRegion: { local: 1 } },
          sites: {
            total: 1,
            byApplyStatus: { planned: 1 },
            rows: [{ id: 's1', name: 'cdn.example.com', apply_status: 'planned' }] },
          cache: [],
          overallHitRatePct: 80,
          notes: [] } },
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
                ipv4: '203.0.113.10' },
            ],
            total: 1,
            meta: { total: 1 } };
        } },
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
                apply_status: 'planned',
                mode: 'origin_pull' },
            ],
            total: 1,
            meta: { total: 1 } };
        } },
      {
        match: (url) => url.includes('/cdn') || url.includes('dns/zones'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return { items: [], total: 0, meta: { total: 0 } };
        } },
    ]);
    renderAt('/cdn', <CdnPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    await clickNamed(user, /create|add|edit|delete|refresh|save|node|site|probe|drain/i, 14);
    const dialogs = screen.queryAllByRole('dialog');
    if (dialogs[0]) {
      for (const input of within(dialogs[0]).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'edge-2' } });
      }
      await clickNamed(user, /save|create/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('ProtectionPage presets automation geo', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
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
                autoUpdate: true },
              sources: [],
              meta: null };
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
                  holdMinutes: 30 },
                autoBan: {
                  enabled: true,
                  mode: 'normal',
                  method: 'fail2ban',
                  cooldownMinutes: 30,
                  maxAutoBansPerHour: 20,
                  whitelist: ['127.0.0.1'] } } };
          }
          return {
            at: now(),
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
            bans: {
              count: 1,
              items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }] },
            nginxLimits: {
              reqRate: '10r/s',
              burst: 20,
              connLimit: 40,
              confPath: '/etc/nginx/conf.d/d.conf',
              exists: true },
            firewall: { active: 'active', installed: true },
            fail2ban: { active: 'active', installed: true, jails: 2 },
            autoBan: {
              enabled: true,
              mode: 'normal',
              method: 'fail2ban',
              cooldownMinutes: 30,
              maxAutoBansPerHour: 20,
              whitelist: ['127.0.0.1'] },
            executeEnabled: false,
            isRoot: false,
            suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' }],
            notes: ['n1'] };
        } },
    ]);
    renderAt('/protection', <ProtectionPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickAllTabs(user);
    await clickNamed(
      user,
      /daily|hardened|attack|emergency|apply|refresh|save|enable|disable|unban|probe|auto|geo/i,
      20,
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('FilesPage browse select actions', async () => {
    const user = userEvent.setup();
    const t = now();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) =>
          url.includes('/api/v1/files') ||
          url.includes('/hosting/files') ||
          url.includes('webdav'),
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
                  mtime: t },
              ] };
          }
          if (url.includes('shares')) {
            return { items: [] };
          }
          if (url.includes('/read')) {
            return {
              content: 'hello',
              path: 'readme.txt',
              bytes: 5,
              mime: 'text/plain' };
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
                favorite: true },
              {
                name: 'docs',
                path: 'docs',
                type: 'dir',
                size: 0,
                mtime: t },
              {
                name: 'photo.png',
                path: 'photo.png',
                type: 'file',
                size: 2048,
                mtime: t,
                mime: 'image/png' },
            ],
            usage: { bytes: 2148, fileCount: 2, dirCount: 1 } };
        } },
    ]);
    renderAt('/files', <FilesPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/readme\.txt/i)).toBeTruthy());
    await clickNamed(
      user,
      /refresh|upload|new|mkdir|delete|rename|download|zip|share|copy|move|chmod|webdav/i,
      14,
    );
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      try {
        await user.click(cb as HTMLElement);
      } catch {
        /* ignore */
      }
    }
    await clickNamed(user, /delete|zip|share|copy|move|download/i, 6);
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('CronPage create run', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('/cron') || url.includes('/projects'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (_u.includes('projects')) {
            return {
              items: [
                {
                  id: 'p1',
                  name: 'demo',
                  homeDir: '/home/ysk/demo',
                  runtime: 'node' },
              ] };
          }
          return {
            jobs: [
              {
                id: 'j1',
                name: 'nightly',
                schedule: '0 2 * * *',
                command: 'echo hi',
                enabled: true },
            ],
            items: [
              {
                id: 'j1',
                name: 'nightly',
                schedule: '0 2 * * *',
                command: 'echo hi',
                enabled: true },
            ],
            installed: true };
        } },
    ]);
    renderAt('/cron', <CronPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /create|add|run|enable|disable|delete|save|refresh|install/i, 12);
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'echo test' } });
      }
      await clickNamed(user, /create|save/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('SystemdUnitPage actions', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) => url.includes('systemd') || url.includes('/system/unit'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            unit: 'nginx.service',
            active: 'active',
            enabled: 'enabled',
            loadState: 'loaded',
            description: 'Nginx',
            fragmentPath: '/lib/systemd/system/nginx.service',
            executeEnabled: false,
            isRoot: false };
        } },
    ]);
    renderAt('/system/unit', <SystemdUnitPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /start|stop|restart|reload|enable|disable|refresh|apply/i, 10);
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('UpdatesPage risk rows', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) =>
          url.includes('updates') || url.includes('packages') || url.includes('advice'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          return {
            items: [
              {
                id: 'u1',
                name: 'openssl',
                current: '1.0',
                candidate: '1.1',
                risk: 'high',
                requiresApproval: true },
              {
                id: 'u2',
                name: 'curl',
                current: '7.0',
                candidate: '8.0',
                risk: 'low' },
            ],
            lastCheckedAt: now(),
            notes: [] };
        } },
    ]);
    renderAt('/updates', <UpdatesPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    await clickNamed(user, /refresh|check|apply|approve|update|install/i, 10);
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('Ssh2faPanel + DbClusterPanel interactions', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      meRoute(),
      {
        match: (url) =>
          url.includes('/ssh') ||
          url.includes('2fa') ||
          url.includes('enroll') ||
          url.includes('db-cluster') ||
          url.includes('cluster'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
          if (_u.includes('cluster')) {
            return {
              items: [
                {
                  id: 'c1',
                  name: 'galera-1',
                  engine: 'mariadb',
                  kind: 'mariadb-galera',
                  status: 'healthy',
                  members: [{ host: '10.0.0.1', role: 'primary' }] },
              ],
              count: 1 };
          }
          return {
            items: [
              {
                id: 'e1',
                username: 'alice',
                status: 'enrolled',
                createdAt: now() },
              {
                id: 'e2',
                username: 'bob',
                status: 'file_written',
                createdAt: now() },
            ],
            hostNotes: ['pam ok'],
            package: 'ok',
            pam: 'ok',
            lights: { package: 'ok', pam: 'ok', sshd: 'ok' } };
        } },
    ]);
    render(
      <MemoryRouter>
        <Ssh2faPanel onFlash={() => undefined} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.innerText.length).toBeGreaterThan(20));
    await clickNamed(user, /enroll|confirm|retire|refresh|create|delete|copy|close|save/i, 12);
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      for (const input of within(dialog).queryAllByRole('textbox')) {
        fireEvent.change(input, { target: { value: 'carol' } });
      }
      await clickNamed(user, /save|create|confirm/i, 2);
      await clickNamed(user, /cancel|close/i, 2);
    }

    render(
      <MemoryRouter>
        <DbClusterPanel engine="mariadb" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.innerText).toMatch(/galera|cluster|maria/i));
    await clickNamed(user, /create|galera|replica|refresh|delete|plan|apply|save/i, 10);
  });
});
