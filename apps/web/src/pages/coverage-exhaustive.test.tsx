/**
 * Exhaustive interaction harness: fill all textboxes, click all enabled buttons/tabs.
 * Designed to force-render large conditional branches on hole pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { ProtectionPage } from './features/ProtectionPage';
import { BackupsPage } from './features/BackupsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { FilesPage } from './FilesPage';
import { UsersPage } from './UsersPage';
import { SecurityPage } from './SecurityPage';
import { LogsPage } from './features/LogsPage';
import { DnsPage } from './features/DnsPage';
import { SystemPage } from './SystemPage';
import { AgentsPage } from './AgentsPage';
import { CronPage } from './features/CronPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { MetricsPage } from './features/MetricsPage';
import { NetworkPage } from './features/NetworkPage';
import { CdnPage } from './features/CdnPage';
import { DashboardPage } from './DashboardPage';
import { FtpPage } from './features/FtpPage';
import { PhpRuntimePage } from './features/PhpRuntimePage';
import { OutboundIdentities } from '../features/security/ssh/OutboundIdentities';
import { DbClusterPanel } from '../features/db-service/DbClusterPanel';

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
  await new Promise((r) => setTimeout(r, ms));
}

async function exhaust(user: ReturnType<typeof userEvent.setup>, rounds = 3) {
  for (let r = 0; r < rounds; r++) {
    // Tabs
    const tabLabels = screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
    for (const label of tabLabels) {
      if (!label.trim()) continue;
      try {
        const tab =
          screen.queryByRole('tab', { name: label }) ??
          screen.queryAllByRole('tab').find((el) => el.textContent === label);
        if (tab) {
          await user.click(tab);
          await settle(30);
        }
      } catch {
        /* ignore */
      }
    }

    // Text fields including password/number via querySelector
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea',
      ),
    ).slice(0, 30)) {
      try {
        input.focus();
        await user.clear(input as HTMLInputElement);
        await user.type(
          input as HTMLInputElement,
          input.type === 'number' || input.type === 'password' ? 'Secret12!' : 'test-value-1',
        );
      } catch {
        /* ignore */
      }
    }

    // Checkboxes / radios
    for (const cb of screen.queryAllByRole('checkbox').slice(0, 12)) {
      try {
        await user.click(cb);
      } catch {
        /* ignore */
      }
    }
    for (const rb of screen.queryAllByRole('radio').slice(0, 10)) {
      try {
        await user.click(rb);
      } catch {
        /* ignore */
      }
    }

    // Selects
    for (const sel of Array.from(document.querySelectorAll('select')).slice(0, 8)) {
      try {
        const opt = sel.querySelector('option:not([value=""])') as HTMLOptionElement | null;
        if (opt) {
          await user.selectOptions(sel, opt.value);
        }
      } catch {
        /* ignore */
      }
    }

    // Buttons
    const buttons = screen.queryAllByRole('button');
    for (const b of buttons.slice(0, 30)) {
      if ((b as HTMLButtonElement).disabled) continue;
      const name = (b.textContent ?? '').toLowerCase();
      if (name.includes('logout') || name.includes('language')) continue;
      try {
        await user.click(b);
        await settle(20);
      } catch {
        /* ignore */
      }
    }

    // Confirm / submit dialogs
    for (const b of screen
      .queryAllByRole('button', {
        name: /confirm|delete|yes|apply|save|ok|create|submit|install|ban|lookup/i })
      .slice(0, 10)) {
      try {
        await user.click(b);
        await settle(20);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Rich universal routes covering most panel APIs. */
function megaRoutes(): FetchRoute[] {
  const now = new Date().toISOString();
  return [
    softwareReadyRoute(),
    {
      match: (url) =>
        url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
      body: {
        at: now,
        threatLevel: 'elevated',
        score: 66,
        signals: [
          { id: 'highReqRate', label: 'Req', value: 9, points: 9 },
          { id: 'f2bBans', label: 'Bans', value: 2, points: 4 },
        ],
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
          confPath: '/x',
          exists: true },
        firewall: { active: 'inactive', installed: true },
        fail2ban: { active: 'inactive', installed: true, jails: 1 },
        labels: {
          firewall: { short: 'off', tone: 'warn' },
          fail2ban: { short: 'off', tone: 'warn' },
          apply: { short: 'written', tone: 'info' },
          autoBan: { short: 'on', tone: 'ok' } },
        autoBan: {
          enabled: true,
          mode: 'normal',
          method: 'fail2ban',
          cooldownMinutes: 30,
          maxAutoBansPerHour: 20,
          whitelist: ['127.0.0.1'] },
        executeEnabled: false,
        isRoot: false,
        suggestions: [
          { id: 's1', title: 'Apply daily', body: 'x', action: 'preset:daily' },
          { id: 's2', title: 'Bans', body: 'y', action: 'tab:bans' },
        ],
        notes: [] } },
    {
      match: (url) => url.startsWith('/api/v1/defense/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        return {
          items: [
            {
              ip: '198.51.100.7',
              score: 40,
              hits: 20,
              reasons: ['scan'],
              sources: ['nginx'],
              lastSeen: now,
              alreadyBanned: false,
              whitelisted: false },
          ],
          notes: [],
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
              minScore: 10,
              minHits: 50,
              min429: 5,
              minScan: 3,
              cooldownMinutes: 30,
              maxAutoBansPerHour: 20,
              intervalSeconds: 60,
              whitelist: [] },
            signalWeights: {},
            cloudflare: { enabled: false, zones: [], onAutoEscalate: false } },
          mechanisms: [{ step: '1', mechanism: 'fail2ban', tunable: 'bantime' }],
          topIps: [{ ip: '1.1.1.1', hits: 1, s429: 0, scan: 0, score: 1 }],
          vhostLimits: { withLimit: 0, total: 0, items: [] },
          hasCfToken: false,
          cfZones: [],
          provider: 'dbip',
          dir: '/var/lib/geo',
          ready: true,
          stale: false,
          cityReady: true,
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
          meta: {},
          attribution: [],
          notes: [] };
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
            exclusions: ['node_modules', '.git'],
            restic: { enabled: true, repoPath: '/var/backups/restic', password: '***' } };
        }
        return {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              path: '/var/backups/p1.tgz',
              bytes: 2048,
              mtime: now,
              kind: 'full' },
          ],
          lastRun: { at: now, ok: true },
          snapshots: [{ id: 'snap-1', time: now, short_id: 'abc' }] };
      } },
    {
      match: (url) => url.includes('/api/v1/email/domains'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        if (url.includes('/dns')) {
          return {
            domain: 'example.com',
            records: [
              { type: 'MX', name: '@', value: 'mail.example.com', note: 'mail' },
              { type: 'TXT', name: '@', value: 'v=spf1', note: 'spf' },
            ],
            externalTodos: ['Add SPF at registrar'],
            health: { score: 40, maxScore: 100, messages: ['SPF missing'] },
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
        if (url.includes('dom-1') && !url.includes('?')) {
          return {
            id: 'dom-1',
            domain: 'example.com',
            rate_limit_per_hour: 200,
            antispam: true,
            server_ip: '203.0.113.10',
            apply_status: 'planned' };
        }
        return {
          items: [
            {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10' },
          ] };
      } },
    {
      match: (url) =>
        url.includes('/api/v1/files') ||
        url.includes('/hosting/files') ||
        url.includes('/trash') ||
        url.includes('/shares'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { ...HONESTY_WRITTEN_BLOCKED, ok: true, path: '/a' };
        }
        if (url.includes('trash')) {
          return {
            items: [
              {
                name: 'old.txt',
                path: 'old.txt',
                type: 'file',
                size: 1,
                deletedAt: now,
                mtime: now },
            ] };
        }
        if (url.includes('share')) {
          return {
            items: [{ id: 'sh1', path: 'a.txt', token: 'tok', createdAt: now }] };
        }
        if (url.includes('/read')) {
          return { content: 'hello', path: 'a.txt', bytes: 5 };
        }
        return {
          ok: true,
          path: '/',
          entries: [
            { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now },
            { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
          ],
          items: [
            { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now },
            { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
          ] };
      } },
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
              locale: 'en' },
            {
              id: 'u2',
              username: 'ops',
              roles: ['operator'],
              packageId: 'pkg1',
              suspended: false,
              locale: 'en' },
          ],
          hostUsage: { projects: 2, diskMb: 100, limitMb: 10240 } };
      } },
    {
      match: (url) => url.startsWith('/api/v1/packages'),
      body: {
        items: [
          {
            id: 'pkg1',
            name: 'default',
            maxProjects: 10,
            maxMailboxes: 10,
            maxDatabases: 5,
            diskMb: 10240,
            bandwidthMb: 0,
            ftp: true,
            ssh: true },
        ] } },
    {
      match: (url) => url.includes('/api/v1/rbac'),
      body: {
        items: [
          {
            role: 'operator',
            dirty: true,
            policy: { maxLevel: 'write-high', capabilities: ['projects.read', 'projects.write'] },
            factory: { maxLevel: 'write-high', capabilities: ['projects.read'] } },
          {
            role: 'admin',
            dirty: false,
            policy: { maxLevel: 'admin', capabilities: [] },
            factory: { maxLevel: 'admin', capabilities: [] } },
        ] } },
    {
      match: (url) => url.startsWith('/api/v1/auth/'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ok: true,
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/YSK:admin',
            enabled: true,
            enrolled: true,
            recoveryCodes: ['aaaa-bbbb'],
            token: 'ysk_tok',
            key: { id: 'k2', name: 'n', prefix: 'ysk_n', created_at: now } };
        }
        if (_u.includes('totp')) return { enabled: false, enrolled: false };
        if (_u.includes('sessions')) {
          return {
            items: [
              {
                id: 'sess-1',
                created_at: now,
                expires_at: now,
                current: true,
                ip: '1.1.1.1' },
            ] };
        }
        if (_u.includes('api-keys')) {
          return {
            items: [{ id: 'k1', name: 'ci', prefix: 'ysk_ci', created_at: now }] };
        }
        return { ok: true };
      } },
    {
      match: (url) => url.startsWith('/api/v1/settings/security'),
      body: { requireAdminTotp: false, requireAdminTotpStrict: false, ok: true } },
    {
      match: (url) => url.startsWith('/api/v1/approvals'),
      body: {
        items: [
          {
            id: 'ap1',
            tool: 'sys.shell',
            status: 'pending',
            requestedAt: now },
        ] } },
    {
      match: (url) => url.startsWith('/api/v1/tools'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { hostname: 'h', uptime: 1 };
        }
        return {
          items: [
            { id: 'sys.info', name: 'sys.info', allowed: true, requiresApproval: false },
            { id: 'sys.shell', name: 'sys.shell', allowed: false, requiresApproval: true },
          ] };
      } },
    {
      match: /\/api\/v1\/ssh\//,
      body: {
        ok: true,
        items: [
          {
            id: 'id-1',
            name: 'panel-key',
            purpose: 'panel_outbound',
            status: 'installed',
            algo: 'ed25519',
            fingerprintSha256: 'SHA256:abcdef0123456789abcd',
            publicKey: 'ssh-ed25519 AAAA',
            createdAt: now,
            binding: { linuxUser: 'ysk', homeDir: '/home/ysk' } },
          {
            id: 'id-2',
            name: 'stored-key',
            purpose: 'panel_outbound',
            status: 'stored',
            algo: 'ed25519',
            fingerprintSha256: 'SHA256:fedcba9876543210fedc',
            publicKey: 'ssh-ed25519 BBBB',
            createdAt: now,
            binding: { linuxUser: 'ysk', homeDir: '/home/ysk' } },
        ],
        host: { notes: [], lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' } },
        pamSnippet: '#pam',
        sshdHints: '#sshd',
        snippet: 'Match',
        notes: [],
        identity: {
          id: 'id-3',
          name: 'new',
          purpose: 'panel_outbound',
          status: 'stored',
          fingerprintSha256: 'SHA256:x' },
        privateKey: 'PRIVATE' } },
    {
      match: /\/api\/v1\/sftp\//,
      body: {
        ok: true,
        items: [
          {
            id: 'k1',
            projectId: 'p1',
            publicKey: 'ssh-ed25519 AAAA',
            comment: 'laptop',
            fingerprint: 'SHA256:xyz',
            linuxUser: 'demo' },
        ],
        snippet: 'Match Group sftp',
        notes: [] } },
    {
      match: /\/api\/v1\/logs\//,
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { ...HONESTY_WRITTEN_BLOCKED, text: 'ok', lines: ['ok'] };
        }
        if (url.includes('sources')) {
          return {
            items: [
              {
                id: 'journal:nginx.service',
                kind: 'journal',
                label: 'nginx',
                unit: 'nginx.service',
                group: 'web',
                available: true },
              {
                id: 'file:access',
                kind: 'file',
                label: 'access',
                path: '/var/log/nginx/access.log',
                group: 'web',
                available: true },
            ] };
        }
        if (url.includes('overview')) {
          return {
            journalDiskMb: 200,
            followIntervalSec: 3,
            journalWarnMb: 100,
            vacuumDefaultDays: 14,
            maxLines: 300,
            sources: 2,
            units: 1,
            projects: 1 };
        }
        if (url.includes('settings')) {
          return {
            vacuumDefaultDays: 14,
            maxLines: 300,
            journalWarnMb: 100,
            bookmarks: [
              {
                id: 'b1',
                name: 'errors',
                source: 'journal:nginx.service',
                grep: 'error' },
            ] };
        }
        if (url.includes('projects')) {
          return {
            items: [
              {
                projectId: 'p1',
                name: 'Demo',
                files: [{ name: 'app.log', bytes: 10, previewable: true }],
                related: [] },
            ] };
        }
        if (url.includes('units')) {
          return { items: [{ unit: 'nginx.service', active: 'active' }] };
        }
        return {
          ok: true,
          text: 'GET / 200\nerror denied\n',
          lines: ['GET / 200', 'error denied'],
          truncated: false,
          notes: [] };
      } },
    {
      match: /\/api\/v1\/resources\//,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return {
            ...HONESTY_WRITTEN_BLOCKED,
            item: {
              id: 'z1',
              zone: 'example.com',
              name: 'app_db',
              engine: 'mysql',
              type: 'A',
              value: '1.2.3.4',
              ttl: 300,
              nsName: 'ns1.example.com',
              apply_status: 'planned' } };
        }
        if (_u.includes('dns/zones')) {
          return {
            items: [
              {
                id: 'z1',
                zone: 'example.com',
                serverIp: '203.0.113.10',
                nsName: 'ns1.example.com',
                ttl: 300,
                apply_status: 'planned',
                backend: 'bind' },
            ],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
        }
        if (_u.includes('dns/records')) {
          return {
            items: [
              {
                id: 'r1',
                zoneId: 'z1',
                type: 'A',
                name: '@',
                value: '203.0.113.10',
                ttl: 300 },
            ],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
        }
        return {
          items: [
            {
              id: 'db1',
              name: 'app_db',
              engine: 'mysql',
              username: 'app',
              host: 'localhost',
              apply_status: 'planned' },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
      } },
    {
      match: /\/api\/v1\/dns/,
      body: {
        ...HONESTY_WRITTEN_BLOCKED,
        ok: true,
        answers: ['203.0.113.10'],
        notes: ['ok'],
        items: [{ id: 'peer-1', host: 'ns2.example.com', user: 'ysk' }],
        peers: [{ host: 'ns2.example.com', ok: false }],
        dsRecord: 'example.com. IN DS 1 13 2 AB' } },
    {
      match: /\/api\/v1\/system\/host/,
      body: {
        ok: true,
        identity: { hostname: 'h', prettyHostname: 'H', timezone: 'UTC' },
        os: { platform: 'linux', arch: 'x64', release: 't', kernel: '6' },
        runtime: {
          uptimeSec: 100,
          loadavg: [0.1, 0.1, 0.1],
          cpus: 2,
          memory: { total: 1e9, free: 5e8, usedRatio: 0.5 },
          node: 'v20',
          pid: 1,
          uid: 0 },
        time: {
          utc: now,
          local: now,
          ntpEnabled: true,
          ntpSynchronized: true,
          timeSource: 'ntp' },
        network: { ips: ['127.0.0.1'], interfaces: [], resolvers: ['1.1.1.1'] },
        disks: [],
        power: { pending: null },
        boot: { defaultTarget: 'multi-user.target' },
        caps: {
          executeEnabled: false,
          isRoot: false,
          canPower: false,
          canIdentity: true },
        collectedAt: now } },
    {
      match: /\/api\/v1\/fleet\//,
      body: {
        items: [
          {
            id: 'sess-1',
            agent_id: 'ag-1',
            status: 'connected',
            group: 'edge',
            last_seen_at: now,
            meta: { hostname: 'edge-1' } },
        ] } },
    {
      match: /\/api\/v1\/agents\//,
      body: {
        items: [
          {
            kind: 'openclaw',
            name: 'OpenClaw',
            status: 'missing',
            unitName: 'openclaw.service',
            unitActive: 'inactive',
            pathExists: false,
            installPath: '/opt/openclaw',
            probedAt: now },
        ] } },
    {
      match: /\/api\/v1\/cron/,
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        if (_u.includes('status')) {
          return {
            managedPath: '/etc/cron.d/ysk',
            managedLines: 1,
            enabledJobs: 1,
            totalJobs: 1,
            hostHasYskEntries: true,
            hostCrontabPreview: '0 2 * * * root true\n',
            executeEnabled: false,
            lastInstallOk: false,
            lastInstallAt: now };
        }
        return {
          items: [
            {
              id: 'job-1',
              name: 'Nightly',
              schedule: '0 2 * * *',
              command: 'true',
              enabled: true,
              user: 'root' },
          ] };
      } },
    {
      match: (url) => url.startsWith('/api/v1/network'),
      handler: (_u, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        return {
          ok: true,
          at: now,
          notes: [],
          backend: {
            hasIp: true,
            networkManager: 'inactive',
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
              addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }] },
          ],
          routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }],
          caps: { canMutate: true, executeEnabled: false, isRoot: false },
          defaultGateway: '10.0.0.1',
          defaultDev: 'eth0',
          dns: {
            nameservers: ['1.1.1.1'],
            uplinkServers: ['1.1.1.1'],
            search: [],
            source: 'static',
            notes: [],
            ignoreAutoDns: true,
            canApply: true } };
      } },
    {
      match: /\/api\/v1\/cdn/,
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
          return { ...HONESTY_WRITTEN_BLOCKED, conf: '#c', contentHash: 'h' };
        }
        if (url.includes('dashboard')) {
          return {
            at: now,
            nodes: { total: 1, online: 1, offline: 0, draining: 0, unknown: 0, byRegion: {} },
            sites: {
              total: 1,
              byApplyStatus: { planned: 1 },
              rows: [{ id: 'site-1', name: 'S', apply_status: 'planned' }] },
            cache: [
              {
                siteId: 'site-1',
                siteName: 'S',
                hitRatePct: 80,
                hits: 1,
                misses: 0,
                method: 'stub',
                notes: [] },
            ],
            notes: [] };
        }
        if (url.includes('nodes')) {
          return {
            items: [
              {
                id: 'n1',
                name: 'edge-1',
                roles: ['edge'],
                region: 'local',
                publicIpv4: ['203.0.113.10'],
                publicIpv6: [],
                weight: 100,
                status: 'online' },
            ] };
        }
        if (url.includes('sites')) {
          return {
            items: [
              {
                id: 'site-1',
                name: 'Demo',
                domains: ['cdn.example.com'],
                mode: 'origin_pull',
                origin: { kind: 'url', url: 'https://o.example.com' },
                edgeNodeIds: ['n1'],
                dns: {
                  strategy: 'multi_a',
                  ttlHealthy: 60,
                  ttlUnhealthy: 30,
                  minHealthyEdges: 1 },
                cache: { enabled: true, zoneSize: '10m', maxAge: '10m' },
                ssl: { mode: 'off' },
                apply_status: 'planned',
                edge_status: { n1: 'planned' } },
            ] };
        }
        return { items: [] };
      } },
    {
      match: (url) => url.startsWith('/api/v1/metrics'),
      handler: (url, init) => {
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
        if (url.includes('processes')) {
          return {
            ok: true,
            at: now,
            sort: 'cpu',
            limit: 40,
            rows: [
              {
                pid: '42',
                user: 'root',
                cpu: 1,
                mem: 2,
                command: 'nginx: master' },
            ],
            notes: [] };
        }
        if (url.includes('projects')) {
          return {
            ok: true,
            items: [
              {
                projectId: 'p1',
                name: 'Demo',
                usedMb: 10,
                quotaMb: 100,
                path: '/home/demo' },
            ],
            totalMb: 100,
            usedMb: 10,
            at: now };
        }
        return {
          at: now,
          loadavg: [0.1, 0.1, 0.1],
          cpuCount: 2,
          memory: { total: 1e9, free: 5e8, usedRatio: 0.5 },
          uptimeSec: 100,
          diskMounts: [
            {
              filesystem: '/dev/sda1',
              size: 1e11,
              used: 1e10,
              avail: 9e10,
              usedRatio: 0.1,
              mount: '/' },
          ],
          alerts: ['disk_high'] };
      } },
    {
      match: /\/api\/v1\/system\/db\//,
      body: {
        serverInstalled: true,
        active: 'inactive',
        activeLabel: 'inactive',
        engine: 'mysql',
        executeEnabled: false,
        isRoot: false } },
    {
      match: /\/api\/v1\/db\//,
      body: {
        items: [
          {
            id: 'tu1',
            engine: 'mysql',
            username: 'ro',
            dbName: 'app_db',
            expiresAt: now },
        ],
        password: 'once',
        ...HONESTY_WRITTEN_BLOCKED } },
    {
      match: /\/api\/v1\/db\/clusters/,
      body: {
        ok: true,
        items: [
          {
            id: 'c1',
            name: 'ysk-cluster',
            engine: 'postgres',
            kind: 'postgres-replica',
            status: 'planned',
            members: [{ host: '10.0.0.1', role: 'primary', access: 'local', label: 'p' }],
            params: {},
            artifactDir: '/tmp/c1' },
        ],
        plan: {
          ok: true,
          notes: ['dry'],
          steps: [{ id: '1', title: 'cfg' }],
          clusterId: 'c1',
          files: ['a.conf'] },
        cluster: {
          id: 'c1',
          name: 'ysk-cluster',
          engine: 'postgres',
          kind: 'postgres-replica',
          status: 'planned',
          members: [],
          params: {},
          artifactDir: '/tmp/c1' },
        ...HONESTY_WRITTEN_BLOCKED } },
    {
      match: /\/api\/v1\/dashboard\//,
      body: {
        ok: true,
        summary: { projects: 1 },
        items: [{ id: 'a', title: 'Alert', tone: 'warn' }] } },
    {
      match: /\/api\/v1\/projects/,
      body: {
        items: [
          {
            id: 'p1',
            name: 'Demo',
            domain: 'demo.example.com',
            runtime: 'node',
            processStatus: 'stopped',
            linuxUser: 'demo',
            homeDir: '/home/demo' },
        ] } },
    {
      match: /\/api\/v1\/ftp|\/api\/v1\/system\/ftps/,
      body: {
        settings: { enabled: true, listenPort: 21, pasvMin: 40000, pasvMax: 40100 },
        status: { installed: true, active: 'inactive', activeLabel: 'inactive' },
        domains: [{ value: 'ftp.example.com', label: 'ftp.example.com' }],
        homes: [{ value: '/home/demo', label: '/home/demo' }],
        items: [{ id: 'f1', username: 'demo', homePath: '/home/demo' }] } },
    {
      match: /\/api\/v1\/hosting\/php\/ini/,
      body: {
        version: '8.2',
        catalog: [
          {
            id: 'core',
            title: 'Core',
            fields: [
              {
                key: 'memory_limit',
                label: 'memory_limit',
                type: 'text',
                default: '128M' },
            ] },
        ],
        settings: {
          version: '8.2',
          values: { memory_limit: '128M' },
          extra: {},
          rawAppend: '' },
        managedIniPath: '/etc/php/8.2/conf.d/ysk.ini',
        notes: [],
        ok: true } },
    {
      match: /\/api\/v1\/hosting\/runtimes/,
      body: {
        ok: true,
        catalog: [],
        settings: { values: {}, env: {} },
        envPreview: {},
        notes: [],
        php: { versions: ['8.2'], active: '8.2' } } },
    {
      match: /\/api\/v1\/system\//,
      body: HONESTY_WRITTEN_BLOCKED },
    { match: /.*/, body: { ok: true, items: [], ready: true, missing: [], notes: [] } },
  ];
}

describe('exhaustive page interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('EMERGENCY');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'exhaust major hole pages',
    async () => {
      const user = userEvent.setup();
      installFetchMock(megaRoutes());

      const cases: Array<[string, React.ReactElement, string?]> = [
        ['/protection', <ProtectionPage key="p" />],
        ['/backups', <BackupsPage key="b" />],
        ['/email/dom-1', <EmailDomainPage key="e" />, '/email/:id'],
        ['/files', <FilesPage key="f" />],
        ['/users', <UsersPage key="u" />],
        ['/security', <SecurityPage key="s" />],
        ['/logs', <LogsPage key="l" />],
        ['/dns', <DnsPage key="d" />],
        ['/system', <SystemPage key="sys" />],
        ['/agents', <AgentsPage key="a" />],
        ['/cron', <CronPage key="c" />],
        ['/databases/mysql-engine', <SqlEnginePage key="sql" engine="mysql" />],
        ['/metrics', <MetricsPage key="m" />],
        ['/network', <NetworkPage key="n" />],
        ['/cdn', <CdnPage key="cdn" />],
        ['/', <DashboardPage key="dash" />],
        ['/ftp', <FtpPage key="ftp" />],
        ['/runtimes/php', <PhpRuntimePage key="php" />],
      ];

      for (const [path, el, routePath] of cases) {
        const { unmount } = renderAt(path, el, routePath ?? '*');
        await waitFor(
          () => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
          { timeout: 8000 },
        );
        await exhaust(user, 2);
        unmount();
      }

      // Panels not full pages
      {
        const { unmount } = render(
          <MemoryRouter>
            <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />
          </MemoryRouter>,
        );
        await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(20));
        await exhaust(user, 1);
        unmount();
      }
      {
        const { unmount } = render(
          <MemoryRouter>
            <DbClusterPanel engine="postgres" />
          </MemoryRouter>,
        );
        await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(20));
        await exhaust(user, 1);
        unmount();
      }
    },
    120_000,
  );
});
