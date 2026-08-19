/**
 * VPN live monitor — parse WireGuard dump / OpenVPN status; build snapshot.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { VpnEngineId } from './types.js';

/** Handshake within this many seconds ⇒ online */
export const WG_ONLINE_HANDSHAKE_SEC = 180;

export type VpnPresence = 'online' | 'idle' | 'offline' | 'never' | 'unknown';

export type VpnMonitorPeerRow = {
  id: string;
  name: string;
  engine: VpnEngineId;
  address: string;
  publicKey: string;
  endpoint: string | null;
  online: boolean;
  presence: VpnPresence;
  lastHandshakeAt: string | null;
  transferRx: number | null;
  transferTx: number | null;
  rxRateBps: number | null;
  txRateBps: number | null;
  connectedSince: string | null;
};

export type VpnMonitorEngineRow = {
  engine: VpnEngineId;
  serverActive: boolean;
  onlineCount: number;
  peerCount: number;
  transferRx: number | null;
  transferTx: number | null;
  rxRateBps: number | null;
  txRateBps: number | null;
  notes: string[];
};

export type VpnMonitorLocalClient = {
  id: string;
  name: string;
  engine: VpnEngineId;
  iface: string;
  status: 'up' | 'down' | 'unknown';
  transferRx: number | null;
  transferTx: number | null;
  rxRateBps: number | null;
  txRateBps: number | null;
};

export type VpnMonitorSnapshot = {
  sampledAt: string;
  engines: VpnMonitorEngineRow[];
  peers: VpnMonitorPeerRow[];
  localClients: VpnMonitorLocalClient[];
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  notes: string[];
};

export type WgDumpPeer = {
  iface: string;
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  latestHandshake: number;
  transferRx: number;
  transferTx: number;
};

export type WgDumpIface = {
  name: string;
  listenPort: number;
  publicKey: string;
};

/** Parse `wg show all dump` (tab-separated). */
export function parseWgDump(text: string): {
  interfaces: WgDumpIface[];
  peers: WgDumpPeer[];
} {
  const interfaces: WgDumpIface[] = [];
  const peers: WgDumpPeer[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split('\t');
    if (cols.length < 5) continue;
    const name = cols[0] ?? '';
    // Interface line: name private public listenPort fwmark  (5 fields)
    // Peer line: name public psk endpoint allowed handshake rx tx keepalive (9 fields)
    if (cols.length >= 9) {
      const handshake = Number(cols[5] ?? 0);
      const rx = Number(cols[6] ?? 0);
      const tx = Number(cols[7] ?? 0);
      peers.push({
        iface: name,
        publicKey: cols[1] ?? '',
        endpoint: cols[3] === '(none)' ? '' : (cols[3] ?? ''),
        allowedIps: cols[4] === '(none)' ? '' : (cols[4] ?? ''),
        latestHandshake: Number.isFinite(handshake) ? handshake : 0,
        transferRx: Number.isFinite(rx) ? rx : 0,
        transferTx: Number.isFinite(tx) ? tx : 0,
      });
    } else if (cols.length >= 5) {
      const port = Number(cols[3] ?? 0);
      interfaces.push({
        name,
        publicKey: cols[2] === '(none)' ? '' : (cols[2] ?? ''),
        listenPort: Number.isFinite(port) ? port : 0,
      });
    }
  }
  return { interfaces, peers };
}

export function presenceFromHandshake(
  latestHandshakeUnix: number,
  nowSec = Math.floor(Date.now() / 1000),
): VpnPresence {
  if (!latestHandshakeUnix || latestHandshakeUnix <= 0) return 'never';
  const age = nowSec - latestHandshakeUnix;
  if (age <= WG_ONLINE_HANDSHAKE_SEC) return 'online';
  if (age > 0) return 'idle';
  return 'never';
}

export type OvpnStatusClient = {
  commonName: string;
  realAddress: string;
  virtualAddress: string;
  bytesReceived: number;
  bytesSent: number;
  connectedSinceUnix: number;
  connectedSince: string | null;
};

/** Parse OpenVPN status-version 2/3 CLIENT_LIST and legacy status-version 1 client table. */
export function parseOvpnStatus(text: string): OvpnStatusClient[] {
  const out: OvpnStatusClient[] = [];
  const lines = text.split('\n');
  let inV1Clients = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // —— status-version 2/3 ——
    if (t.startsWith('CLIENT_LIST,')) {
      // CLIENT_LIST,Common Name,Real Address,Virtual Address,Virtual IPv6,Bytes Received,Bytes Sent,Connected Since,Connected Since (time_t),...
      const parts = t.split(',');
      if (parts.length < 9) continue;
      const cn = parts[1] ?? '';
      if (!cn || cn === 'UNDEF' || cn === 'Common Name') continue;
      const bytesRecv = Number(parts[5] ?? 0);
      const bytesSent = Number(parts[6] ?? 0);
      const sinceStr = parts[7] ?? '';
      const sinceUnix = Number(parts[8] ?? 0);
      out.push({
        commonName: cn,
        realAddress: parts[2] ?? '',
        virtualAddress: parts[3] ?? '',
        bytesReceived: Number.isFinite(bytesRecv) ? bytesRecv : 0,
        bytesSent: Number.isFinite(bytesSent) ? bytesSent : 0,
        connectedSinceUnix: Number.isFinite(sinceUnix) ? sinceUnix : 0,
        connectedSince:
          Number.isFinite(sinceUnix) && sinceUnix > 0
            ? new Date(sinceUnix * 1000).toISOString()
            : sinceStr || null,
      });
      continue;
    }

    // —— status-version 1 ——
    if (/^OpenVPN CLIENT LIST/i.test(t)) {
      inV1Clients = true;
      continue;
    }
    if (inV1Clients) {
      if (/^ROUTING TABLE/i.test(t) || /^GLOBAL STATS/i.test(t) || t === 'END') {
        inV1Clients = false;
        continue;
      }
      if (/^Updated,/i.test(t) || /^Common Name,/i.test(t)) continue;
      // Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since
      const parts = t.split(',');
      if (parts.length < 5) continue;
      const cn = parts[0] ?? '';
      if (!cn || cn === 'UNDEF') continue;
      const bytesRecv = Number(parts[2] ?? 0);
      const bytesSent = Number(parts[3] ?? 0);
      const sinceStr = parts.slice(4).join(',');
      out.push({
        commonName: cn,
        realAddress: parts[1] ?? '',
        virtualAddress: '',
        bytesReceived: Number.isFinite(bytesRecv) ? bytesRecv : 0,
        bytesSent: Number.isFinite(bytesSent) ? bytesSent : 0,
        connectedSinceUnix: 0,
        connectedSince: sinceStr || null,
      });
    }
  }
  return out;
}

/** Primary status path written by openvpn (RuntimeDirectory is writable by the unit). */
export function openVpnStatusPath(_dataDir: string): string {
  return '/run/openvpn-server/ysk-status.log';
}

/** Fallbacks when unit layout differs (openvpn@ / daemon). */
export function openVpnStatusCandidates(dataDir: string): string[] {
  return [
    '/run/openvpn-server/ysk-status.log',
    '/run/openvpn-server/status-ysk.log',
    '/run/openvpn-server/status.log',
    '/var/log/openvpn/ysk-status.log',
    '/var/run/openvpn-server/ysk-status.log',
    join(dataDir, 'vpn', 'openvpn', 'status.log'),
  ];
}

/** dataDir mirror path (optional read fallback) */
export function openVpnStatusPathLocal(dataDir: string): string {
  return join(dataDir, 'vpn', 'openvpn', 'status.log');
}

/** Normalize tunnel IP for matching (strip /32, spaces). */
export function normalizeTunnelIp(addr: string | undefined | null): string {
  if (!addr) return '';
  return String(addr)
    .trim()
    .split('/')[0]
    ?.split(' ')[0]
    ?.toLowerCase() ?? '';
}

export type RatePrevSample = {
  atMs: number;
  byKey: Record<string, { rx: number; tx: number }>;
};

export function rateFromPrev(
  key: string,
  rx: number,
  tx: number,
  nowMs: number,
  prev: RatePrevSample | null | undefined,
): { rxRateBps: number | null; txRateBps: number | null } {
  if (!prev?.byKey[key] || !prev.atMs || nowMs <= prev.atMs) {
    return { rxRateBps: null, txRateBps: null };
  }
  const dt = (nowMs - prev.atMs) / 1000;
  if (dt < 0.5) return { rxRateBps: null, txRateBps: null };
  const pr = prev.byKey[key];
  const dRx = rx - pr.rx;
  const dTx = tx - pr.tx;
  // counters can reset
  if (dRx < 0 || dTx < 0) return { rxRateBps: null, txRateBps: null };
  return {
    rxRateBps: Math.round(dRx / dt),
    txRateBps: Math.round(dTx / dt),
  };
}

export type ControlPlanePeer = {
  id: string;
  name: string;
  engine: VpnEngineId;
  address: string;
  publicKey: string;
  createdAt?: string;
};

export type ControlPlaneClient = {
  id: string;
  name: string;
  engine: VpnEngineId;
  iface: string;
  status: 'up' | 'down' | 'unknown' | 'error';
};

export async function runWgShowDump(
  host: HostExecutor,
  iface?: string,
): Promise<string> {
  const cmd = iface
    ? `wg show ${JSON.stringify(iface)} dump 2>/dev/null || true`
    : `wg show all dump 2>/dev/null || true`;
  const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 10_000 });
  return r.stdout || '';
}

export async function readOvpnStatusFile(
  host: HostExecutor,
  dataDir: string,
): Promise<string> {
  const paths = openVpnStatusCandidates(dataDir);
  if (host.executeEnabled()) {
    // First non-empty readable status file
    const script = paths
      .map(
        (p) =>
          `if [ -s ${JSON.stringify(p)} ]; then cat ${JSON.stringify(p)}; exit 0; fi`,
      )
      .join('\n');
    const r = await host.runCommand(['bash', '-c', `${script}\ntrue`], {
      timeoutMs: 8_000,
    });
    if (r.stdout?.trim()) return r.stdout;
  }
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const t = readFileSync(p, 'utf8');
      if (t.trim()) return t;
    } catch {
      /* */
    }
  }
  return '';
}

/** Match control-plane peer to OpenVPN status client by CN or virtual IP. */
export function matchOvpnControlPeer(
  client: OvpnStatusClient,
  controlPeers: ControlPlanePeer[],
): ControlPlanePeer | undefined {
  const cn = client.commonName.trim().toLowerCase();
  const vip = normalizeTunnelIp(client.virtualAddress);
  const byCn = controlPeers.find((p) => p.name.trim().toLowerCase() === cn);
  if (byCn) return byCn;
  if (vip) {
    const byIp = controlPeers.find(
      (p) => normalizeTunnelIp(p.address) === vip,
    );
    if (byIp) return byIp;
  }
  return undefined;
}

export async function probeServerActive(
  host: HostExecutor,
  engine: VpnEngineId,
): Promise<boolean> {
  if (!host.executeEnabled()) return false;
  if (engine === 'wireguard') {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        'wg show wg0 >/dev/null 2>&1 || systemctl is-active --quiet wg-quick@wg0',
      ],
      { timeoutMs: 8_000 },
    );
    return r.exitCode === 0;
  }
  if (engine === 'openvpn') {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        'systemctl is-active --quiet openvpn-server@ysk || systemctl is-active --quiet openvpn@ysk || pgrep -x openvpn >/dev/null',
      ],
      { timeoutMs: 8_000 },
    );
    return r.exitCode === 0;
  }
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      // YSK unit = healthy. Do NOT treat package shadowsocks-libev (often localhost-only) as up.
      "systemctl is-active --quiet ysk-ss-server.service 2>/dev/null || systemctl is-active --quiet ysk-ss-server 2>/dev/null || { pgrep -x ss-server >/dev/null 2>&1 && ss -lntup 2>/dev/null | grep -F ss-server | grep -vqE '127\\.0\\.0\\.1|\\[::1\\]'; }",
    ],
    { timeoutMs: 8_000 },
  );
  return r.exitCode === 0;
}

/**
 * Build full monitor snapshot from control plane + live probes.
 */
export async function buildMonitorSnapshot(input: {
  host: HostExecutor;
  dataDir: string;
  controlPeers: ControlPlanePeer[];
  controlClients: ControlPlaneClient[];
  prev?: RatePrevSample | null;
  nowMs?: number;
}): Promise<{ snapshot: VpnMonitorSnapshot; nextPrev: RatePrevSample }> {
  const nowMs = input.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const sampledAt = new Date(nowMs).toISOString();
  const notes: string[] = [];
  const canLive = input.host.executeEnabled() && input.host.isRoot();
  const blocked = !canLive;
  if (blocked) {
    notes.push('Live metrics need root + YSK_EXECUTE');
  }

  const byKey: Record<string, { rx: number; tx: number }> = {};
  const peers: VpnMonitorPeerRow[] = [];

  // —— WireGuard live ——
  let wgDumpPeers: WgDumpPeer[] = [];
  let wgActive = false;
  if (canLive) {
    wgActive = await probeServerActive(input.host, 'wireguard');
    const dump = await runWgShowDump(input.host);
    const parsed = parseWgDump(dump);
    wgDumpPeers = parsed.peers.filter((p) => p.iface === 'wg0' || p.iface.startsWith('wg'));
  }

  const wgCp = input.controlPeers.filter((p) => p.engine === 'wireguard');
  const wgByPub = new Map(wgCp.map((p) => [p.publicKey, p]));
  const matchedWgPubs = new Set<string>();

  let wgRx = 0;
  let wgTx = 0;
  let wgOnline = 0;

  for (const live of wgDumpPeers) {
    // Only server iface peers (wg0); client ifaces handled under localClients
    if (live.iface !== 'wg0') continue;
    const cp = wgByPub.get(live.publicKey);
    matchedWgPubs.add(live.publicKey);
    const presence = presenceFromHandshake(live.latestHandshake, nowSec);
    if (presence === 'online') wgOnline += 1;
    wgRx += live.transferRx;
    wgTx += live.transferTx;
    const id = cp?.id ?? `wg-live:${live.publicKey.slice(0, 12)}`;
    const key = `peer:${id}`;
    byKey[key] = { rx: live.transferRx, tx: live.transferTx };
    const rates = rateFromPrev(key, live.transferRx, live.transferTx, nowMs, input.prev);
    peers.push({
      id,
      name: cp?.name ?? `unknown ${live.publicKey.slice(0, 8)}…`,
      engine: 'wireguard',
      address: cp?.address || live.allowedIps || '—',
      publicKey: live.publicKey,
      endpoint: live.endpoint || null,
      online: presence === 'online',
      presence,
      lastHandshakeAt:
        live.latestHandshake > 0
          ? new Date(live.latestHandshake * 1000).toISOString()
          : null,
      transferRx: live.transferRx,
      transferTx: live.transferTx,
      rxRateBps: rates.rxRateBps,
      txRateBps: rates.txRateBps,
      connectedSince: null,
    });
  }

  // Control-plane WG peers with no live row
  for (const cp of wgCp) {
    if (matchedWgPubs.has(cp.publicKey)) continue;
    peers.push({
      id: cp.id,
      name: cp.name,
      engine: 'wireguard',
      address: cp.address,
      publicKey: cp.publicKey,
      endpoint: null,
      online: false,
      presence: canLive ? 'never' : 'unknown',
      lastHandshakeAt: null,
      transferRx: canLive ? 0 : null,
      transferTx: canLive ? 0 : null,
      rxRateBps: null,
      txRateBps: null,
      connectedSince: null,
    });
  }

  // —— OpenVPN ——
  let ovpnActive = false;
  let ovpnClients: OvpnStatusClient[] = [];
  if (canLive) {
    ovpnActive = await probeServerActive(input.host, 'openvpn');
    const st = await readOvpnStatusFile(input.host, input.dataDir);
    if (st.trim()) {
      ovpnClients = parseOvpnStatus(st);
    } else if (ovpnActive) {
      notes.push('OpenVPN status file missing — re-apply server for live sessions');
    }
  }
  const ovpnCp = input.controlPeers.filter((p) => p.engine === 'openvpn');
  const matchedOvpnIds = new Set<string>();
  let ovpnRx = 0;
  let ovpnTx = 0;
  let ovpnOnline = 0;

  for (const c of ovpnClients) {
    ovpnOnline += 1;
    ovpnRx += c.bytesReceived;
    ovpnTx += c.bytesSent;
    const cp = matchOvpnControlPeer(c, ovpnCp);
    if (cp) matchedOvpnIds.add(cp.id);
    const id = cp?.id ?? `ovpn-live:${c.commonName}`;
    const key = `peer:${id}`;
    byKey[key] = { rx: c.bytesReceived, tx: c.bytesSent };
    const rates = rateFromPrev(key, c.bytesReceived, c.bytesSent, nowMs, input.prev);
    peers.push({
      id,
      name: cp?.name ?? c.commonName,
      engine: 'openvpn',
      address: cp?.address || c.virtualAddress || '—',
      publicKey: '',
      endpoint: c.realAddress || null,
      online: true,
      presence: 'online',
      lastHandshakeAt: c.connectedSince,
      transferRx: c.bytesReceived,
      transferTx: c.bytesSent,
      rxRateBps: rates.rxRateBps,
      txRateBps: rates.txRateBps,
      connectedSince: c.connectedSince,
    });
  }
  for (const cp of ovpnCp) {
    if (matchedOvpnIds.has(cp.id)) continue;
    peers.push({
      id: cp.id,
      name: cp.name,
      engine: 'openvpn',
      address: cp.address,
      publicKey: '',
      endpoint: null,
      online: false,
      presence: canLive ? 'never' : 'unknown',
      lastHandshakeAt: null,
      transferRx: canLive ? 0 : null,
      transferTx: canLive ? 0 : null,
      rxRateBps: null,
      txRateBps: null,
      connectedSince: null,
    });
  }

  // —— Shadowsocks (server KPI only; no per-key live) ——
  let ssActive = false;
  if (canLive) {
    ssActive = await probeServerActive(input.host, 'outline');
  }
  const ssCp = input.controlPeers.filter((p) => p.engine === 'outline');
  for (const cp of ssCp) {
    peers.push({
      id: cp.id,
      name: cp.name,
      engine: 'outline',
      address: cp.address || '—',
      publicKey: '',
      endpoint: null,
      online: false,
      presence: 'unknown',
      lastHandshakeAt: null,
      transferRx: null,
      transferTx: null,
      rxRateBps: null,
      txRateBps: null,
      connectedSince: null,
    });
  }

  // —— Local clients ——
  const localClients: VpnMonitorLocalClient[] = [];
  for (const c of input.controlClients) {
    let transferRx: number | null = null;
    let transferTx: number | null = null;
    let status: 'up' | 'down' | 'unknown' = c.status === 'up' || c.status === 'down' ? c.status : 'unknown';
    if (canLive && c.engine === 'wireguard' && c.iface) {
      const dump = await runWgShowDump(input.host, c.iface);
      const parsed = parseWgDump(dump);
      // For client iface, interface is up if dump non-empty; sum peer transfer on that iface
      if (parsed.interfaces.length || parsed.peers.length) {
        status = 'up';
        transferRx = 0;
        transferTx = 0;
        for (const p of parsed.peers) {
          transferRx += p.transferRx;
          transferTx += p.transferTx;
        }
      } else {
        status = 'down';
        transferRx = 0;
        transferTx = 0;
      }
    } else if (canLive && c.engine === 'openvpn') {
      // best-effort unit
      const r = await input.host.runCommand(
        [
          'bash',
          '-c',
          `systemctl is-active --quiet openvpn-client@${c.iface} || systemctl is-active --quiet openvpn@${c.iface}`,
        ],
        { timeoutMs: 5_000 },
      );
      status = r.exitCode === 0 ? 'up' : 'down';
    }
    const key = `client:${c.id}`;
    if (transferRx != null && transferTx != null) {
      byKey[key] = { rx: transferRx, tx: transferTx };
    }
    const rates =
      transferRx != null && transferTx != null
        ? rateFromPrev(key, transferRx, transferTx, nowMs, input.prev)
        : { rxRateBps: null, txRateBps: null };
    localClients.push({
      id: c.id,
      name: c.name,
      engine: c.engine,
      iface: c.iface,
      status,
      transferRx,
      transferTx,
      rxRateBps: rates.rxRateBps,
      txRateBps: rates.txRateBps,
    });
  }

  const engKey = (e: VpnEngineId) => `engine:${e}`;
  byKey[engKey('wireguard')] = { rx: wgRx, tx: wgTx };
  byKey[engKey('openvpn')] = { rx: ovpnRx, tx: ovpnTx };
  const wgRates = rateFromPrev(engKey('wireguard'), wgRx, wgTx, nowMs, input.prev);
  const ovpnRates = rateFromPrev(engKey('openvpn'), ovpnRx, ovpnTx, nowMs, input.prev);

  const engines: VpnMonitorEngineRow[] = [
    {
      engine: 'wireguard',
      serverActive: wgActive,
      onlineCount: wgOnline,
      peerCount: wgCp.length,
      transferRx: canLive ? wgRx : null,
      transferTx: canLive ? wgTx : null,
      rxRateBps: wgRates.rxRateBps,
      txRateBps: wgRates.txRateBps,
      notes: [],
    },
    {
      engine: 'openvpn',
      serverActive: ovpnActive,
      onlineCount: ovpnOnline,
      peerCount: ovpnCp.length,
      transferRx: canLive ? ovpnRx : null,
      transferTx: canLive ? ovpnTx : null,
      rxRateBps: ovpnRates.rxRateBps,
      txRateBps: ovpnRates.txRateBps,
      notes: [],
    },
    {
      engine: 'outline',
      serverActive: ssActive,
      onlineCount: 0,
      peerCount: ssCp.length,
      transferRx: null,
      transferTx: null,
      rxRateBps: null,
      txRateBps: null,
      notes: ['Per-key live sessions not available (shared password ss-server)'],
    },
  ];

  // Sort: online first, then name
  peers.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    snapshot: {
      sampledAt,
      engines,
      peers,
      localClients,
      blocked: blocked || undefined,
      requiresExecute: !input.host.executeEnabled() || undefined,
      requiresRoot: !input.host.isRoot() || undefined,
      notes,
    },
    nextPrev: { atMs: nowMs, byKey },
  };
}
