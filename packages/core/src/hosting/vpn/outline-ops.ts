/**
 * Shadowsocks-libev server (Outline-compatible ss:// access keys).
 * Honest label: not full Outline Manager — simple ss-server for QR share.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import type { VpnServerPeer } from './types.js';
import { sanitizePeerName } from './wireguard-conf.js';

export type SsServerState = {
  listenPort: number;
  method: string;
  password: string;
  endpoint: string;
  peers: Array<{ id: string; name: string; createdAt: string }>;
  updatedAt: string;
};

const METHOD = 'chacha20-ietf-poly1305';

function newId(): string {
  return randomBytes(8).toString('hex');
}

function randomPassword(): string {
  return randomBytes(16).toString('base64url');
}

async function binExists(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} >/dev/null 2>&1`], {
    timeoutMs: 5_000,
  });
  return r.exitCode === 0;
}

export function ssServerDir(dataDir: string): string {
  return join(dataDir, 'vpn', 'server', 'outline');
}

export function loadSsServer(dataDir: string): SsServerState | null {
  const p = join(ssServerDir(dataDir), 'server.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SsServerState;
  } catch {
    return null;
  }
}

export function saveSsServer(dataDir: string, state: SsServerState): void {
  mkdirSync(ssServerDir(dataDir), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(join(ssServerDir(dataDir), 'server.json'), JSON.stringify(state, null, 2), 'utf8');
}

/** ss://method:password@host:port#name */
export function buildSsUri(input: {
  method: string;
  password: string;
  host: string;
  port: number;
  name?: string;
}): string {
  const userinfo = `${input.method}:${input.password}`;
  const b64 = Buffer.from(userinfo, 'utf8').toString('base64url');
  const tag = input.name ? `#${encodeURIComponent(input.name)}` : '';
  return `ss://${b64}@${input.host}:${input.port}${tag}`;
}

/**
 * Parse panel "公開端點" host[:port].
 * Rejects mistakes like "51820:8388" (WG port used as host).
 */
export function parseSsEndpoint(
  endpoint: string | undefined | null,
  listenPort: number,
): { host: string; port: number; ok: boolean } {
  const raw = (endpoint || '').trim();
  if (!raw) return { host: 'YOUR_PUBLIC_IP', port: listenPort, ok: false };
  // [ipv6]:port
  const v6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    return { host: v6[1], port: v6[2] ? Number(v6[2]) : listenPort, ok: true };
  }
  const parts = raw.split(':');
  if (parts.length === 1) {
    const h = parts[0].trim();
    const ok = !/^\d+$/.test(h);
    return { host: ok ? h : 'YOUR_PUBLIC_IP', port: listenPort, ok };
  }
  // host:port — last segment port
  const portStr = parts[parts.length - 1];
  const host = parts.slice(0, -1).join(':').trim();
  const port = /^\d+$/.test(portStr) ? Number(portStr) : listenPort;
  // "51820:8388" → host is digits only → invalid
  if (!host || /^\d+$/.test(host)) {
    return { host: 'YOUR_PUBLIC_IP', port: listenPort, ok: false };
  }
  return { host, port: Number.isFinite(port) ? port : listenPort, ok: true };
}

export function listSsPeers(dataDir: string): VpnServerPeer[] {
  const state = loadSsServer(dataDir);
  if (!state) return [];
  // SS-libev uses one shared password; peers are named access labels
  return state.peers.map((p) => ({
    id: p.id,
    name: p.name,
    engine: 'outline' as const,
    address: `${state.listenPort}`,
    publicKey: '',
    createdAt: p.createdAt,
  }));
}

export async function ensureSsServer(
  host: HostExecutor,
  dataDir: string,
  input: { listenPort?: number; endpoint?: string },
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; requiresExecute?: boolean }> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
      notes: [tl('notes.vpn.needExecuteServer')],
    };
  }
  // Debian: ss-server from shadowsocks-libev
  if (!(await binExists(host, 'ss-server'))) {
    return {
      ok: false,
      notes: [
        tl('notes.vpn.needInstall', { engine: 'Shadowsocks (ss-server)' }),
        tl('notes.vpn.ssHonest'),
      ],
    };
  }

  let state = loadSsServer(dataDir);
  if (!state) {
    state = {
      listenPort: input.listenPort ?? 8388,
      method: METHOD,
      password: randomPassword(),
      endpoint: input.endpoint?.trim() || '',
      peers: [],
      updatedAt: new Date().toISOString(),
    };
    notes.push(tl('notes.vpn.ssKeysCreated'));
  } else {
    if (input.listenPort) state.listenPort = input.listenPort;
    if (input.endpoint != null) state.endpoint = input.endpoint.trim();
  }
  saveSsServer(dataDir, state);

  const confPath = '/etc/shadowsocks-libev/ysk.json';
  const conf = JSON.stringify(
    {
      server: ['0.0.0.0', '::0'],
      server_port: state.listenPort,
      password: state.password,
      method: state.method,
      mode: 'tcp_and_udp',
      timeout: 300,
      fast_open: false,
    },
    null,
    2,
  );

  const apply = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'mkdir -p /etc/shadowsocks-libev',
        `cat > ${JSON.stringify(confPath)} <<'YSKSS'`,
        conf,
        'YSKSS',
        'chmod 600 /etc/shadowsocks-libev/ysk.json',
        // Package default unit binds 127.0.0.1 and steals the port — must yield to YSK
        'systemctl stop shadowsocks-libev.service 2>/dev/null || true',
        'systemctl disable shadowsocks-libev.service 2>/dev/null || true',
        'systemctl stop shadowsocks-libev@*.service 2>/dev/null || true',
        'pkill -x ss-server 2>/dev/null || true',
        'sleep 0.3',
        `cat > /etc/systemd/system/ysk-ss-server.service <<'EOF'`,
        '[Unit]',
        'Description=YSK Shadowsocks server',
        'After=network-online.target',
        'Conflicts=shadowsocks-libev.service',
        '[Service]',
        'Type=simple',
        'ExecStart=/usr/bin/ss-server -c /etc/shadowsocks-libev/ysk.json',
        'Restart=on-failure',
        'RestartSec=2',
        'LimitNOFILE=65535',
        '[Install]',
        'WantedBy=multi-user.target',
        'EOF',
        'systemctl daemon-reload',
        'systemctl enable ysk-ss-server 2>/dev/null || true',
        'systemctl reset-failed ysk-ss-server 2>/dev/null || true',
        'systemctl restart ysk-ss-server',
        // Verify public bind (not loopback-only)
        `ss -lntu | grep -E ':${state.listenPort}\\b' | grep -vqE '127\\.0\\.0\\.1|\\[::1\\]' || { echo 'SS not bound on public interface' >&2; exit 1; }`,
      ].join('\n'),
    ],
    { timeoutMs: 45_000 },
  );
  if (apply.exitCode !== 0) {
    notes.push(
      tl('notes.vpn.applyFailed', {
        detail: (apply.stderr || apply.stdout || '').slice(0, 240),
      }),
    );
    return { ok: false, notes };
  }
  notes.push(tl('notes.vpn.ssServerActive', { port: String(state.listenPort) }));
  notes.push(tl('notes.vpn.ssHonest'));
  return { ok: true, notes };
}

export async function addSsPeer(
  host: HostExecutor,
  dataDir: string,
  nameRaw: string,
): Promise<{
  ok: boolean;
  peer?: VpnServerPeer;
  config?: string;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  void host;
  let state = loadSsServer(dataDir);
  if (!state) {
    return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
  }
  const id = newId();
  const name = sanitizePeerName(nameRaw);
  state.peers.push({ id, name, createdAt: new Date().toISOString() });
  saveSsServer(dataDir, state);

  const ep = parseSsEndpoint(state.endpoint, state.listenPort);
  const uri = buildSsUri({
    method: state.method,
    password: state.password,
    host: ep.host,
    port: ep.port,
    name,
  });
  mkdirSync(join(ssServerDir(dataDir), 'clients'), { recursive: true });
  writeFileSync(join(ssServerDir(dataDir), 'clients', `${id}.txt`), uri + '\n', 'utf8');

  return {
    ok: true,
    peer: {
      id,
      name,
      engine: 'outline',
      address: String(state.listenPort),
      publicKey: '',
      createdAt: new Date().toISOString(),
    },
    config: uri,
    notes: [
      tl('notes.vpn.peerCreated', { name }),
      tl('notes.vpn.ssSharedPassword'),
      !ep.ok ? tl('notes.vpn.setEndpointHint') : '',
    ].filter(Boolean),
  };
}

export function getSsPeerConfig(
  dataDir: string,
  peerId: string,
): { config: string; filename: string } | null {
  const p = join(ssServerDir(dataDir), 'clients', `${peerId}.txt`);
  if (!existsSync(p)) {
    // regenerate from server state + peer name
    const state = loadSsServer(dataDir);
    if (!state) return null;
    const peer = state.peers.find((x) => x.id === peerId);
    if (!peer) return null;
    const ep = parseSsEndpoint(state.endpoint, state.listenPort);
    const uri = buildSsUri({
      method: state.method,
      password: state.password,
      host: ep.host,
      port: ep.port,
      name: peer.name,
    });
    return { config: uri + '\n', filename: `${peer.name}.txt` };
  }
  let name = peerId;
  const state = loadSsServer(dataDir);
  const peer = state?.peers.find((x) => x.id === peerId);
  if (peer) name = peer.name;
  return { config: readFileSync(p, 'utf8'), filename: `${name}.txt` };
}

export async function deleteSsPeer(
  dataDir: string,
  peerId: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const state = loadSsServer(dataDir);
  if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
  if (state.peers.length === before) {
    return { ok: false, notes: [tl('notes.vpn.peerNotFound')] };
  }
  saveSsServer(dataDir, state);
  try {
    rmSync(join(ssServerDir(dataDir), 'clients', `${peerId}.txt`), { force: true });
  } catch {
    /* */
  }
  return { ok: true, notes: [tl('notes.vpn.peerRemoved')] };
}

export async function isSsServerActive(host: HostExecutor): Promise<boolean> {
  if (!host.executeEnabled()) return false;
  const r = await host.runCommand(['systemctl', 'is-active', '--quiet', 'ysk-ss-server'], {
    timeoutMs: 5_000,
  });
  return r.exitCode === 0;
}
