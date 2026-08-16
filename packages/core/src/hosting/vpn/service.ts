/**
 * VPN service — WireGuard + OpenVPN server/client (Outline status stub).
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import {
  coerceVpnListenPort,
  defaultPortForEngine,
  parseVpnListenPort,
  presetsForEngine,
} from './ports.js';
import type {
  VpnClientProfile,
  VpnEngineId,
  VpnEngineStatus,
  VpnOverviewStatus,
  VpnServerPeer,
} from './types.js';
import {
  buildClientConf,
  buildServerConf,
  clientIfaceName,
  nextClientAddress,
  sanitizePeerName,
} from './wireguard-conf.js';
import {
  buildVpnClientProtectScript,
  injectWgClientHostProtection,
  stripImportedVpnHooks,
} from './client-conf-protect.js';
import {
  addOvpnPeer,
  deleteOvpnPeer,
  ensureOpenVpnServer,
  getOvpnPeerConfig,
  isOvpnServerActive,
  listOvpnPeers,
  loadOvpnServer,
  openvpnClientDown,
  openvpnClientIsUp,
  openvpnClientUp,
  openVpnClientUnitName,
} from './openvpn-ops.js';
import {
  addSsPeer,
  deleteSsPeer,
  ensureSsServer,
  getSsPeerConfig,
  isSsServerActive,
  listSsPeers,
  loadSsServer,
} from './outline-ops.js';
import {
  buildMonitorSnapshot,
  type RatePrevSample,
  type VpnMonitorSnapshot,
} from './monitor.js';
import type { VpnAccessMode } from './types.js';
import { DEFAULT_VPN_LAN_CIDRS } from './types.js';
import {
  needsInternetNat,
  normalizeVpnCidrList,
  parseAccessMode,
  wgClientAllowedIps,
} from './access-mode.js';
import {
  formatVpnEndpoint,
  guessPublicEndpoint,
  parseVpnEndpoint,
} from './endpoint.js';

type WgServerState = {
  privateKey: string;
  publicKey: string;
  address: string;
  listenPort: number;
  endpoint: string;
  dns: string;
  accessMode?: VpnAccessMode;
  lanCidrs?: string[];
  customCidrs?: string[];
  peers: Array<{
    id: string;
    name: string;
    privateKey: string;
    publicKey: string;
    address: string;
    createdAt: string;
  }>;
  updatedAt: string;
};

type ClientMeta = {
  id: string;
  name: string;
  engine: VpnEngineId;
  iface: string;
  autostart: boolean;
  createdAt: string;
  confFile: string;
};

function newId(): string {
  return randomBytes(8).toString('hex');
}

async function binExists(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} >/dev/null 2>&1`], {
    timeoutMs: 5_000,
  });
  return r.exitCode === 0;
}

async function genWgKeypair(
  host: HostExecutor,
): Promise<{ privateKey: string; publicKey: string } | null> {
  const priv = await host.runCommand(['wg', 'genkey'], { timeoutMs: 10_000 });
  if (priv.exitCode !== 0 || !priv.stdout?.trim()) return null;
  const privateKey = priv.stdout.trim();
  const pub = await host.runCommand(['bash', '-c', `printf %s ${JSON.stringify(privateKey)} | wg pubkey`], {
    timeoutMs: 10_000,
  });
  if (pub.exitCode !== 0 || !pub.stdout?.trim()) return null;
  return { privateKey, publicKey: pub.stdout.trim() };
}

/** Process-wide rate samples — VpnService is constructed per HTTP request. */
const MONITOR_RATE_CACHE = new Map<string, RatePrevSample>();

export class VpnService {
  constructor(
    private readonly dataDir: string,
    private readonly host: HostExecutor,
  ) {}

  private root(): string {
    return join(this.dataDir, 'vpn');
  }

  private wgServerDir(): string {
    return join(this.root(), 'server', 'wireguard');
  }

  private wgServerStatePath(): string {
    return join(this.wgServerDir(), 'server.json');
  }

  private clientDir(): string {
    return join(this.root(), 'client', 'profiles');
  }

  private ensureDirs(): void {
    mkdirSync(this.wgServerDir(), { recursive: true });
    mkdirSync(this.clientDir(), { recursive: true });
  }

  private loadWgServer(): WgServerState | null {
    const p = this.wgServerStatePath();
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as WgServerState;
    } catch {
      return null;
    }
  }

  private saveWgServer(state: WgServerState): void {
    this.ensureDirs();
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.wgServerStatePath(), JSON.stringify(state, null, 2), 'utf8');
  }

  async status(): Promise<VpnOverviewStatus> {
    const wgInstalled =
      (await binExists(this.host, 'wg')) && (await binExists(this.host, 'wg-quick'));
    const ovpnInstalled = await binExists(this.host, 'openvpn');
    const wgState = this.loadWgServer();
    const clients = this.listClientProfiles();

    let serverActive = false;
    if (wgInstalled && this.host.executeEnabled()) {
      const st = await this.host.runCommand(
        ['bash', '-c', 'wg show wg0 >/dev/null 2>&1 || systemctl is-active --quiet wg-quick@wg0'],
        { timeoutMs: 8_000 },
      );
      serverActive = st.exitCode === 0;
    } else if (wgState) {
      serverActive = false;
    }

    const wgPeers = wgState?.peers?.length ?? 0;
    const wgClientProfiles = clients.filter((c) => c.engine === 'wireguard');
    let clientUp = 0;
    for (const c of wgClientProfiles) {
      if (c.status === 'up') clientUp += 1;
    }

    const engines: VpnEngineStatus[] = [
      {
        engine: 'wireguard',
        title: 'WireGuard',
        installed: wgInstalled,
        serverActive,
        serverPort: wgState?.listenPort ?? defaultPortForEngine('wireguard').port,
        serverProto: 'udp',
        peerCount: wgPeers,
        clientProfileCount: wgClientProfiles.length,
        clientConnectedCount: clientUp,
        notes: wgInstalled
          ? []
          : [tl('notes.vpn.needInstall', { engine: 'WireGuard' })],
        bins: ['wg', 'wg-quick'],
        missingBins: [
          ...(!(await binExists(this.host, 'wg')) ? ['wg'] : []),
          ...(!(await binExists(this.host, 'wg-quick')) ? ['wg-quick'] : []),
        ],
      },
      {
        engine: 'openvpn',
        title: 'OpenVPN',
        installed: ovpnInstalled,
        serverActive: await isOvpnServerActive(this.host),
        serverPort:
          loadOvpnServer(this.dataDir)?.listenPort ??
          defaultPortForEngine('openvpn').port,
        serverProto: loadOvpnServer(this.dataDir)?.proto ?? 'udp',
        peerCount: listOvpnPeers(this.dataDir).length,
        clientProfileCount: clients.filter((c) => c.engine === 'openvpn').length,
        clientConnectedCount: clients.filter(
          (c) => c.engine === 'openvpn' && c.status === 'up',
        ).length,
        notes: ovpnInstalled
          ? []
          : [tl('notes.vpn.needInstall', { engine: 'OpenVPN' })],
        bins: ['openvpn', 'openssl'],
        missingBins: ovpnInstalled ? [] : ['openvpn'],
      },
      {
        engine: 'outline',
        title: 'Shadowsocks (ss-server)',
        installed: await binExists(this.host, 'ss-server'),
        serverActive: await isSsServerActive(this.host),
        serverPort:
          loadSsServer(this.dataDir)?.listenPort ??
          defaultPortForEngine('outline').port,
        serverProto: 'both',
        peerCount: listSsPeers(this.dataDir).length,
        clientProfileCount: 0,
        clientConnectedCount: 0,
        notes: (await binExists(this.host, 'ss-server'))
          ? [tl('notes.vpn.ssHonest')]
          : [tl('notes.vpn.needInstall', { engine: 'ss-server' }), tl('notes.vpn.ssHonest')],
        bins: ['ss-server'],
        missingBins: (await binExists(this.host, 'ss-server')) ? [] : ['ss-server'],
      },
    ];

    // Prefer any valid host:port (reject stale "51820:1194" typos in hint)
    const candidates = [
      wgState?.endpoint,
      loadOvpnServer(this.dataDir)?.endpoint,
      loadSsServer(this.dataDir)?.endpoint,
    ];
    let endpointHint: string | null = null;
    for (const c of candidates) {
      const raw = (c || '').trim();
      if (!raw) continue;
      const p = parseVpnEndpoint(raw, 1);
      if (p.ok) {
        endpointHint = formatVpnEndpoint(p.host, p.port) || `${p.host}:${p.port}`;
        break;
      }
    }

    return {
      engines,
      endpointHint,
      executeEnabled: this.host.executeEnabled(),
      isRoot: this.host.isRoot(),
    };
  }

  portPresets(engine?: VpnEngineId) {
    if (engine) return presetsForEngine(engine);
    return [...presetsForEngine('wireguard'), ...presetsForEngine('openvpn'), ...presetsForEngine('outline')];
  }

  /**
   * Live monitor snapshot: who is online, transfer, rates (3s poll-friendly).
   */
  async monitor(opts?: { engine?: VpnEngineId }): Promise<VpnMonitorSnapshot> {
    const controlPeers = [
      ...this.listServerPeers('wireguard'),
      ...this.listServerPeers('openvpn'),
      ...this.listServerPeers('outline'),
    ].map((p) => ({
      id: p.id,
      name: p.name,
      engine: p.engine,
      address: p.address,
      publicKey: p.publicKey ?? '',
    }));
    const controlClients = this.listClientProfiles().map((c) => ({
      id: c.id,
      name: c.name,
      engine: c.engine,
      iface: c.iface,
      status: c.status,
    }));
    const cacheKey = this.dataDir;
    const { snapshot, nextPrev } = await buildMonitorSnapshot({
      host: this.host,
      dataDir: this.dataDir,
      controlPeers,
      controlClients,
      prev: MONITOR_RATE_CACHE.get(cacheKey) ?? null,
    });
    MONITOR_RATE_CACHE.set(cacheKey, nextPrev);

    if (opts?.engine) {
      return {
        ...snapshot,
        engines: snapshot.engines.filter((e) => e.engine === opts.engine),
        peers: snapshot.peers.filter((p) => p.engine === opts.engine),
        localClients: snapshot.localClients.filter((c) => c.engine === opts.engine),
      };
    }
    return snapshot;
  }

  /**
   * Create or update WireGuard server state; write /etc/wireguard/wg0.conf when EXECUTE+root.
   */
  async ensureWireGuardServer(input: {
    listenPort?: number;
    endpoint?: string;
    dns?: string;
    accessMode?: VpnAccessMode;
    lanCidrs?: string[];
    customCidrs?: string[];
  }): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; requiresExecute?: boolean }> {
    const notes: string[] = [];
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: !this.host.executeEnabled(),
        notes: [tl('notes.vpn.needExecuteServer')],
      };
    }
    if (!(await binExists(this.host, 'wg'))) {
      return { ok: false, notes: [tl('notes.vpn.needInstall', { engine: 'WireGuard' })] };
    }

    let state = this.loadWgServer();
    if (!state) {
      const kp = await genWgKeypair(this.host);
      if (!kp) {
        return { ok: false, notes: [tl('notes.vpn.keygenFailed')] };
      }
      state = {
        privateKey: kp.privateKey,
        publicKey: kp.publicKey,
        address: '10.66.66.1/24',
        listenPort: coerceVpnListenPort(input.listenPort, 51820),
        endpoint: input.endpoint?.trim() || '',
        dns: input.dns?.trim() || '1.1.1.1',
        accessMode: parseAccessMode(input.accessMode ?? 'full'),
        lanCidrs: normalizeVpnCidrList(input.lanCidrs ?? [...DEFAULT_VPN_LAN_CIDRS]),
        customCidrs: normalizeVpnCidrList(input.customCidrs ?? []),
        peers: [],
        updatedAt: new Date().toISOString(),
      };
      notes.push(tl('notes.vpn.serverKeysCreated'));
    } else {
      if (input.listenPort != null) {
        const p = parseVpnListenPort(input.listenPort);
        if (p != null) state.listenPort = p;
      }
      if (input.endpoint != null && input.endpoint.trim()) {
        state.endpoint = input.endpoint.trim();
      }
      if (input.dns != null) state.dns = input.dns.trim() || state.dns;
      if (input.accessMode != null) state.accessMode = parseAccessMode(input.accessMode);
      if (input.lanCidrs != null) state.lanCidrs = normalizeVpnCidrList(input.lanCidrs);
      if (input.customCidrs != null) state.customCidrs = normalizeVpnCidrList(input.customCidrs);
      if (!state.accessMode) state.accessMode = 'full';
    }

    // Normalize / autofill public endpoint (reject "51820:1194" style typos)
    let ep = parseVpnEndpoint(state.endpoint, state.listenPort);
    if (!ep.ok) {
      const guessed = await guessPublicEndpoint(this.host, state.listenPort);
      if (guessed) {
        state.endpoint = guessed;
        ep = parseVpnEndpoint(state.endpoint, state.listenPort);
        notes.push(tl('notes.vpn.endpointAutofilled', { endpoint: state.endpoint }));
      } else {
        state.endpoint = '';
        notes.push(tl('notes.vpn.setEndpointHint'));
      }
    } else {
      state.endpoint =
        formatVpnEndpoint(ep.host, ep.port) || `${ep.host}:${ep.port}`;
    }

    this.saveWgServer(state);
    return this.writeWgConfAndApply(state, notes, 'restart');
  }

  /** Write wg0.conf. `restart` = full apply + NAT notes; `sync` = live peer reload. */
  private async writeWgConfAndApply(
    state: WgServerState,
    notes: string[],
    mode: 'restart' | 'sync',
  ): Promise<{ ok: boolean; notes: string[] }> {
    const accessMode = parseAccessMode(state.accessMode ?? 'full');
    const customCidrs = normalizeVpnCidrList(state.customCidrs ?? []);
    const enableNat = needsInternetNat(accessMode, customCidrs);
    const conf = buildServerConf({
      privateKey: state.privateKey,
      address: state.address,
      listenPort: state.listenPort,
      peers: state.peers.map((p) => ({
        publicKey: p.publicKey,
        allowedIps: p.address,
        name: p.name,
      })),
    });
    const postUp = enableNat
      ? 'PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -C FORWARD -i wg0 -j ACCEPT -m comment --comment YSK-VPN-WG 2>/dev/null || iptables -I FORWARD 1 -i wg0 -j ACCEPT -m comment --comment YSK-VPN-WG; iptables -C FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment YSK-VPN-WG 2>/dev/null || iptables -I FORWARD 1 -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment YSK-VPN-WG; iptables -t nat -C POSTROUTING -s 10.66.66.0/24 -o $(ip route | awk \'/default/{print $5; exit}\') -j MASQUERADE -m comment --comment YSK-VPN-WG 2>/dev/null || iptables -t nat -A POSTROUTING -s 10.66.66.0/24 -o $(ip route | awk \'/default/{print $5; exit}\') -j MASQUERADE -m comment --comment YSK-VPN-WG'
      : 'PostUp = sysctl -w net.ipv4.ip_forward=1';
    const postDown = enableNat
      ? 'PostDown = iptables -D FORWARD -i wg0 -j ACCEPT -m comment --comment YSK-VPN-WG 2>/dev/null; iptables -D FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment YSK-VPN-WG 2>/dev/null; iptables -t nat -D POSTROUTING -s 10.66.66.0/24 -o $(ip route | awk \'/default/{print $5; exit}\') -j MASQUERADE -m comment --comment YSK-VPN-WG 2>/dev/null; true'
      : 'PostDown = true';
    const withNat = conf.replace(
      'SaveConfig = false\n',
      ['SaveConfig = false', postUp, postDown, ''].join('\n'),
    );

    const confPath = '/etc/wireguard/wg0.conf';
    const applyCmd =
      mode === 'sync'
        ? [
            'mkdir -p /etc/wireguard',
            `cat > ${JSON.stringify(confPath)} <<'YSKWG'`,
            withNat,
            'YSKWG',
            'chmod 600 /etc/wireguard/wg0.conf',
            'if wg show wg0 >/dev/null 2>&1; then wg syncconf wg0 <(wg-quick strip /etc/wireguard/wg0.conf); else systemctl start wg-quick@wg0; fi',
          ].join('\n')
        : [
            'mkdir -p /etc/wireguard',
            `cat > ${JSON.stringify(confPath)} <<'YSKWG'`,
            withNat,
            'YSKWG',
            'chmod 600 /etc/wireguard/wg0.conf',
            'systemctl enable wg-quick@wg0 2>/dev/null || true',
            'systemctl restart wg-quick@wg0',
          ].join('\n');
    const write = await this.host.runCommand(['bash', '-c', applyCmd], { timeoutMs: 60_000 });
    if (write.exitCode !== 0) {
      notes.push(
        tl('notes.vpn.applyFailed', {
          detail: (write.stderr || write.stdout || '').slice(0, 240),
        }),
      );
      return { ok: false, notes };
    }
    if (mode === 'sync') {
      notes.push(tl('notes.vpn.peersSynced'));
      return { ok: true, notes };
    }
    notes.push(tl('notes.vpn.serverActive', { port: String(state.listenPort) }));
    notes.push(enableNat ? tl('notes.vpn.accessFullNat') : tl('notes.vpn.accessLanOnly'));
    notes.push(tl('notes.vpn.accessReconnectHint'));
    return { ok: true, notes };
  }

  private async syncWireGuardPeers(): Promise<{
    ok: boolean;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
  }> {
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: !this.host.executeEnabled(),
        notes: [tl('notes.vpn.needExecuteServer')],
      };
    }
    const state = this.loadWgServer();
    if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
    return this.writeWgConfAndApply(state, [], 'sync');
  }

  listServerPeers(engine: VpnEngineId = 'wireguard'): VpnServerPeer[] {
    if (engine === 'openvpn') return listOvpnPeers(this.dataDir);
    if (engine === 'outline') return listSsPeers(this.dataDir);
    const state = this.loadWgServer();
    if (!state) return [];
    return state.peers.map((p) => ({
      id: p.id,
      name: p.name,
      engine: 'wireguard' as const,
      address: p.address,
      publicKey: p.publicKey,
      createdAt: p.createdAt,
    }));
  }

  async ensureServer(input: {
    engine?: VpnEngineId;
    listenPort?: number;
    endpoint?: string;
    dns?: string;
    proto?: 'udp' | 'tcp';
    accessMode?: import('./types.js').VpnAccessMode;
    lanCidrs?: string[];
    customCidrs?: string[];
  }): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; requiresExecute?: boolean }> {
    const engine = input.engine ?? 'wireguard';
    if (engine === 'openvpn') {
      return ensureOpenVpnServer(this.host, this.dataDir, {
        listenPort: input.listenPort,
        proto: input.proto,
        endpoint: input.endpoint,
        dns: input.dns,
        accessMode: input.accessMode,
        lanCidrs: input.lanCidrs,
        customCidrs: input.customCidrs,
      });
    }
    if (engine === 'outline') {
      return ensureSsServer(this.host, this.dataDir, {
        listenPort: input.listenPort,
        endpoint: input.endpoint,
      });
    }
    return this.ensureWireGuardServer({
      listenPort: input.listenPort,
      endpoint: input.endpoint,
      dns: input.dns,
      accessMode: input.accessMode,
      lanCidrs: input.lanCidrs,
      customCidrs: input.customCidrs,
    });
  }

  async stopServer(input: {
    engine?: VpnEngineId;
  }): Promise<{
    ok: boolean;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
  }> {
    const engine = input.engine ?? 'wireguard';
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: !this.host.executeEnabled(),
        notes: [tl('notes.vpn.needExecuteServer')],
      };
    }
    const units =
      engine === 'openvpn'
        ? ['openvpn-server@ysk', 'openvpn@ysk']
        : engine === 'outline'
          ? ['ysk-ss-server']
          : ['wg-quick@wg0'];
    const notes: string[] = [];
    let stoppedOrIdle = false;
    for (const unit of units) {
      const active = await this.host.runCommand(['systemctl', 'is-active', '--quiet', unit], {
        timeoutMs: 8_000,
      });
      if (active.exitCode !== 0) {
        stoppedOrIdle = true;
        continue;
      }
      const r = await this.host.runCommand(['systemctl', 'stop', unit], { timeoutMs: 30_000 });
      notes.push(`systemctl stop ${unit} exit=${r.exitCode}`);
      if (r.exitCode === 0) stoppedOrIdle = true;
    }
    if (engine === 'wireguard') {
      await this.host.runCommand(['bash', '-c', 'wg-quick down wg0 2>/dev/null || true'], {
        timeoutMs: 20_000,
      });
    }
    if (!stoppedOrIdle) {
      return {
        ok: false,
        notes: [
          tl('notes.vpn.serverStopFailed', {
            engine,
            detail: notes.join('; ') || 'no unit',
          }),
        ],
      };
    }
    return { ok: true, notes: [tl('notes.vpn.serverStopped', { engine }), ...notes] };
  }

  async addServerPeer(input: {
    name: string;
    engine?: VpnEngineId;
  }): Promise<{
    ok: boolean;
    peer?: VpnServerPeer;
    config?: string;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
  }> {
    const engine = input.engine ?? 'wireguard';
    if (engine === 'openvpn') {
      return addOvpnPeer(this.host, this.dataDir, input.name);
    }
    if (engine === 'outline') {
      return addSsPeer(this.host, this.dataDir, input.name);
    }
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: !this.host.executeEnabled(),
        notes: [tl('notes.vpn.needExecuteServer')],
      };
    }
    let state = this.loadWgServer();
    if (!state) {
      const ensured = await this.ensureWireGuardServer({});
      if (!ensured.ok) return { ok: false, notes: ensured.notes, blocked: ensured.blocked, requiresExecute: ensured.requiresExecute };
      state = this.loadWgServer();
    }
    if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };

    const kp = await genWgKeypair(this.host);
    if (!kp) return { ok: false, notes: [tl('notes.vpn.keygenFailed')] };

    const id = newId();
    const name = sanitizePeerName(input.name);
    const address = nextClientAddress(state.peers.map((p) => p.address));
    const peer = {
      id,
      name,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      address,
      createdAt: new Date().toISOString(),
    };
    state.peers.push(peer);
    this.saveWgServer(state);

    const reapply = await this.syncWireGuardPeers();

    const ep = parseVpnEndpoint(state.endpoint, state.listenPort);
    const endpoint = ep.ok
      ? `${ep.host}:${ep.port}`
      : (await this.guessEndpoint(state.listenPort));

    const config = buildClientConf({
      privateKey: peer.privateKey,
      address: peer.address,
      dns: state.dns,
      serverPublicKey: state.publicKey,
      endpoint,
      allowedIps: wgClientAllowedIps(parseAccessMode(state.accessMode ?? 'full'), {
        lanCidrs: state.lanCidrs,
        customCidrs: state.customCidrs,
      }),
    });

    return {
      ok: reapply.ok,
      peer: {
        id: peer.id,
        name: peer.name,
        engine: 'wireguard',
        address: peer.address,
        publicKey: peer.publicKey,
        createdAt: peer.createdAt,
      },
      config,
      notes: [
        tl('notes.vpn.peerCreated', { name }),
        ...reapply.notes,
        !ep.ok && !state.endpoint ? tl('notes.vpn.setEndpointHint') : '',
      ].filter(Boolean),
    };
  }

  getServerPeerConfig(peerId: string): { config: string; filename: string } | null {
    const ss = getSsPeerConfig(this.dataDir, peerId);
    if (ss) return ss;
    const ovpn = getOvpnPeerConfig(this.dataDir, peerId);
    if (ovpn) return ovpn;
    const state = this.loadWgServer();
    if (!state) return null;
    const peer = state.peers.find((p) => p.id === peerId);
    if (!peer) return null;
    const ep = parseVpnEndpoint(state.endpoint, state.listenPort);
    const endpoint = ep.ok
      ? `${ep.host}:${ep.port}`
      : `YOUR_PUBLIC_IP:${state.listenPort}`;
    const config = buildClientConf({
      privateKey: peer.privateKey,
      address: peer.address,
      dns: state.dns,
      serverPublicKey: state.publicKey,
      endpoint,
      allowedIps: wgClientAllowedIps(parseAccessMode(state.accessMode ?? 'full'), {
        lanCidrs: state.lanCidrs,
        customCidrs: state.customCidrs,
      }),
    });
    return { config, filename: `${peer.name}.conf` };
  }

  async deleteServerPeer(peerId: string): Promise<{ ok: boolean; notes: string[] }> {
    const ssState = loadSsServer(this.dataDir);
    if (ssState?.peers.some((p) => p.id === peerId)) {
      return deleteSsPeer(this.dataDir, peerId);
    }
    const ovpnState = loadOvpnServer(this.dataDir);
    if (ovpnState?.peers.some((p) => p.id === peerId)) {
      return deleteOvpnPeer(this.host, this.dataDir, peerId);
    }
    const state = this.loadWgServer();
    if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
    const before = state.peers.length;
    state.peers = state.peers.filter((p) => p.id !== peerId);
    if (state.peers.length === before) {
      return { ok: false, notes: [tl('notes.vpn.peerNotFound')] };
    }
    this.saveWgServer(state);
    if (this.host.executeEnabled() && this.host.isRoot()) {
      const sync = await this.syncWireGuardPeers();
      return {
        ok: sync.ok,
        notes: [tl('notes.vpn.peerRemoved'), ...sync.notes],
      };
    }
    return { ok: true, notes: [tl('notes.vpn.peerRemoved')] };
  }

  private async guessEndpoint(port: number): Promise<string> {
    // best-effort public IP
    try {
      const r = await this.host.runCommand(
        [
          'bash',
          '-c',
          'curl -4 -fsS --max-time 3 https://ifconfig.me/ip 2>/dev/null || curl -4 -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true',
        ],
        { timeoutMs: 8_000 },
      );
      const ip = (r.stdout || '').trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return `${ip}:${port}`;
    } catch {
      /* */
    }
    return `YOUR_PUBLIC_IP:${port}`;
  }

  // ── Client profiles ──────────────────────────────────────────

  listClientProfiles(): VpnClientProfile[] {
    this.ensureDirs();
    const dir = this.clientDir();
    if (!existsSync(dir)) return [];
    const out: VpnClientProfile[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(dir, name), 'utf8'),
        ) as ClientMeta;
        out.push({
          id: meta.id,
          name: meta.name,
          engine: meta.engine,
          iface: meta.iface,
          status: 'unknown',
          autostart: meta.autostart,
          createdAt: meta.createdAt,
        });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async refreshClientStatuses(
    profiles: VpnClientProfile[],
  ): Promise<VpnClientProfile[]> {
    if (!this.host.executeEnabled()) return profiles;
    const next: VpnClientProfile[] = [];
    for (const p of profiles) {
      if (p.engine === 'openvpn') {
        const up = await openvpnClientIsUp(this.host, p.iface);
        next.push({ ...p, status: up ? 'up' : 'down' });
        continue;
      }
      if (p.engine !== 'wireguard') {
        next.push(p);
        continue;
      }
      const st = await this.host.runCommand(
        ['bash', '-c', `wg show ${JSON.stringify(p.iface)} >/dev/null 2>&1`],
        { timeoutMs: 5_000 },
      );
      next.push({ ...p, status: st.exitCode === 0 ? 'up' : 'down' });
    }
    return next;
  }

  async importClientProfile(input: {
    name: string;
    engine?: VpnEngineId;
    conf: string;
    autostart?: boolean;
  }): Promise<{
    ok: boolean;
    profile?: VpnClientProfile;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
  }> {
    let engine = input.engine ?? 'wireguard';
    const conf = input.conf.trim();
    // Auto-detect OpenVPN
    if (
      engine === 'wireguard' &&
      (conf.includes('client') || conf.includes('<ca>')) &&
      conf.includes('remote ')
    ) {
      engine = 'openvpn';
    }
    if (engine === 'outline') {
      return { ok: false, notes: [tl('notes.vpn.outlineComing')] };
    }
    if (engine === 'wireguard') {
      if (!conf.includes('[Interface]') || !conf.includes('PrivateKey')) {
        return { ok: false, notes: [tl('notes.vpn.invalidConf')] };
      }
    } else if (engine === 'openvpn') {
      if (!conf.includes('remote ') && !conf.includes('client')) {
        return { ok: false, notes: [tl('notes.vpn.invalidOvpn')] };
      }
    }
    const cleaned = stripImportedVpnHooks(conf);
    const safeConf = cleaned.conf;
    this.ensureDirs();
    const id = newId();
    const iface =
      engine === 'openvpn' ? openVpnClientUnitName(id) : clientIfaceName(id);
    const name = sanitizePeerName(input.name);
    const confFile = engine === 'openvpn' ? `${id}.ovpn` : `${id}.conf`;
    const meta: ClientMeta = {
      id,
      name,
      engine,
      iface,
      autostart: input.autostart === true,
      createdAt: new Date().toISOString(),
      confFile,
    };
    writeFileSync(
      join(this.clientDir(), confFile),
      safeConf.endsWith('\n') ? safeConf : safeConf + '\n',
      'utf8',
    );
    writeFileSync(join(this.clientDir(), `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');

    return {
      ok: true,
      profile: {
        id,
        name,
        engine,
        iface,
        status: 'down',
        autostart: meta.autostart,
        createdAt: meta.createdAt,
      },
      notes: [tl('notes.vpn.clientImported', { name })],
    };
  }

  async clientUp(profileId: string): Promise<{
    ok: boolean;
    notes: string[];
    blocked?: boolean;
    requiresExecute?: boolean;
  }> {
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: !this.host.executeEnabled(),
        notes: [tl('notes.vpn.needExecuteClient')],
      };
    }
    const metaPath = join(this.clientDir(), `${profileId}.meta.json`);
    if (!existsSync(metaPath)) {
      return { ok: false, notes: [tl('notes.vpn.profileNotFound')] };
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ClientMeta;
    const confSrc = join(this.clientDir(), meta.confFile);
    if (!existsSync(confSrc)) {
      return { ok: false, notes: [tl('notes.vpn.profileNotFound')] };
    }
    if (meta.engine === 'openvpn') {
      const r = await openvpnClientUp(this.host, confSrc, meta.iface);
      if (!r.ok) return r;
      return { ok: true, notes: [tl('notes.vpn.clientUp', { name: meta.name }), ...r.notes] };
    }
    const dest = `/etc/wireguard/${meta.iface}.conf`;
    const rawConf = stripImportedVpnHooks(readFileSync(confSrc, 'utf8')).conf;
    const prepared = injectWgClientHostProtection(rawConf);
    const notes: string[] = [];
    if (prepared.fullTunnel) {
      notes.push(tl('notes.vpn.clientFullTunnelProtect'));
    }
    // Persist protect hooks into stored profile (multi-host apply path)
    writeFileSync(confSrc, prepared.conf, 'utf8');
    const script = [
      'mkdir -p /usr/local/lib/ysk-server /etc/wireguard',
      `cat > /usr/local/lib/ysk-server/vpn-client-protect.sh <<'YSKCP'`,
      buildVpnClientProtectScript().trimEnd(),
      'YSKCP',
      'chmod 755 /usr/local/lib/ysk-server/vpn-client-protect.sh',
      `cp ${JSON.stringify(confSrc)} ${JSON.stringify(dest)}`,
      `chmod 600 ${JSON.stringify(dest)}`,
      `wg-quick down ${JSON.stringify(meta.iface)} 2>/dev/null || true`,
      `wg-quick up ${JSON.stringify(meta.iface)}`,
      prepared.fullTunnel
        ? '/usr/local/lib/ysk-server/vpn-client-protect.sh up || true'
        : 'true',
    ].join('\n');
    const r = await this.host.runCommand(['bash', '-c', script], { timeoutMs: 45_000 });
    if (r.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          tl('notes.vpn.clientUpFailed', {
            detail: (r.stderr || r.stdout || '').slice(0, 240),
          }),
        ],
      };
    }
    if (meta.autostart) {
      await this.host.runCommand(
        ['systemctl', 'enable', `wg-quick@${meta.iface}`],
        { timeoutMs: 15_000 },
      );
    }
    notes.unshift(tl('notes.vpn.clientUp', { name: meta.name }));
    if (prepared.fullTunnel) {
      notes.push(tl('notes.vpn.clientFullTunnelHint'));
    }
    return { ok: true, notes };
  }

  async clientDown(profileId: string): Promise<{ ok: boolean; notes: string[] }> {
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        notes: [tl('notes.vpn.needExecuteClient')],
      };
    }
    const metaPath = join(this.clientDir(), `${profileId}.meta.json`);
    if (!existsSync(metaPath)) {
      return { ok: false, notes: [tl('notes.vpn.profileNotFound')] };
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ClientMeta;
    if (meta.engine === 'openvpn') {
      await openvpnClientDown(this.host, meta.iface);
      return { ok: true, notes: [tl('notes.vpn.clientDown', { name: meta.name })] };
    }
    await this.host.runCommand(
      ['bash', '-c', `wg-quick down ${JSON.stringify(meta.iface)} 2>/dev/null || true`],
      { timeoutMs: 30_000 },
    );
    return { ok: true, notes: [tl('notes.vpn.clientDown', { name: meta.name })] };
  }

  async deleteClientProfile(profileId: string): Promise<{ ok: boolean; notes: string[] }> {
    await this.clientDown(profileId).catch(() => undefined);
    const metaPath = join(this.clientDir(), `${profileId}.meta.json`);
    if (!existsSync(metaPath)) {
      return { ok: false, notes: [tl('notes.vpn.profileNotFound')] };
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ClientMeta;
    try {
      rmSync(metaPath, { force: true });
      rmSync(join(this.clientDir(), meta.confFile), { force: true });
    } catch {
      /* */
    }
    if (this.host.executeEnabled() && this.host.isRoot()) {
      await this.host.runCommand(
        [
          'bash',
          '-c',
          `rm -f /etc/wireguard/${meta.iface}.conf; systemctl disable wg-quick@${meta.iface} 2>/dev/null || true`,
        ],
        { timeoutMs: 15_000 },
      );
    }
    return { ok: true, notes: [tl('notes.vpn.clientDeleted', { name: meta.name })] };
  }

  async setClientAutostart(
    profileId: string,
    autostart: boolean,
  ): Promise<{ ok: boolean; notes: string[] }> {
    const metaPath = join(this.clientDir(), `${profileId}.meta.json`);
    if (!existsSync(metaPath)) {
      return { ok: false, notes: [tl('notes.vpn.profileNotFound')] };
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ClientMeta;
    meta.autostart = autostart;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    if (this.host.executeEnabled() && this.host.isRoot()) {
      await this.host.runCommand(
        [
          'systemctl',
          autostart ? 'enable' : 'disable',
          `wg-quick@${meta.iface}`,
        ],
        { timeoutMs: 15_000 },
      );
    }
    return {
      ok: true,
      notes: [
        autostart
          ? tl('notes.vpn.autostartOn', { name: meta.name })
          : tl('notes.vpn.autostartOff', { name: meta.name }),
      ],
    };
  }
}

export function createVpnService(dataDir: string, host: HostExecutor): VpnService {
  return new VpnService(dataDir, host);
}

export function parseEngine(raw: unknown): VpnEngineId {
  const s = String(raw ?? 'wireguard').toLowerCase();
  if (s === 'openvpn') return 'openvpn';
  if (s === 'outline' || s === 'shadowsocks' || s === 'ss') return 'outline';
  return 'wireguard';
}
