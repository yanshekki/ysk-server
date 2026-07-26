/**
 * Optional DNS cluster: peer list + push managed zone files via scp (honest).
 */

import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type DnsClusterPeer = {
  id: string;
  host: string;
  port: number;
  username: string;
  /** remote path for zone files */
  path: string;
  label?: string;
  createdAt: string;
};

const KEY = 'dns_cluster_peers';

export function listDnsClusterPeers(db: JsonStore): DnsClusterPeer[] {
  try {
    return JSON.parse(db.snapshot.settings?.[KEY] ?? '[]') as DnsClusterPeer[];
  } catch {
    return [];
  }
}

export function upsertDnsClusterPeer(
  db: JsonStore,
  input: Partial<DnsClusterPeer> & { host: string; username: string },
): DnsClusterPeer {
  const all = listDnsClusterPeers(db);
  const id = input.id ?? randomUUID();
  const row: DnsClusterPeer = {
    id,
    host: input.host.trim(),
    port: input.port ?? 22,
    username: input.username.trim(),
    path: input.path ?? '/var/lib/ysk/dns/zones',
    label: input.label,
    createdAt: all.find((p) => p.id === id)?.createdAt ?? new Date().toISOString(),
  };
  const next = [row, ...all.filter((p) => p.id !== id)];
  db.snapshot.settings[KEY] = JSON.stringify(next.slice(0, 20));
  db.persist();
  return row;
}

export function deleteDnsClusterPeer(db: JsonStore, id: string): boolean {
  const all = listDnsClusterPeers(db);
  const next = all.filter((p) => p.id !== id);
  db.snapshot.settings[KEY] = JSON.stringify(next);
  db.persist();
  return next.length < all.length;
}

export async function pushDnsZonesToCluster(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  peerId?: string;
}): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const peers = listDnsClusterPeers(input.db).filter(
    (p) => !input.peerId || p.id === input.peerId,
  );
  if (!peers.length) return { ok: true, notes: ['無 cluster peer'] };
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: ['無法推送 DNS cluster：未開啟系統變更權限'],
    };
  }
  const zoneDir = join(input.dataDir, 'dns', 'zones');
  if (!existsSync(zoneDir)) {
    return { ok: false, notes: ['本地尚無 zone 檔'] };
  }
  const files = readdirSync(zoneDir).filter((f) => f.endsWith('.zone'));
  if (!files.length) return { ok: false, notes: ['無 .zone 檔可推'] };

  const notes: string[] = [];
  let anyFail = false;
  for (const peer of peers) {
    const dest = `${peer.username}@${peer.host}:${peer.path}/`;
    for (const f of files.slice(0, 50)) {
      const local = join(zoneDir, f);
      const r = await input.host.runCommand(
        [
          'scp',
          '-o',
          'StrictHostKeyChecking=no',
          '-P',
          String(peer.port),
          local,
          dest,
        ],
        { timeoutMs: 60_000 },
      );
      if (r.exitCode !== 0) {
        anyFail = true;
        notes.push(`${peer.host}/${f}: scp 失敗 ${(r.stderr || r.stdout).slice(0, 100)}`);
      } else {
        notes.push(`${peer.host}/${f}: ok`);
      }
    }
  }
  notes.push(
    anyFail
      ? '部分推送失敗 — 對方 named 需自行 reload'
      : '已 scp zone 檔（written on peer ≠ named reloaded）',
  );
  return { ok: !anyFail, notes };
}
