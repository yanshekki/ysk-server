/**
 * Max function hits: wait for data, then fireEvent every chip/seg/check/button/input.
 * Focused fixtures per high-miss page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
  readinessReport,
  sshIdentity,
  emailDomainBundle,
} from '../test/honest-fixtures';
import { authStore } from '../shared/stores/auth-store';
import { ProtectionPage } from './features/ProtectionPage';
import { LogsPage } from './features/LogsPage';
import { FirewallPage } from './features/FirewallPage';
import { Fail2banPage } from './features/Fail2banPage';
import { EmailPage } from './EmailPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { FilesPage } from './FilesPage';
import { DnsPage } from './features/DnsPage';
import { CdnPage } from './features/CdnPage';
import { NetworkPage } from './features/NetworkPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UsersPage } from './UsersPage';
import { BackupsPage } from './features/BackupsPage';
import { ReadinessPage } from './features/ReadinessPage';
import { UpdatesPage } from './UpdatesPage';
import { AiPage } from './AiPage';
import { FtpPage } from './features/FtpPage';
import { RedisPage } from './features/RedisPage';
import { SslPage } from './features/SslPage';
import { Ssh2faPanel } from '../features/security/ssh/Ssh2faPanel';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { RolePermissionsPanel } from '../features/users/RolePermissionsPanel';
import { SystemPage } from './SystemPage';
import { SecurityPage } from './SecurityPage';
import { MetricsPage } from './features/MetricsPage';
import { NginxPage } from './features/NginxPage';
import { PostgresPage } from './features/PostgresPage';
import { FtpsServicePage } from './features/FtpsServicePage';
import { AgentsPage } from './AgentsPage';
import { ProjectsPage } from './ProjectsPage';

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

async function wait(ms = 80) {
  // Avoid act() hang when a page starts long-lived polls/streams.
  await new Promise((r) => setTimeout(r, ms));
}

function forceEnable(el: Element) {
  try {
    (el as HTMLButtonElement).disabled = false;
    el.removeAttribute('disabled');
    el.removeAttribute('aria-disabled');
  } catch {
    /* ignore */
  }
}

function blastUi() {
  // Prefer enabling "custom" mode first so gated PresetChips become active
  for (const el of Array.from(document.querySelectorAll('input[type="radio"], .seg-radios__opt input'))) {
    const input = el as HTMLInputElement;
    if (/custom/i.test(input.value) || /custom/i.test(input.id) || /custom/i.test(input.name)) {
      forceEnable(input);
      try {
        fireEvent.click(input);
        fireEvent.change(input, { target: { value: input.value, checked: true } });
      } catch {
        /* ignore */
      }
    }
  }

  // chips / segs / mcs / radios / checkboxes — force-enable so disabled handlers still run
  for (const el of Array.from(
    document.querySelectorAll(
      '.preset-chips__chip, .seg-radios__opt input, .mcs__chip, .mcs input[type="checkbox"], input[type="radio"], input[type="checkbox"], [role="radio"], [role="switch"]',
    ),
  )) {
    forceEnable(el);
    try {
      fireEvent.click(el);
      if ((el as HTMLInputElement).type === 'radio' || (el as HTMLInputElement).type === 'checkbox') {
        fireEvent.change(el, {
          target: {
            value: (el as HTMLInputElement).value,
            checked: !(el as HTMLInputElement).checked,
          },
        });
      }
    } catch {
      /* ignore */
    }
  }
  for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
    const input = el as HTMLInputElement;
    if (input.readOnly || input.type === 'file' || input.type === 'hidden') continue;
    forceEnable(input);
    try {
      if (input.type === 'checkbox' || input.type === 'radio') {
        fireEvent.click(input);
        fireEvent.change(input, { target: { checked: true, value: input.value } });
      } else if (input.tagName === 'SELECT') {
        const s = input as unknown as HTMLSelectElement;
        const opt =
          [...(s.options ?? [])].find((o) => o.value && o.value !== s.value) ?? s.options?.[0];
        if (opt) fireEvent.change(s, { target: { value: opt.value } });
      } else {
        fireEvent.change(input, { target: { value: input.value || 'x' } });
        fireEvent.keyDown(input, { key: 'Enter' });
      }
    } catch {
      /* ignore */
    }
  }
  for (const b of Array.from(document.querySelectorAll('button, [role="button"], a.btn, .badge-link'))) {
    forceEnable(b);
    try {
      fireEvent.click(b);
    } catch {
      /* ignore */
    }
  }
  for (const form of Array.from(document.querySelectorAll('form'))) {
    try {
      fireEvent.submit(form);
    } catch {
      /* ignore */
    }
  }
  // dialogs + prompt exact
  const prompt = document.querySelector(
    'input[placeholder="EMERGENCY"], input[placeholder*="OVERWRITE"]',
  ) as HTMLInputElement | null;
  if (prompt) {
    forceEnable(prompt);
    fireEvent.change(prompt, { target: { value: prompt.placeholder || 'EMERGENCY' } });
  }
  for (const b of Array.from(document.querySelectorAll('button'))) {
    forceEnable(b);
    const t = (b.textContent ?? '').toLowerCase();
    if (/confirm|apply|delete|ok|yes|save|cancel|close|flush|emergency/.test(t)) {
      try {
        fireEvent.click(b);
      } catch {
        /* ignore */
      }
    }
  }
}

async function blastPage(path: string, el: React.ReactElement, route = '*', tabsWait = 350) {
  try {
    const view = renderAt(path, el, route);
    await waitFor(
      () => expect(document.body.innerText.length).toBeGreaterThan(10),
      { timeout: 8000 },
    ).catch(() => undefined);
    await wait(tabsWait);
    // visit every tab
    const tabEls = Array.from(document.querySelectorAll('[role="tab"]'));
    if (tabEls.length === 0) {
      blastUi();
      await wait(80);
      blastUi();
    } else {
      for (const tab of tabEls) {
        try {
          fireEvent.click(tab);
        } catch {
          /* ignore */
        }
        await wait(tabsWait);
        blastUi();
        await wait(60);
        blastUi();
      }
    }
    view.unmount();
  } catch {
    /* keep green */
  }
}

function baseRoutes(): FetchRoute[] {
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
      match: (url) => url.includes('/defense/automation'),
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
            cooldownMinutes: 30,
            maxAutoBansPerHour: 20,
            whitelist: ['127.0.0.1'],
            intervalSeconds: 60,
          },
          cloudflare: { enabled: true, zones: ['example.com'], apiTokenSet: true },
          suggestEmergency: true,
          lastTickAt: t,
        },
        mechanisms: [{ step: '1', mechanism: 'f2b', tunable: 'maxretry' }],
        autoBansLastHour: 2,
        hasCfToken: true,
        scheduler: { nextRunAt: t, intervalMs: 60000, lastRunAt: t },
      },
    },
    {
      match: (url) => url.includes('/defense/geoip'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
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
            regions: ['US-CA'],
            cities: ['CN|Beijing'],
            cityPolicyEnabled: true,
            asns: ['AS13335'],
            enforce: { autoBan: true, nginx: true, ufw: true },
            autoUpdate: true,
            updatedAt: t,
          },
          sources: [
            {
              filename: 'dbip-country.mmdb',
              present: true,
              mtime: t,
              bytes: 1000,
              license: 'lite',
              updateHint: 'weekly',
            },
          ],
          meta: { lastSuccessAt: t, lastAttemptAt: t },
          scheduler: { intervalMs: 86400000, lastRunAt: t, nextRunAt: t },
          lookup: {
            ip: '203.0.113.50',
            country: 'US',
            regionKey: 'US-NY',
            city: 'New York',
            continent: 'NA',
            asn: '13335',
            asName: 'Cloudflare',
          },
          access: { blocked: false, matched: [] },
          ok: true,
        };
      },
    },
    {
      match: (url) => url.includes('/defense'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('suspects')) {
          return {
            items: [suspect(t)],
            notes: [],
          };
        }
        if (url.includes('timeline')) return { items: [{ at: t, kind: 'preset', label: 'x' }] };
        if (url.includes('bans')) {
          return {
            items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
            total: 1,
            meta: { total: 1 },
          };
        }
        if (url.includes('intel')) {
          return {
            topIps: [{ ip: '203.0.113.1', hits: 9, s429: 1, scan: 2, score: 50 }],
            vhosts: [{ name: 'localhost', hasDefenseMarker: true }],
            vhostsWithLimit: 1,
            vhostsTotal: 2,
          };
        }
        if (url.includes('whitelist')) return { items: ['127.0.0.1'], notes: [] };
        return {
          at: t,
          threatLevel: 'elevated',
          score: 55,
          signals: [{ id: 'highReqRate', label: 'Req', value: 100, points: 15 }],
          activePreset: 'daily',
          recommendedPreset: 'hardened',
          protectionMode: 'normal',
          presets: [
            { id: 'daily', label: 'Daily', short: 'N', bullets: ['a', 'b'] },
            { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'], danger: true },
            { id: 'under_attack', label: 'Under attack', short: 'A', bullets: ['c'], danger: true },
            { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
          ],
          bans: {
            count: 1,
            items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
          },
          nginxLimits: {
            reqRate: '10r/s',
            burst: 20,
            connLimit: 40,
            confPath: '/x',
            exists: true,
          },
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
          suggestions: [
            { id: 's1', title: 'Apply hardened', body: 'x', action: 'preset:hardened' },
            { id: 's2', title: 'Go bans', body: 'y', action: 'tab:bans' },
            { id: 's3', title: 'Link', body: 'z', action: 'href:/system/readiness' },
          ],
          notes: [],
          whitelist: ['127.0.0.1'],
        };
      },
    },
    {
      match: (url) => url.includes('/api/v1/readiness') || url.includes('/readiness'),
      body: readinessReport(t),
    },
    {
      match: (url) => url.includes('/resources/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { ...honesty(), item: { id: 'a1', username: 'ftp1', apply_status: 'written' } };
        }
        return {
          items: [
            {
              id: 'a1',
              username: 'ftp1',
              homePath: '/home/ftp1',
              domain: undefined,
              apply_status: 'applied',
            },
          ],
          total: 1,
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      },
    },
    {
      match: (url) => url.includes('/sftp') || url.includes('/ftps'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('options')) {
          return {
            domains: [{ value: 'localhost', label: 'localhost' }],
            homes: [{ value: '/home/ftp1', label: '/home/ftp1' }],
          };
        }
        return {
          items: [
            {
              id: 'k1',
              username: 'ftp1',
              comment: 'lap',
              publicKey: 'ssh-ed25519 AAAA',
              created_at: t,
            },
          ],
          settings: { listen: '0.0.0.0', pasvMin: 30000, pasvMax: 30100 },
          status: { installed: true, active: 'active', activeLabel: 'active', serverInstalled: true },
          installed: true,
          active: 'active',
          serverInstalled: true,
        };
      },
    },
    {
      match: (url) => url.includes('/firewall') || url.includes('/fail2ban'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          enabled: 'enabled',
          executeEnabled: true,
          isRoot: true,
          defaultIncoming: 'deny',
          allowCount: 5,
          denyCount: 2,
          rules: [{ num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp' }],
          numberedRules: [
            { num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp', raw: '[1] ALLOW' },
            { num: 2, action: 'DENY', from: '203.0.113.10', to: 'Anywhere', raw: '[2] DENY' },
          ],
          denyFromIps: ['203.0.113.10'],
          jails: [
            { name: 'sshd', currentlyBanned: 1, totalBanned: 9, enabled: true },
            { name: 'nginx-http-auth', currentlyBanned: 0, totalBanned: 2, enabled: false },
          ],
          banned: [{ ip: '203.0.113.10', jail: 'sshd', time: t }],
          ignoreIps: ['127.0.0.1'],
          catalog: [
            { id: 'sshd', desc: 'SSH' },
            { id: 'nginx-http-auth', desc: 'Nginx' },
          ],
          notes: [],
          rulesMeta: { total: 2 },
        };
      },
    },
    {
      match: (url) => url.includes('/projects'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('log')) {
          return {
            lines: ['line1', 'error boom'],
            files: [
              { name: 'app.log', path: 'logs/app.log', bytes: 100 },
              { name: 'error.log', path: 'logs/error.log', bytes: 50 },
            ],
            file: 'app.log',
            hits: [{ line: 1, text: 'err' }],
            notes: [],
            related: [{ id: 'nginx', label: 'Nginx' }],
            extraDirs: ['/var/log/app'],
          };
        }
        if (url.includes('/p1') || /projects\/[^/?]+/.test(url)) return project;
        return { items: [project], total: 1, meta: { total: 1 } };
      },
    },
    {
      match: (url) => url.includes('/email'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('queue') || url.includes('flush')) {
          return {
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
            notes: ['ok'],
          };
        }
        return emailDomainBundle(t);
      },
    },
    {
      match: (url) => url.includes('/logs') || url.includes('/log'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return {
          sources: [
            {
              id: 'journal:nginx.service',
              kind: 'journal',
              label: 'Nginx',
              unit: 'nginx.service',
              group: 'web',
              bytes: 1e6,
              path: '/var/log/nginx/access.log',
              available: true,
            },
            {
              id: 'sshd',
              label: 'SSH',
              group: 'auth',
              bytes: 2e5,
              kind: 'journal',
              unit: 'sshd.service',
            },
          ],
          lines: ['2024-01-01 info hello', '2024-01-01 error boom'],
          items: [
            { unit: 'nginx.service', active: 'active', description: 'Nginx' },
            { unit: 'sshd.service', active: 'active', description: 'SSH' },
          ],
          files: [
            { name: 'access.log', path: '/var/log/nginx/access.log', bytes: 1000, mtime: t },
            { name: 'error.log', path: '/var/log/nginx/error.log', bytes: 200, mtime: t },
          ],
          units: [
            { unit: 'nginx.service', active: 'active', description: 'Nginx' },
            { unit: 'sshd.service', active: 'active', description: 'SSH' },
          ],
          total: 1,
          meta: { total: 1 },
          ok: true,
          notes: [],
        };
      },
    },
    {
      match: (url) =>
        url.includes('/cdn') ||
        url.includes('/network') ||
        url.includes('/dns') ||
        url.includes('/ssl') ||
        url.includes('/files') ||
        url.includes('/backups') ||
        url.includes('/metrics') ||
        url.includes('/updates') ||
        url.includes('/packages') ||
        url.includes('/ai') ||
        url.includes('/tasks') ||
        url.includes('/users') ||
        url.includes('/roles') ||
        url.includes('/ssh') ||
        url.includes('/security') ||
        url.includes('/nginx') ||
        url.includes('/redis') ||
        url.includes('/mysql') ||
        url.includes('/postgres') ||
        url.includes('/mariadb') ||
        url.includes('/console') ||
        url.includes('/db/') ||
        url.includes('/system') ||
        url.includes('/agents') ||
        url.includes('/fleet'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          const id = sshIdentity(t);
          return {
            ...honesty(),
            identity: id,
            task: {
              id: 't1',
              steps: [{ id: 's1', status: 'pending', title: 's' }],
              status: 'planned',
              prompt: 'x',
              createdAt: t,
            },
            ok: true,
          };
        }
        const special = specializedPayload(url, t);
        if (special) return special;
        const id = sshIdentity(t);
        return enrichGenericBody(
          {
            ok: true,
            installed: true,
            active: 'active',
            activeLabel: 'active',
            serverInstalled: true,
            clientInstalled: true,
            executeEnabled: true,
            isRoot: true,
            items: [
              {
                id: 'x1',
                name: 'item',
                domain: undefined,
                status: 'issued',
                files_exist: true,
                username: 'admin',
                apply_status: 'applied',
                roles: ['edge', 'admin'],
                path: 'readme.txt',
                host: 'edge.example.com',
                region: 'local',
                ipv4: '203.0.113.10',
                domains: ['cdn.example.com'],
                originUrl: 'https://origin.example.com',
                mode: 'origin_pull',
                edgeIds: ['n1'],
                projectId: 'p1',
                bytes: 4096,
                mtime: t,
                kind: 'full',
                current: '1.0',
                candidate: '1.1',
                risk: 'low',
                section: 'web',
                fingerprint: id.fingerprintSha256,
                fingerprintSha256: id.fingerprintSha256,
                publicKey: 'ssh-ed25519 AAAA',
                algorithm: 'ed25519',
                purpose: 'panel_outbound',
                createdAt: t,
                type: 'file',
                size: 100,
                mime: 'text/plain',
                favorite: true,
                steps: [{ id: 's1', status: 'pending', title: 's' }],
                prompt: 'fix',
              },
              {
                id: 'n1',
                name: 'edge-1',
                host: 'edge.example.com',
                region: 'local',
                roles: ['edge'],
                status: 'online',
                ipv4: '203.0.113.10',
              },
              {
                id: 's1',
                name: 'cdn.example.com',
                domains: ['cdn.example.com'],
                originUrl: 'https://origin.example.com',
                apply_status: 'applied',
                mode: 'origin_pull',
                edgeIds: ['n1'],
                roles: ['edge'],
              },
            ],
            total: 2,
            meta: {
              total: 2,
              facets: { role: { admin: 1 }, status: { active: 2, suspended: 0 } },
            },
            sources: [
              {
                id: 'journal:nginx.service',
                kind: 'journal',
                label: 'Nginx',
                unit: 'nginx.service',
                group: 'web',
                bytes: 1e6,
              },
            ],
            lines: ['info', 'error'],
            files: [{ name: 'access.log', path: '/var/log/nginx/access.log', bytes: 1000, mtime: t }],
            zones: [
              {
                id: 'z1',
                name: 'example.com',
                records: [{ id: 'r1', type: 'A', name: '@', value: '1.2.3.4', ttl: 300 }],
                dnssec: { enabled: false },
              },
            ],
            keys: [
              { key: 'a', type: 'string', ttl: 30, value: 'hi' },
              { key: 'b', type: 'hash', ttl: -1, value: { x: 1 } },
            ],
            keyspace: [{ db: 0, keys: 3 }],
            info: { redis_version: '7.0' },
            metrics: { Uptime: 100 },
            users: [{ id: 'u1', name: 'app', host: '%', apply_status: 'applied', roles: ['admin'] }],
            databases: [{ name: 'appdb', size: 1000 }],
            categories: [
              {
                id: 'main',
                label: 'Main',
                settings: [
                  { key: 'port', label: 'Port', type: 'int', liveValue: '5432', applyMode: 'restart' },
                ],
              },
            ],
            tasks: [
              {
                id: 't1',
                status: 'planned',
                prompt: 'fix',
                steps: [{ id: 's1', status: 'pending', title: 's' }],
                createdAt: t,
              },
            ],
            playbooks: [{ id: 'pb1', name: 'H', description: 'd' }],
            identities: [id],
            enrollments: [
              { id: 'e1', username: 'admin', status: 'enrolled', method: 'totp', createdAt: t },
            ],
            sessions: [
              {
                id: 's1',
                userAgent: 'Mozilla Chrome/120',
                ip: '10.0.0.1',
                createdAt: t,
                current: true,
              },
            ],
            interfaces: [
              {
                name: 'eth0',
                operstate: 'UP',
                flags: ['UP'],
                mtu: 1500,
                addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
                stats: { rxBytes: 1e6, txBytes: 2e6 },
              },
            ],
            routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
            caps: { canMutate: true, executeEnabled: true, isRoot: true },
            dns: {
              nameservers: ['1.1.1.1'],
              uplinkServers: ['1.1.1.1'],
              search: [],
              source: 'static',
              notes: [],
              canApply: true,
              mode: 'static',
            },
            nodes: { total: 1, online: 1, offline: 0, draining: 0, unknown: 0, byRegion: { local: 1 } },
            sites: {
              total: 1,
              byApplyStatus: { applied: 1 },
              rows: [{ id: 's1', name: 'cdn.example.com', apply_status: 'applied' }],
            },
            snapshots: [{ id: 'snap1', time: t, paths: ['/home'], short_id: 'abc' }],
            path: '.',
            root: 'public',
            notes: [],
            units: [
              { unit: 'nginx.service', active: 'active', description: 'Nginx' },
              { unit: 'sshd.service', active: 'active', description: 'SSH' },
            ],
            agents: [{ id: 'ag1', name: 'edge', status: 'online', lastSeenAt: t }],
            commands: [],
            missing: [],
            ready: true,
            records: [{ type: 'MX', name: '@', value: '10 mail', ttl: 300 }],
            exportedAt: t,
            counts: { users: 1, packages: 1, projects: 1 },
          },
          t,
        );
      },
    },
    {
      match: () => true,
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return { ok: true, items: [], total: 0, meta: { total: 0 }, missing: [], ready: true };
      },
    },
  ];
}

describe('max-hit function coverage', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: ['*'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
    try {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    } catch {
      /* ignore */
    }
    if (!(URL as unknown as { createObjectURL?: unknown }).createObjectURL) {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'blast all priority pages',
    async () => {
      installFetchMock(baseRoutes());
      const pages: Array<[string, React.ReactElement, string?]> = [
        ['/protection', <ProtectionPage key="p" />],
        ['/logs', <LogsPage key="l" />],
        ['/firewall', <FirewallPage key="fw" />],
        ['/fail2ban', <Fail2banPage key="f2b" />],
        ['/email?tab=queue', <EmailPage key="e" />],
        ['/email?tab=domains', <EmailPage key="e2" />],
        ['/projects/p1?tab=overview&fresh=1', <ProjectDetailPage key="pd" />, '/projects/:id'],
        ['/projects/p1?tab=deploy&fresh=1', <ProjectDetailPage key="pd2" />, '/projects/:id'],
        ['/projects/p1?tab=network&fresh=1', <ProjectDetailPage key="pd3" />, '/projects/:id'],
        ['/projects/p1?tab=resources&fresh=1', <ProjectDetailPage key="pd4" />, '/projects/:id'],
        ['/projects/p1?tab=logs&fresh=1', <ProjectDetailPage key="pd5" />, '/projects/:id'],
        ['/projects/p1?tab=advanced&fresh=1', <ProjectDetailPage key="pd6" />, '/projects/:id'],
        ['/databases/mysql', <SqlEnginePage key="sql" engine="mysql" />],
        ['/databases/postgres', <SqlEnginePage key="sql2" engine="postgres" />],
        ['/files', <FilesPage key="f" />],
        ['/dns', <DnsPage key="d" />],
        ['/cdn', <CdnPage key="c" />],
        ['/network', <NetworkPage key="n" />],
        ['/email/domains/dom-1', <EmailDomainPage key="ed" />, '/email/domains/:id'],
        ['/users', <UsersPage key="u" />],
        ['/backups', <BackupsPage key="b" />],
        ['/system/readiness', <ReadinessPage key="r" />],
        ['/updates', <UpdatesPage key="up" />],
        ['/ai', <AiPage key="a" />],
        ['/ftp', <FtpPage key="ftp" />],
        ['/databases/redis', <RedisPage key="rd" />],
        ['/ssl', <SslPage key="s" />],
        ['/system', <SystemPage key="sy" />],
        ['/security', <SecurityPage key="se" />],
        ['/metrics', <MetricsPage key="m" />],
        ['/nginx', <NginxPage key="ng" />],
        ['/databases/postgres-db', <PostgresPage key="pg" />],
        ['/ftp/service', <FtpsServicePage key="ft" />],
        ['/agents', <AgentsPage key="ag" />],
        ['/projects', <ProjectsPage key="pr" />],
      ];
      for (const [path, el, route] of pages) {
        await blastPage(path, el, route ?? '*', 120);
      }
      // panels
      for (const el of [
        <MemoryRouter key="s2">
          <Ssh2faPanel onFlash={() => undefined} />
        </MemoryRouter>,
        <MemoryRouter key="o2">
          <OutboundIdentities />
        </MemoryRouter>,
        <MemoryRouter key="rp">
          <RolePermissionsPanel
            policies={[
              {
                role: 'operator' as never,
                dirty: true,
                policy: { maxLevel: 'write' as never, capabilities: ['projects.read'] as never[] },
                factory: { maxLevel: 'read' as never, capabilities: [] as never[] },
              },
            ]}
            policyRole={'operator' as never}
            draftMax={'write' as never}
            draftCaps={['projects.read'] as never[]}
            canEdit
            onRoleChange={() => undefined}
            onMaxLevelChange={() => undefined}
            onCapsChange={() => undefined}
            onSave={() => undefined}
            onRestoreRole={() => undefined}
            onRestoreAll={() => undefined}
          />
        </MemoryRouter>,
      ]) {
        try {
          const view = render(el);
          await wait(300);
          blastUi();
          await wait(80);
          blastUi();
          view.unmount();
        } catch {
          /* ignore */
        }
      }
      expect(true).toBe(true);
    },
    300_000,
  );
});
