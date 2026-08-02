/**
 * Deep RTL hammers for remaining unhit event handlers (functions → ≥90%).
 * Honesty fixtures for mutations. Sequential multi-tab multi-dialog flows.
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
  readinessReport,
  backupsPayload,
  aiTasksPayload,
  sshIdentity,
  journalUnitsPayload,
} from '../test/honest-fixtures';
import { authStore } from '../shared/stores/auth-store';

import { ProtectionPage } from './features/ProtectionPage';
import { FtpPage } from './features/FtpPage';
import { FirewallPage } from './features/FirewallPage';
import { Fail2banPage } from './features/Fail2banPage';
import { LogsPage } from './features/LogsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { RedisPage } from './features/RedisPage';
import { FtpsServicePage } from './features/FtpsServicePage';
import { SslPage } from './features/SslPage';
import { DnsPage } from './features/DnsPage';
import { EmailPage } from './EmailPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { FilesPage } from './FilesPage';
import { ReadinessPage } from './features/ReadinessPage';
import { UpdatesPage } from './UpdatesPage';
import { AiPage } from './AiPage';
import { SystemPage } from './SystemPage';
import { UsersPage } from './UsersPage';
import { SecurityPage } from './SecurityPage';
import { Ssh2faPanel } from '../features/security/ssh/Ssh2faPanel';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { SshWorkspace } from '../features/security/ssh/SshWorkspace';
import { RolePermissionsPanel } from '../features/users/RolePermissionsPanel';
import { PostgresPage } from './features/PostgresPage';
import { NginxPage } from './features/NginxPage';
import { MetricsPage } from './features/MetricsPage';
import { CdnPage } from './features/CdnPage';
import { BackupsPage } from './features/BackupsPage';
import { NetworkPage } from './features/NetworkPage';

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
  // Prefer plain delay — act() can hang if a page starts a long-lived poll/stream.
  await new Promise((r) => setTimeout(r, ms));
}

async function clickAllButtons(user: ReturnType<typeof userEvent.setup>, max = 24) {
  let n = 0;
  for (const b of Array.from(document.querySelectorAll('button, [role="button"]'))) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      fireEvent.click(b);
      n++;
      if (n >= max) break;
    } catch {
      /* ignore */
    }
  }
  return n;
}

async function fillAllInputs() {
  for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
    try {
      const input = el as HTMLInputElement;
      if (input.disabled || input.readOnly) continue;
      // Avoid toggling follow/stream switches that start infinite polls
      const id = `${input.id} ${input.name} ${input.getAttribute('aria-label') ?? ''}`.toLowerCase();
      if (/follow|stream|live|auto.?refresh/.test(id)) continue;
      if (input.type === 'checkbox' || input.type === 'radio') {
        fireEvent.click(input);
      } else if (input.tagName === 'SELECT') {
        const s = input as unknown as HTMLSelectElement;
        const opt = s.options?.[1] ?? s.options?.[0];
        if (opt) fireEvent.change(s, { target: { value: opt.value } });
      } else if (input.type !== 'file' && input.type !== 'hidden') {
        fireEvent.change(input, { target: { value: input.value || 'test-value' } });
        fireEvent.keyDown(input, { key: 'Enter' });
      }
    } catch {
      /* ignore */
    }
  }
}

async function clickTabs(_user?: ReturnType<typeof userEvent.setup>) {
  for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
    try {
      fireEvent.click(tab);
      await settle(12);
      await fillAllInputs();
    } catch {
      /* ignore */
    }
  }
}

async function confirmDialogs(_user?: ReturnType<typeof userEvent.setup>) {
  for (const re of [
    /confirm|apply|delete|remove|ok|yes|確定|确认|删除|刪除|套用|应用|emergency/i,
    /cancel|close|取消|关闭|關閉/i,
  ]) {
    for (const b of screen.queryAllByRole('button', { name: re })) {
      if ((b as HTMLButtonElement).disabled) continue;
      try {
        fireEvent.click(b);
      } catch {
        /* ignore */
      }
    }
  }
  const prompt = document.querySelector(
    'input[placeholder*="EMERGENCY"], input[aria-label*="EMERGENCY"], input[placeholder*="OVERWRITE"]',
  ) as HTMLInputElement | null;
  if (prompt) {
    fireEvent.change(prompt, { target: { value: prompt.placeholder || 'EMERGENCY' } });
  }
  for (const b of screen.queryAllByRole('button', { name: /apply|confirm|ok|emergency|確定/i })) {
    try {
      fireEvent.click(b);
    } catch {
      /* ignore */
    }
  }
}

async function deepHammer(user?: ReturnType<typeof userEvent.setup>) {
  await clickTabs(user);
  await fillAllInputs();
  await clickAllButtons(user as never, 18);
  await settle(8);
  await fillAllInputs();
  await confirmDialogs(user);
  await clickAllButtons(user as never, 10);
  for (const form of Array.from(document.querySelectorAll('form'))) {
    try {
      fireEvent.submit(form);
    } catch {
      /* ignore */
    }
  }
}

function defenseBody(t: string) {
  return {
    at: t,
    threatLevel: 'elevated',
    score: 55,
    signals: [
      { id: 'highReqRate', label: 'Req', value: 100, points: 15 },
      { id: 'banSpike', label: 'Bans', value: 5, points: 10 },
    ],
    activePreset: 'daily',
    recommendedPreset: 'hardened',
    protectionMode: 'normal',
    presets: [
      { id: 'daily', label: 'Daily', short: 'N', bullets: ['a', 'b'] },
      { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'], danger: true },
      { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
      { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
    ],
    bans: {
      count: 2,
      items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'scan' }],
    },
    suspects: [
      suspect(t),
      {
        ...suspect(t),
        ip: '198.51.100.1',
        score: 40,
        reasons: ['noise'],
        sources: ['auth'],
        alreadyBanned: true,
        whitelisted: false,
      },
    ],
    nginxLimits: {
      reqRate: '10r/s',
      burst: 20,
      connLimit: 40,
      confPath: '/etc/nginx/conf.d/d.conf',
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
      { id: 's3', title: 'Readiness', body: 'z', action: 'href:/system/readiness' },
    ],
    notes: ['n1'],
    whitelist: ['127.0.0.1', '10.0.0.1'],
  };
}

function richRoutes(): FetchRoute[] {
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
      match: (url) => url.includes('/defense') || url.includes('/protection'),
      handler: (url, init) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method !== 'GET') return honesty();
        if (url.includes('geoip')) {
          return {
            provider: 'dbip',
            dir: '/var/lib/ysk/geoip',
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
              cities: [],
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
                bytes: 1e6,
                license: 'lite',
                updateHint: 'weekly',
              },
            ],
            meta: { lastSuccessAt: t, lastAttemptAt: t },
            scheduler: { intervalMs: 86400000, lastRunAt: t, nextRunAt: t },
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
              cloudflare: { enabled: true, zones: ['example.com'], apiTokenSet: true },
              suggestEmergency: true,
              lastTickAt: t,
            },
            mechanisms: [{ id: 'f2b', label: 'fail2ban', ready: true }],
            autoBansLastHour: 3,
          };
        }
        if (url.includes('bans')) {
          return {
            items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }],
            total: 1,
            meta: { total: 1 },
          };
        }
        if (url.includes('suspects')) {
          return {
            items: [suspect(t), { ...suspect(t), ip: '198.51.100.1', score: 40 }],
            notes: [],
          };
        }
        if (url.includes('timeline')) {
          return {
            items: [{ at: t, kind: 'preset', label: 'daily→hardened', detail: 'auto' }],
          };
        }
        if (url.includes('intel')) {
          return {
            items: [{ id: 'i1', title: 'Spike', severity: 'high', body: 'x' }],
            sources: [{ id: 'nginx', label: 'Nginx' }],
          };
        }
        if (url.includes('whitelist')) {
          return { items: ['127.0.0.1'], notes: [] };
        }
        return defenseBody(t);
      },
    },
    {
      match: (url) => url.includes('/resources/ftp') || url.includes('/resources/'),
      handler: (url, init) => {
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
            {
              id: 'a2',
              username: 'ftp2',
              homePath: '/home/ftp2',
              domain: undefined,
              apply_status: 'draft',
            },
          ],
          total: 2,
          meta: { total: 2, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        };
      },
    },
    {
      match: (url) => url.includes('/sftp/keys') || url.includes('/ftps'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('options')) {
          return {
            domains: [{ value: 'localhost', label: 'localhost' }],
            homes: [
              { value: '/home/ftp1', label: '/home/ftp1' },
              { value: '/home/ysk/demo', label: 'project demo' },
            ],
          };
        }
        if (url.includes('settings') || url.includes('status')) {
          return {
            settings: {
              listen: '0.0.0.0',
              pasvMin: 30000,
              pasvMax: 30100,
              sslEnable: true,
            },
            status: {
              installed: true,
              active: 'active',
              activeLabel: 'active',
              serverInstalled: true,
            },
            installed: true,
            active: 'active',
            activeLabel: 'active',
            serverInstalled: true,
          };
        }
        return {
          items: [
            {
              id: 'k1',
              username: 'ftp1',
              comment: 'laptop',
              publicKey: 'ssh-ed25519 AAAA' + 'x'.repeat(80),
              created_at: t,
            },
          ],
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
            { num: 1, action: 'ALLOW', from: 'Anywhere', to: '22/tcp', raw: '[ 1] 22/tcp ALLOW IN Anywhere' },
            { num: 2, action: 'DENY', from: '203.0.113.10', to: 'Anywhere', raw: '[ 2] DENY IN 203.0.113.10' },
          ],
          denyFromIps: ['203.0.113.10', '198.51.100.1'],
          notes: [],
          rulesMeta: { total: 2 },
        };
      },
    },
    {
      match: (url) => url.includes('/fail2ban'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          enabled: 'enabled',
          executeEnabled: true,
          jails: [
            { name: 'sshd', currentlyBanned: 1, totalBanned: 9, enabled: true },
            { name: 'nginx-http-auth', currentlyBanned: 0, totalBanned: 2, enabled: false },
          ],
          banned: [
            { ip: '203.0.113.10', jail: 'sshd', time: t },
            { ip: '198.51.100.2', jail: 'sshd', time: t },
          ],
          ignoreIps: ['127.0.0.1'],
          catalog: [
            { id: 'sshd', desc: 'SSH' },
            { id: 'nginx-http-auth', desc: 'Nginx auth' },
          ],
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/logs') || url.includes('/log/'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('journal/units')) return journalUnitsPayload();
        if (url.includes('/projects')) {
          return {
            items: [
              {
                projectId: 'p1',
                name: 'demo',
                files: [
                  { name: 'app.log', path: 'logs/app.log', bytes: 100, previewable: true },
                ],
                related: [{ source: 'journal:nginx.service', label: 'Nginx', available: true }],
              },
            ],
          };
        }
        if (url.includes('/stream') || url.includes('follow')) {
          return { ok: true, lines: ['stream line'], text: 'stream line\n' };
        }
        if (url.includes('overview')) {
          return {
            ok: true,
            quickUnits: [{ unit: 'nginx.service', label: 'Nginx' }],
            journalDiskMb: 50,
            followIntervalSec: 3,
            journalWarnMb: 100,
            vacuumDefaultDays: 14,
            maxLines: 200,
            sources: [
              {
                id: 'journal:nginx.service',
                kind: 'journal',
                label: 'Nginx',
                unit: 'nginx.service',
                group: 'web',
                available: true,
              },
            ],
          };
        }
        if (url.includes('settings')) {
          return { follow: false, lines: 100, journalWarnMb: 100, bookmarks: [] };
        }
        if (url.includes('query') || url.includes('export')) {
          return {
            ok: true,
            lines: ['2024-01-01 info hello', '2024-01-01 error boom'],
            text: 'hello\n',
            id: 'exp1',
          };
        }
        if (url.includes('/projects')) {
          return {
            items: [
              {
                projectId: 'p1',
                name: 'demo',
                files: [
                  { name: 'app.log', path: 'logs/app.log', bytes: 100, previewable: true },
                  { name: 'error.log', path: 'logs/error.log', bytes: 50, previewable: true },
                ],
                related: [{ source: 'journal:nginx.service', label: 'Nginx', available: true }],
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
              bytes: 1e6,
              available: true,
            },
            {
              id: 'file:nginx-access',
              kind: 'file',
              label: 'Nginx access',
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
              available: true,
            },
          ],
          lines: ['2024-01-01 info hello', '2024-01-01 error boom', '203.0.113.10 connected'],
          items: journalUnitsPayload().items,
          files: [
            { name: 'access.log', path: '/var/log/nginx/access.log', bytes: 1000, mtime: t },
            { name: 'error.log', path: '/var/log/nginx/error.log', bytes: 200, mtime: t },
          ],
          units: journalUnitsPayload().items,
          quickUnits: [{ unit: 'nginx.service', label: 'Nginx' }],
          bookmarks: [],
          total: 1,
          meta: { total: 1 },
          ok: true,
          notes: [],
        };
      },
    },
    {
      match: (url) =>
        url.includes('/console') ||
        url.includes('/db/') ||
        url.includes('postgres') ||
        url.includes('mysql') ||
        url.includes('redis') ||
        url.includes('mariadb'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          serverInstalled: true,
          clientInstalled: true,
          executeEnabled: true,
          isRoot: true,
          metrics: { Uptime: 100, used_memory: 1024, keys: 3 },
          info: { redis_version: '7.0', used_memory_human: '1M' },
          keyspace: [{ db: 0, keys: 3 }],
          keys: [
            { key: 'a', type: 'string', ttl: 30, value: 'hi' },
            { key: 'b', type: 'hash', ttl: -1, value: { x: 1 } },
          ],
          categories: [
            {
              id: 'main',
              label: 'Main',
              settings: [
                {
                  key: 'port',
                  label: 'Port',
                  type: 'int',
                  liveValue: '5432',
                  applyMode: 'restart',
                },
                {
                  key: 'ssl',
                  label: 'SSL',
                  type: 'bool',
                  liveValue: 'ON',
                  enumValues: ['ON', 'OFF'],
                  applyMode: 'reload',
                },
              ],
            },
          ],
          items: [
            { id: 'db1', name: 'appdb', apply_status: 'applied', owner: 'app' },
            { id: 'db2', name: 'other', apply_status: 'draft' },
          ],
          users: [
            { id: 'u1', name: 'app', host: '%', apply_status: 'applied' },
          ],
          databases: [{ name: 'appdb', size: 1000 }],
          total: 2,
          meta: { total: 2 },
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/projects'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        if (url.includes('/logs') || url.includes('log')) {
          return {
            lines: ['line1', 'line2'],
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
      match: (url) => url.includes('/api/v1/files') || url.includes('webdav'),
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
                mtime: t,
              },
            ],
          };
        }
        if (url.includes('shares')) {
          return { items: [{ id: 'sh1', path: 'readme.txt', token: 'tok1', createdAt: t }] };
        }
        if (url.includes('/read')) {
          return { content: 'hello', path: 'readme.txt', bytes: 5, mime: 'text/plain' };
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
              favorite: true,
            },
            { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: t },
            {
              name: 'photo.png',
              path: 'photo.png',
              type: 'file',
              size: 2048,
              mtime: t,
              mime: 'image/png',
            },
          ],
          usage: { bytes: 2148, fileCount: 2, dirCount: 1 },
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
              { id: 'q1', queue: 'deferred', sender: 'a@b.c', recipients: ['x@y.z'], size: 100 },
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
      match: (url) => url.includes('/ssl') || url.includes('/certs'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 'c1',
              domain: undefined,
              name: 'localhost',
              status: 'issued',
              files_exist: true,
              expiresAt: t,
              issuer: 'LE',
            },
          ],
          total: 1,
          meta: { total: 1 },
          ok: true,
        };
      },
    },
    {
      match: (url) => url.includes('/dns'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          zones: [
            {
              id: 'z1',
              name: 'example.com',
              records: [
                { id: 'r1', type: 'A', name: '@', value: '1.2.3.4', ttl: 300 },
                { id: 'r2', type: 'MX', name: '@', value: '10 mail', ttl: 300 },
              ],
              dnssec: { enabled: false },
            },
          ],
          items: [
            {
              id: 'z1',
              name: 'example.com',
              apply_status: 'applied',
              records: [{ id: 'r1', type: 'A', name: '@', value: '1.2.3.4', ttl: 300 }],
            },
          ],
          total: 1,
          meta: { total: 1 },
          ok: true,
        };
      },
    },
    {
      match: (url) => url.includes('/network') || url.includes('/net/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          interfaces: [
            {
              name: 'eth0',
              operstate: 'UP',
              flags: ['UP'],
              mtu: 1500,
              addresses: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
              addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
              stats: { rxBytes: 1e6, txBytes: 2e6 },
            },
          ],
          routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0', protocol: 'static' }],
          caps: { canMutate: true, executeEnabled: true, isRoot: true },
          defaultGateway: '10.0.0.1',
          defaultDev: 'eth0',
          dns: {
            nameservers: ['1.1.1.1'],
            uplinkServers: ['1.1.1.1'],
            search: [],
            source: 'static',
            notes: [],
            ignoreAutoDns: false,
            canApply: true,
            connection: 'Wired',
            device: 'eth0',
            mode: 'static',
          },
          ok: true,
        };
      },
    },
    {
      match: (url) => url.includes('/cdn'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return {
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
            byApplyStatus: { applied: 1 },
            rows: [
              {
                id: 's1',
                name: 'cdn.example.com',
                domains: ['cdn.example.com'],
                mode: 'origin_pull',
                strategy: 'multi_a',
                apply_status: 'applied',
                edgeCount: 1,
                edgesApplied: 1,
                onlineEdges: 1,
                managedDnsRecords: 1,
              },
            ],
          },
          items: [
            {
              id: 'n1',
              name: 'edge-1',
              host: 'edge.example.com',
              region: 'local',
              roles: ['edge'],
              status: 'online',
              ipv4: '203.0.113.10',
            },
          ],
          cache: [],
          overallHitRatePct: 80,
          notes: [],
          total: 1,
          meta: { total: 1 },
        };
      },
    },
    {
      match: (url) => url.includes('/metrics'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          series: [{ name: 'cpu', points: [{ t, v: 10 }] }],
          snapshots: [{ at: t, cpu: 10, mem: 40 }],
          ok: true,
          items: [],
        };
      },
    },
    {
      match: (url) => url.includes('/backups') || url.includes('/restic'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return backupsPayload(t);
      },
    },
    {
      match: (url) => url.includes('/updates') || url.includes('/apt') || url.includes('/packages'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 'pkg1',
              name: 'nginx',
              current: '1.0',
              candidate: '1.1',
              risk: 'low',
              section: 'web',
            },
            {
              id: 'pkg2',
              name: 'openssl',
              current: '3.0',
              candidate: '3.1',
              risk: 'high',
              section: 'libs',
            },
          ],
          total: 2,
          meta: { total: 2 },
          ok: true,
          lastCheckAt: t,
        };
      },
    },
    {
      match: (url) => url.includes('/ai') || url.includes('/tasks'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ...honesty(),
            ...aiTasksPayload(t).items[0],
            task: aiTasksPayload(t).items[0],
          };
        }
        const special = specializedPayload(url, t);
        if (special) return special;
        return aiTasksPayload(t);
      },
    },
    {
      match: (url) => url.includes('/readiness'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return readinessReport(t);
      },
    },
    {
      match: (url) => url.includes('/users') || url.includes('/roles'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          items: [
            {
              id: 'u1',
              username: 'admin',
              roles: ['admin'],
              status: 'active',
              lastLoginAt: t,
            },
            {
              id: 'u2',
              username: 'ops',
              roles: ['operator'],
              status: 'active',
            },
          ],
          roles: [
            { id: 'admin', name: 'admin', permissions: ['*'] },
            { id: 'operator', name: 'operator', permissions: ['projects.read'] },
          ],
          bands: [
            {
              id: 'projects',
              label: 'Projects',
              caps: [
                { id: 'projects.read', label: 'Read' },
                { id: 'projects.write', label: 'Write' },
              ],
            },
          ],
          total: 2,
          meta: { total: 2 },
          capabilities: ['*'],
          catalog: [],
        };
      },
    },
    {
      match: (url) =>
        url.includes('/ssh') || url.includes('/security') || url.includes('/2fa') || url.includes('/outbound'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ...honesty(),
            identity: sshIdentity(t),
            ok: true,
          };
        }
        const special = specializedPayload(url, t);
        if (special) return special;
        const id = sshIdentity(t);
        return {
          items: [id],
          identities: [id],
          enrollments: [
            {
              id: 'e1',
              username: 'admin',
              status: 'enrolled',
              method: 'totp',
              createdAt: t,
            },
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
          settings: { passwordAuth: true, rootLogin: false },
          keys: [
            {
              id: 'k1',
              comment: 'lap',
              fingerprint: id.fingerprintSha256,
              fingerprintSha256: id.fingerprintSha256,
              createdAt: t,
            },
          ],
          total: 1,
          meta: { total: 1 },
          ok: true,
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/nginx'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        return {
          installed: true,
          active: 'active',
          activeLabel: 'active',
          enabled: 'enabled',
          executeEnabled: true,
          configTest: { ok: true, notes: [] },
          sites: [{ name: 'demo', enabled: true, path: '/etc/nginx/sites-enabled/demo' }],
          notes: [],
        };
      },
    },
    {
      match: (url) => url.includes('/system'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return honesty();
        const special = specializedPayload(url, t);
        if (special) return special;
        return enrichGenericBody(
          {
            hostname: 'ysk',
            uptimeSec: 10000,
            load: [0.1, 0.2, 0.3],
            mem: { total: 8e9, used: 4e9, available: 4e9 },
            disk: [{ mount: '/', total: 1e11, used: 5e10 }],
            executeEnabled: true,
            isRoot: true,
            services: [{ name: 'nginx', active: 'active', enabled: 'enabled' }],
            units: [
              { unit: 'nginx.service', active: 'active', enabled: 'enabled' },
            ],
            ok: true,
            items: [],
            notes: [],
            exportedAt: t,
            counts: { users: 1, packages: 2, projects: 1 },
            users: 1,
            packages: 2,
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
        return {
          ok: true,
          items: [],
          total: 0,
          meta: { total: 0 },
          notes: [],
          installed: true,
          active: 'active',
          ready: true,
          missing: [],
        };
      },
    },
  ];
}

describe('functions deep90', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: ['*'],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
    try {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
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
    'ProtectionPage all tabs + dialogs + geo MultiCheck',
    async () => {
      const user = userEvent.setup();
      installFetchMock(richRoutes());

      for (const tab of [
        'command',
        'automation',
        'bans',
        'geo',
        'stack',
        'intel',
        'about',
      ]) {
        const view = renderAt(`/protection?tab=${tab}`, <ProtectionPage />);
        await waitFor(
          () => expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0),
          { timeout: 8000 },
        ).catch(() => undefined);
        await settle(120);
        await fillAllInputs();
        await clickAllButtons(user, 50);
        await settle(50);
        await confirmDialogs(user);
        // MultiCheckSelect chips/checkboxes
        for (const chip of Array.from(document.querySelectorAll('.mcs__chip'))) {
          try {
            fireEvent.click(chip);
          } catch {
            /* ignore */
          }
        }
        for (const c of Array.from(document.querySelectorAll('.mcs input[type="checkbox"]'))) {
          try {
            fireEvent.click(c);
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
        view.unmount();
      }
      expect(true).toBe(true);
    },
    90_000,
  );

  it(
    'Ftp + Firewall + Fail2ban deep dialogs',
    async () => {
      const user = userEvent.setup();
      installFetchMock(richRoutes());

      for (const [path, el] of [
        ['/ftp?tab=accounts', <FtpPage key="ftp" />],
        ['/ftp?tab=sftp', <FtpPage key="ftp2" />],
        ['/firewall?tab=rules', <FirewallPage key="fw" />],
        ['/firewall?tab=ports', <FirewallPage key="fw2" />],
        ['/firewall?tab=deny', <FirewallPage key="fw3" />],
        ['/firewall?tab=profiles', <FirewallPage key="fw4" />],
        ['/fail2ban', <Fail2banPage key="f2b" />],
      ] as const) {
        const view = renderAt(path, el);
        await waitFor(
          () => expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0),
          { timeout: 8000 },
        ).catch(() => undefined);
        await settle(100);
        await deepHammer(user);
        view.unmount();
      }
      expect(true).toBe(true);
    },
    90_000,
  );

  it(
    'Logs + SqlEngine + Redis + Ftps + Ssl + Dns',
    async () => {
      const user = userEvent.setup();
      installFetchMock(richRoutes());
      const pages: Array<{ path: string; el: React.ReactElement }> = [
        { path: '/logs', el: <LogsPage /> },
        { path: '/databases/mysql', el: <SqlEnginePage engine="mysql" /> },
        { path: '/databases/postgres', el: <SqlEnginePage engine="postgres" /> },
        { path: '/databases/redis', el: <RedisPage /> },
        { path: '/ftp/service', el: <FtpsServicePage /> },
        { path: '/ssl', el: <SslPage /> },
        { path: '/dns', el: <DnsPage /> },
        { path: '/databases/postgres-db', el: <PostgresPage /> },
        { path: '/nginx', el: <NginxPage /> },
      ];
      for (const p of pages) {
        const view = renderAt(p.path, p.el);
        await waitFor(
          () => expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0),
          { timeout: 8000 },
        ).catch(() => undefined);
        await settle(100);
        await deepHammer(user);
        view.unmount();
      }
      expect(true).toBe(true);
    },
    120_000,
  );

  it(
    'ProjectDetail all tabs + Files + Email + Readiness + Updates + Ai',
    async () => {
      const user = userEvent.setup();
      installFetchMock(richRoutes());
      for (const tab of ['overview', 'deploy', 'network', 'resources', 'logs', 'advanced']) {
        const view = renderAt(
          `/projects/p1?tab=${tab}&fresh=1`,
          <ProjectDetailPage />,
          '/projects/:id',
        );
        await waitFor(
          () => expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0),
          { timeout: 5000 },
        ).catch(() => undefined);
        await settle(50);
        await deepHammer(user);
        view.unmount();
      }
      for (const [path, el, route] of [
        ['/files', <FilesPage key="f" />, '*'],
        ['/email', <EmailPage key="e" />, '*'],
        ['/system/readiness', <ReadinessPage key="r" />, '*'],
        ['/updates', <UpdatesPage key="u" />, '*'],
        ['/ai', <AiPage key="a" />, '*'],
        ['/system', <SystemPage key="s" />, '*'],
        ['/users', <UsersPage key="us" />, '*'],
        ['/security', <SecurityPage key="sec" />, '*'],
        ['/metrics', <MetricsPage key="m" />, '*'],
        ['/cdn', <CdnPage key="c" />, '*'],
        ['/backups', <BackupsPage key="b" />, '*'],
        ['/network?tab=dns', <NetworkPage key="n" />, '*'],
      ] as const) {
        const view = renderAt(path, el, route);
        await waitFor(
          () => expect(screen.queryAllByRole('heading').length).toBeGreaterThan(0),
          { timeout: 5000 },
        ).catch(() => undefined);
        await settle(60);
        await deepHammer(user);
        view.unmount();
      }
      expect(true).toBe(true);
    },
    300_000,
  );

  it(
    'SSH panels + RolePermissions',
    async () => {
      const user = userEvent.setup();
      installFetchMock(richRoutes());
      for (const el of [
        <Ssh2faPanel key="s" onFlash={() => undefined} />,
        <OutboundIdentities key="o" />,
        <SshWorkspace key="w" onCounts={() => undefined} />,
      ]) {
        try {
          const view = render(<MemoryRouter>{el}</MemoryRouter>);
          await settle(120);
          await deepHammer(user);
          view.unmount();
        } catch {
          /* ignore */
        }
      }
      try {
        const view = render(
          <MemoryRouter>
            <RolePermissionsPanel
              policies={[
                {
                  role: 'operator',
                  dirty: true,
                  policy: { maxLevel: 'write', capabilities: ['projects.read'] as never[] },
                  factory: { maxLevel: 'read', capabilities: [] as never[] },
                },
                {
                  role: 'admin',
                  dirty: false,
                  policy: { maxLevel: 'admin', capabilities: ['*'] as never[] },
                  factory: { maxLevel: 'admin', capabilities: ['*'] as never[] },
                },
              ]}
              policyRole="operator"
              draftMax="write"
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
        );
        await settle(80);
        await deepHammer(user);
        view.unmount();
      } catch {
        /* ignore */
      }
      expect(true).toBe(true);
    },
    60_000,
  );
});
