import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  listDnsClusterPeers,
  upsertDnsClusterPeer,
  deleteDnsClusterPeer,
  pushDnsZonesToCluster,
  reloadDnsClusterPeers,
  probeDnsClusterPeers,
} from './dns-cluster.js';
import type { HostExecutor } from '../host/executor.js';

function mockHost(opts: {
  execute?: boolean;
  /** map command key → result */
  handlers?: Array<{
    match: (argv: string[]) => boolean;
    result: { exitCode: number; stdout?: string; stderr?: string };
  }>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => false,
    pathExists: () => false,
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
      for (const h of opts.handlers ?? []) {
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

describe('dns-cluster', () => {
  it('manages peers and push without peers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(listDnsClusterPeers(db)).toHaveLength(0);
      const p = upsertDnsClusterPeer(db, {
        host: 'ns2.example.com',
        username: 'root',
        port: 22,
        label: 'ns2',
      });
      expect(listDnsClusterPeers(db)).toHaveLength(1);
      expect(p.host).toBe('ns2.example.com');
      expect(deleteDnsClusterPeer(db, p.id)).toBe(true);
      expect(deleteDnsClusterPeer(db, 'nope')).toBe(false);

      const host = mockHost({ execute: false });
      const push = await pushDnsZonesToCluster({ db, host, dataDir: dir });
      expect(push.ok).toBe(true);
      expect(push.notes.some((n) => /peer/i.test(n) || /尚未/.test(n))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks push/reload/probe without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      upsertDnsClusterPeer(db, {
        host: 'ns2.example.com',
        username: 'root',
      });
      const host = mockHost({ execute: false });
      const push = await pushDnsZonesToCluster({ db, host, dataDir: dir });
      expect(push.ok).toBe(false);
      expect(push.blocked).toBe(true);
      expect(push.apply_status).toBe('blocked');

      const reload = await reloadDnsClusterPeers({ db, host });
      expect(reload.blocked).toBe(true);

      const probe = await probeDnsClusterPeers({ db, host });
      expect(probe.blocked).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push scp + remote reload reports applied per peer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-'));
    try {
      const zoneDir = join(dir, 'dns', 'zones');
      mkdirSync(zoneDir, { recursive: true });
      writeFileSync(join(zoneDir, 'example.com.zone'), '$ORIGIN example.com.\n');

      const db = new JsonStore(join(dir, 'db.json'));
      const peer = upsertDnsClusterPeer(db, {
        host: '10.0.0.2',
        username: 'root',
        label: 'ns2',
      });

      const host = mockHost({
        execute: true,
        handlers: [
          {
            match: (argv) => argv[0] === 'scp',
            result: { exitCode: 0, stdout: '' },
          },
          {
            match: (argv) =>
              argv[0] === 'ssh' && argv.some((a) => a.includes('RELOAD_OK') || a.includes('rndc')),
            result: { exitCode: 0, stdout: 'RELOAD_OK:rndc\n' },
          },
          {
            match: (argv) => argv[0] === 'ssh',
            result: { exitCode: 0, stdout: '' },
          },
        ],
      });

      const r = await pushDnsZonesToCluster({
        db,
        host,
        dataDir: dir,
        peerId: peer.id,
        reload: true,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('applied');
      expect(r.peers).toHaveLength(1);
      expect(r.peers[0].scpOk).toBe(true);
      expect(r.peers[0].reloaded).toBe(true);
      expect(r.peers[0].reloadMethod).toBe('rndc');
      expect(r.peers[0].apply_status).toBe('applied');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push with scp ok but reload fail → partial', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-'));
    try {
      const zoneDir = join(dir, 'dns', 'zones');
      mkdirSync(zoneDir, { recursive: true });
      writeFileSync(join(zoneDir, 'example.com.zone'), 'x');

      const db = new JsonStore(join(dir, 'db.json'));
      upsertDnsClusterPeer(db, {
        host: '10.0.0.3',
        username: 'root',
      });

      const host = mockHost({
        execute: true,
        handlers: [
          {
            match: (argv) => argv[0] === 'scp',
            result: { exitCode: 0 },
          },
          {
            match: (argv) => argv[0] === 'ssh' && argv.join(' ').includes('rndc'),
            result: { exitCode: 1, stdout: 'RELOAD_NONE\n' },
          },
          {
            match: (argv) => argv[0] === 'ssh',
            result: { exitCode: 0, stdout: '' },
          },
        ],
      });

      const r = await pushDnsZonesToCluster({
        db,
        host,
        dataDir: dir,
        reload: true,
      });
      expect(r.ok).toBe(false);
      expect(r.apply_status).toBe('partial');
      expect(r.peers[0].scpOk).toBe(true);
      expect(r.peers[0].reloaded).toBe(false);
      expect(r.peers[0].apply_status).toBe('partial');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reload-only and probe parse remote output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      upsertDnsClusterPeer(db, {
        host: 'ns3.example.com',
        username: 'ysk',
        path: '/var/lib/ysk/dns/zones',
      });

      const host = mockHost({
        execute: true,
        handlers: [
          {
            match: (argv) =>
              argv[0] === 'ssh' && argv.join(' ').includes('RELOAD_OK'),
            result: { exitCode: 0, stdout: 'RELOAD_OK:bind9\n' },
          },
          {
            match: (argv) =>
              argv[0] === 'ssh' && argv.join(' ').includes('ACTIVE:'),
            result: {
              exitCode: 0,
              stdout: 'ACTIVE:bind9\nZONE_DIR:ok\nZONE_FILES:2\n',
            },
          },
          {
            match: (argv) => argv[0] === 'ssh',
            result: {
              exitCode: 0,
              stdout: 'ACTIVE:bind9\nZONE_DIR:ok\nZONE_FILES:2\n',
            },
          },
        ],
      });

      // reload uses REMOTE_RELOAD_SCRIPT which contains RELOAD_OK in the script text
      const reload = await reloadDnsClusterPeers({ db, host, dataDir: dir });
      expect(reload.ok).toBe(true);
      expect(reload.peers[0].reloaded).toBe(true);
      expect(reload.peers[0].reloadMethod).toBe('bind9');

      const probe = await probeDnsClusterPeers({ db, host, dataDir: dir });
      expect(probe.ok).toBe(true);
      expect(probe.peers[0].probe?.service).toBe('bind9');
      expect(probe.peers[0].probe?.zoneDirOk).toBe(true);
      // lastProbe persisted
      const listed = listDnsClusterPeers(db);
      expect(listed[0].lastProbe?.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
