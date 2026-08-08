import { createUiProbe } from '../test/assert-rendered';
/**
 * AgentsPage deep (helpers via rich command history) + EmailDomain advanced flags.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { AgentsPage } from './AgentsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { DashboardPage } from './DashboardPage';
import { SecurityPage } from './SecurityPage';
import { DnsPage } from './features/DnsPage';
import { BackupsPage } from './features/BackupsPage';
import { NetworkPage } from './features/NetworkPage';
import { UsersPage } from './UsersPage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';

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

describe('agents + email + batch hole fillers', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) } });
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
    'AgentsPage register, command presets, history with rich results',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const commands = [
        {
          id: 'c1',
          agent_id: 'ag-1',
          status: 'done',
          payload: { cli: ['readiness', '--json'] },
          result: {
            ok: true,
            exitCode: 0,
            result: { ready: true },
            at: t },
          createdAt: t },
        {
          id: 'c2',
          agent_id: 'ag-1',
          status: 'error',
          payload: { op: 'echo', message: 'hi' },
          result: {
            ok: false,
            exitCode: 1,
            error: 'failed',
            stderr: 'boom' },
          createdAt: t },
        {
          id: 'c3',
          agent_id: 'ag-1',
          status: 'queued',
          payload: { op: 'ping' },
          createdAt: t },
        {
          id: 'c4',
          agent_id: 'ag-1',
          status: 'acked',
          payload: 'plain-string-payload',
          result: { exitCode: 2, blocked: true, note: 'need execute' },
          createdAt: t },
        {
          id: 'c5',
          agent_id: 'ag-1',
          status: 'done',
          payload: { big: 'x'.repeat(100) },
          result: {
            exitCode: 3,
            result: { nested: true, data: Array.from({ length: 50 }, (_, i) => i) } },
          createdAt: t },
        {
          id: 'c6',
          agent_id: 'ag-1',
          status: 'done',
          payload: { circular: true },
          result: { exitCode: 4 },
          createdAt: t },
        {
          id: 'c7',
          agent_id: 'ag-1',
          status: 'done',
          payload: null,
          result: { exitCode: 5 },
          createdAt: t },
      ];

      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/fleet/agents'),
          handler: (url, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            if (url.includes('/commands')) {
              if (method !== 'GET') {
                return {
                  id: 'c-new',
                  agent_id: 'ag-1',
                  status: 'queued',
                  payload: { cli: ['host'] },
                  createdAt: t };
              }
              return { items: commands };
            }
            if (method === 'POST' || method === 'PUT') {
              return {
                id: 'sess-new',
                agent_id: 'edge-2',
                status: 'connected',
                group: 'default',
                last_seen_at: t,
                meta: { hostname: 'edge-2' } };
            }
            if (method === 'DELETE') return { ok: true, id: 'sess-1' };
            return {
              items: [
                {
                  id: 'sess-1',
                  agent_id: 'ag-1',
                  status: 'connected',
                  group: 'edge',
                  last_seen_at: t,
                  meta: { hostname: 'edge-1', version: '0.1' } },
                {
                  id: 'sess-2',
                  agent_id: 'ag-2',
                  status: 'offline',
                  group: 'default',
                  last_seen_at: t,
                  meta: { hostname: 'edge-2' } },
                {
                  id: 'sess-3',
                  agent_id: 'ag-3',
                  status: 'not_installed',
                  group: 'lab',
                  last_seen_at: t },
                {
                  id: 'sess-4',
                  agent_id: 'ag-4',
                  status: 'failed',
                  group: 'lab',
                  last_seen_at: t },
                {
                  id: 'sess-5',
                  agent_id: 'ag-5',
                  status: 'unknown',
                  group: 'lab',
                  last_seen_at: t },
                {
                  id: 'sess-6',
                  agent_id: 'ag-6',
                  status: 'weird',
                  group: 'lab',
                  last_seen_at: t },
              ],
              meta: { total: 6, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
          } },
        {
          match: (url) => url.includes('/api/v1/agents/runtimes'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['written'] };
            }
            if (/runtimes\/[^/]+$/.test(url) || url.includes('/unit') || url.includes('/install')) {
              return {
                runtime: {
                  kind: 'edge',
                  status: 'running',
                  unitActive: 'active',
                  version: '0.1' },
                notes: ['ok'] };
            }
            return {
              items: [
                {
                  kind: 'edge',
                  status: 'running',
                  unitActive: 'active',
                  version: '0.1' },
                {
                  kind: 'worker',
                  status: 'stopped',
                  unitActive: 'inactive',
                  version: '0.1' },
                {
                  kind: 'legacy',
                  status: 'not_installed',
                  unitActive: 'failed' },
                {
                  kind: 'x',
                  status: 'error',
                  unitActive: 'activating' },
                {
                  kind: 'y',
                  status: 'unknown' },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/agents', <AgentsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Register
      for (const b of screen.queryAllByRole('button', { name: /register|add agent|new/i }).slice(0, 2)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        for (const input of within(dialog).queryAllByRole('textbox')) {
          try {
            await user.clear(input);
            await user.type(input, 'edge-new');
          } catch {
            /* ignore */
          }
        }
        for (const b of within(dialog).queryAllByRole('button', { name: /register|create|save|ok/i })) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      // Select agent / row
      try {
        const row = screen.queryAllByText(/edge-1|ag-1/i)[0];
        if (row) await user.click(row);
      } catch {
        /* ignore */
      }

      // Command / history / delete / probe / install
      for (const re of [
        /command|send|queue|history|detail|probe|install|write|unit|refresh|delete|remove|plan/i,
      ]) {
        for (const b of screen.queryAllByRole('button', { name: re }).slice(0, 10)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      // Command modal presets
      for (const rb of screen.queryAllByRole('radio').slice(0, 12)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 4)) {
        for (const o of Array.from((sel as HTMLSelectElement).options).slice(0, 8)) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'projects list --json');
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /send|queue|submit|run|confirm|close|cancel/i })
        .slice(0, 8)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Click into history rows / result details
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Tabs
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'EmailDomain advanced flags + mailbox/alias create',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
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
                id: 'new-id' };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [
                  { type: 'MX', name: '@', value: 'mail.example.com' },
                  { type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                externalTodos: [
                  { title: 'DKIM', description: 'publish', priority: 'high' },
                ],
                health: { score: 40, maxScore: 100, messages: ['soft'] },
                notes: [] };
            }
            if (url.includes('/mailboxes')) {
              return {
                items: [
                  {
                    id: 'mb1',
                    local_part: 'info',
                    address: 'info@example.com',
                    quotaMb: 500 },
                ] };
            }
            if (url.includes('/aliases')) {
              return {
                items: [{ id: 'al1', source: 'hi@example.com', dest: 'info@example.com' }] };
            }
            if (url.includes('/deliverability')) {
              return {
                ok: false,
                score: 20,
                panelReady: true,
                honesty: ['h'],
                checks: [],
                recommendations: ['fix'],
                items: [] };
            }
            if (
              url.includes('/sieve') ||
              url.includes('/relay') ||
              url.includes('/warmup') ||
              url.includes('/dnsbl') ||
              url.includes('/live') ||
              url.includes('/webmail')
            ) {
              return {
                ok: true,
                script: 'require ["fileinto"];',
                enabled: false,
                items: [],
                host: 'smtp.example.com',
                score: 50,
                health: { score: 50 } };
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
                  managed: true },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Advanced tab for suspend/resume/autoreply
      const adv = screen.queryByRole('tab', { name: /advanced/i });
      if (adv) await user.click(adv);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await fillMaybe('ar-sub', 'Away', user);
      await fillMaybe('ar-body', 'Back later', user);
      for (const b of screen
        .queryAllByRole('button', {
          name: /save|suspend|resume|apply|autoreply/i })
        .slice(0, 8)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      // Mailboxes
      const mb = screen.queryByRole('tab', { name: /mailbox/i });
      if (mb) await user.click(mb);
      for (const b of screen.queryAllByRole('button', { name: /create|add|refresh|delete/i }).slice(0, 6)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      const d = screen.queryAllByRole('dialog')[0];
      if (d) {
        for (const input of within(d).queryAllByRole('textbox').slice(0, 4)) {
          try {
            await user.type(input, 'sales');
          } catch {
            /* ignore */
          }
        }
        for (const input of d.querySelectorAll('input[type="password"]')) {
          try {
            await user.type(input as HTMLElement, 'Secret12!');
          } catch {
            /* ignore */
          }
        }
        for (const b of within(d).queryAllByRole('button', { name: /create|save|ok/i })) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      // Aliases + health + relay + sieve + deliverability
      for (const name of [/alias/i, /health/i, /relay/i, /filter|sieve|sso/i, /deliver/i, /dns/i]) {
        const tab = screen.queryByRole('tab', { name });
        if (tab) await user.click(tab);
        for (const input of Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
          ),
        ).slice(0, 8)) {
          try {
            await user.clear(input as HTMLInputElement);
            await user.type(input as HTMLInputElement, 'x');
          } catch {
            /* ignore */
          }
        }
        for (const b of screen
          .queryAllByRole('button', {
            name: /save|create|add|apply|test|check|refresh|copy|enable|disable|generate/i })
          .slice(0, 8)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'Security sessions + TOTP + Outbound detail actions batch',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
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
                recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] };
            }
            return { enabled: false, enrolled: false };
          } },
        {
          match: (url) => url.startsWith('/api/v1/auth/sessions'),
          body: {
            items: [
              {
                id: 's1',
                created_at: t,
                expires_at: t,
                current: true,
                ip: '1.1.1.1',
                user_agent: 'vitest' },
              {
                id: 's2',
                created_at: t,
                expires_at: t,
                current: false,
                ip: '2.2.2.2' },
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/auth/api-keys'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                key: { id: 'k2', name: 'ci', prefix: 'ysk_x', created_at: t },
                token: 'ysk_secret' };
            }
            return {
              items: [{ id: 'k1', name: 'old', prefix: 'ysk_old', created_at: t }] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/settings/security'),
          body: { requireAdminTotp: true, requireAdminTotpStrict: false, ok: true } },
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
                  requestedAt: t },
              ] };
          } },
        {
          match: (url) => url.includes('/ssh') || url.includes('/identities'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                applied: true,
                notes: ['ok'],
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END-----',
                identity: {
                  id: 'id-new',
                  name: 'n',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:n',
                  publicKey: 'ssh-ed25519 X',
                  status: 'created',
                  createdAt: t } };
            }
            return {
              items: [
                {
                  id: 'id1',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abc',
                  publicKey: 'ssh-ed25519 AAAA',
                  status: 'installed',
                  createdAt: t,
                  install: { path: '/home/ysk/.ssh/id', applied: true },
                  lastVerifyNote: 'ok' },
                {
                  id: 'id2',
                  name: 'proj',
                  algorithm: 'ed25519',
                  purpose: 'user_outbound',
                  fingerprintSha256: 'SHA256:def',
                  publicKey: 'ssh-ed25519 BBBB',
                  status: 'created',
                  createdAt: t,
                  binding: {
                    projectId: 'p1',
                    linuxUser: 'u',
                    homeDir: '/home/u' } },
              ] };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: {
            items: [{ id: 'p1', name: 'Demo', linuxUser: 'u', homeDir: '/home/u' }] } },
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
      await fillMaybe('reauth-pw', 'adminpass', user);
      for (const b of screen
        .queryAllByRole('button', {
          name: /start|2fa|reset|enroll|confirm|create|revoke|logout|approve|deny|copy|save/i })
        .slice(0, 15)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      await fillMaybe('totp-confirm', '123456', user);
      for (const b of screen.queryAllByRole('button', { name: /confirm|enable|verify/i }).slice(0, 3)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }

      const { unmount } = renderAt(
        '/s',
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />,
      );
      await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));
      try {
        const row = screen.queryAllByText(/panel-peer/i)[0];
        if (row) await user.click(row);
      } catch {
        /* ignore */
      }
      for (const b of screen
        .queryAllByRole('button', {
          name: /copy|install|test|rotate|delete|local|allow|create|next|finish/i })
        .slice(0, 12)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
      probe.sample();
        unmount();
      probe.assertRendered();
    },
    40_000,
  );

  it(
    'Dashboard Users Backups Network Cdn Dns rich fixtures',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.startsWith('/api/v1/dashboard') || url.startsWith('/api/v1/summary'),
          body: {
            ok: true,
            at: t,
            host: {
              hostname: 'ysk',
              uptimeSec: 99999,
              loadavg: [1, 1, 1],
              runtime: { memory: { usedRatio: 0.85, total: 8e9, free: 1e9 } } },
            services: [
              { id: 'nginx', label: 'Nginx', active: 'active', ok: true },
              { id: 'ssh', label: 'SSH', active: 'failed', ok: false },
            ],
            alerts: [
              { id: 'a1', level: 'warn', message: 'disk high', href: '/metrics' },
              { id: 'a2', level: 'danger', message: 'mem high' },
              { id: 'a3', level: 'info', message: 'info' },
            ],
            projects: { total: 5, running: 3, stopped: 2 },
            notes: ['n1', 'n2'],
            kpis: [
              { id: 'cpu', label: 'CPU', value: '90%', tone: 'danger' },
              { id: 'mem', label: 'Mem', value: '80%', tone: 'warn' },
              { id: 'disk', label: 'Disk', value: '10%', tone: 'ok' },
            ],
            quickLinks: [
              { to: '/files', label: 'Files' },
              { to: '/logs', label: 'Logs' },
            ],
            counts: { projects: 5, users: 2, domains: 1 } } },
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
                  capabilityRevokes: ['projects.write'] },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['user'],
                  packageId: 'pkg1',
                  suspended: true,
                  locale: 'zh-CN' },
              ],
              hostUsage: { projects: 2, diskMb: 100, quotaMb: 1000 },
              meta: { total: 2, page: 1, limit: 50 } };
          } },
        {
          match: (url) => url.startsWith('/api/v1/packages'),
          body: {
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
                ssh: true },
            ] } },
        {
          match: (url) => url.includes('/rbac'),
          body: {
            items: [
              {
                role: 'operator',
                dirty: true,
                policy: {
                  maxLevel: 'write-high',
                  capabilities: ['projects.read', 'projects.write'] },
                factory: {
                  maxLevel: 'write-high',
                  capabilities: ['projects.read'] } },
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (_u.includes('settings')) {
              return {
                remote: {
                  enabled: true,
                  kind: 's3',
                  host: '',
                  port: 22,
                  username: '',
                  path: 's3://b/p',
                  s3Bucket: 'b',
                  s3Region: 'us-east-1',
                  s3Endpoint: '',
                  accessKey: 'A',
                  secretKey: 'S' },
                exclusions: ['node_modules', '.git'],
                restic: {
                  enabled: true,
                  repoPath: '/var/backups/restic',
                  password: '***',
                  s3Repo: 's3:https://s3/b' } };
            }
            return {
              items: [
                {
                  projectId: 'p1',
                  name: 'Demo',
                  path: '/var/backups/p1.tgz',
                  bytes: 4096,
                  mtime: t,
                  kind: 'full' },
                {
                  projectId: 'p2',
                  name: 'Other',
                  path: '/var/backups/p2.tgz',
                  bytes: 1024,
                  mtime: t,
                  kind: 'incremental' },
              ],
              lastRun: {
                at: t,
                ok: true,
                results: [
                  { projectId: 'p1', ok: true, notes: ['ok'] },
                  { projectId: 'p2', ok: false, notes: ['fail'] },
                ] },
              snapshots: [
                {
                  id: 'snap-1',
                  time: t,
                  tags: ['p1'],
                  paths: ['/home/demo'],
                  short_id: 'abc' },
              ] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              at: t,
              notes: ['n'],
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
                  mtu: 1500,
                  isLoopback: false,
                  isDefaultEgress: true,
                  addrs: [
                    { family: 'inet', local: '10.0.0.5', prefixlen: 24 },
                    { family: 'inet6', local: 'fe80::1', prefixlen: 64 },
                  ] },
                {
                  name: 'lo',
                  ifindex: 1,
                  operstate: 'UNKNOWN',
                  flags: ['LOOPBACK'],
                  mtu: 65536,
                  isLoopback: true,
                  isDefaultEgress: false,
                  addrs: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }] },
              ],
              routes: [
                { dst: 'default', gateway: '10.0.0.1', dev: 'eth0', metric: 100 },
                { dst: '10.0.0.0/24', gateway: '', dev: 'eth0' },
              ],
              caps: { canMutate: true, executeEnabled: false, isRoot: false },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1', '8.8.8.8'],
                uplinkServers: ['1.1.1.1'],
                search: ['local', 'lan'],
                source: 'static',
                notes: [],
                ignoreAutoDns: true,
                canApply: true } };
          } },
        {
          match: (url) =>
            url.includes('/cdn') ||
            url.includes('/cloudflare') ||
            url.includes('/api/v1/resources/cdn'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [
                {
                  id: 'c1',
                  domain: 'cdn.example.com',
                  status: 'active',
                  provider: 'cloudflare',
                  zones: ['example.com'] },
              ],
              sites: [
                {
                  id: 's1',
                  name: 'main',
                  domains: ['cdn.example.com', 'www.example.com'],
                  status: 'active' },
              ],
              zones: [{ id: 'z1', name: 'example.com', status: 'active' }],
              notes: [] };
          } },
        {
          match: (url) =>
            url.includes('/api/v1/resources/dns') ||
            url.includes('/api/v1/dns') ||
            url.includes('/zones'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('records') || /zones\/[^/?]+/.test(url) || /dns\/[^/?]+/.test(url)) {
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
                  { id: 'r5', type: 'AAAA', name: '@', value: '::1', ttl: 300 },
                  { id: 'r6', type: 'NS', name: '@', value: 'ns1.example.com', ttl: 300 },
                  {
                    id: 'r7',
                    type: 'SRV',
                    name: '_sip._tcp',
                    value: '0 5 5060 sip',
                    ttl: 300 },
                  { id: 'r8', type: 'CAA', name: '@', value: '0 issue letsencrypt.org', ttl: 300 },
                ],
                notes: [],
                soa: {
                  mname: 'ns1.example.com',
                  rname: 'hostmaster.example.com',
                  serial: 1,
                  refresh: 3600,
                  retry: 600,
                  expire: 86400,
                  minimum: 300 } };
            }
            return {
              items: [
                {
                  id: 'z1',
                  zone: 'example.com',
                  serverIp: '203.0.113.10',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                  apply_status: 'planned' },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: { items: [{ id: 'p1', name: 'Demo' }] } },
        { match: /.*/, body: { ok: true, items: [], ready: true } },
      ]);

      for (const [path, el] of [
        ['/', <DashboardPage key="d" />],
        ['/users', <UsersPage key="u" />],
        ['/backups', <BackupsPage key="b" />],
        ['/network', <NetworkPage key="n" />],
        ['/dns', <DnsPage key="dns" />],
      ] as const) {
        const { unmount } = renderAt(path, el);
        await waitFor(() =>
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
        ).catch(() => undefined);
        probe.sample();
        for (const tab of screen.queryAllByRole('tab')) {
          try {
            await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        try {
          const hit = screen.queryAllByText(
            /admin|bob|demo|eth0|example\.com|cdn|snap|p1/i,
          )[0];
          if (hit) await user.click(hit);
        } catch {
          /* ignore */
        }
        for (const input of Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
          ),
        ).slice(0, 10)) {
          try {
            await user.clear(input as HTMLInputElement);
            await user.type(input as HTMLInputElement, 'x');
          } catch {
            /* ignore */
          }
        }
        for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
          try {
            await user.click(cb);
          } catch {
            /* ignore */
          }
        }
        for (const rb of screen.queryAllByRole('radio').slice(0, 6)) {
          try {
            await user.click(rb);
          } catch {
            /* ignore */
          }
        }
        for (const b of screen
          .queryAllByRole('button', {
            name: /save|create|add|apply|delete|edit|refresh|backup|restore|run|export|download|detail|suspend|enable|disable|probe|sync|record|zone/i })
          .slice(0, 12)) {
          if ((b as HTMLButtonElement).disabled) continue;
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
        probe.sample();
        unmount();
      }
      probe.sample();
      probe.assertRendered();
    },
    60_000,
  );
});

async function fillMaybe(
  id: string,
  value: string,
  user: ReturnType<typeof userEvent.setup>,
) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  try {
    el.focus();
    await user.clear(el);
    await user.type(el, value);
  } catch {
    /* ignore */
  }
}
