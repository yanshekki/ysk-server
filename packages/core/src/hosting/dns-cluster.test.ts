import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  listDnsClusterPeers,
  upsertDnsClusterPeer,
  deleteDnsClusterPeer,
  pushDnsZonesToCluster,
} from './dns-cluster.js';
import type { HostExecutor } from '../host/executor.js';

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

      const host: HostExecutor = {
        executeEnabled: () => false,
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
        runCommand: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        }),
      };
      const push = await pushDnsZonesToCluster({ db, host, dataDir: dir });
      expect(push.ok).toBe(true);
      expect(push.notes.some((n) => /peer/i.test(n) || /尚未/.test(n))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
