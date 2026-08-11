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

/** Best-effort public IP:port for QR / mobile clients (every install host). */
export async function guessSsEndpoint(host: HostExecutor, port: number): Promise<string> {
  try {
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        'curl -4 -fsS --max-time 3 https://ifconfig.me/ip 2>/dev/null || curl -4 -fsS --max-time 3 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 3 https://icanhazip.com 2>/dev/null || true',
      ],
      { timeoutMs: 10_000 },
    );
    const ip = (r.stdout || '').trim().split(/\s+/)[0] || '';
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return `${ip}:${port}`;
  } catch {
    /* */
  }
  return '';
}

/** Rewrite all peer ss:// files from current server.json (after endpoint/password change). */
export function rewriteAllSsClientUris(dataDir: string): number {
  const state = loadSsServer(dataDir);
  if (!state) return 0;
  const ep = parseSsEndpoint(state.endpoint, state.listenPort);
  const dir = join(ssServerDir(dataDir), 'clients');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const peer of state.peers) {
    const uri = buildSsUri({
      method: state.method,
      password: state.password,
      host: ep.host,
      port: ep.port,
      name: peer.name,
    });
    writeFileSync(join(dir, `${peer.id}.txt`), uri + '\n', 'utf8');
    n++;
  }
  return n;
}

/**
 * Install/start YSK Shadowsocks on THIS host (portable to every ysk-server box):
 * - yield Debian package default unit (localhost bind steals the port)
 * - bind 0.0.0.0 (+ ::) for mobile clients
 * - open UFW tcp+udp
 * - autofill public endpoint when missing/invalid
 * - regenerate client ss:// URIs
 */
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
  if (!(await binExists(host, 'ss-server'))) {
    return {
      ok: false,
      notes: [
        tl('notes.vpn.needInstall', { engine: 'Shadowsocks (ss-server / shadowsocks-libev)' }),
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
      endpoint: '',
      peers: [],
      updatedAt: new Date().toISOString(),
    };
    notes.push(tl('notes.vpn.ssKeysCreated'));
  }
  if (input.listenPort) state.listenPort = input.listenPort;
  if (input.endpoint != null && String(input.endpoint).trim()) {
    state.endpoint = String(input.endpoint).trim();
  }

  // Normalize / autofill public endpoint (reject "51820:8388" style typos)
  let ep = parseSsEndpoint(state.endpoint, state.listenPort);
  if (!ep.ok) {
    const guessed = await guessSsEndpoint(host, state.listenPort);
    if (guessed) {
      state.endpoint = guessed;
      ep = parseSsEndpoint(state.endpoint, state.listenPort);
      notes.push(tl('notes.vpn.ssEndpointAutofilled', { endpoint: state.endpoint }));
    } else {
      notes.push(tl('notes.vpn.setEndpointHint'));
    }
  } else {
    // Canonical host:port form
    state.endpoint = `${ep.host}:${ep.port}`;
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

  const port = state.listenPort;
  const apply = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set -e',
        'mkdir -p /etc/shadowsocks-libev',
        `cat > ${JSON.stringify(confPath)} <<'YSKSS'`,
        conf,
        'YSKSS',
        'chmod 600 /etc/shadowsocks-libev/ysk.json',
        // Package default unit binds 127.0.0.1 and steals the port on every host
        'systemctl stop shadowsocks-libev.service 2>/dev/null || true',
        'systemctl disable shadowsocks-libev.service 2>/dev/null || true',
        'systemctl stop shadowsocks-libev@*.service 2>/dev/null || true',
        // Mask so apt/reboot cannot revive localhost-only instance
        'ln -sfn /dev/null /etc/systemd/system/shadowsocks-libev.service',
        'pkill -x ss-server 2>/dev/null || true',
        'sleep 0.4',
        `cat > /etc/systemd/system/ysk-ss-server.service <<'EOF'`,
        '[Unit]',
        'Description=YSK Shadowsocks server (public bind)',
        'Documentation=https://github.com/yanshekki/ysk-server',
        'After=network-online.target',
        'Wants=network-online.target',
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
        'systemctl enable ysk-ss-server.service 2>/dev/null || true',
        'systemctl reset-failed ysk-ss-server.service 2>/dev/null || true',
        'systemctl restart ysk-ss-server.service',
        'sleep 0.5',
        // Must be publicly reachable — fail apply if only loopback
        `ss -lntu | grep -E ':${port}\\b' | grep -vqE '127\\.0\\.0\\.1|\\[::1\\]' || { echo 'SS not bound on public interface (0.0.0.0)' >&2; ss -lntu | grep ${port} || true; exit 1; }`,
        // UFW: tcp+udp (best-effort if ufw present)
        `if command -v ufw >/dev/null 2>&1; then ufw allow ${port}/tcp comment 'ysk-vpn-ss' 2>/dev/null || true; ufw allow ${port}/udp comment 'ysk-vpn-ss' 2>/dev/null || true; fi`,
      ].join('\n'),
    ],
    { timeoutMs: 60_000 },
  );
  if (apply.exitCode !== 0) {
    notes.push(
      tl('notes.vpn.applyFailed', {
        detail: (apply.stderr || apply.stdout || '').slice(0, 320),
      }),
    );
    return { ok: false, notes };
  }

  notes.push(tl('notes.vpn.ssPackageYielded', { port: String(port) }));
  notes.push(tl('notes.vpn.ssServerActive', { port: String(port) }));
  notes.push(tl('notes.vpn.ssUfwOpened', { port: String(port) }));

  const rewritten = rewriteAllSsClientUris(dataDir);
  if (rewritten > 0) {
    notes.push(tl('notes.vpn.ssClientsRewritten', { n: String(rewritten) }));
  }
  notes.push(tl('notes.vpn.ssHonest'));
  if (!parseSsEndpoint(state.endpoint, state.listenPort).ok) {
    notes.push(tl('notes.vpn.setEndpointHint'));
  }
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
  const state = loadSsServer(dataDir);
  if (!state) return null;
  const peer = state.peers.find((x) => x.id === peerId);
  if (!peer) return null;
  // Always regenerate from current server.json (endpoint/password may have changed)
  const ep = parseSsEndpoint(state.endpoint, state.listenPort);
  const uri = buildSsUri({
    method: state.method,
    password: state.password,
    host: ep.host,
    port: ep.port,
    name: peer.name,
  });
  try {
    mkdirSync(join(ssServerDir(dataDir), 'clients'), { recursive: true });
    writeFileSync(join(ssServerDir(dataDir), 'clients', `${peerId}.txt`), uri + '\n', 'utf8');
  } catch {
    /* best-effort cache */
  }
  return { config: uri + '\n', filename: `${peer.name}.txt` };
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
