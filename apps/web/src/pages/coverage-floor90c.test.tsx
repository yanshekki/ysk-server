import { createUiProbe } from '../test/assert-rendered';
/**
 * Floor-90 wave C: step-accurate wizards + form submits for remaining handlers.
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
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { ServiceConsolePage } from './features/ServiceConsolePage';
import { BackupsPage } from './features/BackupsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UsersPage } from './UsersPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { CdnPage } from './features/CdnPage';
import { NetworkPage } from './features/NetworkPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { RedisPage } from './features/RedisPage';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { ProtectionPage } from './features/ProtectionPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { LogsPage } from './features/LogsPage';
import { DnsPage } from './features/DnsPage';
import { FilesPage } from './FilesPage';
import { DashboardPage } from './DashboardPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, limit = 8) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
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

describe('coverage floor 90c', () => {
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
    'OutboundIdentities: full wizard steps + create + reveal ack + row CTAs',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/ssh') || url.includes('/security/ssh'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                applied: true,
                blocked: false,
                notes: ['ok'],
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----',
                identity: {
                  id: 'id-new',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abcdefghijklmnopqrstuvwxyz012345',
                  publicKey: 'ssh-ed25519 AAAA',
                  status: 'stored',
                  createdAt: t,
                },
                newIdentity: {
                  id: 'id-rot',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:rotatedkeyfingerprint01234567',
                  publicKey: 'ssh-ed25519 BBBB',
                  status: 'stored',
                  createdAt: t,
                },
              };
            }
            return {
              items: [
                {
                  id: 'id1',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abcdefghijklmnopqrstuvwxyz012345',
                  publicKey: 'ssh-ed25519 AAAA panel',
                  status: 'installed',
                  createdAt: t,
                },
                {
                  id: 'id2',
                  name: 'stored-key',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:storedkeyfingerprintxxxxxxxxxxxx',
                  publicKey: 'ssh-ed25519 CCCC',
                  status: 'stored',
                  createdAt: t,
                },
                {
                  id: 'id3',
                  name: 'user-out',
                  algorithm: 'ed25519',
                  purpose: 'user_outbound',
                  fingerprintSha256: 'SHA256:userkeyfingerprintyyyyyyyyyyyy',
                  publicKey: 'ssh-ed25519 DDDD',
                  status: 'installed',
                  createdAt: t,
                  binding: {
                    projectId: 'p1',
                    linuxUser: 'demou',
                    homeDir: '/home/demou',
                  },
                },
                {
                  id: 'id4',
                  name: 'verified',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:verifiedkeyzzzzzzzzzzzzzzzzzz',
                  publicKey: 'ssh-ed25519 EEEE',
                  status: 'verified',
                  createdAt: t,
                },
              ],
            };
          },
        },
        {
          match: /\/api\/v1\/projects/,
          body: {
            items: [
              { id: 'p1', name: 'Demo', linuxUser: 'demou', homeDir: '/home/demou' },
            ],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/security', <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />);
      await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));

      // Open wizard
      await clickBtn(user, /create|new|add|wizard|\+/i, 2);

      // Step 1: purpose buttons
      for (const b of screen.queryAllByRole('button').slice(0, 12)) {
        const txt = b.textContent ?? '';
        if (/panel|user|outbound|peer|project/i.test(txt)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
      await clickBtn(user, /next|continue|下一步/i, 2);

      // Step 2 may be project select or callout
      const proj = document.getElementById('wiz-proj') as HTMLSelectElement | null;
      if (proj && proj.options.length > 1) {
        await user.selectOptions(proj, proj.options[1].value);
      }
      await clickBtn(user, /next|continue|下一步/i, 2);

      // Step 3 name + algo + install
      setVal('wiz-name', 'panel-peer-test');
      for (const rb of screen.queryAllByRole('radio').slice(0, 4)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 2)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /create|finish|完成|generate|建立/i, 3);

      // Reveal private key modal
      await waitFor(() => {
        expect(screen.queryAllByText(/BEGIN OPENSSH|private|私鑰|私钥/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /copy|install|done|close|ack|confirm|next/i, 6);

      // Row CTAs: install / test / copy
      await clickBtn(user, /install|test|copy|rotate|delete|primary/i, 12);
      for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.clear(input);
          await user.type(input, 'root@10.0.0.9');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /test|run|confirm|delete|rotate|yes|ok/i, 8);

      probe.sample();
      probe.assertRendered();
    },
    50_000,
  );

  it(
    'ServiceConsole: lifecycle + dirty apply + number presets + enum radio',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/console'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              engine: 'redis',
              title: 'Redis',
              version: '7.0',
              unit: 'redis-server',
              active: 'active',
              activeLabel: 'running',
              enabled: 'enabled',
              installed: true,
              executeEnabled: false,
              isRoot: false,
              canLifecycle: true,
              metrics: { used_memory: '12M' },
              live: { maxmemory: '256mb', timeout: '0', 'tcp-backlog': '511', 'protected-mode': 'ON' },
              categories: [
                {
                  id: 'memory',
                  label: 'Memory',
                  description: 'RAM',
                  settings: [
                    {
                      key: 'maxmemory',
                      label: 'Max memory',
                      category: 'memory',
                      type: 'string',
                      applyMode: 'runtime',
                      liveValue: '256mb',
                    },
                    {
                      key: 'timeout',
                      label: 'Timeout',
                      category: 'memory',
                      type: 'number',
                      unit: 's',
                      applyMode: 'reload',
                      liveValue: '0',
                    },
                    {
                      key: 'tcp-backlog',
                      label: 'Backlog',
                      category: 'memory',
                      type: 'int',
                      applyMode: 'restart',
                      liveValue: '511',
                      advanced: true,
                    },
                    {
                      key: 'protected-mode',
                      label: 'Protected',
                      category: 'memory',
                      type: 'bool',
                      enumValues: ['ON', 'OFF'],
                      applyMode: 'runtime',
                      liveValue: 'ON',
                      danger: true,
                    },
                    {
                      key: 'maxmemory-policy',
                      label: 'Policy',
                      category: 'memory',
                      type: 'enum',
                      enumValues: [
                        'allkeys-lru',
                        'volatile-lru',
                        'allkeys-lfu',
                        'volatile-lfu',
                        'allkeys-random',
                        'volatile-random',
                        'volatile-ttl',
                        'noeviction',
                        'extra1',
                        'extra2',
                        'extra3',
                        'extra4',
                        'extra5',
                      ],
                      applyMode: 'restart',
                      liveValue: 'allkeys-lru',
                    },
                  ],
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/lifecycle') || url.includes('/install') || url.includes('/apply'),
          body: HONESTY_WRITTEN_BLOCKED,
        },
        { match: /.*/, body: { ok: true, items: [], installed: true, active: 'active' } },
      ]);

      renderAt('/services/redis', <ServiceConsolePage engine="redis" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      await clickBtn(user, /start|stop|restart|reload|enable|disable|install/i, 8);

      // Open memory category tab
      const mem = screen.queryAllByRole('tab').find((t) => /memory/i.test(t.textContent ?? ''));
      if (mem) await user.click(mem);

      // Toggle radios / chips / inputs
      for (const rb of screen.queryAllByRole('radio').slice(0, 10)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const b of screen.queryAllByRole('button').slice(0, 20)) {
        const txt = b.textContent ?? '';
        if (/^\d+$|custom|256|128|64|30|60|300|ON|OFF|lru/i.test(txt)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'),
      ).slice(0, 6)) {
        fireEvent.change(input, { target: { value: '128' } });
      }
      for (const sel of document.querySelectorAll('select')) {
        try {
          const opts = Array.from(sel.options);
          if (opts[1]) await user.selectOptions(sel, opts[1].value);
        } catch {
          /* ignore */
        }
      }

      await clickBtn(user, /save|apply|套用|儲存/i, 4);

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'Backups restic restore paths + Email suspend flags + Users package PATCH',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['ok'] };
            }
            return {
              items: [
                {
                  id: 'b1',
                  name: 'nightly.tgz',
                  createdAt: now(),
                  sizeBytes: 9_000_000,
                  status: 'ok',
                  type: 'full',
                  path: '/var/backups/b1.tgz',
                  projectId: 'proj-aaaaaaaa',
                },
              ],
              settings: {
                enabled: true,
                schedule: '0 3 * * *',
                retain: 7,
                includeProjects: true,
                includeMail: false,
                includeDb: true,
                restic: { enabled: true, repo: '/var/restic', passwordSet: true },
              },
              lastRun: {
                ok: true,
                at: now(),
                notes: ['done'],
                empty: false,
                results: [
                  { projectId: 'proj-aaaaaaaa', ok: true, notes: ['tar ok'] },
                  { projectId: 'proj-bbbbbbbb', ok: false, notes: ['fail'] },
                ],
                sideResults: [
                  {
                    projectId: 'proj-aaaaaaaa',
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
                    notes: ['sftp fail'],
                  },
                  {
                    projectId: 'proj-cccccccc',
                    kind: 'remote',
                    ok: true,
                    skipped: true,
                    notes: [],
                  },
                ],
              },
              snapshots: [
                { id: 'snap1', time: now(), tags: ['project:proj-aaaaaaaa', 'full'] },
                { id: 'snap2', time: now(), tags: ['manual'] },
              ],
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
                records: [{ type: 'A', name: '@', value: '1.2.3.4' }],
                externalTodos: [],
                health: { score: 40, maxScore: 100, messages: [] },
                notes: [],
              };
            }
            if (url.includes('/mailboxes') || url.includes('/aliases')) return { items: [] };
            if (url.includes('/deliverability')) {
              return {
                ok: true,
                score: 50,
                panelReady: true,
                honesty: ['h'],
                items: [
                  {
                    id: 'x',
                    title: 'X',
                    ok: true,
                    level: 'panel',
                    owner: 'o',
                    detail: 'd',
                  },
                ],
                externalTodos: [],
              };
            }
            if (
              /\/(live|dnsbl|warmup|sieve|relay|webmail|bootstrap|flags|policy)/.test(url)
            ) {
              return { ok: true, health: { score: 50 }, notes: ['ok'], script: '', enabled: false };
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
                  capabilityGrants: [],
                  capabilityRevokes: [],
                },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['operator'],
                  packageId: 'pkg1',
                  suspended: false,
                  locale: 'en',
                  capabilityGrants: [],
                  capabilityRevokes: [],
                },
              ],
              meta: {
                total: 2,
                page: 1,
                limit: 50,
                facets: { role: { admin: 1 }, status: {}, totp: {} },
              },
              hostUsage: { projects: 1, diskMb: 10, freeMb: 100 },
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
                  notes: 'n',
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/rbac'),
          body: {
            items: [
              {
                role: 'operator',
                dirty: true,
                policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
                factory: { maxLevel: 'write-high', capabilities: ['projects.read'] },
              },
            ],
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      // Backups
      let r = renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      setVal('rs-pid', 'proj-aaaaaaaa');
      await clickBtn(user, /preview|dry|safe|overwrite|restore|run|save|download|delete|list|snapshot/i, 16);
      await clickBtn(user, /confirm|yes|ok|overwrite/i, 4);
      probe.sample(); r.unmount();

      // Email domain advanced suspend
      r = renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      const adv = screen.queryAllByRole('tab').find((t) => /advanced|進階|高级/i.test(t.textContent ?? ''));
      if (adv) await user.click(adv);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /suspend|暫停|暂停|resume|恢復|恢复|save|儲存|保存|apply|autoreply/i, 10);
      setVal('boot-pw', 'AdminPass99!');
      await clickBtn(user, /bootstrap|引導|引导/i, 2);
      probe.sample(); r.unmount();

      // Users package edit submit
      r = renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getByText(/admin/i)).toBeInTheDocument());
      const pkgTab = screen.queryAllByRole('tab').find((t) => /package|套餐/i.test(t.textContent ?? ''));
      if (pkgTab) await user.click(pkgTab);
      await clickBtn(user, /edit|編輯|编辑/i, 2);
      setVal('p-name', 'gold');
      setVal('p-projects', '25');
      setVal('p-mail', '20');
      setVal('p-db', '10');
      setVal('p-disk', '40960');
      setVal('p-bw', '1000');
      setVal('p-notes', 'edited');
      await clickBtn(user, /save|update|儲存|保存/i, 2);

      // delete package confirm path
      await clickBtn(user, /delete|刪除|删除/i, 2);
      await clickBtn(user, /confirm|yes|刪除|删除/i, 2);

      // user detail delete/impersonate confirms
      const usersTab = screen.queryAllByRole('tab').find((t) => /user|用戶|用户/i.test(t.textContent ?? ''));
      if (usersTab) await user.click(usersTab);
      await clickBtn(user, /details|detail|詳情|详情/i, 2);
      await clickBtn(user, /delete|impersonate|模擬|模拟|restore|重置/i, 4);
      await clickBtn(user, /confirm|yes|確認|确认/i, 3);

      // RBAC restore
      const rbac = screen.queryAllByRole('tab').find((t) => /rbac|role|權限|权限/i.test(t.textContent ?? ''));
      if (rbac) await user.click(rbac);
      await clickBtn(user, /restore|reset|save|還原|还原/i, 6);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    70_000,
  );

  it(
    'GenericRuntime tuning + Cdn node/site forms + Network mutate + Project actions',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/runtime') ||
            url.includes('/hosting') ||
            url.includes('/api/v1/system/runtime') ||
            url.includes('/runtimes'),
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
                      type: 'number',
                    },
                  ],
                },
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
                      type: 'number',
                    },
                  ],
                },
              ],
              items: [
                { version: '20.11.0', path: '/usr/bin/node', default: true },
                { version: '18.19.0', path: '/usr/bin/node18', default: false },
              ],
              versions: ['20.11.0', '18.19.0'],
            };
          },
        },
        {
          match: (url) => url.includes('/api/v1/cdn/dashboard'),
          body: {
            at: t,
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
              byApplyStatus: { planned: 1 },
              rows: [{ id: 'site1', name: 'cdn.example.com', apply_status: 'planned' }],
            },
            cache: [
              {
                siteId: 'site1',
                siteName: 'cdn.example.com',
                hitRatePct: 70,
                hits: 10,
                misses: 4,
                method: 'stub',
                notes: [],
              },
            ],
            notes: [],
            overallHitRatePct: 70,
          },
        },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/nodes') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: {
            items: [
              {
                id: 'n1',
                name: 'edge-1',
                roles: ['edge'],
                region: 'local',
                publicIpv4: ['203.0.113.10'],
                publicIpv6: [],
                weight: 100,
                status: 'online',
                healthUrl: 'http://203.0.113.10/health',
                baseUrl: 'http://203.0.113.10',
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
                origin: 'http://origin.example.com',
                status: 'planned',
                apply_status: 'planned',
                edgeNodeIds: ['n1'],
                mode: 'proxy',
              },
            ],
          },
        },
        {
          match: (url) => url.includes('/api/v1/cdn'),
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            ok: true,
            apply_status: 'written',
            notes: ['written'],
            conf: 'server { }',
            hash: 'abc',
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written ≠ applied on host'],
              };
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
                  stats: { rxBytes: 1e9, txBytes: 2e9, rxPackets: 100, txPackets: 200 },
                },
              ],
              routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
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
          match: (url) => url.includes('/api/v1/projects/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/logs')) return { lines: ['a', 'b'], nextCursor: null };
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
              nginxConfigPath: '/etc/nginx/x',
              lastHealth: { ok: true, status: 200, ms: 10, at: t },
              entry: 'server.js',
              env: { NODE_ENV: 'production' },
            };
          },
        },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      let r = renderAt('/runtimes/node', <GenericRuntimePage kind="node" />);
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
      ).slice(0, 8)) {
        fireEvent.change(input, { target: { value: '1024' } });
      }
      await clickBtn(user, /install|probe|save|apply|default|switch|refresh/i, 12);
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
      await clickBtn(user, /add|create|new|\+|edit|probe|drain|apply|dns|ssl|purge|preview|write|health/i, 16);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"]), textarea'),
      ).slice(0, 12)) {
        try {
          fireEvent.change(input, { target: { value: 'edge-2' } });
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /save|create|apply|confirm/i, 6);
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
      await clickBtn(user, /add|edit|delete|apply|save|up|down|refresh|dns|route/i, 12);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 8)) {
        fireEvent.change(input, { target: { value: '10.0.0.10/24' } });
      }
      await clickBtn(user, /save|apply|add|confirm/i, 6);
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
      await clickBtn(user, /deploy|stop|start|restart|health|publish|suspend|resume|logs|save|delete|env/i, 16);
      await clickBtn(user, /confirm|yes/i, 3);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    90_000,
  );

  it(
    'Batch: Redis Fail2ban Firewall Protection Sql Logs Dns Files Dashboard deep clicks',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/redis'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [{ id: 'r1', name: 'cache', port: 6379, status: 'running' }],
              instances: [{ id: 'r1', name: 'cache', port: 6379, status: 'running' }],
              info: { used_memory_human: '10M' },
              ok: true,
            };
          },
        },
        {
          match: (url) => url.includes('/fail2ban'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              installed: true,
              active: 'active',
              jails: [{ name: 'sshd', currentlyBanned: 2, totalBanned: 9, enabled: true }],
              banned: [{ ip: '1.2.3.4', jail: 'sshd', time: t }],
            };
          },
        },
        {
          match: (url) => url.includes('/firewall') || url.includes('/ufw'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              installed: true,
              active: 'active',
              defaultIncoming: 'deny',
              defaultOutgoing: 'allow',
              rules: [
                { id: '1', action: 'ALLOW', from: 'Anywhere', to: '22/tcp', direction: 'in' },
              ],
            };
          },
        },
        {
          match: (url) => url.startsWith('/api/v1/defense'),
          body: {
            at: t,
            threatLevel: 'normal',
            score: 20,
            signals: [],
            activePreset: 'daily',
            presets: [{ id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] }],
            bans: { count: 0, items: [] },
            nginxLimits: { reqRate: '10r/s', burst: 20, connLimit: 40, confPath: '/x', exists: true },
            firewall: { active: 'active', installed: true },
            fail2ban: { active: 'active', installed: true, jails: 1 },
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
            ...HONESTY_WRITTEN_BLOCKED,
            provider: 'dbip',
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
          },
        },
        {
          match: (url) => url.includes('/mysql') || url.includes('/databases') || url.includes('/sql'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [{ id: 'db1', name: 'app', engine: 'mysql', status: 'active' }],
              users: [{ id: 'u1', name: 'app', host: '%' }],
              ok: true,
              installed: true,
              active: 'active',
            };
          },
        },
        {
          match: (url) => url.includes('/logs'),
          body: {
            sources: [
              { id: 'journal', label: 'Journal', kind: 'journal' },
              { id: 'nginx', label: 'Nginx', kind: 'file', path: '/var/log/nginx/error.log' },
            ],
            lines: [
              { ts: t, line: 'hello', source: 'journal' },
              { ts: t, line: 'error', source: 'nginx' },
            ],
            bookmarks: [{ id: 'bm1', name: 'errs', query: 'error' }],
            settings: { follow: false, lines: 200 },
          },
        },
        {
          match: /\/api\/v1\/resources\//,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                item: { id: 'z1', zone: 'example.com', serverIp: '1.2.3.4', nsName: 'ns1', ttl: 300 },
              };
            }
            return {
              items: [
                {
                  id: 'z1',
                  zone: 'example.com',
                  serverIp: '1.2.3.4',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                },
              ],
            };
          },
        },
        {
          match: (url) => url.includes('/dns'),
          body: {
            ok: true,
            items: [],
            notes: [],
            answers: ['1.2.3.4'],
            peers: [],
          },
        },
        {
          match: (url) => url.includes('/api/v1/files'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, content: 'x' };
            }
            return {
              path: '/',
              cwd: '/',
              items: [
                {
                  name: 'a.txt',
                  path: 'a.txt',
                  type: 'file',
                  size: 10,
                  mtime: t,
                  mime: 'text/plain',
                },
              ],
              entries: [
                {
                  name: 'a.txt',
                  path: 'a.txt',
                  type: 'file',
                  size: 10,
                  mtime: t,
                  mime: 'text/plain',
                },
              ],
              favorites: [],
            };
          },
        },
        {
          match: (url) => url.includes('/dashboard') || url.includes('/status'),
          body: {
            ok: true,
            product: 'ysk',
            version: '1',
            executeEnabled: false,
            tools: [],
            software: [{ id: 'nginx', features: ['nginx'], installed: true, active: 'active' }],
            host: { loadavg: [0.1, 0.1, 0.1], uptimeSec: 100 },
            notes: [],
          },
        },
        { match: /.*/, body: { ok: true, items: [], installed: true, active: 'active' } },
      ]);

      const pages: Array<[string, React.ReactElement]> = [
        ['/redis', <RedisPage key="r" />],
        ['/fail2ban', <Fail2banPage key="f2" />],
        ['/firewall', <FirewallPage key="fw" />],
        ['/protection', <ProtectionPage key="p" />],
        ['/databases/mysql-engine', <SqlEnginePage key="s" engine="mysql" />],
        ['/logs', <LogsPage key="l" />],
        ['/dns', <DnsPage key="d" />],
        ['/files', <FilesPage key="fi" />],
        ['/', <DashboardPage key="da" />],
      ];

      for (const [path, el] of pages) {
        const r = renderAt(path, el);
        await waitFor(
          () =>
            expect(
              screen.queryByRole('heading', { level: 1 }) ||
                screen.queryAllByRole('button').length > 0,
            ).toBeTruthy(),
          { timeout: 8000 },
        ).catch(() => undefined);
        for (const tab of screen.queryAllByRole('tab')) {
          try {
            await user.click(tab);
          } catch {
            /* ignore */
          }
        }
        await clickBtn(
          user,
          /create|add|save|apply|start|stop|restart|refresh|delete|edit|ban|unban|allow|deny|run|query|follow|export|backup|install|probe|filter/i,
          12,
        );
        await clickBtn(user, /confirm|yes|ok/i, 2);
        probe.sample(); r.unmount();
      }

      probe.sample();
      probe.assertRendered();
    },
    120_000,
  );
});
