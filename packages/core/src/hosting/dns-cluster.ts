/**
 * Optional DNS cluster: peer list + scp zone files + remote nameserver reload/probe.
 * Honesty: scp written ≠ reloaded; reload ok only when remote command succeeds.
 */

import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import type { ApplyStatus } from '@ysk/shared';
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
  /** optional SSH identity id under dataDir (BatchMode key) */
  sshIdentityId?: string;
  createdAt: string;
  /** last probe snapshot (control-plane memory) */
  lastProbe?: DnsPeerProbeResult;
};

export type DnsPeerProbeResult = {
  at: string;
  ok: boolean;
  /** active unit if detected: named | bind9 | pdns | none */
  service?: string;
  zoneDirOk?: boolean;
  notes: string[];
  latencyMs?: number;
};

export type DnsPeerActionResult = {
  peerId: string;
  host: string;
  label?: string;
  scpOk?: boolean;
  filesOk?: number;
  filesFail?: number;
  reloaded?: boolean;
  reloadMethod?: string;
  probe?: DnsPeerProbeResult;
  notes: string[];
  apply_status: ApplyStatus;
};

export type DnsClusterOpResult = {
  ok: boolean;
  apply_status: ApplyStatus;
  blocked?: boolean;
  requiresExecute?: boolean;
  notes: string[];
  peers: DnsPeerActionResult[];
};

const KEY = 'dns_cluster_peers';

export function listDnsClusterPeers(db: JsonStore): DnsClusterPeer[] {
  try {
    return JSON.parse(db.snapshot.settings?.[KEY] ?? '[]') as DnsClusterPeer[];
  } catch {
    return [];
  }
}

function savePeers(db: JsonStore, peers: DnsClusterPeer[]): void {
  db.snapshot.settings[KEY] = JSON.stringify(peers.slice(0, 20));
  db.persist();
}

export function upsertDnsClusterPeer(
  db: JsonStore,
  input: Partial<DnsClusterPeer> & { host: string; username: string },
): DnsClusterPeer {
  const all = listDnsClusterPeers(db);
  const id = input.id ?? randomUUID();
  const prev = all.find((p) => p.id === id);
  const row: DnsClusterPeer = {
    id,
    host: input.host.trim(),
    port: input.port ?? 22,
    username: input.username.trim(),
    path: input.path ?? '/var/lib/ysk/dns/zones',
    label: input.label,
    sshIdentityId: input.sshIdentityId ?? prev?.sshIdentityId,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    lastProbe: prev?.lastProbe,
  };
  const next = [row, ...all.filter((p) => p.id !== id)];
  savePeers(db, next);
  return row;
}

export function deleteDnsClusterPeer(db: JsonStore, id: string): boolean {
  const all = listDnsClusterPeers(db);
  const next = all.filter((p) => p.id !== id);
  savePeers(db, next);
  return next.length < all.length;
}

function updatePeerLastProbe(
  db: JsonStore,
  peerId: string,
  probe: DnsPeerProbeResult,
): void {
  const all = listDnsClusterPeers(db);
  const next = all.map((p) => (p.id === peerId ? { ...p, lastProbe: probe } : p));
  savePeers(db, next);
}

function sshArgv(
  peer: DnsClusterPeer,
  remoteCmd: string,
  identityPath?: string,
): string[] {
  const base = ['ssh'];
  if (identityPath) {
    base.push(
      '-i',
      identityPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=10',
    );
  } else {
    base.push(
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
    );
  }
  base.push(
    '-p',
    String(peer.port),
    `${peer.username}@${peer.host}`,
    'bash',
    '-lc',
    remoteCmd,
  );
  return base;
}

async function resolvePeerIdentity(
  dataDir: string | undefined,
  peer: DnsClusterPeer,
): Promise<string | undefined> {
  if (!peer.sshIdentityId || !dataDir) return undefined;
  try {
    const { resolveIdentityKeyPath } = await import(
      '../security/ssh-identity/ops.js'
    );
    const r = resolveIdentityKeyPath(dataDir, peer.sshIdentityId);
    return r.ok ? r.path : undefined;
  } catch {
    return undefined;
  }
}

async function sshOnPeer(
  host: HostExecutor,
  peer: DnsClusterPeer,
  remoteCmd: string,
  opts?: { dataDir?: string; timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const identityPath = await resolvePeerIdentity(opts?.dataDir, peer);
  const argv = sshArgv(peer, remoteCmd, identityPath);
  const r = await host.runCommand(argv, {
    timeoutMs: opts?.timeoutMs ?? 30_000,
  });
  return {
    exitCode: r.exitCode,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

/** Remote one-liner: detect active NS unit + zone dir. */
const REMOTE_PROBE_SCRIPT = (zonePath: string) =>
  [
    'svc=none',
    'for u in named bind9 pdns; do',
    '  if systemctl is-active --quiet "$u" 2>/dev/null; then svc=$u; break; fi',
    'done',
    'echo ACTIVE:$svc',
    `if [ -d ${JSON.stringify(zonePath)} ]; then echo ZONE_DIR:ok; else echo ZONE_DIR:missing; fi`,
    `ls ${JSON.stringify(zonePath)}/*.zone 2>/dev/null | wc -l | awk '{print "ZONE_FILES:"$1}'`,
  ].join('\n');

/** Remote one-liner: try rndc then systemctl reload. */
const REMOTE_RELOAD_SCRIPT = [
  'if command -v rndc >/dev/null 2>&1; then',
  '  rndc reload && echo RELOAD_OK:rndc && exit 0',
  '  echo RELOAD_FAIL:rndc; exit 1',
  'fi',
  'for u in named bind9 pdns; do',
  '  if systemctl is-active --quiet "$u" 2>/dev/null; then',
  '    systemctl reload "$u" && echo RELOAD_OK:$u && exit 0',
  '    echo RELOAD_FAIL:$u; exit 1',
  '  fi',
  'done',
  'echo RELOAD_NONE; exit 1',
].join('\n');

/**
 * Probe one peer over SSH (nameserver unit + zone dir).
 */
export async function probeDnsClusterPeer(input: {
  host: HostExecutor;
  peer: DnsClusterPeer;
  dataDir?: string;
  db?: JsonStore;
}): Promise<DnsPeerProbeResult> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  if (!input.host.executeEnabled()) {
    return {
      at,
      ok: false,
      notes: ['無法 probe：未開啟系統變更權限（SSH 需 EXECUTE）'],
      latencyMs: Date.now() - t0,
    };
  }

  const r = await sshOnPeer(
    input.host,
    input.peer,
    REMOTE_PROBE_SCRIPT(input.peer.path),
    { dataDir: input.dataDir, timeoutMs: 20_000 },
  );

  if (r.exitCode !== 0 && !r.stdout.includes('ACTIVE:')) {
    const probe: DnsPeerProbeResult = {
      at,
      ok: false,
      notes: [
        `SSH probe 失敗：${(r.stderr || r.stdout || 'connection failed').slice(0, 160)}`,
      ],
      latencyMs: Date.now() - t0,
    };
    if (input.db) updatePeerLastProbe(input.db, input.peer.id, probe);
    return probe;
  }

  const active =
    r.stdout.match(/ACTIVE:(\S+)/)?.[1]?.trim() || 'none';
  const zoneDirOk = /ZONE_DIR:ok/.test(r.stdout);
  const zoneFiles = Number(r.stdout.match(/ZONE_FILES:(\d+)/)?.[1] ?? '0');
  const serviceOk = active !== 'none';
  const notes: string[] = [
    serviceOk
      ? `nameserver 活躍：${active}`
      : '遠端無 active named/bind9/pdns（仍可 scp 檔案）',
    zoneDirOk
      ? `zone 目錄存在（${zoneFiles} 個 .zone）`
      : `zone 目錄不存在：${input.peer.path}`,
  ];
  const probe: DnsPeerProbeResult = {
    at,
    ok: serviceOk && zoneDirOk,
    service: active,
    zoneDirOk,
    notes,
    latencyMs: Date.now() - t0,
  };
  if (input.db) updatePeerLastProbe(input.db, input.peer.id, probe);
  return probe;
}

/**
 * Probe all (or one) registered peers.
 */
export async function probeDnsClusterPeers(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir?: string;
  peerId?: string;
}): Promise<DnsClusterOpResult> {
  const peers = listDnsClusterPeers(input.db).filter(
    (p) => !input.peerId || p.id === input.peerId,
  );
  if (!peers.length) {
    return {
      ok: true,
      apply_status: 'written',
      notes: ['尚未登記叢集 peer'],
      peers: [],
    };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      notes: ['無法 probe DNS cluster：未開啟系統變更權限'],
      peers: [],
    };
  }

  const results: DnsPeerActionResult[] = [];
  const notes: string[] = [];
  let okCount = 0;
  for (const peer of peers) {
    const probe = await probeDnsClusterPeer({
      host: input.host,
      peer,
      dataDir: input.dataDir,
      db: input.db,
    });
    if (probe.ok) okCount += 1;
    results.push({
      peerId: peer.id,
      host: peer.host,
      label: peer.label,
      probe,
      notes: probe.notes,
      apply_status: probe.ok ? 'applied' : 'failed',
    });
    notes.push(
      `${peer.label || peer.host}: ${probe.ok ? 'healthy' : 'unhealthy'} — ${probe.notes.join('; ')}`,
    );
  }

  const allOk = okCount === peers.length;
  const noneOk = okCount === 0;
  return {
    ok: allOk,
    apply_status: allOk ? 'applied' : noneOk ? 'failed' : 'partial',
    notes,
    peers: results,
  };
}

/**
 * Reload nameserver on peer(s) via SSH (rndc / systemctl).
 */
export async function reloadDnsClusterPeers(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir?: string;
  peerId?: string;
}): Promise<DnsClusterOpResult> {
  const peers = listDnsClusterPeers(input.db).filter(
    (p) => !input.peerId || p.id === input.peerId,
  );
  if (!peers.length) {
    return {
      ok: true,
      apply_status: 'written',
      notes: ['尚未登記叢集 peer'],
      peers: [],
    };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      notes: ['無法 remote reload：未開啟系統變更權限'],
      peers: [],
    };
  }

  const results: DnsPeerActionResult[] = [];
  const notes: string[] = [];
  let okCount = 0;

  for (const peer of peers) {
    const r = await sshOnPeer(input.host, peer, REMOTE_RELOAD_SCRIPT, {
      dataDir: input.dataDir,
      timeoutMs: 25_000,
    });
    const method = r.stdout.match(/RELOAD_OK:(\S+)/)?.[1];
    const reloaded = r.exitCode === 0 && Boolean(method);
    if (reloaded) okCount += 1;
    const peerNotes: string[] = [];
    if (reloaded) {
      peerNotes.push(`remote reload OK (${method})`);
    } else if (/RELOAD_NONE/.test(r.stdout)) {
      peerNotes.push('遠端找不到 rndc / active named|bind9|pdns');
    } else {
      peerNotes.push(
        `remote reload 失敗：${(r.stderr || r.stdout).slice(0, 140)}`,
      );
    }
    notes.push(`${peer.label || peer.host}: ${peerNotes.join('; ')}`);
    results.push({
      peerId: peer.id,
      host: peer.host,
      label: peer.label,
      reloaded,
      reloadMethod: method,
      notes: peerNotes,
      apply_status: reloaded ? 'applied' : 'failed',
    });
  }

  const allOk = okCount === peers.length;
  const noneOk = okCount === 0;
  notes.push(
    allOk
      ? '全部 peer nameserver 已 reload'
      : noneOk
        ? '全部 peer reload 失敗 — 檔案可能已在磁碟但權威未刷新'
        : '部分 peer reload 成功（partial）',
  );
  return {
    ok: allOk,
    apply_status: allOk ? 'applied' : noneOk ? 'failed' : 'partial',
    notes,
    peers: results,
  };
}

/**
 * Push managed zone files to peers via scp; optionally remote reload after scp.
 */
export async function pushDnsZonesToCluster(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  peerId?: string;
  /** default true (PR-D2): attempt remote reload after successful scp */
  reload?: boolean;
  /** after reload, run probe (default false) */
  probeAfter?: boolean;
}): Promise<DnsClusterOpResult> {
  const wantReload = input.reload !== false;
  const peers = listDnsClusterPeers(input.db).filter(
    (p) => !input.peerId || p.id === input.peerId,
  );
  if (!peers.length) {
    return {
      ok: true,
      apply_status: 'written',
      notes: ['尚未登記叢集 peer'],
      peers: [],
    };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      notes: ['無法推送 DNS cluster：未開啟系統變更權限'],
      peers: [],
    };
  }
  const zoneDir = join(input.dataDir, 'dns', 'zones');
  if (!existsSync(zoneDir)) {
    return {
      ok: false,
      apply_status: 'failed',
      notes: ['本地尚無 zone 檔'],
      peers: [],
    };
  }
  const files = readdirSync(zoneDir).filter((f) => f.endsWith('.zone'));
  if (!files.length) {
    return {
      ok: false,
      apply_status: 'failed',
      notes: ['無 .zone 檔可推'],
      peers: [],
    };
  }

  const results: DnsPeerActionResult[] = [];
  const notes: string[] = [];
  let peersFullyApplied = 0;
  let peersAnyOk = 0;

  for (const peer of peers) {
    const peerNotes: string[] = [];
    let filesOk = 0;
    let filesFail = 0;
    const identityPath = await resolvePeerIdentity(input.dataDir, peer);

    // Ensure remote dir exists (best-effort)
    await sshOnPeer(
      input.host,
      peer,
      `mkdir -p ${JSON.stringify(peer.path)}`,
      { dataDir: input.dataDir, timeoutMs: 15_000 },
    );

    for (const f of files.slice(0, 50)) {
      const local = join(zoneDir, f);
      const scpArgv = [
        'scp',
        ...(identityPath
          ? [
              '-i',
              identityPath,
              '-o',
              'IdentitiesOnly=yes',
              '-o',
              'BatchMode=yes',
              '-o',
              'StrictHostKeyChecking=accept-new',
            ]
          : [
              '-o',
              'StrictHostKeyChecking=no',
              '-o',
              'BatchMode=yes',
            ]),
        '-P',
        String(peer.port),
        local,
        `${peer.username}@${peer.host}:${peer.path}/`,
      ];
      const r = await input.host.runCommand(scpArgv, { timeoutMs: 60_000 });
      if (r.exitCode !== 0) {
        filesFail += 1;
        peerNotes.push(
          `${f}: scp 失敗 ${(r.stderr || r.stdout).slice(0, 80)}`,
        );
      } else {
        filesOk += 1;
      }
    }

    const scpOk = filesFail === 0 && filesOk > 0;
    if (scpOk) peersAnyOk += 1;
    else if (filesOk > 0) peersAnyOk += 1;

    peerNotes.push(
      scpOk
        ? `scp ${filesOk} 檔 OK → ${peer.path}`
        : `scp 部分/全部失敗（ok=${filesOk} fail=${filesFail}）`,
    );

    let reloaded = false;
    let reloadMethod: string | undefined;
    if (wantReload && filesOk > 0) {
      const rr = await sshOnPeer(input.host, peer, REMOTE_RELOAD_SCRIPT, {
        dataDir: input.dataDir,
        timeoutMs: 25_000,
      });
      reloadMethod = rr.stdout.match(/RELOAD_OK:(\S+)/)?.[1];
      reloaded = rr.exitCode === 0 && Boolean(reloadMethod);
      if (reloaded) {
        peerNotes.push(`remote reload OK (${reloadMethod})`);
      } else if (/RELOAD_NONE/.test(rr.stdout)) {
        peerNotes.push(
          'scp 已寫入但無法 reload：遠端無 rndc/named/bind9/pdns',
        );
      } else {
        peerNotes.push(
          `reload 失敗：${(rr.stderr || rr.stdout).slice(0, 100)}`,
        );
      }
    } else if (!wantReload) {
      peerNotes.push('略過 remote reload（reload=false）— written ≠ applied');
    }

    let probe: DnsPeerProbeResult | undefined;
    if (input.probeAfter && filesOk > 0) {
      probe = await probeDnsClusterPeer({
        host: input.host,
        peer,
        dataDir: input.dataDir,
        db: input.db,
      });
      peerNotes.push(...probe.notes.map((n) => `probe: ${n}`));
    }

    let apply_status: ApplyStatus;
    if (scpOk && reloaded) {
      apply_status = 'applied';
      peersFullyApplied += 1;
    } else if (scpOk && !wantReload) {
      apply_status = 'written';
    } else if (scpOk && !reloaded) {
      apply_status = 'partial'; // written on peer, not reloaded
    } else if (filesOk > 0) {
      apply_status = 'partial';
    } else {
      apply_status = 'failed';
    }

    notes.push(
      `${peer.label || peer.host}: ${apply_status} — ${peerNotes.slice(0, 3).join('; ')}`,
    );
    results.push({
      peerId: peer.id,
      host: peer.host,
      label: peer.label,
      scpOk,
      filesOk,
      filesFail,
      reloaded,
      reloadMethod,
      probe,
      notes: peerNotes,
      apply_status,
    });
  }

  const allApplied = peersFullyApplied === peers.length;
  const anyPartial = results.some(
    (r) => r.apply_status === 'partial' || r.apply_status === 'written',
  );
  const allFailed = results.every((r) => r.apply_status === 'failed');

  let apply_status: ApplyStatus;
  let ok: boolean;
  if (allApplied) {
    apply_status = 'applied';
    ok = true;
    notes.push('全部 peer：zone 已推送並 remote reload 成功');
  } else if (allFailed) {
    apply_status = 'failed';
    ok = false;
    notes.push('全部 peer 失敗');
  } else if (wantReload && peersFullyApplied > 0) {
    apply_status = 'partial';
    ok = false;
    notes.push(
      '部分 peer applied；其餘僅 written 或失敗 — 勿當全叢集已 reload',
    );
  } else if (!wantReload && peersAnyOk === peers.length) {
    apply_status = 'written';
    ok = true;
    notes.push('已 scp zone 檔（written on peer ≠ named reloaded）');
  } else {
    apply_status = anyPartial ? 'partial' : 'failed';
    ok = false;
    notes.push('推送結果不完整（partial/failed）');
  }

  return { ok, apply_status, notes, peers: results };
}
