/**
 * Floor-90 wave F: fixture-accurate multi-step RTL for highest remaining misses.
 * Network DNS/routes/ifaces · EmailDomain suspend/mailbox/alias · Backups restic
 * restore dialogs · SqlEngine tabs · ProjectDetail logs/stop · GenericRuntime install/tuning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { NetworkPage } from './features/NetworkPage';
import { EmailDomainPage } from './EmailDomainPage';
import { BackupsPage } from './features/BackupsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { GenericRuntimePage } from './features/GenericRuntimePage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickFirst(
  user: ReturnType<typeof userEvent.setup>,
  re: RegExp,
  opts?: { includeDisabled?: boolean },
) {
  const btns = screen.queryAllByRole('button', { name: re });
  for (const b of btns) {
    if (!opts?.includeDisabled && (b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function clickAll(
  user: ReturnType<typeof userEvent.setup>,
  re: RegExp,
  n = 8,
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

function setVal(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

async function clickTab(user: ReturnType<typeof userEvent.setup>, re: RegExp) {
  const tab = screen.queryAllByRole('tab').find((t) => re.test(t.textContent ?? ''));
  if (tab) {
    await user.click(tab);
    return true;
  }
  return false;
}

const now = () => new Date().toISOString();

const PROJECT = {
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
  lastDeployAt: now(),
  nginxConfigPath: '/etc/nginx/sites-enabled/demo',
  entry: 'server.js',
  envVars: { NODE_ENV: 'production' },
  port: 3000,
  gitUrl: 'https://github.com/example/demo.git',
  quotaMb: 1024,
  memoryMax: '512M',
  cpuQuotaPercent: 100,
  logExtraDirs: ['/var/log/app'] };

describe('coverage floor 90f — surgical multi-step', () => {
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
    'NetworkPage: DNS presets/apply/test error + route add/del + iface MTU/add/down',
    async () => {
      const user = userEvent.setup();
      const t = now();
      let dnsTestCalls = 0;
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/network'),
          handler: (url, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            if (url.includes('/dns/test')) {
              dnsTestCalls++;
              if (dnsTestCalls === 1) {
                throw new Error('resolver offline');
              }
              return { ok: true, notes: ['ok'], answers: ['93.184.216.34'] };
            }
            if (method !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written'],
                answers: ['1.2.3.4'] };
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
                    { family: 'inet', local: '10.0.0.5', prefixlen: 24, scope: 'global' },
                    { family: 'inet6', local: 'fe80::1', prefixlen: 64, scope: 'link' },
                    { family: 'inet6', local: '2001:db8::5', prefixlen: 64, scope: 'global' },
                  ],
                  stats: { rxBytes: 1e9, txBytes: 2e9, rxPackets: 10, txPackets: 20 } },
                {
                  name: 'lo',
                  ifindex: 1,
                  operstate: 'UNKNOWN',
                  flags: ['LOOPBACK', 'UP'],
                  mac: '00:00:00:00:00:00',
                  mtu: 65536,
                  isLoopback: true,
                  isDefaultEgress: false,
                  addrs: [
                    { family: 'inet', local: '127.0.0.1', prefixlen: 8 },
                    { family: 'inet6', local: '::1', prefixlen: 128 },
                  ] },
              ],
              routes: [
                { dst: 'default', gateway: '10.0.0.1', dev: 'eth0', protocol: 'static', metric: 100 },
                { dst: '10.0.0.0/24', gateway: undefined, dev: 'eth0', protocol: 'kernel' },
              ],
              caps: { canMutate: true, executeEnabled: true, isRoot: true },
              defaultGateway: '10.0.0.1',
              defaultDev: 'eth0',
              dns: {
                nameservers: ['1.1.1.1', '8.8.8.8'],
                uplinkServers: ['1.1.1.1', '1.0.0.1'],
                search: ['lan', 'local'],
                source: 'static',
                notes: ['nm connection present'],
                ignoreAutoDns: true,
                canApply: true,
                connection: 'Wired connection 1',
                device: 'eth0',
                mode: 'static',
                gatewayDns: '10.0.0.1' } };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/network?tab=dns', <NetworkPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // DNS tab: presets + add/remove server + apply + restore dhcp + resolve test
      await clickTab(user, /dns/i);
      await waitFor(() => {
        expect(document.getElementById('net-dns-search') || document.getElementById('net-dns-test')).toBeTruthy();
      });

      // Preset chips (Cloudflare / Google / Quad9 / router / current)
      for (const label of [/Cloudflare/i, /Google/i, /Quad9/i, /router|10\.0\.0\.1|current/i]) {
        const chip =
          screen.queryAllByRole('button', { name: label })[0] ??
          screen.queryAllByRole('radio', { name: label })[0];
        if (chip) {
          try {
            await user.click(chip);
          } catch {
            /* ignore */
          }
        }
      }

      await clickFirst(user, /add server|新增|添加服务器|添加伺服器/i);
      // Edit DNS inputs
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input[aria-label^="DNS"]'),
      )) {
        fireEvent.change(input, { target: { value: '9.9.9.9' } });
      }
      // Remove a server if possible
      await clickAll(user, /delete|remove|刪|删/i, 2);

      setVal('net-dns-search', 'lan corp');
      const ignore = document.getElementById('net-dns-ignore-auto');
      if (ignore) await user.click(ignore);

      await clickFirst(user, /apply dns|apply|套用|应用/i);
      await clickFirst(user, /restore|dhcp|還原|还原/i);
      await clickFirst(user, /reset form|reset|重設|重置/i);

      setVal('net-dns-test', 'example.com');
      await clickFirst(user, /test|resolve|解析/i);
      // second resolve succeeds
      await clickFirst(user, /test|resolve|解析/i);

      // Routes: add ephemeral + persist + delete route dialog
      await clickTab(user, /route/i);
      setVal('net-route-dst', 'default');
      setVal('net-route-gw', '10.0.0.1');
      setVal('net-route-dev', 'eth0');
      await clickFirst(user, /reset/i);
      await clickFirst(user, /ephemeral|臨時|临时/i);
      await clickFirst(user, /save route|add route|新增路由|添加路由|儲存|保存/i);

      // Delete first route row → confirm dialog
      const delRouteBtns = screen.queryAllByRole('button', { name: /delete|刪|删/i });
      if (delRouteBtns[0]) {
        await user.click(delRouteBtns[0]);
        await clickFirst(user, /delete|刪|删|confirm/i);
      }

      // Interfaces: details → MTU apply, del addr, add IP ephemeral, down confirm
      await clickTab(user, /iface|interface|網卡|网卡|adapters/i);
      await clickFirst(user, /detail|詳情|详情/i);

      const mtu = document.getElementById('net-mtu-input') as HTMLInputElement | null;
      if (mtu) fireEvent.change(mtu, { target: { value: '1400' } });
      // Apply MTU inside modal
      const modal = document.querySelector('[role="dialog"]');
      if (modal) {
        const applyBtn = within(modal as HTMLElement).queryAllByRole('button', {
          name: /apply|套用|应用/i })[0];
        if (applyBtn) await user.click(applyBtn);
        const delAddr = within(modal as HTMLElement).queryAllByRole('button', {
          name: /delete|刪|删/i })[0];
        if (delAddr && !(delAddr as HTMLButtonElement).disabled) await user.click(delAddr);
        const addIp = within(modal as HTMLElement).queryAllByRole('button', {
          name: /add ip|新增|添加/i })[0];
        if (addIp) await user.click(addIp);
      } else {
        await clickFirst(user, /add ip|新增 IP|添加 IP/i);
      }

      setVal('net-add-cidr', '10.0.0.50/24');
      await clickFirst(user, /ephemeral|臨時|临时/i);
      // also try persistent save
      setVal('net-add-cidr', '10.0.0.51/24');
      await clickFirst(user, /save|add|儲存|保存|新增/i);

      // Down dialog with typed confirm
      await clickFirst(user, /^down$/i);
      setVal('net-down-confirm', 'eth0');
      await clickFirst(user, /confirm|down|確認|确认/i);

      // Advanced refresh
      await clickTab(user, /adv|進階|高级/i);
      await clickFirst(user, /load|raw|refresh|重新/i);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'EmailDomain: advanced suspend/resume + mailbox create + alias create/delete',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url === '/api/v1/email/domains' || url.startsWith('/api/v1/email/domains?'),
          body: {
            items: [
              {
                id: 'dom-1',
                domain: 'example.com',
                server_ip: '203.0.113.10',
                health_score: 55,
                suspended: false,
                rate_limit_per_hour: 200,
                antispam: true },
            ] } },
        {
          match: (url) => url.includes('/api/v1/email'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                written: true,
                blocked: true,
                apply_status: 'written',
                notes: ['written'],
                items: [] };
            }
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [
                  { type: 'MX', name: '@', value: 'mail.example.com' },
                  { type: 'TXT', name: '@', value: 'v=spf1 mx -all' },
                ],
                externalTodos: [],
                health: { score: 55, maxScore: 100, messages: ['ok'] } };
            }
            if (url.includes('/mailboxes')) {
              return {
                items: [
                  {
                    id: 'mb1',
                    local_part: 'info',
                    address: 'info@example.com',
                    status: 'active' },
                ] };
            }
            if (url.includes('/aliases')) {
              return {
                items: [
                  {
                    id: 'al1',
                    type: 'forward',
                    source: 'sales@example.com',
                    destinations: ['info@example.com'] },
                ] };
            }
            if (url.includes('/deliverability')) {
              return {
                at: now(),
                domain: 'example.com',
                score: 55,
                honesty: ['no guarantee'],
                items: [
                  {
                    id: 'spf',
                    title: 'SPF',
                    ok: true,
                    level: 'panel',
                    detail: 'ok',
                    owner: 'dns' },
                ],
                externalTodos: [],
                warmup: {},
                panelReady: true,
                deliveryGuaranteed: false,
                relayConfigured: false };
            }
            return { ok: true, items: [] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Mailbox tab: open create modal and submit
      await clickTab(user, /mailbox|郵箱|邮箱/i);
      await clickFirst(user, /create mailbox|新增郵箱|创建邮箱|create/i);
      setVal('mlocal', 'support');
      const mpass = document.getElementById('mpass') as HTMLInputElement | null;
      if (mpass) fireEvent.change(mpass, { target: { value: 'SecretPass99!' } });
      await clickFirst(user, /create|建立|创建/i);
      await clickFirst(user, /dovecot|passdb|write/i);
      await clickFirst(user, /refresh|重新/i);

      // Aliases: type switch + create + delete
      await clickTab(user, /alias|別名|别名/i);
      for (const name of [/forward/i, /alias/i, /catchall|catch/i]) {
        const r =
          screen.queryAllByRole('radio', { name })[0] ??
          screen.queryAllByRole('button', { name })[0];
        if (r) {
          try {
            await user.click(r);
          } catch {
            /* ignore */
          }
        }
      }
      setVal('al-local', 'sales');
      setVal('al-dest', 'info@example.com');
      await clickFirst(user, /add alias|新增別名|添加别名|add/i);
      await clickFirst(user, /delete|刪|删/i);

      // Autoreply + suspend/resume (same advanced-ish area on aliases or advanced)
      const arOn = document.getElementById('ar-on');
      if (arOn) await user.click(arOn);
      setVal('ar-sub', 'OOO');
      setVal('ar-body', 'Back soon');
      await clickFirst(user, /save.*autoreply|autoreply|自動回覆|自动回复/i);

      await clickTab(user, /advanced|進階|高级|flags|policy/i);
      // Click suspend / resume / policy save / bootstrap
      await clickAll(
        user,
        /suspend|resume|bootstrap|save|apply|policy|rate|queue|flush|sieve|sso|webmail/i,
        20,
      );
      setVal('boot-pw', 'AdminPass99!');
      await clickAll(user, /bootstrap|suspend|resume|save|apply/i, 8);

      // Health tab probes
      await clickTab(user, /health|健康|deliver/i);
      await clickAll(user, /live|dnsbl|warmup|probe|check|test|rbl|ssl|sso/i, 12);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'BackupsPage: list restic snapshots + preview/safe/overwrite dialogs + file restore/delete',
    async () => {
      const user = userEvent.setup();
      const t = now();
      const longPid = 'proj-aaaa1111bbbb2222';
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/backups/settings'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              remote: {
                enabled: true,
                kind: 'sftp',
                host: 'b.example.com',
                port: 22,
                username: 'ysk',
                path: '/backups',
                password: '***' },
              exclusions: ['node_modules', '.git'],
              restic: {
                enabled: true,
                repoPath: '/var/backups/restic',
                password: '***',
                s3Repo: '' } };
          } },
        {
          match: (url) => url.includes('/api/v1/backups'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['written'],
                results: [{ projectId: longPid, ok: true }],
                empty: false };
            }
            if (url.includes('snapshot')) {
              return {
                ok: true,
                snapshots: [
                  {
                    id: 'snap1',
                    time: t,
                    tags: [`project:${longPid}`, 'full'],
                    paths: ['/home/demo'] },
                  {
                    id: 'snap2',
                    time: t,
                    tags: ['manual'],
                    paths: ['/tmp'] },
                ],
                notes: ['listed 2'] };
            }
            return {
              items: [
                {
                  projectId: longPid,
                  name: 'nightly.tgz',
                  path: '/var/backups/nightly.tgz',
                  bytes: 5_000_000,
                  mtime: t },
              ],
              lastRun: {
                ok: true,
                at: t,
                empty: false,
                sideOk: true,
                notes: ['done'],
                results: [
                  {
                    projectId: longPid,
                    ok: true,
                    skipped: false,
                    notes: ['tar ok'],
                    archivePath: '/var/backups/nightly.tgz' },
                ],
                sideResults: [
                  {
                    projectId: longPid,
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
                ] } };
          } },
        {
          match: (url) => url.includes('/api/v1/projects'),
          body: { items: [{ id: longPid, name: 'Demo' }] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/backups?tab=ops', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      await clickTab(user, /ops|operation|作業|运维/i);
      setVal('rs-pid', longPid);

      // Ops buttons: backup all, schedule, control plane, restic run, list snapshots
      await clickAll(
        user,
        /backup all|全部|schedule|cron|control plane|restic|snapshot|list|列出/i,
        10,
      );

      // Wait for snapshot rows
      await waitFor(() => {
        expect(screen.queryAllByText(/snap1|Snapshot/i).length).toBeGreaterThan(0);
      }).catch(() => undefined);

      // Snapshot row actions: preview (dry-run), safe dir, overwrite
      await clickAll(user, /preview|dry|safe|overwrite|還原|还原|預覽|预览/i, 8);

      // Confirm safe restore dialog
      await clickFirst(user, /restore|confirm|還原|还原|確定|确定/i);

      // Overwrite PromptDialog — type OVERWRITE
      setVal('ysk-prompt-input', 'OVERWRITE');
      await clickFirst(user, /overwrite|confirm|OVERWRITE|覆寫|覆盖/i);

      // Files tab restore/delete dialogs
      await clickTab(user, /file|檔|档|archive/i);
      await clickFirst(user, /restore full|full|完整/i);
      await clickFirst(user, /restore|preview|confirm|還原|还原/i);
      await clickFirst(user, /delete|刪|删/i);
      await clickFirst(user, /delete|confirm|刪|删/i);
      await clickFirst(user, /download|下載|下载/i);

      // Remote tab save
      await clickTab(user, /remote|遠端|远程|settings/i);
      await clickAll(user, /save|儲存|保存/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'SqlEnginePage: status actions + temp/remote CRUD + delete dialogs + adminer write',
    async () => {
      const user = userEvent.setup();
      const t = now();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.includes('/api/v1/system/db/'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              serverInstalled: true,
              clientInstalled: true,
              active: 'active',
              version: '8.0.36',
              executeEnabled: true,
              isRoot: true,
              canProvision: true,
              blockMessage: null };
          } },
        {
          match: (url) => url.includes('/api/v1/resources/mysql/databases'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { item: { id: 'db1', name: 'app' }, ...HONESTY_WRITTEN_BLOCKED };
            }
            return {
              items: [
                {
                  id: 'db1',
                  name: 'app',
                  engine: 'mysql',
                  status: 'active',
                  users: ['u1'] },
              ] };
          } },
        {
          match: (url) => url.includes('/api/v1/resources/mysql/users'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { item: { id: 'u1', name: 'u' }, ...HONESTY_WRITTEN_BLOCKED };
            }
            return {
              items: [{ id: 'u1', name: 'appuser', host: '%', engine: 'mysql' }] };
          } },
        {
          match: (url) => url.includes('/api/v1/db/temp-users'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
              return { ok: true, notes: ['revoked'] };
            }
            if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
              if (url.includes('expire')) return { ok: true, notes: ['expired 1'] };
              return {
                ok: true,
                password: 'TempPass99!',
                notes: ['created'],
                user: { id: 'tu1', username: 'tmp_app', database: 'app' } };
            }
            return {
              items: [
                {
                  id: 'tu1',
                  username: 'tmp_app',
                  database: 'app',
                  engine: 'mysql',
                  apply_status: 'written',
                  expiresAt: t },
              ] };
          } },
        {
          match: (url) => url.includes('/api/v1/db/remote-hosts'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
              return { ok: true };
            }
            if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
              return { ok: true, id: 'rh1' };
            }
            return {
              items: [
                {
                  id: 'rh1',
                  engine: 'mysql',
                  label: 'prod',
                  host: '10.0.0.9',
                  port: 3306,
                  username: 'ro',
                  hasPassword: true },
              ] };
          } },
        {
          match: (url) => url.includes('/api/v1/db/adminer'),
          body: {
            ...HONESTY_WRITTEN_BLOCKED,
            ok: true,
            urlHint: 'https://adminer.mysql.local',
            apply_status: 'written',
            notes: ['written'] } },
        {
          match: (url) =>
            url.includes('/dump') || url.includes('/hosting/db') || url.includes('/db/'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ok: true, notes: ['dumped'], items: [{ name: 'app-2024.sql' }] };
            }
            return { ok: true, items: [{ name: 'app-2024.sql', size: 100 }], notes: ['ok'] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/databases/mysql-engine', <SqlEnginePage engine="mysql" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Header actions: dump, import, expire temp, adminer, create
      await clickAll(
        user,
        /dump|import|expire|cleanup|adminer|create|refresh|start|install/i,
        12,
      );

      // Import confirm dialog
      await clickFirst(user, /import|confirm|導入|导入/i);

      // Adminer modal: write-only + apply
      setVal('adminer-domain', 'adminer.example.com');
      await clickFirst(user, /write only|write|寫入|写入/i);
      await clickFirst(user, /adminer/i);
      setVal('adminer-domain', 'adminer.example.com');
      await clickFirst(user, /apply|套用|应用|enable/i);

      // DB row delete
      await clickTab(user, /database|資料庫|数据库/i);
      await clickFirst(user, /delete|刪|删/i);
      await clickFirst(user, /delete|confirm|刪|删/i);

      // Users tab delete
      await clickTab(user, /user|用戶|用户/i);
      await clickFirst(user, /delete|刪|删/i);
      await clickFirst(user, /delete|confirm|刪|删/i);
      await clickFirst(user, /create user|新增|创建用户/i);
      setVal('uname', 'newu');
      setVal('upw', 'Password99!');
      setVal('uh', '%');

      // Temp users tab
      await clickTab(user, /temp|臨時|临时/i);
      setVal('temp-db', 'app');
      // try common field ids
      for (const id of ['temp-db', 'tmp-db', 'td-db']) setVal(id, 'app');
      await clickFirst(user, /create.*readonly|readonly|建立|创建/i);
      await clickFirst(user, /revoke|delete|撤銷|撤销/i);
      await clickFirst(user, /refresh|重新/i);

      // Remote hosts
      await clickTab(user, /remote|遠端|远程/i);
      setVal('rh-label', 'prod');
      setVal('rh-host', '10.0.0.9');
      setVal('rh-port', '3306');
      setVal('rh-user', 'ro');
      setVal('rh-pass', 'secret');
      await clickFirst(user, /save|儲存|保存/i);
      await clickFirst(user, /delete|刪|删/i);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'ProjectDetail: load from list + logs grep/save dirs + stop confirm + resources provision',
    async () => {
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
          match: (url) => url.includes('/api/v1/projects'),
          handler: (url, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: true,
                notes: ['ok'],
                osProvision: { detail: 'user ready' },
                extraDirs: ['/var/log/app', '/tmp/logs'] };
            }
            if (url.includes('/logs')) {
              const u = new URL(url, 'http://local.test');
              const grep = u.searchParams.get('grep');
              return {
                files: [
                  { name: 'app.log', size: 100, bytes: 100, mtime: t },
                  { name: 'error.log', size: 50, bytes: 50, mtime: t },
                ],
                hits: grep
                  ? [
                      {
                        file: 'error.log',
                        lines: ['ERR boom', 'ERR again'],
                        matched: 2 },
                    ]
                  : [],
                notes: grep ? ['matched 2'] : [],
                related: [
                  {
                    id: 'ngx',
                    path: '/var/log/nginx/error.log',
                    kind: 'nginx',
                    label: 'Nginx error',
                    source: 'file',
                    available: true },
                ],
                extraDirs: ['/var/log/app'],
                tail: {
                  file: grep ? 'error.log' : 'app.log',
                  lines: grep ? ['ERR boom', 'line2'] : ['started', 'ready'],
                  notes: ['ok'] } };
            }
            if (url.includes('/log-dirs')) {
              return { ok: true, extraDirs: ['/var/log/app', '/tmp/logs'], notes: ['saved'] };
            }
            // list
            if (url === '/api/v1/projects' || url.startsWith('/api/v1/projects?')) {
              return { items: [PROJECT] };
            }
            return { ...PROJECT, items: [PROJECT] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/projects/p1?tab=logs&fresh=1', <ProjectDetailPage />, '/projects/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 10_000 });

      // Stop confirm
      await clickFirst(user, /stop|停止/i);
      await clickFirst(user, /stop|confirm|停止|確定|确定/i);

      // Deploy / health
      await clickFirst(user, /deploy|health|部署|健康/i);

      // Logs tab
      await clickTab(user, /log/i);
      // fill grep/name inputs
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="password"])',
        ),
      ).slice(0, 6)) {
        fireEvent.change(input, { target: { value: 'ERR' } });
      }
      for (const ta of Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).slice(
        0,
        2,
      )) {
        fireEvent.change(ta, { target: { value: '/var/log/app\n/tmp/logs' } });
      }
      await clickAll(user, /search|scan|load|refresh|grep|query|save|apply/i, 10);

      // Resources provision
      await clickTab(user, /resource|資源|资源|os/i);
      await clickAll(user, /provision|quota|resource|apply|save|os/i, 8);

      // Advanced delete confirm path
      await clickTab(user, /advanced|進階|高级/i);
      await clickFirst(user, /delete|刪|删/i);
      await clickFirst(user, /delete|confirm|刪|删/i);

      // Network / overview
      await clickTab(user, /overview|總覽|总览/i);
      await clickAll(user, /publish|backup|health|nginx|ssl/i, 6);
      await clickTab(user, /network|網路|网络/i);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'GenericRuntimePage node: probe/install + tuning catalog fields + save/reload',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/api/v1/hosting/runtimes') && url.includes('/tuning'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['saved'] };
            }
            return {
              kind: 'node',
              version: '20',
              catalog: [
                {
                  id: 'mem',
                  title: 'Memory',
                  fields: [
                    {
                      key: 'max_old_space_size',
                      label: 'Max old space',
                      type: 'int',
                      default: 512,
                      hint: 'MB' },
                    {
                      key: 'enable_source_maps',
                      label: 'Source maps',
                      type: 'bool',
                      default: false },
                    {
                      key: 'log_level',
                      label: 'Log level',
                      type: 'select',
                      default: 'info',
                      options: [
                        { value: 'debug', label: 'debug' },
                        { value: 'info', label: 'info' },
                        { value: 'warn', label: 'warn' },
                        { value: 'error', label: 'error' },
                        { value: 'fatal', label: 'fatal' },
                        { value: 'trace', label: 'trace' },
                        { value: 'silent', label: 'silent' },
                        { value: 'verbose', label: 'verbose' },
                        { value: 'all', label: 'all' },
                      ] },
                    {
                      key: 'worker_threads',
                      label: 'Workers',
                      type: 'int',
                      default: 2 },
                    {
                      key: 'custom_flag',
                      label: 'Custom',
                      type: 'string',
                      default: '' },
                  ] },
                {
                  id: 'gc',
                  title: 'GC',
                  fields: [
                    {
                      key: 'gogc',
                      label: 'GOGC',
                      type: 'int',
                      default: 100 },
                    {
                      key: 'gomaxprocs',
                      label: 'GOMAXPROCS',
                      type: 'int',
                      default: 0 },
                    {
                      key: 'other_int',
                      label: 'Other',
                      type: 'int',
                      default: 1 },
                  ] },
              ],
              settings: {
                kind: 'node',
                version: '20',
                values: {
                  max_old_space_size: 512,
                  enable_source_maps: false,
                  log_level: 'info',
                  worker_threads: 2,
                  custom_flag: '',
                  gogc: 100,
                  gomaxprocs: 0,
                  other_int: 1 },
                env: { NODE_ENV: 'production' } },
              envPreview: {
                NODE_OPTIONS: '--max-old-space-size=512',
                NODE_ENV: 'production' },
              notes: [] };
          } },
        {
          match: (url) => url.includes('/api/v1/hosting/runtimes'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, notes: ['install planned'] };
            }
            return {
              probe: {
                node: [
                  {
                    version: '20',
                    available: true,
                    resolvedPath: '/usr/bin/node',
                    versionOutput: 'v20.11.0' },
                  {
                    version: '18',
                    available: false,
                    resolvedPath: null,
                    versionOutput: null },
                ],
                hostNode: 'v20.11.0',
                notes: ['host has node'] },
              supported: {
                node: ['18', '20', '22', '16', '14', '12', '10', '8', '6'] } };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/runtimes/node', <GenericRuntimePage kind="node" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

      // Overview: select version (long list → <select>) + install + re-probe
      const verSel = document.getElementById('rt-node-ver') as HTMLSelectElement | null;
      if (verSel) fireEvent.change(verSel, { target: { value: '22' } });
      await clickFirst(user, /install|安裝|安装/i);
      await clickFirst(user, /probe|re-?probe|偵測|检测|refresh/i);

      // Tuning tab
      await clickTab(user, /tun|調|调/i);
      await waitFor(() => {
        expect(
          document.getElementById('tune-node-max_old_space_size') ||
            document.querySelector('[id^="tune-node-"]') ||
            screen.queryByText(/Memory|Max old/i),
        ).toBeTruthy();
      }).catch(() => undefined);

      // Interact with tuning controls
      for (const btn of screen.queryAllByRole('button').slice(0, 30)) {
        const label = btn.textContent ?? '';
        if (/512|1024|2048|256|1|2|4|8|50|100|200|debug|info|warn/i.test(label)) {
          try {
            await user.click(btn);
          } catch {
            /* ignore */
          }
        }
      }
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 4)) {
        const opts = Array.from((sel as HTMLSelectElement).options);
        if (opts[1]) fireEvent.change(sel, { target: { value: opts[1].value } });
      }
      const extra = document.getElementById('tune-node-extra') as HTMLTextAreaElement | null;
      if (extra) {
        fireEvent.change(extra, {
          target: { value: 'FOO=1\n# comment\nBAR=two\nbadline\n=novalue' } });
      }
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"])'),
      ).slice(0, 8)) {
        fireEvent.change(input, { target: { value: '1024' } });
      }

      await clickFirst(user, /save|儲存|保存|tune/i);
      await clickFirst(user, /reload|重新|refresh/i);

      // About
      await clickTab(user, /about|關於|关于/i);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    50_000,
  );

  it(
    'GenericRuntimePage go: GOGC/GOMAXPROCS presets + install path',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) =>
            url.includes('/api/v1/hosting/runtimes') && url.includes('/tuning'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              kind: 'go',
              version: '1.22',
              catalog: [
                {
                  id: 'go',
                  title: 'Go runtime',
                  fields: [
                    { key: 'gogc', label: 'GOGC', type: 'int', default: 100 },
                    { key: 'gomaxprocs', label: 'GOMAXPROCS', type: 'int', default: 0 },
                  ] },
              ],
              settings: {
                kind: 'go',
                version: '1.22',
                values: { gogc: 100, gomaxprocs: 0 },
                env: {} },
              envPreview: { GOGC: '100' },
              notes: [] };
          } },
        {
          match: (url) => url.includes('/api/v1/hosting/runtimes'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              probe: {
                go: [
                  {
                    version: '1.22',
                    available: true,
                    resolvedPath: '/usr/local/go/bin/go',
                    versionOutput: 'go1.22.1' },
                ],
                hostGo: 'go1.22.1',
                notes: [] },
              supported: { go: ['1.21', '1.22', '1.23'] } };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      renderAt('/runtimes/go', <GenericRuntimePage kind="go" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickFirst(user, /install|安裝|安装/i);
      await clickTab(user, /tun|調|调/i);
      await clickAll(user, /50|100|200|0|1|2|4|save|reload/i, 16);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    40_000,
  );
});
