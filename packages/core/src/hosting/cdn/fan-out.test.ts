import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { LocalHostExecutor } from '../../host/executor.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import {
  fanOutCdnSite,
  purgeCdnSite,
  resolveShieldUpstreamUrl,
} from './fan-out.js';
import type { CdnNodeDto, CdnSiteDto } from '@yanshekki/shared';

function mockHost(opts?: {
  execute?: boolean;
  nginx?: boolean;
  handlers?: Array<{
    match: (argv: string[]) => boolean;
    result: { exitCode: number; stdout?: string; stderr?: string };
  }>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => true,
    pathExists: (p) =>
      opts?.nginx !== false &&
      (p === '/usr/sbin/nginx' || p === '/usr/bin/nginx'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      for (const h of opts?.handlers ?? []) {
        if (h.match(argv)) {
          return {
            stdout: h.result.stdout ?? '',
            stderr: h.result.stderr ?? '',
            exitCode: h.result.exitCode,
            argv,
            dryRun: false,
          };
        }
      }
      // default success for mkdir, nginx -t, reload, purge
      if (argv[0] === 'nginx' && argv[1] === '-t') {
        return {
          stdout: 'syntax ok',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'bash' && String(argv[2] ?? '').includes('PURGE')) {
        return {
          stdout: 'PURGE_OK\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'bash' && String(argv[2] ?? '').includes('reload')) {
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      };
    },
  };
}

describe('cdn fan-out (PR-C3)', () => {
  it('without EXECUTE: conf written (not applied); SSH edges blocked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 's',
        domains: ['a.example.com'],
        origin: { kind: 'url', url: 'http://127.0.0.1:3000' },
        edgeNodeIds: [edge.id],
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: false }),
        dataDir: dir,
        siteId: site.id,
      });
      // local conf write under dataDir is allowed; not host-applied
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('written');
      expect(r.edges[0]?.apply_status).toBe('written');
      expect(existsSync(join(dir, 'cdn', 'sites', site.id, 'edge.conf'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fleet-only edge queues command without EXECUTE (queued ≠ applied)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfleet-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'fleet-edge',
        roles: ['edge'],
        fleetAgentId: 'session-fleet-1',
      });
      const site = upsertCdnSite(db, {
        name: 's',
        domains: ['f.example.com'],
        origin: { kind: 'url', url: 'http://127.0.0.1:3000' },
        edgeNodeIds: [edge.id],
      });
      const queued: unknown[] = [];
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: false }),
        dataDir: dir,
        siteId: site.id,
        enqueue: (sessionId, payload) => {
          queued.push({ sessionId, payload });
          return { id: 'cmd-1', agent_session_id: sessionId, status: 'queued' };
        },
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('written');
      expect(r.edges[0]?.method).toBe('fleet');
      expect(r.edges[0]?.apply_status).toBe('written');
      expect(queued).toHaveLength(1);
      expect((queued[0] as { payload: { op: string } }).payload.op).toBe('cdn.edge.apply');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('local edge fan-out applied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local-edge',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['cdn.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [edge.id],
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true, nginx: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('applied');
      expect(r.edges).toHaveLength(1);
      expect(r.edges[0].method).toBe('local');
      expect(r.edges[0].apply_status).toBe('applied');
      expect(r.edges[0].reloaded).toBe(true);
      expect(
        existsSync(join(dir, 'cdn', 'sites', site.id, 'edge.conf')),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ssh edge scp + reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'remote',
        roles: ['edge'],
        publicIpv4: ['203.0.113.50'],
        sshUsername: 'root',
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['x.example.com'],
        origin: { kind: 'url', url: 'http://origin.example.com' },
        edgeNodeIds: [edge.id],
      });
      const host = mockHost({
        execute: true,
        handlers: [
          {
            match: (argv) => argv[0] === 'scp',
            result: { exitCode: 0 },
          },
          {
            match: (argv) =>
              argv[0] === 'ssh' &&
              argv.join(' ').includes('NGINX_RELOAD_OK'),
            result: { exitCode: 0, stdout: 'NGINX_RELOAD_OK\n' },
          },
          {
            match: (argv) => argv[0] === 'ssh',
            result: { exitCode: 0, stdout: '' },
          },
        ],
      });
      const r = await fanOutCdnSite({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('applied');
      expect(r.edges[0].method).toBe('ssh');
      expect(r.edges[0].reloaded).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips draining edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'drain-me',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
        status: 'draining',
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['d.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.edges[0].method).toBe('skip');
      expect(r.edges[0].notes.some((n) => /draining/i.test(n))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('purge local cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['p.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const r = await purgeCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(true);
      expect(r.edges[0].apply_status).toBe('applied');
      expect(r.notes.some((n) => /purge/i.test(n))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fleet-only edge without enqueue is blocked (not fake applied)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'fleet-edge',
        roles: ['edge'],
        // no IPv4 → not SSH; healthUrl satisfies node validation
        publicIpv4: [],
        healthUrl: 'https://fleet-edge.example.com/health',
        fleetAgentId: 'session-abc',
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['f.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.edges[0].method).toBe('fleet');
      expect(r.edges[0].apply_status).toBe('blocked');
      expect(r.apply_status).toBe('blocked');
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.edges[0].notes.some((n) => /enqueue|SSH/i.test(n))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fleet-only edge with enqueue is written (queued ≠ applied)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'fleet-edge',
        roles: ['edge'],
        publicIpv4: [],
        healthUrl: 'https://fleet-edge.example.com/health',
        fleetAgentId: 'session-xyz',
      });
      const site = upsertCdnSite(db, {
        name: 'demo',
        domains: ['q.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const payloads: unknown[] = [];
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
        enqueue: (sessionId, payload) => {
          expect(sessionId).toBe('session-xyz');
          payloads.push(payload);
          return { id: 'cmd-12345678' };
        },
      });
      expect(r.edges[0].method).toBe('fleet');
      expect(r.edges[0].apply_status).toBe('written');
      expect(r.edges[0].reloaded).toBe(false);
      expect(r.apply_status).toBe('written');
      expect(r.ok).toBe(true);
      expect(payloads[0]).toMatchObject({
        op: 'cdn.edge.apply',
        siteId: site.id,
        edgeNodeId: edge.id,
      });
      expect(
        r.notes.some((n) => /queued|佇列/i.test(n)),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveShieldUpstreamUrl uses baseUrl, IPv4, IPv6, fallback', () => {
    const site = {
      ssl: { mode: 'upload' as const },
    } as CdnSiteDto;
    expect(
      resolveShieldUpstreamUrl(site, {
        baseUrl: 'https://shield.example.com/',
        publicIpv4: [],
        publicIpv6: [],
      } as CdnNodeDto),
    ).toBe('https://shield.example.com');
    expect(
      resolveShieldUpstreamUrl(site, {
        publicIpv4: ['203.0.113.9'],
        publicIpv6: [],
      } as CdnNodeDto),
    ).toBe('https://203.0.113.9');
    expect(
      resolveShieldUpstreamUrl(
        { ssl: { mode: 'off' } } as CdnSiteDto,
        { publicIpv4: [], publicIpv6: ['2001:db8::1'] } as CdnNodeDto,
      ),
    ).toBe('http://[2001:db8::1]');
    expect(
      resolveShieldUpstreamUrl(site, {
        publicIpv4: [],
        publicIpv6: [],
      } as CdnNodeDto),
    ).toBe('http://127.0.0.1:80');
  });

  it('SSH edge blocked without EXECUTE (honest blocked status)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'remote',
        roles: ['edge'],
        publicIpv4: ['203.0.113.60'],
        sshUsername: 'root',
      });
      const site = upsertCdnSite(db, {
        name: 'ssh-block',
        domains: ['sshblock.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await fanOutCdnSite({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.edges[0]?.method).toBe('ssh');
      expect(r.edges[0]?.apply_status).toBe('blocked');
      expect(r.apply_status).toBe('blocked');
      expect(r.ok).toBe(false);
      expect(r.blocked === true || r.edges[0]?.apply_status === 'blocked').toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing edge node id fails that edge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'miss',
        domains: ['miss.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      // inject stale edge id after create (upsert validates nodes exist)
      const raw = JSON.parse(db.snapshot.settings['cdn_sites'] ?? '[]') as Array<{
        id: string;
        edgeNodeIds: string[];
      }>;
      const row = raw.find((s) => s.id === site.id)!;
      row.edgeNodeIds.push('nonexistent-edge-id');
      db.snapshot.settings['cdn_sites'] = JSON.stringify(raw);
      db.persist();

      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true, nginx: true }),
        dataDir: dir,
        siteId: site.id,
      });
      const miss = r.edges.find((e) => e.edgeNodeId === 'nonexistent-edge-id');
      expect(miss?.apply_status).toBe('failed');
      expect(miss?.method).toBe('skip');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('origin shield renders per-edge confs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const shield = upsertCdnNode(db, {
        name: 'shield',
        roles: ['edge'],
        publicIpv4: ['203.0.113.10'],
        baseUrl: 'https://shield.cdn.example.com',
      });
      const edge = upsertCdnNode(db, {
        name: 'edge2',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'shielded',
        domains: ['shielded.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [shield.id, edge.id],
        originShieldNodeId: shield.id,
        ssl: { mode: 'off' },
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: false }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(
        r.notes.some((n) => /shield|upstream/i.test(n)),
      ).toBe(true);
      const edgeDir = join(dir, 'cdn', 'sites', site.id, 'edges');
      expect(existsSync(edgeDir)).toBe(true);
      // local edge without execute → written conf
      const localEdge = r.edges.find((e) => e.edgeNodeId === edge.id);
      expect(
        localEdge?.apply_status === 'written' ||
          localEdge?.apply_status === 'blocked',
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('local nginx -t failure → failed edge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local-bad',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'badngx',
        domains: ['badngx.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const host = mockHost({
        execute: true,
        nginx: true,
        handlers: [
          {
            match: (argv) => argv[0] === 'nginx' && argv[1] === '-t',
            result: { exitCode: 1, stderr: 'syntax error' },
          },
        ],
      });
      const r = await fanOutCdnSite({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.edges[0]?.apply_status).toBe('failed');
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SSH scp fail and NGINX_NONE partial paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edgeScp = upsertCdnNode(db, {
        name: 'scp-fail',
        roles: ['edge'],
        publicIpv4: ['203.0.113.70'],
      });
      const site1 = upsertCdnSite(db, {
        name: 'scpf',
        domains: ['scpf.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edgeScp.id],
      });
      const hostScp = mockHost({
        execute: true,
        handlers: [
          {
            match: (argv) => argv[0] === 'scp',
            result: { exitCode: 1, stderr: 'scp fail' },
          },
          {
            match: (argv) => argv[0] === 'ssh',
            result: { exitCode: 0, stdout: '' },
          },
        ],
      });
      const scpR = await fanOutCdnSite({
        db,
        host: hostScp,
        dataDir: dir,
        siteId: site1.id,
      });
      expect(scpR.edges[0]?.apply_status).toBe('failed');

      const edgeNone = upsertCdnNode(db, {
        name: 'ngx-none',
        roles: ['edge'],
        publicIpv4: ['203.0.113.71'],
      });
      const site2 = upsertCdnSite(db, {
        name: 'ngxnone',
        domains: ['ngxnone.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edgeNone.id],
      });
      let sshN = 0;
      const hostNone = mockHost({
        execute: true,
        handlers: [
          { match: (argv) => argv[0] === 'scp', result: { exitCode: 0 } },
          {
            match: (argv) => argv[0] === 'ssh',
            result: (() => {
              // first ssh = mkdir (ok); second = reload → NGINX_NONE
              return { exitCode: 0, stdout: '' };
            })(),
          },
        ],
      });
      // custom host: mkdir ok, reload reports NGINX_NONE
      const hostNone2: HostExecutor = {
        ...hostNone,
        runCommand: async (argv) => {
          if (argv[0] === 'scp') {
            return {
              stdout: '',
              stderr: '',
              exitCode: 0,
              argv,
              dryRun: false,
            };
          }
          if (argv[0] === 'ssh') {
            sshN += 1;
            if (sshN === 1) {
              return {
                stdout: '',
                stderr: '',
                exitCode: 0,
                argv,
                dryRun: false,
              };
            }
            return {
              stdout: 'NGINX_NONE\n',
              stderr: '',
              exitCode: 1,
              argv,
              dryRun: false,
            };
          }
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        },
      };
      const noneR = await fanOutCdnSite({
        db,
        host: hostNone2,
        dataDir: dir,
        siteId: site2.id,
      });
      expect(noneR.edges[0]?.apply_status).toBe('partial');
      expect(noneR.edges[0]?.reloaded).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('purge blocked without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'purge-block',
        domains: ['pb.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await purgeCdnSite({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('purge fleet-only edge queues or blocks; SSH purge path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const fleet = upsertCdnNode(db, {
        name: 'fleet-p',
        roles: ['edge'],
        publicIpv4: [],
        healthUrl: 'https://fleet.example.com/health',
        fleetAgentId: 'session-purge-1',
      });
      const site = upsertCdnSite(db, {
        name: 'purge-f',
        domains: ['pf.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [fleet.id],
      });
      const blocked = await purgeCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(blocked.edges[0]?.method).toBe('fleet');
      expect(blocked.edges[0]?.apply_status).toBe('blocked');
      expect(blocked.apply_status).toBe('blocked');

      const queued: unknown[] = [];
      const q = await purgeCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
        enqueue: (sessionId, payload) => {
          queued.push({ sessionId, payload });
          return { id: 'purge-cmd-1' };
        },
      });
      expect(q.edges[0]?.apply_status).toBe('written');
      expect(q.apply_status).toBe('written');
      expect(q.ok).toBe(true);
      expect((queued[0] as { payload: { op: string } }).payload.op).toBe(
        'cdn.edge.purge',
      );

      const remote = upsertCdnNode(db, {
        name: 'ssh-purge',
        roles: ['edge'],
        publicIpv4: ['203.0.113.90'],
      });
      const site2 = upsertCdnSite(db, {
        name: 'purge-ssh',
        domains: ['ps.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [remote.id],
      });
      const sshP = await purgeCdnSite({
        db,
        host: mockHost({
          execute: true,
          handlers: [
            {
              match: (argv) =>
                argv[0] === 'ssh' &&
                argv.join(' ').includes('PURGE'),
              result: { exitCode: 0, stdout: 'PURGE_OK\n' },
            },
            {
              match: (argv) => argv[0] === 'ssh',
              result: { exitCode: 0, stdout: 'PURGE_OK\n' },
            },
          ],
        }),
        dataDir: dir,
        siteId: site2.id,
      });
      expect(sshP.edges[0]?.method).toBe('ssh');
      expect(sshP.edges[0]?.apply_status).toBe('applied');
      expect(sshP.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('purge skips draining; missing edge fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const drain = upsertCdnNode(db, {
        name: 'd',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
        status: 'draining',
      });
      const site = upsertCdnSite(db, {
        name: 'pd',
        domains: ['pd.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [drain.id],
      });
      const raw = JSON.parse(db.snapshot.settings['cdn_sites'] ?? '[]') as Array<{
        id: string;
        edgeNodeIds: string[];
      }>;
      const row = raw.find((s) => s.id === site.id)!;
      row.edgeNodeIds.push('gone-edge');
      db.snapshot.settings['cdn_sites'] = JSON.stringify(raw);
      db.persist();

      const r = await purgeCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.edges.find((e) => e.edgeNodeId === drain.id)?.method).toBe(
        'skip',
      );
      expect(
        r.edges.find((e) => e.edgeNodeId === 'gone-edge')?.apply_status,
      ).toBe('failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fleet enqueue throw → failed edge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnfo-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'fleet-err',
        roles: ['edge'],
        publicIpv4: [],
        healthUrl: 'https://fe.example.com/h',
        fleetAgentId: 'session-err',
      });
      const site = upsertCdnSite(db, {
        name: 'ferr',
        domains: ['ferr.example.com'],
        origin: { kind: 'url', url: 'http://o.example.com' },
        edgeNodeIds: [edge.id],
      });
      const r = await fanOutCdnSite({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
        enqueue: () => {
          throw new Error('enqueue down');
        },
      });
      expect(r.edges[0]?.method).toBe('fleet');
      expect(r.edges[0]?.apply_status).toBe('failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

