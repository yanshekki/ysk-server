import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  listDnsClusterPeers,
  upsertDnsClusterPeer,
  deleteDnsClusterPeer,
  probeDnsClusterPeer,
  probeDnsClusterPeers,
  reloadDnsClusterPeers,
  pushDnsZonesToCluster,
} from './dns-cluster.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
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
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts.run?.(argv) ?? {}),
    }),
  };
}

describe('dns-cluster depth', () => {
  it('listDnsClusterPeers recovers corrupt settings; upsert with identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-d-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings.dns_cluster_peers = 'not-json{';
      db.persist();
      expect(listDnsClusterPeers(db)).toEqual([]);

      const p = upsertDnsClusterPeer(db, {
        host: 'ns1.example',
        username: 'dns',
        port: 2222,
        path: '/zones',
        label: 'ns1',
        sshIdentityId: 'id-1',
      });
      const again = upsertDnsClusterPeer(db, {
        id: p.id,
        host: 'ns1.example',
        username: 'dns',
        label: 'ns1b',
      });
      expect(again.id).toBe(p.id);
      expect(again.sshIdentityId).toBe('id-1');
      expect(again.label).toBe('ns1b');
      expect(deleteDnsClusterPeer(db, p.id)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeDnsClusterPeer success / fail / no-execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-p-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const peer = upsertDnsClusterPeer(db, {
        host: '10.0.0.2',
        username: 'root',
        label: 'peer',
      });

      const noExec = await probeDnsClusterPeer({
        host: mockHost({ execute: false }),
        peer,
        db,
      });
      expect(noExec.ok).toBe(false);

      const fail = await probeDnsClusterPeer({
        host: mockHost({
          run: () => ({ exitCode: 255, stderr: 'Connection refused' }),
        }),
        peer,
        db,
      });
      expect(fail.ok).toBe(false);
      expect(fail.notes.length).toBeGreaterThan(0);

      const ok = await probeDnsClusterPeer({
        host: mockHost({
          run: (argv) => {
            if (argv[0] === 'ssh') {
              return {
                exitCode: 0,
                stdout: 'ACTIVE:named\nZONE_DIR:ok\nZONE_FILES:3\n',
              };
            }
            return {};
          },
        }),
        peer,
        db,
        dataDir: dir,
      });
      expect(ok.ok).toBe(true);
      expect(ok.service).toBe('named');
      expect(ok.zoneDirOk).toBe(true);

      const noSvc = await probeDnsClusterPeer({
        host: mockHost({
          run: () => ({
            exitCode: 0,
            stdout: 'ACTIVE:none\nZONE_DIR:missing\nZONE_FILES:0\n',
          }),
        }),
        peer,
      });
      expect(noSvc.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probe/reload multi-peer partial and push with scp+reload+probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-m-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const a = upsertDnsClusterPeer(db, { host: 'ns-a', username: 'root', label: 'A' });
      const b = upsertDnsClusterPeer(db, { host: 'ns-b', username: 'root', label: 'B' });

      const probePartial = await probeDnsClusterPeers({
        db,
        host: mockHost({
          run: (argv) => {
            const dest = argv.find((x) => x.includes('@')) || '';
            if (dest.includes('ns-a')) {
              return { exitCode: 0, stdout: 'ACTIVE:bind9\nZONE_DIR:ok\nZONE_FILES:1\n' };
            }
            return { exitCode: 255, stderr: 'timeout' };
          },
        }),
        dataDir: dir,
      });
      expect(probePartial.apply_status).toBe('partial');
      expect(probePartial.ok).toBe(false);

      const one = await probeDnsClusterPeers({
        db,
        host: mockHost({
          run: () => ({
            exitCode: 0,
            stdout: 'ACTIVE:pdns\nZONE_DIR:ok\nZONE_FILES:2\n',
          }),
        }),
        peerId: a.id,
      });
      expect(one.peers).toHaveLength(1);

      const reloadOk = await reloadDnsClusterPeers({
        db,
        host: mockHost({
          run: () => ({ exitCode: 0, stdout: 'RELOAD_OK:rndc\n' }),
        }),
      });
      expect(reloadOk.ok).toBe(true);
      expect(reloadOk.apply_status).toBe('applied');

      const reloadNone = await reloadDnsClusterPeers({
        db,
        host: mockHost({
          run: () => ({ exitCode: 1, stdout: 'RELOAD_NONE\n' }),
        }),
        peerId: b.id,
      });
      expect(reloadNone.ok).toBe(false);
      expect(reloadNone.peers[0]?.apply_status).toBe('failed');

      const reloadFail = await reloadDnsClusterPeers({
        db,
        host: mockHost({
          run: () => ({ exitCode: 1, stderr: 'permission denied' }),
        }),
      });
      expect(reloadFail.ok).toBe(false);

      // zones
      const zoneDir = join(dir, 'dns', 'zones');
      mkdirSync(zoneDir, { recursive: true });
      writeFileSync(join(zoneDir, 'example.com.zone'), '$ORIGIN example.com.\n', 'utf8');
      writeFileSync(join(zoneDir, 'other.txt'), 'skip', 'utf8');

      const push = await pushDnsZonesToCluster({
        db,
        host: mockHost({
          run: (argv) => {
            if (argv[0] === 'scp') return { exitCode: 0 };
            if (argv[0] === 'ssh') {
              if (argv.some((x) => String(x).includes('RELOAD') || String(x).includes('rndc'))) {
                return { exitCode: 0, stdout: 'RELOAD_OK:named\n' };
              }
              // mkdir + probe scripts
              if (argv.some((x) => String(x).includes('ACTIVE:'))) {
                return { exitCode: 0, stdout: 'ACTIVE:named\nZONE_DIR:ok\nZONE_FILES:1\n' };
              }
              return { exitCode: 0, stdout: 'RELOAD_OK:named\n' };
            }
            return {};
          },
        }),
        dataDir: dir,
        reload: true,
        probeAfter: true,
      });
      expect(push.ok).toBe(true);
      expect(push.apply_status).toBe('applied');
      expect(push.peers.every((p) => p.scpOk)).toBe(true);

      const pushNoReload = await pushDnsZonesToCluster({
        db,
        host: mockHost({
          run: (argv) => (argv[0] === 'scp' ? { exitCode: 0 } : { exitCode: 0 }),
        }),
        dataDir: dir,
        reload: false,
      });
      expect(pushNoReload.ok).toBe(true);
      expect(pushNoReload.apply_status).toBe('written');

      const pushScpFail = await pushDnsZonesToCluster({
        db,
        host: mockHost({
          run: (argv) =>
            argv[0] === 'scp'
              ? { exitCode: 1, stderr: 'scp failed' }
              : { exitCode: 0 },
        }),
        dataDir: dir,
        reload: true,
      });
      expect(pushScpFail.ok).toBe(false);
      expect(pushScpFail.apply_status).toBe('failed');

      // empty zone dir
      rmSync(zoneDir, { recursive: true, force: true });
      mkdirSync(zoneDir, { recursive: true });
      const emptyZones = await pushDnsZonesToCluster({
        db,
        host: mockHost({}),
        dataDir: dir,
      });
      expect(emptyZones.ok).toBe(false);

      // missing zone dir
      rmSync(zoneDir, { recursive: true, force: true });
      const noDir = await pushDnsZonesToCluster({
        db,
        host: mockHost({}),
        dataDir: dir,
      });
      expect(noDir.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('push partial: scp ok but reload fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnsc-part-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      upsertDnsClusterPeer(db, { host: 'ns-x', username: 'root' });
      const zoneDir = join(dir, 'dns', 'zones');
      mkdirSync(zoneDir, { recursive: true });
      writeFileSync(join(zoneDir, 'z.zone'), 'x\n', 'utf8');
      const r = await pushDnsZonesToCluster({
        db,
        host: mockHost({
          run: (argv) => {
            if (argv[0] === 'scp') return { exitCode: 0 };
            if (argv[0] === 'ssh') {
              return { exitCode: 1, stdout: 'RELOAD_NONE\n' };
            }
            return {};
          },
        }),
        dataDir: dir,
        reload: true,
      });
      expect(r.apply_status).toBe('partial');
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
