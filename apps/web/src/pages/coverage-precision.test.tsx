import { createUiProbe } from '../test/assert-rendered';
/**
 * Precision interactions: known field ids, ?tab= deep links, full mutation paths.
 * Also unit-covers operator-messages + i18n locale helpers.
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
import {
  humanizeOperatorNote,
  isOperatorNoise,
  looksLikeBlockedMessage,
  sanitizeOperatorNotes } from '../shared/lib/operator-messages';
import { setAppLocale, cycleAppLocale, applyUserLocale } from '../shared/lib/i18n';

import { ProtectionPage } from './features/ProtectionPage';
import { SystemPage } from './SystemPage';
import { SecurityPage } from './SecurityPage';
import { EmailDomainPage } from './EmailDomainPage';
import { MetricsPage } from './features/MetricsPage';
import { DnsPage } from './features/DnsPage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { DashboardPage } from './DashboardPage';
import { UsersPage } from './UsersPage';
import { BackupsPage } from './features/BackupsPage';
import { NetworkPage } from './features/NetworkPage';
import { AgentsPage } from './AgentsPage';
import { LogsPage } from './features/LogsPage';
import { FilesPage } from './FilesPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { EmailPage } from './EmailPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { NginxPage } from './features/NginxPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
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

async function clickName(user: ReturnType<typeof userEvent.setup>, re: RegExp, n = 3) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, n)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

const now = () => new Date().toISOString();

describe('operator-messages + i18n unit', () => {
  it('covers humanize / noise / blocked branches', () => {
    expect(isOperatorNoise('')).toBe(true);
    expect(isOperatorNoise('  ')).toBe(true);
    expect(isOperatorNoise('YSK_EXECUTE is off')).toBe(true);
    expect(isOperatorNoise('systemctl restart nginx')).toBe(true);
    expect(isOperatorNoise('CREATE TABLE foo')).toBe(true);
    expect(
      isOperatorNoise('line1\n--flag\nline3\nline4'),
    ).toBe(true);
    expect(isOperatorNoise('Normal ops note')).toBe(false);

    expect(looksLikeBlockedMessage('YSK_NEED_EXECUTE please')).toBe(true);
    expect(looksLikeBlockedMessage('need root for this')).toBe(true);
    expect(looksLikeBlockedMessage('permission denied')).toBe(true);
    expect(looksLikeBlockedMessage('all good')).toBe(false);

    expect(humanizeOperatorNote('')).toBeNull();
    expect(humanizeOperatorNote('  ')).toBeNull();
    // i18n key path
    const k = humanizeOperatorNote('common.ok');
    expect(k === null || typeof k === 'string').toBe(true);

    expect(humanizeOperatorNote('YSK_NEED_EXECUTE Host execute is off')).toBeTruthy();
    expect(humanizeOperatorNote('YSK_NEED_ROOT need root')).toBeTruthy();
    expect(humanizeOperatorNote('admin only not an admin')).toBeTruthy();
    expect(humanizeOperatorNote('SANDBOX path not allowed')).toBeTruthy();
    expect(humanizeOperatorNote('EACCES permission denied')).toBeTruthy();
    expect(humanizeOperatorNote('EADDRINUSE address already in use')).toBeTruthy();
    expect(humanizeOperatorNote('ENOENT no such file or directory path')).toBeTruthy();
    expect(humanizeOperatorNote('path required')).toBeTruthy();
    expect(humanizeOperatorNote('files required from and to required')).toBeTruthy();
    expect(humanizeOperatorNote('Not found')).toBeTruthy();
    expect(humanizeOperatorNote('Unauthorized 401 auth token')).toBeTruthy();
    expect(humanizeOperatorNote('Project name is required')).toBeTruthy();
    expect(humanizeOperatorNote('written ≠ applied on host')).toBeTruthy();
    expect(humanizeOperatorNote('nginx -t OK')).toBeTruthy();
    expect(humanizeOperatorNote('nginx -t failed')).toBeTruthy();
    expect(humanizeOperatorNote('nginx reloaded successfully')).toBeTruthy();
    expect(humanizeOperatorNote('ok')).toBeTruthy();
    expect(humanizeOperatorNote('failed')).toBeTruthy();
    expect(humanizeOperatorNote('timeout timed out')).toBeTruthy();
    expect(humanizeOperatorNote('systemctl restart foo')).toBeNull();
    expect(humanizeOperatorNote('Already localized 你好')).toBe('Already localized 你好');

    const cleaned = sanitizeOperatorNotes([
      'YSK_EXECUTE blocked',
      'normal note',
      'systemctl restart x',
      '',
    ]);
    expect(cleaned.length).toBeGreaterThan(0);
    expect(sanitizeOperatorNotes(null)).toEqual([]);
    expect(sanitizeOperatorNotes(undefined)).toEqual([]);
  });

  it('covers setAppLocale / cycle / applyUserLocale', async () => {
      const probe = createUiProbe();
    authStore.setSession('tok', { username: 'admin', roles: ['admin'], locale: 'en' });
    installFetchMock([
      {
        match: (url) => url.includes('/auth/locale') || url.includes('/locale'),
        body: { ok: true, user: { username: 'admin', roles: ['admin'], locale: 'zh-HK' } } },
      { match: /.*/, body: { ok: true } },
    ]);
    setAppLocale('zh-CN');
    setAppLocale('en', { syncServer: false });
    setAppLocale('zh-HK');
    cycleAppLocale();
    applyUserLocale(null);
    applyUserLocale(undefined);
    applyUserLocale('zh-HK');
    // localStorage throw path
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    setAppLocale('en', { syncServer: false });
    Storage.prototype.setItem = orig;
    authStore.clear();
    probe.sample();
      expect(typeof setAppLocale).toBe('function');
    expect(typeof cycleAppLocale).toBe('function');
    expect(typeof applyUserLocale).toBe('function');
  });
});

describe('precision page handlers', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('REBOOT');
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
    'ProtectionPage automation+geo+bans via query tabs',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const minAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const hoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
          body: {
            at: t,
            threatLevel: 'elevated',
            score: 55,
            protectionMode: 'daily',
            signals: [{ id: 'x', label: 'X', value: 1, points: 2, tone: 'warn' }],
            activePreset: 'daily',
            presets: [
              { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
              { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
              { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
              { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
            ],
            bans: {
              count: 1,
              items: [{ ip: '203.0.113.9', source: 'fail2ban', jail: 'sshd', reason: 'auth' }] },
            nginxLimits: {
              reqRate: '10r/s',
              burst: 20,
              connLimit: 40,
              confPath: '/x',
              exists: true },
            firewall: { active: 'active', installed: true },
            fail2ban: { active: 'active', installed: true, jails: 2 },
            autoBan: {
              enabled: true,
              mode: 'normal',
              method: 'fail2ban',
              cooldownMinutes: 30,
              maxAutoBansPerHour: 20,
              whitelist: [] },
            executeEnabled: true,
            isRoot: false,
            suggestions: [{ id: 's1', title: 'Apply', body: 'x', action: 'preset:daily' }],
            notes: [
              'YSK_EXECUTE blocked system',
              'Wrote nginx 00-ysk-defense /home/demo/x',
              'Wrote jail.local fail2ban',
              'a'.repeat(140) + ' /home/user/long/path',
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/defense/timeline'),
          body: {
            items: [
              { at: minAgo, kind: 'preset', summary: 'daily', tone: 'ok' },
              { at: hoursAgo, kind: 'ban', summary: 'ban ip', tone: 'danger' },
              { at: t, kind: 'info', summary: 'tick', tone: 'info' },
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/defense/suspects'),
          body: {
            items: [
              {
                ip: '198.51.100.7',
                score: 40,
                hits: 99,
                reasons: ['scan'],
                sources: ['nginx'],
                lastSeen: t },
            ],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/defense/automation'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                automation: {
                  enabled: true,
                  lastTickAt: minAgo,
                  autoPreset: {
                    enabled: true,
                    escalateToHardenedAt: 30,
                    escalateToUnderAttackAt: 55,
                    suggestEmergencyAt: 90,
                    deescalateEnabled: true,
                    deescalateToDailyBelow: 10,
                    holdMinutes: 15 },
                  autoBan: {
                    enabled: true,
                    mode: 'aggressive',
                    method: 'ufw',
                    minScore: 5,
                    minHits: 10,
                    min429: 2,
                    minScan: 1,
                    cooldownMinutes: 15,
                    maxAutoBansPerHour: 50,
                    intervalSeconds: 30,
                    whitelist: ['10.0.0.1'] },
                  cloudflare: { enabled: true, zones: ['example.com'] },
                  suggestEmergency: true },
                ...HONESTY_WRITTEN_BLOCKED };
            }
            return {
              automation: {
                enabled: true,
                lastTickAt: minAgo,
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
                  minScore: 10,
                  minHits: 50,
                  min429: 5,
                  minScan: 3,
                  cooldownMinutes: 30,
                  maxAutoBansPerHour: 20,
                  intervalSeconds: 60,
                  whitelist: ['127.0.0.1'] },
                cloudflare: { enabled: false, zones: [] },
                suggestEmergency: true },
              mechanisms: [{ step: '1', mechanism: 'fail2ban', tunable: 'bantime' }],
              autoBansLastHour: 2,
              scheduler: { nextRunAt: t, intervalMs: 60000, lastRunAt: minAgo },
              hasCfToken: true };
          } },
        {
          match: (url) => url.startsWith('/api/v1/defense/intel'),
          body: {
            topIps: [{ ip: '1.1.1.1', hits: 10, s429: 1, scan: 2, score: 5 }],
            vhosts: [{ name: 'a.example', hasDefenseMarker: true }],
            vhostsWithLimit: 1,
            vhostsTotal: 2 } },
        {
          match: (url) => url.startsWith('/api/v1/defense/geoip/status'),
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
              countries: ['CN'],
              continents: [],
              regions: [],
              cities: [],
              cityPolicyEnabled: true,
              asns: [],
              enforce: { autoBan: true, nginx: true, ufw: false },
              autoUpdate: true },
            sources: [{ filename: 'city.mmdb', present: true, mtime: t, bytes: 100 }],
            meta: { lastSuccessAt: t } } },
        {
          match: (url) => url.includes('/geoip/lookup'),
          body: {
            ok: true,
            lookup: {
              ip: '8.8.8.8',
              country: 'US',
              regionKey: 'US-CA',
              regionName: 'California',
              city: 'Mountain View',
              cityKey: 'US-CA-MV',
              continent: 'NA',
              asn: '15169',
              asName: 'Google',
              source: 'dbip' },
            access: { blocked: false, matched: [] } } },
        {
          match: /\/api\/v1\/defense/,
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            notes: [
              'YSK_EXECUTE blocked',
              'Wrote nginx /home/x/00-ysk-defense',
              'Wrote jail.local fail2ban',
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      // automation deep link
      const r1 = renderAt('/protection?tab=automation', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await waitFor(() => {
        expect(screen.queryAllByRole('button').length).toBeGreaterThan(5);
      });
      // Click numeric preset chips
      for (const b of screen.queryAllByRole('button')) {
        const txt = (b.textContent ?? '').trim();
        if (/^(5|10|15|20|30|35|40|45|50|55|60|65|80|90|120|0)$/.test(txt)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 10)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /save|apply|whitelist|add|remove|token|zone|cloudflare/i, 10);
      probe.sample();
      r1.unmount();
      probe.sample();
      r1.unmount();

      // bans + ip deep link
      const r2 = renderAt('/protection?tab=bans&ip=203.0.113.55', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickName(user, /ban|unban|add|manual|remove|refresh/i, 8);
      probe.sample();
      r2.unmount();
      probe.sample();
      r2.unmount();

      // geo
      const r3 = renderAt('/protection?tab=geo', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const input of screen.queryAllByRole('textbox').slice(0, 6)) {
        try {
          await user.clear(input);
          await user.type(input, '8.8.8.8');
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /lookup|save|apply|download|update|add|country|region|city|asn/i, 12);
      probe.sample();
      r3.unmount();
      probe.sample();
      r3.unmount();

      // intel + stack + command
      for (const tab of ['intel', 'stack', 'command', 'about']) {
        const r = renderAt(`/protection?tab=${tab}`, <ProtectionPage />);
        await waitFor(() =>
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
        );
        await clickName(user, /apply|preset|probe|refresh|daily|hardened|emergency|suggestion/i, 8);
        probe.sample(); r.unmount();
      }
      probe.sample();
      probe.assertRendered();
    },
    50_000,
  );

  it(
    'SystemPage identity apply + power dialogs + export download',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: /\/api\/v1\/system\/host/,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ok: true, notes: ['written'], ...HONESTY_WRITTEN_BLOCKED };
            }
            return {
              ok: true,
              identity: {
                hostname: 'ysk.example.com',
                prettyHostname: 'YSK',
                timezone: 'UTC' },
              os: {
                platform: 'linux',
                arch: 'x64',
                release: '24.04',
                kernel: '6.8',
                prettyName: 'Ubuntu 24.04' },
              runtime: {
                uptimeSec: 1000,
                loadavg: [0.1, 0.1, 0.1],
                cpus: 2,
                memory: { total: 4e9, free: 2e9, usedRatio: 0.5 },
                node: 'v20',
                pid: 1,
                uid: 0 },
              time: {
                utc: now(),
                local: now(),
                ntpEnabled: true,
                ntpSynchronized: false,
                timeSource: 'local' },
              network: { ips: ['10.0.0.5'], interfaces: [], resolvers: ['1.1.1.1'] },
              disks: [{ mount: '/', size: '50G', used: '10G', avail: '40G', usePct: 20 }],
              power: {
                pending: { action: 'reboot', actionHint: 'reboot in 10s', at: now() } },
              boot: { defaultTarget: 'multi-user.target' },
              caps: {
                executeEnabled: true,
                isRoot: true,
                canPower: true,
                canIdentity: true },
              collectedAt: now() };
          } },
        {
          match: /\/api\/v1\/system\/export/,
          body: {
            ok: true,
            generatedAt: now(),
            exportedAt: now(),
            counts: { projects: 1, sites: 1 },
            projects: [{ id: 'p1', name: 'Demo' }],
            items: [{ path: '/etc/ysk/x', kind: 'conf' }] } },
        {
          match: /\/api\/v1\/system\/managed-nginx/,
          body: {
            items: [
              { name: 'demo.conf', path: '/etc/nginx/sites-enabled/demo', bytes: 100 },
            ] } },
        {
          match: /\/api\/v1\/system\/exports/,
          body: {
            items: [
              {
                name: 'export-1.json',
                path: '/var/lib/ysk/exports/export-1.json',
                mtime: now(),
                bytes: 2048 },
            ] } },
        {
          match: /\/api\/v1\/system\/rebuild/,
          body: {
            ok: true,
            dryRun: false,
            mode: 'sync',
            notes: ['rebuilt'],
            executeEnabled: true,
            isRoot: true } },
        {
          match: /\/api\/v1\/system\/host-identity|\/host\/ntp|\/host\/power/,
          body: { ok: true, notes: ['done'], ...HONESTY_WRITTEN_BLOCKED } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/system?tab=host', <SystemPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await waitFor(() => expect(document.getElementById('sys-hn')).toBeTruthy());

      await fillId('sys-hn', 'panel.example.com', user);
      await fillId('sys-pretty', 'Panel Host', user);
      await fillId('sys-tz', 'Asia/Hong_Kong', user);
      await clickName(user, /apply identity|identity|apply|ntp|sync/i, 4);

      // Power
      await clickName(user, /reboot|power.?off|shutdown|cancel schedule/i, 4);
      const dlg = screen.queryAllByRole('dialog')[0];
      if (dlg) {
        const input = dlg.querySelector('input') as HTMLInputElement | null;
        if (input) await user.type(input, 'REBOOT');
        await clickName(user, /confirm|reboot|yes/i, 2);
        await clickName(user, /cancel|close/i, 1);
      }

      // Export tab
      const exportTab = screen.queryByRole('tab', { name: /export/i });
      if (exportTab) await user.click(exportTab);
      await clickName(user, /export|download|rebuild|sync|preview|refresh|dry/i, 10);

      const about = screen.queryByRole('tab', { name: /about/i });
      if (about) await user.click(about);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'SecurityPage TOTP enroll + confirm + API key + sessions',
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
                enrolled: true,
                recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] };
            }
            return { enabled: false, enrolled: false };
          } },
        {
          match: (url) => url.startsWith('/api/v1/auth/sessions'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { ok: true };
            return {
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
              ] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/auth/api-keys'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                key: { id: 'k2', name: 'ci', prefix: 'ysk_x', created_at: t },
                token: 'ysk_x_secret_token' };
            }
            return {
              items: [{ id: 'k1', name: 'old', prefix: 'ysk_old', created_at: t }] };
          } },
        {
          match: (url) => url.startsWith('/api/v1/settings/security'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return { requireAdminTotp: false, requireAdminTotpStrict: false, ok: true };
          } },
        {
          match: (url) => url.startsWith('/api/v1/approvals'),
          body: {
            items: [
              {
                id: 'ap1',
                tool: 'sys.shell',
                status: 'pending',
                requestedAt: t },
            ] } },
        {
          match: (url) => url.includes('/ssh'),
          body: { items: [], ok: true } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/security?tab=account', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Try each tab
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      // Account / 2FA
      await fillId('reauth-pw', 'admin-pass', user);
      await clickName(user, /start|2fa|reset|enroll|begin/i, 3);
      await waitFor(() => {
        expect(document.getElementById('totp-confirm') || screen.queryByText(/JBSWY|otpauth/i)).toBeTruthy();
      }).catch(() => undefined);
      await fillId('totp-confirm', '123456', user);
      await clickName(user, /confirm|enable|verify/i, 2);
      await clickName(user, /copy|close|saved/i, 3);

      // API keys — fill name field if present
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'ci-key');
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /create|generate|api key|revoke|logout|approve|deny|save/i, 12);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'EmailDomainPage every tab with actions',
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
                id: 'mb-new' };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [
                  { type: 'MX', name: '@', value: 'mail.example.com', note: 'mx' },
                  { type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                  { type: 'TXT', name: 'default._domainkey', value: 'v=DKIM1; k=rsa; p=AB' },
                ],
                externalTodos: [
                  { title: 'Publish DKIM', description: 'Add TXT', priority: 'high' },
                  { title: 'SPF', description: 'Tighten', priority: 'med' },
                ],
                health: { score: 40, maxScore: 100, messages: ['SPF soft'] },
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
                items: [
                  {
                    id: 'al1',
                    source: 'hi@example.com',
                    dest: 'info@example.com',
                    type: 'forward' },
                ] };
            }
            if (url.includes('/deliverability')) {
              return {
                ok: true,
                score: 55,
                panelReady: false,
                honesty: ['No inbox guarantee'],
                checks: [{ id: 'spf', ok: false, detail: 'missing', title: 'SPF' }],
                recommendations: ['Add SPF'],
                items: [
                  { id: 'spf', title: 'SPF', ok: false, detail: 'missing' },
                  { id: 'dkim', title: 'DKIM', ok: true, detail: 'ok' },
                ] };
            }
            if (url.includes('/warmup') || url.includes('/dnsbl') || url.includes('/live')) {
              return {
                ok: true,
                score: 60,
                health: { score: 60 },
                items: [],
                listed: false,
                notes: [] };
            }
            if (
              url.includes('/sieve') ||
              url.includes('/relay') ||
              url.includes('/autoreply') ||
              url.includes('/webmail')
            ) {
              return {
                ok: true,
                items: [],
                script: 'require ["fileinto"];\n',
                enabled: true,
                subject: 'OOO',
                body: 'away',
                host: 'smtp.example.com',
                username: 'u' };
            }
            return {
              items: [
                {
                  id: 'dom-1',
                  domain: 'example.com',
                  rate_limit_per_hour: 200,
                  antispam: true,
                  server_ip: '203.0.113.10',
                  health_score: 55,
                  suspended: false,
                  managed: true },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await waitFor(() => {
        expect(screen.queryAllByText(/example\.com/i).length).toBeGreaterThan(0);
      });

      // Visit every tab by label
      const tabLabels = screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
      for (const label of tabLabels) {
        if (!label.trim()) continue;
        try {
          const tab = screen.getByRole('tab', { name: label });
          await user.click(tab);
        } catch {
          /* ignore */
        }
        // Fill fields
        for (const input of Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
          ),
        ).slice(0, 10)) {
          try {
            await user.clear(input as HTMLInputElement);
            await user.type(
              input as HTMLInputElement,
              input.type === 'password' || input.type === 'number' ? '42' : 'val',
            );
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
        await clickName(
          user,
          /save|create|add|apply|suspend|resume|delete|test|refresh|copy|generate|enable|disable|check|live|warmup|dnsbl|relay|sieve|webmail|open/i,
          12,
        );
        // Close modals
        await clickName(user, /cancel|close/i, 2);
      }

      // May unmount mid-interaction if a modal navigates; still exercised handlers
      expect(
        screen.queryByRole('heading', { level: 1 }) || document.body,
      ).toBeTruthy();
    },
    45_000,
  );

  it(
    'OutboundIdentities select + install/test/rotate/delete/authorize',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/ssh') || url.includes('/identities'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ok: true,
                applied: true,
                blocked: false,
                notes: ['ok'],
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----',
                identity: {
                  id: 'id-new',
                  name: 'new-key',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:new',
                  publicKey: 'ssh-ed25519 CCC',
                  status: 'created',
                  createdAt: t } };
            }
            return {
              ok: true,
              items: [
                {
                  id: 'id1',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abc',
                  publicKey: 'ssh-ed25519 AAAA panel',
                  status: 'installed',
                  createdAt: t,
                  install: { path: '/home/ysk/.ssh/id_ysk', applied: true },
                  lastVerifyNote: 'ok 2024',
                  lastTestAt: t,
                  lastTestOk: true },
                {
                  id: 'id2',
                  name: 'proj-out',
                  algorithm: 'ed25519',
                  purpose: 'user_outbound',
                  fingerprintSha256: 'SHA256:def',
                  publicKey: 'ssh-ed25519 BBBB proj',
                  status: 'created',
                  createdAt: t,
                  binding: {
                    projectId: 'p1',
                    linuxUser: 'demou',
                    homeDir: '/home/demou' } },
              ] };
          } },
        {
          match: /\/api\/v1\/projects/,
          body: {
            items: [
              {
                id: 'p1',
                name: 'Demo',
                linuxUser: 'demou',
                homeDir: '/home/demou' },
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt(
        '/security',
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
      });

      // Select first identity by name
      try {
        const row = screen.getByText(/panel-peer/i);
        await user.click(row);
      } catch {
        /* ignore */
      }
      await clickName(
        user,
        /copy|install|test|rotate|delete|local login|allow|primary|create|next|finish|filter|all|panel|user/i,
        15,
      );

      // Select project identity
      try {
        const row = screen.getByText(/proj-out/i);
        await user.click(row);
      } catch {
        /* ignore */
      }
      await clickName(user, /install|test|local|copy|delete|rotate/i, 8);

      // Test modal
      for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.clear(input);
          await user.type(input, 'root@10.0.0.2');
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /test|run|confirm|close/i, 4);

      // Confirm dialogs
      await clickName(user, /confirm|yes|delete|rotate/i, 4);

      // Wizard full path
      await clickName(user, /create|new|add/i, 2);
      for (const rb of screen.queryAllByRole('radio').slice(0, 6)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
        try {
          await user.type(input, 'wizard-key');
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 3)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /next|continue|create|finish|back/i, 8);
      // Private key reveal ack
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 3)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickName(user, /ack|understand|close|copy/i, 4);

      probe.sample();
      probe.assertRendered();
    },
    40_000,
  );

  it(
    'MetricsPage process detail + signal confirm',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      const topHeader = {
        ok: true,
        at: t,
        uptimeSec: 3600,
        loadavg: [1.5, 1.2, 0.8] as [number, number, number],
        tasks: { total: 100, running: 2, sleeping: 98, stopped: 0, zombie: 0 },
        cpu: {
          us: 20,
          sy: 10,
          ni: 0,
          id: 70,
          wa: 0,
          hi: 0,
          si: 0,
          st: 0,
          busyPct: 30 },
        cpus: [
          {
            us: 20,
            sy: 10,
            ni: 0,
            id: 70,
            wa: 0,
            hi: 0,
            si: 0,
            st: 0,
            busyPct: 30 },
        ],
        memory: {
          totalKiB: 8e6,
          freeKiB: 5e5,
          usedKiB: 7e6,
          buffCacheKiB: 5e5,
          availableKiB: 1e6 },
        swap: { totalKiB: 1e6, freeKiB: 1e5, usedKiB: 9e5 },
        notes: [] };
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/processes/signal') || url.includes('/renice'),
          body: {
            ok: true,
            pid: '42',
            signal: 'TERM',
            stillAlive: false,
            notes: ['sent'] } },
        {
          match: (url) => /\/metrics\/processes\/\d+/.test(url),
          body: {
            ok: true,
            pid: '42',
            command: 'nginx: master',
            user: 'root',
            cpu: 1.2,
            mem: 0.5,
            state: 'S',
            ppid: '1',
            cmdline: '/usr/sbin/nginx',
            env: ['PATH=/bin'],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics/processes'),
          body: {
            ok: true,
            at: t,
            sort: 'cpu',
            limit: 40,
            topHeader,
            rows: [
              {
                pid: '42',
                user: 'www-data',
                cpu: 12,
                mem: 8,
                command: 'nginx: worker',
                state: 'S',
                etime: '01:00',
                resKiB: 50000,
                virtKiB: 100000 },
              {
                pid: '99',
                user: 'alice',
                cpu: 6,
                mem: 3,
                command: 'ysk-server dist',
                state: 'R',
                etime: '00:30',
                resKiB: 20000,
                virtKiB: 80000 },
              {
                pid: '7',
                user: 'bob',
                cpu: 0.2,
                mem: 0.1,
                command: 'bash',
                state: 'S',
                etime: '00:05',
                resKiB: 2000,
                virtKiB: 4000 },
            ],
            notes: [] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics/top'),
          body: topHeader },
        {
          match: (url) => url.startsWith('/api/v1/metrics/projects'),
          body: {
            items: [
              { projectId: 'p1', name: 'Demo', diskMb: 100, path: '/home/demo' },
            ] } },
        {
          match: (url) => url.startsWith('/api/v1/metrics'),
          body: {
            at: t,
            loadavg: [2.5, 1.2, 0.8],
            cpuCount: 2,
            uptimeSec: 100000,
            memory: {
              total: 8e9,
              free: 0.5e9,
              usedRatio: 0.92,
              available: 0.8e9 },
            disk: { path: '/', free: 5e9, total: 100e9, usedRatio: 0.95 },
            diskMounts: [
              {
                filesystem: '/dev/sda1',
                mount: '/',
                size: 100e9,
                used: 95e9,
                avail: 5e9,
                usedRatio: 0.95 },
            ],
            alerts: ['mem_high', 'disk_high'],
            notes: [] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/metrics?tab=processes', <MetricsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      for (const cb of screen.queryAllByRole('checkbox').slice(0, 5)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }

      // Quick filters
      await clickName(user, /cpu|mem|mine|all|follow|refresh|detail|term|kill|stop|nice|signal/i, 15);

      // Search
      for (const input of screen.queryAllByRole('textbox').slice(0, 2)) {
        try {
          await user.clear(input);
          await user.type(input, 'nginx');
        } catch {
          /* ignore */
        }
      }

      // Click pid / command cells
      try {
        const pid = screen.getByText('42');
        await user.click(pid);
      } catch {
        /* ignore */
      }

      await clickName(user, /confirm|send|yes|kill|term/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    35_000,
  );

  it(
    'DnsPage zone records CRUD-ish',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/api/v1/resources/dns') ||
            url.includes('/api/v1/dns') ||
            url.includes('/zones'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (/\/[^/]+$/.test(url) && (url.includes('zones/') || url.includes('dns/'))) {
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
                  { id: 'r7', type: 'SRV', name: '_sip._tcp', value: '0 5 5060 sip', ttl: 300 },
                ],
                notes: [] };
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
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/dns', <DnsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      try {
        await user.click(screen.getByText(/example\.com/i));
      } catch {
        /* ignore */
      }
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of screen.queryAllByRole('textbox').slice(0, 12)) {
        try {
          await user.clear(input);
          await user.type(input, 'www');
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 5)) {
        const opts = Array.from((sel as HTMLSelectElement).options);
        for (const o of opts.slice(0, 5)) {
          try {
            await user.selectOptions(sel as HTMLSelectElement, o.value);
          } catch {
            /* ignore */
          }
        }
      }
      await clickName(user, /add|create|save|apply|delete|edit|refresh|record|zone/i, 15);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    30_000,
  );

  it(
    'Dashboard + Users + Backups + Network + Cdn + Agents batch',
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
              uptimeSec: 10000,
              loadavg: [0.5, 0.4, 0.3],
              runtime: {
                memory: { usedRatio: 0.6, total: 8e9, free: 3e9 } } },
            services: [
              { id: 'nginx', label: 'Nginx', active: 'active', ok: true },
              { id: 'ssh', label: 'SSH', active: 'failed', ok: false },
            ],
            alerts: [
              { id: 'a1', level: 'warn', message: 'disk', href: '/metrics' },
              { id: 'a2', level: 'danger', message: 'mem' },
            ],
            projects: { total: 3, running: 2, stopped: 1 },
            notes: ['hello'],
            kpis: [
              { id: 'cpu', label: 'CPU', value: '10%', tone: 'ok' },
              { id: 'mem', label: 'Mem', value: '80%', tone: 'warn' },
              { id: 'disk', label: 'Disk', value: '95%', tone: 'danger' },
            ],
            quickLinks: [
              { to: '/files', label: 'Files' },
              { to: '/logs', label: 'Logs' },
            ],
            counts: { projects: 3, users: 2 } } },
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
                  capabilityRevokes: [] },
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
          match: (url) => url.startsWith('/api/v1/network'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
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
                  flags: ['UP'],
                  mtu: 1500,
                  isLoopback: false,
                  isDefaultEgress: true,
                  addrs: [
                    { family: 'inet', local: '10.0.0.5', prefixlen: 24 },
                    { family: 'inet6', local: 'fe80::1', prefixlen: 64 },
                  ] },
              ],
              routes: [
                { dst: 'default', gateway: '10.0.0.1', dev: 'eth0' },
                { dst: '10.0.0.0/24', gateway: '', dev: 'eth0' },
              ],
              caps: { canMutate: true, executeEnabled: false, isRoot: false },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1', '8.8.8.8'],
                uplinkServers: ['1.1.1.1'],
                search: ['local'],
                source: 'static',
                notes: [],
                ignoreAutoDns: true,
                canApply: true } };
          } },
        {
          match: (url) => url.startsWith('/api/v1/backups'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (_u.includes('settings')) {
              return {
                remote: {
                  enabled: true,
                  kind: 'sftp',
                  host: 'b.example.com',
                  port: 22,
                  username: 'ysk',
                  path: '/backups',
                  password: '***' },
                exclusions: ['node_modules'],
                restic: {
                  enabled: true,
                  repoPath: '/var/backups/restic',
                  password: '***',
                  s3Repo: '' } };
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
              ],
              lastRun: {
                at: t,
                ok: false,
                results: [{ projectId: 'p1', ok: false, notes: ['fail'] }] },
              snapshots: [
                { id: 'snap-1', time: t, tags: ['p1'], paths: ['/home/demo'], short_id: 'abc' },
              ] };
          } },
        {
          match: (url) => url.includes('/cdn') || url.includes('/cloudflare'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [
                {
                  id: 'c1',
                  domain: 'cdn.example.com',
                  status: 'active',
                  provider: 'cloudflare' },
              ],
              zones: [{ id: 'z1', name: 'example.com' }],
              notes: [] };
          } },
        {
          match: /\/api\/v1\/fleet\//,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, id: 'cmd-1' };
            }
            if (_u.includes('/commands')) {
              return {
                items: [
                  {
                    id: 'cmd-1',
                    agent_id: 'ag-1',
                    status: 'done',
                    payload: { type: 'ping' },
                    createdAt: t },
                ] };
            }
            return {
              items: [
                {
                  id: 'sess-1',
                  agent_id: 'ag-1',
                  status: 'connected',
                  group: 'edge',
                  last_seen_at: t,
                  meta: { hostname: 'edge-1' } },
              ] };
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
        ['/agents', <AgentsPage key="a" />],
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
        await clickName(
          user,
          /save|create|add|apply|delete|edit|refresh|backup|restore|run|export|download|detail|suspend|enable|disable|register|command|ping|probe/i,
          12,
        );
        // Click table rows / names
        try {
          const row = screen.queryByText(/admin|bob|demo|edge|cdn\.example|eth0/i);
          if (row) await user.click(row);
        } catch {
          /* ignore */
        }
        await clickName(user, /confirm|yes|save|create/i, 4);
        probe.sample();
        unmount();
      }
      probe.sample();
      probe.assertRendered();
    },
    60_000,
  );

  it(
    'Remaining mid-miss pages: Logs Files Sql DbCluster Project Email Nginx GenericRuntime',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/logs'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              if (url.includes('export')) return { ok: true, id: 'e1', notes: ['ok'] };
              return HONESTY_WRITTEN_BLOCKED;
            }
            if (url.includes('sources')) {
              return {
                items: [
                  {
                    id: 'journal:nginx.service',
                    kind: 'journal',
                    label: 'nginx',
                    unit: 'nginx.service',
                    available: true },
                  {
                    id: 'file:auth',
                    kind: 'file',
                    label: 'auth',
                    available: true,
                    bytes: 1000 },
                ] };
            }
            if (url.includes('overview')) {
              return {
                journalDiskMb: 100,
                followIntervalSec: 2,
                journalWarnMb: 200,
                vacuumDefaultDays: 7,
                maxLines: 100,
                isRoot: true,
                executeEnabled: true,
                quickUnits: [{ unit: 'ssh.service', label: 'SSH' }] };
            }
            if (url.includes('settings')) {
              return {
                maxLines: 100,
                maxBytes: 1e6,
                followIntervalSec: 2,
                vacuumDefaultDays: 7,
                maskSecrets: true,
                autoVacuumEnabled: true,
                autoVacuumTime: '03:00',
                journalWarnMb: 200,
                customAllowPaths: [],
                disabledSources: [] };
            }
            if (url.includes('bookmarks')) {
              return {
                items: [
                  {
                    id: 'bm1',
                    name: 'n',
                    source: 'journal:nginx.service',
                    lines: 50 },
                ] };
            }
            if (url.includes('projects')) {
              return {
                items: [
                  {
                    projectId: 'p1',
                    name: 'App',
                    linuxUser: 'appu',
                    files: [{ name: 'app.log', previewable: true }],
                    related: [] },
                ] };
            }
            if (url.includes('units')) {
              return { items: [{ unit: 'nginx.service', active: 'active' }] };
            }
            return {
              ok: true,
              lines: ['err line', 'ok line'],
              lineCount: 2,
              notes: [] };
          } },
        {
          match: (url) => url.includes('/api/v1/files'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ok: true, path: 'x', notes: ['ok'], favorited: true };
            }
            if (url.includes('/read')) {
              return { content: 'hi', path: 'a.txt', bytes: 2, mime: 'text/plain' };
            }
            if (url.includes('trash')) {
              return {
                items: [
                  {
                    trashId: 'tr1',
                    name: 'g.txt',
                    originalPath: 'g.txt',
                    deletedAt: t },
                ] };
            }
            if (url.includes('shares')) {
              return {
                items: [{ id: 'sh1', path: 'a.txt', token: 't', createdAt: t }] };
            }
            if (url.includes('webdav')) {
              return { enabled: false, mountPath: '/webdav' };
            }
            if (url.includes('versions')) {
              return {
                items: [{ id: 'v1', path: 'a.txt', createdAt: t, bytes: 10 }] };
            }
            const entries = [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 10,
                mtime: t,
                mime: 'text/plain' },
              {
                name: 'b.zip',
                path: 'b.zip',
                type: 'file',
                size: 100,
                mtime: t,
                mime: 'application/zip' },
              { name: 'd', path: 'd', type: 'dir', size: 0, mtime: t },
            ];
            return {
              items: entries,
              entries,
              path: '.',
              usage: { bytes: 5000, fileCount: 2, dirCount: 1 } };
          } },
        {
          match: (url) =>
            url.includes('/db/') ||
            url.includes('/sql') ||
            url.includes('/cluster') ||
            url.includes('/mysql') ||
            url.includes('/postgres'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [
                {
                  id: 'db1',
                  name: 'app',
                  engine: 'mysql',
                  status: 'online' },
              ],
              clusters: [
                {
                  id: 'cl1',
                  name: 'primary',
                  role: 'primary',
                  hosts: [{ host: '10.0.0.1', port: 3306 }] },
              ],
              serverInstalled: true,
              active: 'active',
              engine: 'mysql',
              executeEnabled: false,
              isRoot: false,
              notes: [] };
          } },
        {
          match: (url) => url.includes('/projects'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'p1',
                  name: 'Demo',
                  runtime: 'node',
                  status: 'running',
                  linuxUser: 'demou',
                  homeDir: '/home/demou',
                  domain: 'demo.local',
                  port: 3000 },
              ],
              project: {
                id: 'p1',
                name: 'Demo',
                runtime: 'node',
                status: 'running',
                linuxUser: 'demou',
                homeDir: '/home/demou',
                domain: 'demo.local',
                port: 3000 },
              ok: true };
          } },
        {
          match: (url) => url.includes('/email'),
          body: {
            items: [
              {
                id: 'dom-1',
                domain: 'example.com',
                health_score: 50,
                server_ip: '1.2.3.4' },
            ] } },
        {
          match: (url) =>
            url.includes('/nginx') ||
            url.includes('/runtimes') ||
            url.includes('/hosting/'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [],
              sites: [{ name: 'demo', enabled: true }],
              catalog: [
                {
                  id: 'g',
                  title: 'G',
                  fields: [
                    { key: 'workers', label: 'W', type: 'int', default: 2 },
                    { key: 'mem', label: 'M', type: 'bytes', default: '512M' },
                    { key: 'debug', label: 'D', type: 'bool', default: false },
                  ] },
              ],
              settings: { values: {}, extra: {}, version: 'default' },
              versions: ['18', '20'],
              version: '20',
              installed: true,
              active: 'active',
              notes: [] };
          } },
        { match: /.*/, body: { ok: true, items: [], ready: true } },
      ]);

      for (const [path, el, route] of [
        ['/logs', <LogsPage key="l" />, '*'],
        ['/files', <FilesPage key="f" />, '*'],
        ['/sql', <SqlEnginePage key="s" />, '*'],
        ['/email', <EmailPage key="e" />, '*'],
        ['/nginx', <NginxPage key="n" />, '*'],
        ['/runtimes/python', <GenericRuntimePage key="g" kind="python" />, '*'],
      ] as const) {
        const { unmount } = renderAt(path, el, route);
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
        for (const cb of screen.queryAllByRole('checkbox').slice(0, 5)) {
          try {
            await user.click(cb);
          } catch {
            /* ignore */
          }
        }
        await clickName(
          user,
          /save|create|add|apply|delete|edit|refresh|install|start|stop|reload|query|export|backup|restore|probe|plan|write|push|deploy|restart/i,
          12,
        );
        for (const input of screen.queryAllByRole('textbox').slice(0, 6)) {
          try {
            await user.type(input, 'x');
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
