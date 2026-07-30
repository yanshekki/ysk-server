import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import { fanOutCdnSite, purgeCdnSite } from './fan-out.js';

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
  it('blocks without EXECUTE', async () => {
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
      expect(r.blocked).toBe(true);
      expect(r.apply_status).toBe('blocked');
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
});
