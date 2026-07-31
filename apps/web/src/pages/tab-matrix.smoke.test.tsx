/**
 * Mount major pages once per tab via ?tab= URL (usePageTab sync).
 * Higher coverage than click-walk without interaction races.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
  type FetchRoute,
} from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';

import { ProtectionPage } from './features/ProtectionPage';
import { CdnPage } from './features/CdnPage';
import { DnsPage } from './features/DnsPage';
import { BackupsPage } from './features/BackupsPage';
import { LogsPage } from './features/LogsPage';
import { MetricsPage } from './features/MetricsPage';
import { NetworkPage } from './features/NetworkPage';
import { SecurityPage } from './SecurityPage';
import { UsersPage } from './UsersPage';
import { FilesPage } from './FilesPage';
import { SystemPage } from './SystemPage';
import { AgentsPage } from './AgentsPage';
import { CronPage } from './features/CronPage';
import { DashboardPage } from './DashboardPage';
import { EmailDomainPage } from './EmailDomainPage';
import { UpdatesPage } from './UpdatesPage';
import { AiPage } from './AiPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { ReadinessPage } from './features/ReadinessPage';
import { ServicesPage } from './features/ServicesPage';
import { RedisPage } from './features/RedisPage';
import { SqlEnginePage } from './features/SqlEnginePage';

const emptyList = {
  items: [],
  meta: { total: 0, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
};

function routes(): FetchRoute[] {
  const now = new Date().toISOString();
  return [
    softwareReadyRoute(),
    {
      match: /\/api\/v1\/scheduler/,
      body: { jobs: [], items: [] },
    },
    {
      match: (url) => url.startsWith('/api/v1/readiness') || url.includes('/readiness'),
      body: {
        productionReady: false,
        mode: 'degraded',
        summary: ['execute policy off'],
        score: { ready: 1, degraded: 1, missing: 1, total: 3 },
        items: [
          {
            id: 'execute-policy',
            category: 'security',
            level: 'missing',
            severity: 'critical',
            title: 'Execute',
            detail: 'Host execute is off',
            fixHint: 'Enable execute',
          },
        ],
        blockers: [],
        categories: ['security'],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/status') || url.includes('/defense/probe'),
      body: {
        at: now,
        threatLevel: 'under_attack',
        score: 80,
        signals: [
          { id: 'highReqRate', label: 'Req', value: 200, points: 20 },
          { id: 'f2bBans', label: 'Bans', value: 5, points: 10 },
        ],
        activePreset: 'hardened',
        presets: [
          { id: 'daily', label: 'Daily', short: 'D', bullets: ['a'] },
          { id: 'hardened', label: 'Hardened', short: 'H', bullets: ['b'] },
          { id: 'under_attack', label: 'Attack', short: 'A', bullets: ['c'], danger: true },
          { id: 'emergency', label: 'Emergency', short: 'E', bullets: ['d'], danger: true },
        ],
        bans: {
          count: 2,
          items: [
            { ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' },
            { ip: '198.51.100.1', source: 'ufw', reason: 'manual' },
          ],
        },
        nginxLimits: {
          reqRate: '10r/s',
          burst: 20,
          connLimit: 40,
          confPath: '/etc/nginx/conf.d/d.conf',
          exists: true,
        },
        firewall: { active: 'active', installed: true },
        fail2ban: { active: 'active', installed: true, jails: 3 },
        labels: {
          firewall: { short: 'on', tone: 'ok' },
          fail2ban: { short: 'on', tone: 'ok' },
          apply: { short: 'written', tone: 'info' },
          autoBan: { short: 'on', tone: 'ok' },
        },
        autoBan: {
          enabled: true,
          mode: 'aggressive',
          method: 'both',
          cooldownMinutes: 15,
          maxAutoBansPerHour: 50,
          whitelist: ['127.0.0.1'],
          autoBansLastHour: 3,
        },
        executeEnabled: false,
        isRoot: false,
        suggestions: [
          { id: 's1', title: 'Apply hardened', body: 'x', action: 'preset:hardened' },
          { id: 's2', title: 'Bans', body: 'y', action: 'tab:bans' },
          { id: 's3', title: 'Readiness', body: 'z', action: 'href:/system/readiness' },
        ],
        notes: ['YSK_EXECUTE blocked system'],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/geoip'),
      body: {
        provider: 'dbip',
        dir: '/var/lib/geo',
        ready: true,
        stale: false,
        cityReady: true,
        notes: [],
        attribution: ['DB-IP'],
        policy: {
          enabled: true,
          mode: 'deny_list',
          countries: ['CN', 'RU'],
          continents: ['AS'],
          regions: [],
          cities: ['Moscow'],
          cityPolicyEnabled: true,
          asns: ['AS123'],
          enforce: { autoBan: true, nginx: true, ufw: true },
          autoUpdate: true,
        },
        sources: [
          {
            filename: 'dbip.mmdb',
            present: true,
            mtime: now,
            bytes: 1000,
            license: 'free',
            updateHint: 'weekly',
          },
        ],
        meta: { lastSuccessAt: now },
        lookup: { country: 'US', city: 'NYC' },
        access: { blocked: false, matched: [] },
        ok: true,
        ...HONESTY_WRITTEN_BLOCKED,
      },
    },
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
            holdMinutes: 30,
          },
          autoBan: {
            enabled: true,
            mode: 'aggressive',
            method: 'both',
            minScore: 5,
            minHits: 20,
            min429: 3,
            minScan: 2,
            cooldownMinutes: 15,
            maxAutoBansPerHour: 50,
            intervalSeconds: 30,
            whitelist: ['127.0.0.1'],
            syncFail2banIgnoreip: true,
          },
          cloudflare: {
            enabled: true,
            zones: ['example.com'],
            onAutoEscalate: true,
          },
          lastTickAt: now,
          lastTickNotes: ['tick'],
          suggestEmergency: true,
        },
        mechanisms: [
          { step: '1', mechanism: 'fail2ban', tunable: 'bantime' },
          { step: '2', mechanism: 'nginx', tunable: 'limit_req' },
        ],
        autoBansLastHour: 3,
        schedNext: now,
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/suspects'),
      body: {
        items: [
          {
            ip: '198.51.100.7',
            score: 40,
            hits: 200,
            reasons: ['scan', '429'],
            sources: ['nginx'],
            lastSeen: now,
          },
        ],
        notes: [],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/intel'),
      body: {
        topIps: [{ ip: '1.2.3.4', hits: 9, s429: 2, scan: 1, score: 15 }],
        vhostLimits: {
          withLimit: 1,
          total: 2,
          items: [{ name: 'a.example.com', hasDefenseMarker: true }],
        },
        hasCfToken: true,
        cfZones: ['example.com'],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/timeline'),
      body: {
        items: [
          { at: now, kind: 'preset', title: 'Hardened', detail: 'auto' },
          { at: now, kind: 'ban', title: 'Ban IP', detail: '203.0.113.10' },
        ],
      },
    },
    {
      match: (url) => url.startsWith('/api/v1/defense/bans'),
      body: {
        items: [{ ip: '203.0.113.10', source: 'fail2ban', jail: 'sshd', reason: 'auth' }],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
      },
    },
    {
      match: /\/api\/v1\/defense/,
      body: { ...HONESTY_WRITTEN_BLOCKED, items: [], whitelist: ['127.0.0.1'] },
    },
    {
      match: /\/api\/v1\/cdn\/dashboard/,
      body: {
        at: now,
        nodes: {
          total: 2,
          online: 1,
          offline: 1,
          draining: 0,
          unknown: 0,
          byRegion: { ap: 1, eu: 1 },
        },
        sites: {
          total: 1,
          byApplyStatus: { written: 1 },
          rows: [
            {
              id: 's1',
              name: 'site',
              domains: ['cdn.example.com'],
              mode: 'proxy',
              strategy: 'round_robin',
              apply_status: 'written',
              edgeCount: 1,
              edgesApplied: 0,
              onlineEdges: 1,
              managedDnsRecords: 1,
            },
          ],
        },
        cache: [
          {
            siteId: 's1',
            siteName: 'site',
            method: 'nginx',
            hitRatePct: 80,
            hits: 100,
            misses: 20,
            notes: [],
          },
        ],
        overallHitRatePct: 80,
        notes: [],
      },
    },
    {
      match: (url: string, init?: RequestInit) =>
        url.startsWith('/api/v1/cdn/nodes') && (init?.method ?? 'GET').toUpperCase() === 'GET',
      body: {
        items: [
          {
            id: 'n1',
            name: 'edge-1',
            role: 'edge',
            roles: ['edge'],
            host: '10.0.0.2',
            region: 'ap',
            status: 'online',
            apply_status: 'applied',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
      },
    },
    {
      match: (url: string, init?: RequestInit) =>
        url.startsWith('/api/v1/cdn/sites') && (init?.method ?? 'GET').toUpperCase() === 'GET',
      body: {
        items: [
          {
            id: 's1',
            name: 'site',
            domains: ['cdn.example.com'],
            mode: 'origin_pull',
            origin: { url: 'http://origin.example.com' },
            edgeNodeIds: ['n1'],
            status: 'written',
            apply_status: 'written',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
      },
    },
    {
      match: /\/api\/v1\/cdn/,
      body: HONESTY_WRITTEN_BLOCKED,
    },
    {
      match: /\/api\/v1\/dns/,
      body: {
        items: [
          {
            id: 'z1',
            name: 'example.com',
            type: 'A',
            content: '1.2.3.4',
            ttl: 300,
            apply_status: 'written',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        peers: [],
      },
    },
    {
      match: /\/api\/v1\/backups/,
      body: {
        items: [
          {
            projectId: 'p1',
            name: 'Demo',
            path: '/backups/p1.tgz',
            bytes: 1024,
            mtime: now,
          },
        ],
      },
    },
    {
      match: /\/api\/v1\/logs\//,
      handler: (url) => {
        if (url.includes('/projects')) {
          return {
            items: [
              {
                projectId: 'p1',
                name: 'Demo',
                files: [{ name: 'app.log', bytes: 100, previewable: true }],
                related: [],
              },
            ],
          };
        }
        if (url.includes('/sources')) {
          return {
            items: [
              {
                id: 'j1',
                kind: 'journal',
                label: 'nginx',
                unit: 'nginx.service',
                group: 'journal',
                available: true,
              },
            ],
          };
        }
        if (url.includes('/journal/units')) {
          return {
            items: [
              { unit: 'nginx.service', active: 'active' },
              { unit: 'ysk-project-p1.service', active: 'active' },
            ],
          };
        }
        return {
          ok: true,
          items: [],
          journalDiskMb: 100,
          followIntervalSec: 3,
          journalWarnMb: 1024,
          vacuumDefaultDays: 14,
          maxLines: 300,
          text: 'boot\n',
          lines: ['boot'],
          quickUnits: [],
          settings: {},
        };
      },
    },
    {
      match: /\/api\/v1\/metrics/,
      body: {
        ok: true,
        at: now,
        cpu: { percent: 5, us: 3, sy: 2, ni: 0, id: 95, wa: 0, hi: 0, si: 0, st: 0, busyPct: 5 },
        memory: {
          usedMb: 200,
          totalMb: 2048,
          percent: 10,
          total: 2e9,
          free: 1e9,
          usedRatio: 0.5,
          totalKiB: 2e6,
          freeKiB: 1e6,
          usedKiB: 1e6,
          buffCacheKiB: 0,
          availableKiB: 1e6,
        },
        disk: { usedGb: 10, totalGb: 100, percent: 10 },
        load: [0.2, 0.2, 0.2],
        loadavg: [0.2, 0.2, 0.2],
        cpuCount: 4,
        uptimeSec: 3600,
        alerts: ['disk high'],
        processes: [
          {
            pid: '1',
            user: 'root',
            cpu: 0.1,
            mem: 0.1,
            command: 'systemd',
          },
        ],
        disks: [],
        items: [],
        totalMb: 100,
        usedMb: 10,
        notes: [],
        tasks: { total: 10, running: 1, sleeping: 9, stopped: 0, zombie: 0 },
        cpus: [{ us: 3, sy: 2, ni: 0, id: 95, wa: 0, hi: 0, si: 0, st: 0, busyPct: 5 }],
        swap: { totalKiB: 0, freeKiB: 0, usedKiB: 0 },
      },
    },
    {
      match: /\/api\/v1\/network/,
      body: {
        ok: true,
        notes: [],
        backend: { hasIp: true, hasNmcli: false, hasResolvectl: false },
        interfaces: [
          {
            name: 'eth0',
            up: true,
            operstate: 'UP',
            flags: ['UP', 'BROADCAST'],
            mac: 'aa:bb:cc:dd:ee:ff',
            addrs: ['10.0.0.5/24'],
            addresses: [{ address: '10.0.0.5', prefix: 24, family: 'inet' }],
            rxBytes: 1000,
            txBytes: 2000,
          },
        ],
        routes: [
          {
            destination: 'default',
            gateway: '10.0.0.1',
            device: 'eth0',
            dest: 'default',
            iface: 'eth0',
          },
        ],
        caps: { canMutate: false, executeEnabled: false, isRoot: false },
        dns: {
          nameservers: ['1.1.1.1'],
          uplinkServers: [],
          search: ['local'],
          ignoreAutoDns: true,
        },
      },
    },
    {
      match: /\/api\/v1\/system\/host/,
      body: {
        ok: true,
        identity: { hostname: 'ysk', prettyHostname: 'YSK', timezone: 'UTC' },
        os: { platform: 'linux', arch: 'x64', release: 'Test', kernel: '6' },
        runtime: {
          uptimeSec: 100,
          loadavg: [0.1, 0.1, 0.1],
          cpus: 2,
          memory: { total: 8e9, free: 4e9, usedRatio: 0.5 },
          node: 'v20',
          pid: 1,
          uid: 0,
        },
        time: {
          utc: now,
          local: now,
          ntpEnabled: true,
          ntpSynchronized: true,
          timeSource: 'ntp',
        },
        network: { ips: ['10.0.0.5'], interfaces: [], resolvers: ['1.1.1.1'] },
        disks: [{ filesystem: '/dev/sda1', size: 1e11, used: 5e10, avail: 5e10, usedRatio: 0.5, mount: '/' }],
        power: { pending: null },
        boot: { defaultTarget: 'multi-user.target' },
        caps: {
          executeEnabled: false,
          isRoot: false,
          canPower: true,
          canIdentity: true,
        },
        collectedAt: now,
      },
    },
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
            binding: { linuxUser: 'ysk', homeDir: '/home/ysk' },
          },
        ],
        host: {
          notes: ['ok'],
          lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' },
        },
        pamSnippet: '# pam',
        sshdHints: '# sshd',
        snippet: 'Match',
        notes: [],
      },
    },
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
            fingerprint: 'SHA256:x',
            linuxUser: 'demo',
          },
        ],
        snippet: 'Match',
        notes: [],
      },
    },
    {
      match: /\/api\/v1\/security/,
      body: {
        ok: true,
        totpEnabled: true,
        enrolled: true,
        enabled: true,
        sessions: [
          {
            id: 's1',
            created_at: now,
            last_seen_at: now,
            userAgent: 'vitest',
            ip: '127.0.0.1',
          },
        ],
        apiKeys: [{ id: 'ak1', name: 'ci', created_at: now, prefix: 'ysk_' }],
        tools: [{ id: 't1', name: 'shell', enabled: false }],
        approvals: [{ id: 'ap1', tool: 'shell', status: 'pending', created_at: now }],
        webauthnCredentials: [],
      },
    },
    {
      match: /\/api\/v1\/rbac/,
      body: {
        items: [
          {
            role: 'operator',
            dirty: false,
            policy: { maxLevel: 'write-high', capabilities: ['projects.read', 'projects.write'] },
            factory: { maxLevel: 'write-high', capabilities: ['projects.read'] },
          },
          {
            role: 'viewer',
            dirty: false,
            policy: { maxLevel: 'read', capabilities: ['projects.read'] },
            factory: { maxLevel: 'read', capabilities: ['projects.read'] },
          },
          {
            role: 'admin',
            dirty: false,
            policy: { maxLevel: 'admin', capabilities: [] },
            factory: { maxLevel: 'admin', capabilities: [] },
          },
        ],
      },
    },
    {
      match: /\/api\/v1\/users/,
      body: {
        items: [
          {
            id: 'u1',
            username: 'alice',
            roles: ['operator'],
            packageId: 'pkg1',
            packageName: 'default',
            suspended: false,
            locale: 'en',
            totpEnabled: false,
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
        hostUsage: { projects: 1, diskMb: 100, limitMb: 10240 },
      },
    },
    {
      match: /\/api\/v1\/packages/,
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
            ssh: true,
            notes: '',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
      },
    },
    {
      match: (url) => url.includes('/hosting/files') || url.includes('/api/v1/files'),
      handler: (url) => {
        if (url.includes('trash')) {
          return {
            ok: true,
            items: [
              {
                name: 'old.txt',
                path: 'old.txt',
                type: 'file',
                size: 1,
                deletedAt: now,
                mtime: now,
              },
            ],
          };
        }
        if (url.includes('share')) {
          return {
            ok: true,
            items: [
              {
                id: 'sh1',
                path: '/pub',
                token: 'tok',
                createdAt: now,
              },
            ],
          };
        }
        return {
          ok: true,
          entries: [
            {
              name: 'a.txt',
              path: 'a.txt',
              type: 'file',
              size: 10,
              mtime: now,
            },
            { name: 'dir', path: 'dir', type: 'dir', mtime: now },
          ],
          items: [
            {
              name: 'a.txt',
              path: 'a.txt',
              type: 'file',
              size: 10,
              mtime: now,
            },
          ],
          path: '/',
        };
      },
    },
    {
      match: /\/api\/v1\/agents/,
      body: {
        items: [
          {
            id: 'ag1',
            name: 'edge',
            status: 'online',
            lastSeenAt: now,
            version: '0.1.0',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
      },
    },
    {
      match: /\/api\/v1\/cron/,
      body: {
        items: [
          {
            id: 'c1',
            schedule: '0 * * * *',
            command: 'true',
            enabled: true,
            projectId: 'p1',
          },
        ],
        managedPath: '/etc/cron.d/ysk',
        managedLines: 1,
        enabledJobs: 1,
        totalJobs: 1,
        hostHasYskEntries: true,
        hostCrontabPreview: '0 * * * * true',
        executeEnabled: false,
        lastInstallOk: true,
        lastInstallAt: now,
      },
    },
    {
      match: /\/api\/v1\/email/,
      body: {
        items: [{ id: 'dom-1', domain: 'example.com', rate_limit_per_hour: 200, antispam: true }],
        domain: 'example.com',
        records: [
          { type: 'MX', name: '@', value: 'mail.example.com' },
          { type: 'TXT', name: '@', value: 'v=spf1' },
        ],
        externalTodos: ['Add DKIM'],
        health: { score: 70, maxScore: 100, messages: ['ok'] },
        notes: [],
        checks: [{ id: 'spf', ok: true, detail: 'pass' }],
        recommendations: ['Add DMARC'],
        score: 70,
      },
    },
    {
      match: /\/api\/v1\/projects/,
      body: {
        items: [
          {
            id: 'p1',
            name: 'Demo App',
            domain: 'demo.example.com',
            runtime: 'node',
            runtimeVersion: '20',
            processStatus: 'running',
            status: 'running',
            gitUrl: 'https://github.com/example/demo.git',
            envVars: { NODE_ENV: 'production' },
            quotaMb: 1024,
            memoryMax: '512M',
            cpuQuotaPercent: 100,
            port: 3000,
            linuxUser: 'demo',
            homeDir: '/home/demo',
            osProvisioned: true,
            nginxConfigPath: '/etc/nginx/sites-enabled/demo',
            lastDeployAt: now,
          },
        ],
      },
    },
    {
      match: /\/api\/v1\/updates/,
      body: {
        jobs: [],
        ok: true,
        items: [],
        inventory: [
          {
            name: 'openssl',
            current: '1.0',
            candidate: '3.0',
            risk: 'high',
            upgradable: true,
          },
        ],
        advice: [{ id: 'a1', title: 'Upgrade openssl', risk: 'high' }],
        current: { version: '0.1.0' },
        channel: 'stable',
        pending: [],
        updateAvailable: true,
        checked: true,
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
      },
    },
    {
      match: /\/api\/v1\/ai\//,
      body: {
        items: [
          {
            id: 't1',
            title: 'Task',
            status: 'completed',
            createdAt: now,
            steps: [
              { id: 's1', title: 'Plan', status: 'completed' },
              { id: 's2', title: 'Run', status: 'executed' },
            ],
          },
        ],
      },
    },
    {
      match: /\/api\/v1\/dashboard\//,
      body: {
        ok: true,
        items: [],
        summary: { projects: 1, alerts: 0 },
        notifications: [],
        wizard: { steps: [], completed: 0 },
      },
    },
    { match: /.*/, body: { ok: true, items: [], ready: true, missing: [], notes: [] } },
  ];
}

function renderAt(path: string, el: ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

const matrix: Array<{
  name: string;
  base: string;
  tabs: string[];
  el: ReactElement;
  routePath?: string;
}> = [
  {
    name: 'Protection',
    base: '/protection',
    tabs: ['command', 'automation', 'bans', 'geo', 'stack', 'intel', 'about'],
    el: <ProtectionPage />,
  },
  {
    name: 'Cdn',
    base: '/cdn',
    tabs: ['nodes', 'sites', 'dashboard', 'about'],
    el: <CdnPage />,
  },
  {
    name: 'Dns',
    base: '/dns',
    tabs: ['zones', 'records', 'cluster', 'dnssec', 'tools', 'about'],
    el: <DnsPage />,
  },
  {
    name: 'Backups',
    base: '/backups',
    tabs: ['files', 'ops', 'remote', 'about'],
    el: <BackupsPage />,
  },
  {
    name: 'Logs',
    base: '/logs',
    tabs: ['explore', 'ops', 'settings', 'about'],
    el: <LogsPage />,
  },
  {
    name: 'Metrics',
    base: '/metrics',
    tabs: ['overview', 'live', 'storage', 'projects', 'alerts', 'about'],
    el: <MetricsPage />,
  },
  {
    name: 'Network',
    base: '/network',
    tabs: ['ifaces', 'routes', 'dns', 'advanced', 'about'],
    el: <NetworkPage />,
  },
  {
    name: 'Security',
    base: '/security',
    tabs: ['account', 'keys', 'ssh', 'approvals', 'allowlist', 'about'],
    el: <SecurityPage />,
  },
  {
    name: 'Users',
    base: '/users',
    tabs: ['users', 'packages', 'permissions', 'about'],
    el: <UsersPage />,
  },
  {
    name: 'Files',
    base: '/files',
    tabs: ['browse', 'trash', 'shares', 'webdav', 'about'],
    el: <FilesPage />,
  },
  {
    name: 'System',
    base: '/system',
    tabs: ['host', 'export', 'about'],
    el: <SystemPage />,
  },
  {
    name: 'Agents',
    base: '/agents',
    tabs: ['list', 'about'],
    el: <AgentsPage />,
  },
  {
    name: 'Cron',
    base: '/cron',
    tabs: ['jobs', 'status', 'about'],
    el: <CronPage />,
  },
  {
    name: 'Dashboard',
    base: '/',
    tabs: ['overview', 'wizard', 'notifications', 'features', 'about'],
    el: <DashboardPage />,
  },
  {
    name: 'Updates',
    base: '/updates',
    tabs: ['packages', 'panel', 'schedule', 'policy', 'about'],
    el: <UpdatesPage />,
  },
  {
    name: 'Ai',
    base: '/ai',
    tabs: ['tasks', 'playbooks', 'about'],
    el: <AiPage />,
  },
  {
    name: 'EmailDomain',
    base: '/email/dom-1',
    routePath: '/email/:id',
    tabs: ['dns', 'mailbox', 'aliases', 'health', 'deliverability', 'relay', 'sieve', 'advanced', 'about'],
    // EmailDomainPage uses local useState tab, not usePageTab — still mount once
    el: <EmailDomainPage />,
  },
  {
    name: 'ProjectDetail',
    base: '/projects/p1',
    routePath: '/projects/:id',
    tabs: ['overview', 'deploy', 'network', 'resources', 'logs', 'advanced', 'about'],
    el: <ProjectDetailPage />,
  },
  {
    name: 'Readiness',
    base: '/system/readiness',
    tabs: ['priority', 'checklist', 'summary', 'about'],
    el: <ReadinessPage />,
  },
  {
    name: 'Services',
    base: '/services',
    tabs: ['list', 'about'],
    el: <ServicesPage />,
  },
  {
    name: 'Redis',
    base: '/databases/redis',
    tabs: ['data', 'about'],
    el: <RedisPage />,
  },
  {
    name: 'SqlEngine',
    base: '/databases/mysql',
    tabs: ['databases', 'users', 'about'],
    el: <SqlEnginePage engine="mysql" />,
  },
];

describe('tab matrix smoke', () => {
  beforeEach(() => {
    authStore.setSession('t', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [
        'projects.read',
        'projects.write',
        'users.read',
        'users.write',
        'users.impersonate',
        'rbac.policy',
        'system.read',
        'system.write',
      ],
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it.each(
    matrix.flatMap((m) =>
      m.tabs.map((tab) => ({
        caseName: `${m.name}:${tab}`,
        path: `${m.base}?tab=${tab}`,
        routePath: m.routePath ?? '*',
        el: m.el,
      })),
    ),
  )(
    'renders $caseName',
    async ({ path, routePath, el }) => {
      installFetchMock(routes());
      renderAt(path, el, routePath);
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        },
        { timeout: 8000 },
      );
    },
    15_000,
  );
});
