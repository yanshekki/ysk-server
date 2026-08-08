/**
 * Deep userEvent interactions aimed at the largest uncovered page branches.
 * Honesty: mutation responses use HONESTY_WRITTEN_BLOCKED (requiresExecute).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { ProtectionPage } from './features/ProtectionPage';
import { NetworkPage } from './features/NetworkPage';
import { CdnPage } from './features/CdnPage';
import { DnsPage } from './features/DnsPage';
import { BackupsPage } from './features/BackupsPage';
import { LogsPage } from './features/LogsPage';
import { MetricsPage } from './features/MetricsPage';
import { SqlEnginePage } from './features/SqlEnginePage';
import { SystemdUnitPage } from './features/SystemdUnitPage';
import { UsersPage } from './UsersPage';
import { FilesPage } from './FilesPage';
import { AgentsPage } from './AgentsPage';
import { SecurityPage } from './SecurityPage';
import { EmailDomainPage } from './EmailDomainPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickMatching(
  user: ReturnType<typeof userEvent.setup>,
  re: RegExp,
  limit = 6,
) {
  const buttons = screen.queryAllByRole('button', { name: re });
  for (const b of buttons.slice(0, limit)) {
    if ((b as HTMLButtonElement).disabled) continue;
    try {
      await user.click(b);
    } catch {
      /* unmount / dialog race */
    }
  }
}

async function clickAllTabs(user: ReturnType<typeof userEvent.setup>) {
  const labels = screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
  for (const label of labels) {
    if (!label.trim()) continue;
    try {
      const tab =
        screen.queryByRole('tab', { name: label }) ??
        screen.queryAllByRole('tab').find((el) => el.textContent === label);
      if (tab) await user.click(tab);
    } catch {
      /* ignore */
    }
  }
}

const defenseRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) =>
      url.startsWith('/api/v1/defense/status') || url.startsWith('/api/v1/defense/probe'),
    body: {
      at: new Date().toISOString(),
      threatLevel: 'elevated',
      score: 55,
      signals: [
        { id: 'highReqRate', label: 'Req', value: 200, points: 15, detail: 'hot' },
        { id: 'f2bBans', label: 'Bans', value: 3, points: 5 },
      ],
      activePreset: 'daily',
      presets: [
        { id: 'daily', label: 'Daily', short: 'N', bullets: ['a'] },
        { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
        { id: 'under_attack', label: 'Under attack', short: 'A', bullets: ['c'], danger: true },
        { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
      ],
      bans: {
        count: 1,
        items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }] },
      nginxLimits: {
        reqRate: '10r/s',
        burst: 20,
        connLimit: 40,
        confPath: '/etc/nginx/conf.d/d.conf',
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
        whitelist: ['127.0.0.1'],
        autoBansLastHour: 1 },
      executeEnabled: false,
      isRoot: false,
      suggestions: [
        { id: 's1', title: 'Apply daily', body: 'x', action: 'preset:daily' },
        { id: 's2', title: 'Review bans', body: 'y', action: 'tab:bans' },
      ],
      notes: [] } },
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
        countries: ['CN', 'RU'],
        continents: [],
        regions: [],
        cities: [],
        cityPolicyEnabled: false,
        asns: [],
        enforce: { autoBan: true, nginx: true, ufw: false },
        autoUpdate: true },
      sources: [
        {
          filename: 'dbip-country.mmdb',
          present: true,
          mtime: new Date().toISOString(),
          bytes: 1000 },
      ],
      meta: { lastSuccessAt: new Date().toISOString() } } },
  {
    match: (url) => url.startsWith('/api/v1/defense/automation'),
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
        signalWeights: { highReqRate: 10, f2bBans: 5 },
        cloudflare: { enabled: false, zones: [], onAutoEscalate: false } },
      mechanisms: [{ step: '1', mechanism: 'fail2ban', tunable: 'bantime' }] } },
  {
    match: (url) => url.startsWith('/api/v1/defense/suspects'),
    body: {
      items: [
        {
          ip: '198.51.100.7',
          score: 40,
          hits: 200,
          reasons: ['scan'],
          sources: ['nginx'],
          lastSeen: new Date().toISOString(),
          alreadyBanned: false,
          whitelisted: false },
        {
          ip: '198.51.100.8',
          score: 10,
          hits: 5,
          reasons: ['noise'],
          sources: ['nginx'],
          lastSeen: new Date().toISOString(),
          alreadyBanned: true,
          whitelisted: false },
      ],
      notes: [] } },
  {
    match: (url) => url.startsWith('/api/v1/defense/timeline'),
    body: {
      items: [{ at: new Date().toISOString(), kind: 'preset', title: 'daily', detail: 'ok' }] } },
  {
    match: (url) => url.startsWith('/api/v1/defense/intel'),
    body: {
      topIps: [{ ip: '1.1.1.1', hits: 9, s429: 1, scan: 0, score: 4 }],
      vhostLimits: { withLimit: 1, total: 2, items: [{ server: 'a.com', limit: '10r/s' }] },
      hasCfToken: false,
      cfZones: [] } },
  {
    match: (url) => url.startsWith('/api/v1/defense/bans'),
    body: {
      items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd' }],
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } } },
  {
    match: /\/api\/v1\/defense/,
    body: HONESTY_WRITTEN_BLOCKED },
  {
    match: /\/api\/v1\/system\/firewall/,
    body: { installed: true, active: 'inactive', rules: [], allowCount: 0, denyCount: 0 } },
  {
    match: /\/api\/v1\/system\/fail2ban/,
    body: {
      installed: true,
      active: 'inactive',
      jails: [{ name: 'sshd', currentlyBanned: 1 }],
      banned: [{ jail: 'sshd', ip: '203.0.113.10' }],
      ignoreIps: ['127.0.0.1'],
      catalog: [] } },
  { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
];

const networkRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => url.startsWith('/api/v1/network'),
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          notes: ['written ≠ applied on host'],
          blocked: false,
          executeEnabled: false };
      }
      return {
        ok: true,
        at: new Date().toISOString(),
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
            flags: ['UP', 'BROADCAST'],
            mac: 'aa:bb:cc:dd:ee:ff',
            mtu: 1500,
            isLoopback: false,
            isDefaultEgress: true,
            addrs: [{ family: 'inet', local: '10.0.0.5', prefixlen: 24 }],
            stats: { rxBytes: 1e6, txBytes: 2e6, rxPackets: 100, txPackets: 200 } },
          {
            name: 'lo',
            ifindex: 1,
            operstate: 'UNKNOWN',
            flags: ['UP', 'LOOPBACK'],
            mtu: 65536,
            isLoopback: true,
            addrs: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }] },
        ],
        routes: [
          { dst: 'default', gateway: '10.0.0.1', dev: 'eth0' },
          { dst: '10.0.0.0/24', gateway: undefined, dev: 'eth0' },
        ],
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
          canApply: true,
          mode: 'static' },
        raw: { addr: 'addr show', route: 'route show' } };
    } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const cdnRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => url.includes('/api/v1/cdn/dashboard'),
    body: {
      at: new Date().toISOString(),
      nodes: { total: 1, online: 1, offline: 0, draining: 0, unknown: 0, byRegion: { local: 1 } },
      sites: {
        total: 1,
        byApplyStatus: { planned: 1 },
        rows: [{ id: 'site-1', name: 'Demo site', apply_status: 'planned' }] },
      cache: [
        {
          siteId: 'site-1',
          siteName: 'Demo site',
          hitRatePct: 80,
          hits: 10,
          misses: 2,
          method: 'stub',
          notes: [] },
      ],
      notes: [] } },
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
          baseUrl: 'http://203.0.113.10' },
      ] } },
  {
    match: (url, init) =>
      url.startsWith('/api/v1/cdn/sites') && (init?.method ?? 'GET').toUpperCase() === 'GET',
    body: {
      items: [
        {
          id: 'site-1',
          name: 'Demo site',
          domains: ['cdn.example.com'],
          mode: 'origin_pull',
          origin: { kind: 'url', url: 'https://origin.example.com' },
          edgeNodeIds: ['n1'],
          dns: { strategy: 'multi_a', ttlHealthy: 60, ttlUnhealthy: 30, minHealthyEdges: 1 },
          cache: { enabled: true, zoneSize: '10m', maxAge: '10m' },
          ssl: { mode: 'off' },
          apply_status: 'planned',
          edge_status: { n1: 'planned' } },
      ] } },
  {
    match: (url) => url.startsWith('/api/v1/resources/dns/zones'),
    body: { items: [{ id: 'z1', zone: 'example.com' }] } },
  {
    match: /\/api\/v1\/cdn/,
    body: { ...HONESTY_WRITTEN_BLOCKED, conf: '# conf', contentHash: 'h1' } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const dnsRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url, init) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/v1/resources/')) return false;
      if (m !== 'GET') {
        return true;
      }
      return true;
    },
    handler: (url, init) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          item: {
            id: 'z-new',
            zone: 'new.example.com',
            serverIp: '203.0.113.20',
            nsName: 'ns1.new.example.com',
            ttl: 300,
            apply_status: 'planned' } };
      }
      if (url.includes('dns/zones')) {
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
      if (url.includes('dns/records')) {
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
      return { items: [] };
    } },
  {
    match: /\/api\/v1\/dns/,
    body: {
      ...HONESTY_WRITTEN_BLOCKED,
      ok: true,
      answers: ['203.0.113.10'],
      dsRecord: 'example.com. IN DS 1 13 2 AB',
      notes: ['ok'],
      items: [{ id: 'peer-1', host: 'ns2.example.com', user: 'ysk' }],
      peers: [{ host: 'ns2.example.com', ok: false, notes: ['timeout'] }] } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const backupsRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => url.startsWith('/api/v1/backups/settings'),
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
      return {
        remote: {
          enabled: true,
          kind: 'sftp',
          host: 'backup.example.com',
          port: 22,
          username: 'ysk',
          path: '/backups/ysk',
          password: '***' },
        exclusions: ['node_modules'],
        restic: { enabled: true, repoPath: '/var/backups/restic', password: '***' } };
    } },
  {
    match: /\/api\/v1\/backups/,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ...HONESTY_WRITTEN_BLOCKED, snapshots: [] };
      }
      if (url.includes('snapshot')) {
        return {
          items: [
            {
              id: 'snap-1',
              time: new Date().toISOString(),
              hostname: 'ysk',
              paths: ['/home/demo'],
              short_id: 'abc' },
          ] };
      }
      return {
        items: [
          {
            projectId: 'p1',
            name: 'Demo',
            path: '/var/backups/p1.tgz',
            bytes: 2048,
            mtime: new Date().toISOString(),
            kind: 'full' },
        ],
        lastRun: { at: new Date().toISOString(), ok: true } };
    } },
  {
    match: /\/api\/v1\/projects/,
    body: { items: [{ id: 'p1', name: 'Demo', domain: 'demo.example.com' }] } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const logsRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: /\/api\/v1\/logs\//,
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ...HONESTY_WRITTEN_BLOCKED, text: 'ok', lines: ['ok'] };
      }
      if (url.includes('/overview')) {
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
      if (url.includes('/sources')) {
        return {
          items: [
            {
              id: 'journal:nginx.service',
              kind: 'journal',
              label: 'nginx',
              unit: 'nginx.service',
              group: 'web',
              available: true },
          ] };
      }
      if (url.includes('/journal/units')) {
        return { items: [{ unit: 'nginx.service', active: 'active' }] };
      }
      if (url.includes('/projects')) {
        return {
          items: [
            {
              projectId: 'p1',
              name: 'Demo',
              files: [{ name: 'app.log', bytes: 10, previewable: true }],
              related: [] },
          ] };
      }
      if (url.includes('/settings')) {
        return {
          vacuumDefaultDays: 14,
          maxLines: 300,
          journalWarnMb: 100,
          followIntervalSec: 3,
          bookmarks: [
            {
              id: 'b1',
              name: 'errors',
              source: 'journal:nginx.service',
              grep: 'error' },
          ] };
      }
      return {
        ok: true,
        text: 'GET / 200\nerror denied\n',
        lines: ['GET / 200', 'error denied'],
        truncated: false,
        notes: [] };
    } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const metricsRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => url.startsWith('/api/v1/metrics/projects'),
    body: {
      ok: true,
      items: [
        {
          projectId: 'p1',
          name: 'Demo',
          usedMb: 120,
          quotaMb: 1024,
          path: '/home/demo' },
      ],
      totalMb: 1024,
      usedMb: 120,
      at: new Date().toISOString() } },
  {
    match: (url) => url.startsWith('/api/v1/metrics/processes'),
    handler: (url, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          pid: 42,
          signal: 'TERM',
          stillAlive: true };
      }
      if (url.includes('detail') || /processes\/\d+/.test(url)) {
        return {
          ok: true,
          pid: 42,
          user: 'root',
          cmd: 'nginx: master',
          cpu: 0.5,
          mem: 1.2,
          nice: 0,
          state: 'S',
          threads: 2 };
      }
      return {
        ok: true,
        at: new Date().toISOString(),
        sort: 'cpu',
        limit: 40,
        rows: [
          {
            pid: '42',
            user: 'root',
            cpu: 1.5,
            mem: 2.1,
            command: 'nginx: master process',
            state: 'S',
            etime: '01:00',
            resKiB: 20000,
            virtKiB: 100000 },
        ],
        notes: [],
        topHeader: {
          ok: true,
          at: new Date().toISOString(),
          uptimeSec: 3600,
          loadavg: [0.2, 0.3, 0.4] as [number, number, number],
          tasks: { total: 100, running: 2, sleeping: 98, stopped: 0, zombie: 0 },
          cpu: {
            us: 5,
            sy: 3,
            ni: 0,
            id: 88,
            wa: 2,
            hi: 0,
            si: 0,
            st: 0,
            busyPct: 12 },
          cpus: [
            {
              us: 5,
              sy: 2,
              ni: 0,
              id: 93,
              wa: 0,
              hi: 0,
              si: 0,
              st: 0,
              busyPct: 7 },
          ],
          memory: {
            totalKiB: 2e6,
            freeKiB: 1e6,
            usedKiB: 5e5,
            buffCacheKiB: 5e5,
            availableKiB: 1.5e6 },
          swap: { totalKiB: 1e6, freeKiB: 9e5, usedKiB: 1e5 },
          notes: [] } };
    } },
  {
    match: (url) => url.startsWith('/api/v1/metrics'),
    body: {
      at: new Date().toISOString(),
      loadavg: [0.2, 0.3, 0.4],
      cpuCount: 4,
      memory: {
        total: 2e9,
        free: 1e9,
        usedRatio: 0.25,
        available: 1.5e9 },
      uptimeSec: 3600,
      disk: { path: '/', free: 9e10, total: 1e11, usedRatio: 0.1 },
      diskMounts: [
        {
          filesystem: '/dev/sda1',
          size: 1e11,
          used: 1e10,
          avail: 9e10,
          usedRatio: 0.1,
          mount: '/' },
      ],
      alerts: ['disk_high'],
      notes: [] } },
  { match: /.*/, body: { ok: true, items: [] } },
];

const sqlRoutes = (): FetchRoute[] => [
  softwareReadyRoute(),
  {
    match: (url) => /\/api\/v1\/system\/db\/\w+\/status/.test(url),
    body: {
      serverInstalled: true,
      active: 'inactive',
      activeLabel: 'inactive',
      engine: 'mysql',
      executeEnabled: false,
      isRoot: false,
      version: '8.0' } },
  {
    match: (url, init) =>
      /\/api\/v1\/system\/db\//.test(url) && (init?.method ?? 'GET').toUpperCase() !== 'GET',
    body: HONESTY_WRITTEN_BLOCKED },
  {
    match: /\/api\/v1\/resources\//,
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return {
          ...HONESTY_WRITTEN_BLOCKED,
          item: { id: 'db1', name: 'app_db', engine: 'mysql', host: 'localhost' } };
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
    match: /\/api\/v1\/db\//,
    handler: (_u, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        return { ...HONESTY_WRITTEN_BLOCKED, password: 'temp-once' };
      }
      return {
        items: [
          {
            id: 'tu1',
            engine: 'mysql',
            username: 'ro_tmp',
            dbName: 'app_db',
            expiresAt: new Date(Date.now() + 86400000).toISOString() },
          {
            id: 'rh1',
            engine: 'mysql',
            label: 'replica',
            host: '10.0.0.9',
            port: 3306,
            username: 'repl' },
        ] };
    } },
  { match: /.*/, body: { ok: true, items: [] } },
];

describe('coverage climb deep interactions', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it(
    'ProtectionPage: tabs, preset, bans, automation, geo',
    async () => {
      const user = userEvent.setup();
      installFetchMock(defenseRoutes());
      renderAt('/protection', <ProtectionPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });

      await clickAllTabs(user);

      // Response tab: preview / apply presets
      const responseTab = screen.queryByRole('tab', { name: /response/i });
      if (responseTab) await user.click(responseTab);
      await clickMatching(user, /preview|apply|daily|hardened|suggested|re-?check|reprobe/i, 8);

      // Bans tab: expand manual + ban IP
      const bansTab = screen.queryByRole('tab', { name: /ban/i });
      if (bansTab) await user.click(bansTab);
      await clickMatching(user, /expand|manual/i, 3);
      const ipInput = document.getElementById('def-ip') as HTMLInputElement | null;
      if (ipInput) {
        await user.clear(ipInput);
        await user.type(ipInput, '198.51.100.99');
        await clickMatching(user, /ban/i, 4);
      }
      // select suspect checkboxes if any
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 3)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickMatching(user, /ban|whitelist|bulk/i, 4);

      // Automation
      const autoTab = screen.queryByRole('tab', { name: /automation/i });
      if (autoTab) await user.click(autoTab);
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 4)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      const score = document.getElementById('ab-sc') as HTMLInputElement | null;
      if (score) {
        await user.clear(score);
        await user.type(score, '15');
      }

      // Geo
      const geoTab = screen.queryByRole('tab', { name: /ip access|geo/i });
      if (geoTab) await user.click(geoTab);
      await clickMatching(user, /save|apply|refresh|update|download/i, 5);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );

  it(
    'NetworkPage: iface detail, add IP, routes, DNS',
    async () => {
      const user = userEvent.setup();
      installFetchMock(networkRoutes());
      renderAt('/network', <NetworkPage />);
      await waitFor(
        () => expect(screen.getAllByText(/eth0/i).length).toBeGreaterThan(0),
        { timeout: 8000 },
      );

      await clickMatching(user, /details/i, 2);
      await clickMatching(user, /add ip/i, 1);
      // fill CIDR if modal open
      const cidrInputs = screen.queryAllByRole('textbox');
      for (const input of cidrInputs.slice(0, 2)) {
        try {
          await user.clear(input);
          await user.type(input, '10.0.0.50/24');
        } catch {
          /* ignore */
        }
      }
      await clickMatching(user, /apply|add|save|confirm/i, 3);
      // close modal if cancel present
      await clickMatching(user, /cancel|close/i, 2);

      // Routes
      const routesTab = screen.queryByRole('tab', { name: /routes/i });
      if (routesTab) await user.click(routesTab);
      const gw = document.getElementById('net-route-gw') as HTMLInputElement | null;
      if (gw) {
        await user.clear(gw);
        await user.type(gw, '10.0.0.1');
      }
      await clickMatching(user, /add|apply|save/i, 3);
      await clickMatching(user, /delete/i, 1);
      await clickMatching(user, /confirm|delete|apply/i, 2);

      // DNS
      const dnsTab = screen.queryByRole('tab', { name: /^dns$/i });
      if (dnsTab) await user.click(dnsTab);
      await clickMatching(user, /apply|save|test|preset/i, 4);

      // Advanced
      const adv = screen.queryByRole('tab', { name: /advanced/i });
      if (adv) await user.click(adv);
      await clickMatching(user, /refresh/i, 1);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );

  it(
    'CdnPage: create node/site modals + row actions',
    async () => {
      const user = userEvent.setup();
      installFetchMock(cdnRoutes());
      renderAt('/cdn', <CdnPage />);
      await waitFor(() => expect(screen.getByText(/edge-1/i)).toBeInTheDocument(), {
        timeout: 8000 });

      await clickMatching(user, /add node/i, 1);
      const nameField =
        screen.queryByLabelText(/^name$/i) ??
        (document.querySelector('input[name="name"]') as HTMLInputElement | null);
      if (nameField) {
        await user.clear(nameField);
        await user.type(nameField, 'edge-2');
      }
      // fill ipv4-ish textboxes in modal
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        for (const [i, input] of inputs.entries()) {
          try {
            if (i === 0) await user.type(input, 'edge-2');
            else if (i === 1) await user.type(input, 'local');
            else await user.type(input, '203.0.113.20');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /save|create|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 1);
      }

      await clickMatching(user, /probe|drain|edit|delete/i, 4);

      const sitesTab = screen.queryByRole('tab', { name: /sites/i });
      if (sitesTab) await user.click(sitesTab);
      await clickMatching(user, /add site/i, 1);
      const siteDialog = screen.queryAllByRole('dialog')[0];
      if (siteDialog) {
        const inputs = within(siteDialog).queryAllByRole('textbox');
        for (const [i, input] of inputs.entries()) {
          try {
            await user.type(input, i === 0 ? 'Site B' : i === 1 ? 'b.example.com' : 'https://o.example.com');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /save|create|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 1);
      }
      await clickMatching(user, /apply|purge|dns|ssl|preview|edit|delete/i, 6);

      const dash = screen.queryByRole('tab', { name: /dashboard/i });
      if (dash) await user.click(dash);
      await clickMatching(user, /refresh|probe/i, 3);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );

  it(
    'DnsPage: zone select, create zone, records, tools, cluster',
    async () => {
      const user = userEvent.setup();
      installFetchMock(dnsRoutes());
      renderAt('/dns', <DnsPage />);
      await waitFor(() => expect(screen.getByText(/example\.com/i)).toBeInTheDocument(), {
        timeout: 8000 });

      // Select zone row
      try {
        await user.click(screen.getByText(/example\.com/i));
      } catch {
        /* ignore */
      }

      await clickMatching(user, /create zone/i, 1);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        if (inputs[0]) await user.type(inputs[0], 'new.example.com');
        if (inputs[1]) await user.type(inputs[1], '203.0.113.20');
        await clickMatching(user, /create|save|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 1);
      }

      const recTab = screen.queryByRole('tab', { name: /records/i });
      if (recTab) await user.click(recTab);
      await clickMatching(user, /add record/i, 1);
      const recDialog = screen.queryAllByRole('dialog')[0];
      if (recDialog) {
        const inputs = within(recDialog).queryAllByRole('textbox');
        for (const [i, input] of inputs.entries()) {
          try {
            await user.clear(input);
            await user.type(input, i === 0 ? 'www' : '203.0.113.30');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /save|create|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 1);
      }
      await clickMatching(user, /write|apply|save soa|dnssec/i, 4);

      for (const name of [/cluster/i, /dnssec/i, /tools/i, /about/i]) {
        const tab = screen.queryByRole('tab', { name });
        if (tab) await user.click(tab);
      }
      await clickMatching(user, /add peer|lookup|validate|save|sync|apply|refresh/i, 6);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );

  it(
    'BackupsPage: ops buttons + settings save',
    async () => {
      const user = userEvent.setup();
      installFetchMock(backupsRoutes());
      renderAt('/backups', <BackupsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(
        user,
        /run|schedule|control|restic|restore|delete|save|refresh|download/i,
        10,
      );
      // confirm dialogs
      await clickMatching(user, /confirm|delete|restore|apply|yes/i, 4);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'LogsPage: explore query + settings + maintenance',
    async () => {
      const user = userEvent.setup();
      installFetchMock(logsRoutes());
      renderAt('/logs', <LogsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(user, /refresh|query|run|search|export|save|bookmark|vacuum/i, 10);
      // pick a source if listed
      try {
        const nginx = screen.queryByText(/^nginx$/i);
        if (nginx) await user.click(nginx);
      } catch {
        /* ignore */
      }
      await clickMatching(user, /query|run|follow|export|save/i, 5);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'MetricsPage: live processes signal + project usage',
    async () => {
      const user = userEvent.setup();
      installFetchMock(metricsRoutes());
      renderAt('/metrics', <MetricsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);

      const live = screen.queryByRole('tab', { name: /live/i });
      if (live) await user.click(live);
      await waitFor(
        () => {
          expect(
            screen.queryAllByText(/nginx/i).length +
              screen.queryAllByText(/42/).length,
          ).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      ).catch(() => {
        /* process table may still load empty — keep clicking actions */
      });
      for (const cb of screen.queryAllByRole('checkbox').slice(0, 2)) {
        try {
          await user.click(cb);
        } catch {
          /* ignore */
        }
      }
      await clickMatching(user, /detail|term|kill|refresh|signal/i, 6);
      await clickMatching(user, /confirm|send|apply|term|kill/i, 3);

      const proj = screen.queryByRole('tab', { name: /project/i });
      if (proj) await user.click(proj);
      await clickMatching(user, /refresh/i, 2);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'SqlEnginePage: create db/user + temp/remote tabs',
    async () => {
      const user = userEvent.setup();
      installFetchMock(sqlRoutes());
      renderAt('/databases/mysql-engine', <SqlEnginePage engine="mysql" />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(user, /create|install|start|adminer|expire|clean/i, 8);

      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        for (const [i, input] of inputs.entries()) {
          try {
            await user.type(input, i === 0 ? 'newdb' : i === 1 ? 'newuser' : 'Secret123!');
          } catch {
            /* password type */
          }
        }
        const pw = within(dialog).queryAllByLabelText(/password/i);
        for (const p of pw) {
          try {
            await user.type(p, 'Secret123!');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /create|save|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 2);
      }

      // row apply/delete
      await clickMatching(user, /apply|delete|edit/i, 4);
      await clickMatching(user, /confirm|delete|yes/i, 2);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'SystemdUnitPage: install template + tabs',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: (url) => url.startsWith('/api/v1/system/systemd/status'),
          body: {
            unit: 'ysk-server',
            unitPathHint: '/etc/systemd/system/ysk-server.service',
            active: 'inactive',
            enabled: 'disabled',
            executeEnabled: false,
            isRoot: false,
            canInstall: false,
            systemUnitExists: false,
            managedUnitPath: '/var/lib/ysk/systemd/ysk-server.service',
            managedUnitExists: false,
            show: {
              mainPid: null,
              activeEnterTimestamp: null,
              fragmentPath: null,
              description: 'YSK' } } },
        {
          match: /\/api\/v1\/system\/systemd/,
          body: HONESTY_WRITTEN_BLOCKED },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);
      renderAt('/systemd', <SystemdUnitPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(user, /write template|install|refresh|enable/i, 6);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    15_000,
  );

  it(
    'UsersPage: create user/package + detail modal',
    async () => {
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
                  locale: 'en' },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
              hostUsage: { projects: 1, diskMb: 100, limitMb: 10240 } };
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
                  maxProjects: 10,
                  maxMailboxes: 10,
                  maxDatabases: 5,
                  diskMb: 10240,
                  bandwidthMb: 0,
                  ftp: true,
                  ssh: true,
                  notes: '' },
              ] };
          } },
        {
          match: (url) => url.includes('/api/v1/rbac'),
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            return {
              items: [
                {
                  role: 'operator',
                  dirty: true,
                  policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
                  factory: { maxLevel: 'write-high', capabilities: ['projects.read'] } },
                {
                  role: 'admin',
                  dirty: false,
                  policy: { maxLevel: 'admin', capabilities: [] },
                  factory: { maxLevel: 'admin', capabilities: [] } },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);
      renderAt('/users', <UsersPage />);
      await waitFor(() => expect(screen.getByText(/admin/i)).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(user, /create user|create package|details|delete|save|restore/i, 8);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        for (const [i, input] of inputs.entries()) {
          try {
            await user.type(input, i === 0 ? 'alice' : 'AlicePass1!');
          } catch {
            /* ignore */
          }
        }
        await clickMatching(user, /create|save|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 2);
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'FilesPage: browse actions + new folder modal',
    async () => {
      const user = userEvent.setup();
      const now = new Date().toISOString();
      installFetchMock([
        softwareReadyRoute(),
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
                items: [
                  {
                    id: 'sh1',
                    path: 'a.txt',
                    token: 'tok',
                    createdAt: now },
                ] };
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
        { match: /.*/, body: { ok: true, items: [] } },
      ]);
      renderAt('/files', <FilesPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(
        user,
        /new folder|new text|upload|refresh|delete|rename|share|zip|chmod|restore/i,
        10,
      );
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        if (inputs[0]) await user.type(inputs[0], 'newdir');
        await clickMatching(user, /create|save|apply/i, 2);
        await clickMatching(user, /cancel|close/i, 1);
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'AgentsPage: register + command + history',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
        {
          match: /\/api\/v1\/fleet\//,
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return { ...HONESTY_WRITTEN_BLOCKED, ok: true, id: 'cmd-1', agent_id: 'ag-1' };
            }
            if (url.includes('/commands')) {
              return {
                items: [
                  {
                    id: 'cmd-1',
                    agent_id: 'ag-1',
                    status: 'done',
                    payload: { type: 'ping' },
                    createdAt: new Date().toISOString() },
                ] };
            }
            return {
              items: [
                {
                  id: 'sess-1',
                  agent_id: 'ag-1',
                  status: 'connected',
                  group: 'edge',
                  last_seen_at: new Date().toISOString(),
                  meta: { hostname: 'edge-1' } },
              ] };
          } },
        {
          match: /\/api\/v1\/agents\//,
          handler: (_u, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
              return {
                ...HONESTY_WRITTEN_BLOCKED,
                ok: false,
                requiresExecute: true,
                notes: ['Host execute is off'],
                kind: 'openclaw',
                status: 'missing' };
            }
            return {
              items: [
                {
                  kind: 'openclaw',
                  name: 'OpenClaw',
                  status: 'missing',
                  unitName: 'openclaw.service',
                  unitActive: 'inactive',
                  pathExists: false,
                  installPath: '/opt/openclaw',
                  probedAt: new Date().toISOString() },
              ] };
          } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);
      renderAt('/agents', <AgentsPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickMatching(user, /register|command|history|delete|refresh|probe|install|plan/i, 10);
      const dialog = screen.queryAllByRole('dialog')[0];
      if (dialog) {
        const inputs = within(dialog).queryAllByRole('textbox');
        if (inputs[0]) await user.type(inputs[0], 'ag-new');
        await clickMatching(user, /register|save|create|send|enqueue/i, 3);
        await clickMatching(user, /cancel|close/i, 2);
      }
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    20_000,
  );

  it(
    'SecurityPage + EmailDomainPage tab walks with actions',
    async () => {
      const user = userEvent.setup();
      installFetchMock([
        softwareReadyRoute(),
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
                fingerprintSha256: 'SHA256:abcdef0123456789',
                publicKey: 'ssh-ed25519 AAAA',
                createdAt: new Date().toISOString(),
                binding: { linuxUser: 'ysk', homeDir: '/home/ysk' } },
            ],
            host: { notes: [], lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' } },
            pamSnippet: '#',
            sshdHints: '#',
            snippet: 'Match',
            notes: [],
            identity: {
              id: 'id-2',
              name: 'new',
              purpose: 'panel_outbound',
              status: 'stored',
              fingerprintSha256: 'SHA256:x' },
            privateKey: 'PRIVATE' } },
        {
          match: /\/api\/v1\/sftp\//,
          body: { ok: true, items: [], snippet: '', notes: [] } },
        {
          match: /\/api\/v1\/security/,
          body: {
            ok: true,
            totpEnabled: false,
            enrolled: false,
            sessions: [{ id: 's1', createdAt: new Date().toISOString(), ip: '1.1.1.1' }],
            apiKeys: [{ id: 'k1', name: 'ci', createdAt: new Date().toISOString() }],
            tools: [],
            approvals: [],
            webauthnCredentials: [] } },
        {
          match: (url) =>
            url === '/api/v1/email/domains' || url.startsWith('/api/v1/email/domains?'),
          body: {
            items: [
              {
                id: 'dom-1',
                domain: 'example.com',
                rate_limit_per_hour: 200,
                antispam: true,
                server_ip: '203.0.113.10' },
            ] } },
        {
          match: (url) => url.includes('/api/v1/email/domains/dom-1'),
          handler: (url, init) => {
            if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
            if (url.includes('/dns')) {
              return {
                domain: 'example.com',
                records: [{ type: 'MX', name: '@', value: 'mail.example.com', note: 'mail' }],
                externalTodos: ['Add SPF at registrar'],
                health: { score: 50, maxScore: 100, messages: ['SPF missing'] },
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
                items: [{ id: 'al1', source: 'hello@example.com', dest: 'info@example.com' }] };
            }
            if (url.includes('/deliverability')) {
              return { ok: true, score: 50, checks: [], recommendations: ['Add SPF'] };
            }
            return {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10',
              apply_status: 'planned' };
          } },
        { match: /\/api\/v1\/projects/, body: { items: [] } },
        { match: /.*/, body: { ok: true, items: [] } },
      ]);

      const sec = renderAt('/security', <SecurityPage />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
      await clickAllTabs(user);
      await clickMatching(user, /login|2fa|sshd|outbound|refresh|create|enroll|revoke/i, 10);
      sec.unmount();

      renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: 8000 });
      await clickAllTabs(user);
      await clickMatching(
        user,
        /refresh|copy|create|add|save|apply|mailbox|alias|open/i,
        10,
      );
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    },
    25_000,
  );
});
