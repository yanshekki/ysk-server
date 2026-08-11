/**
 * OpenVPN server/client host operations (PKI + conf + units).
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import {
  buildOpenVpnClientOvpn,
  buildOpenVpnServerConf,
  nextOpenVpnClientIp,
  openVpnClientUnitName,
} from './openvpn-conf.js';
import { sanitizePeerName } from './wireguard-conf.js';
import type { VpnAccessMode, VpnServerPeer } from './types.js';
import { DEFAULT_VPN_LAN_CIDRS } from './types.js';
import {
  buildVpnNatShell,
  needsInternetNat,
  normalizeCidrList,
  parseAccessMode,
} from './access-mode.js';

export type OvpnServerState = {
  listenPort: number;
  proto: 'udp' | 'tcp';
  endpoint: string;
  dns: string;
  /** Client traffic policy */
  accessMode?: VpnAccessMode;
  lanCidrs?: string[];
  customCidrs?: string[];
  peers: Array<{
    id: string;
    name: string;
    address: string;
    createdAt: string;
  }>;
  updatedAt: string;
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

export function ovpnServerDir(dataDir: string): string {
  return join(dataDir, 'vpn', 'server', 'openvpn');
}

export function loadOvpnServer(dataDir: string): OvpnServerState | null {
  const p = join(ovpnServerDir(dataDir), 'server.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as OvpnServerState;
  } catch {
    return null;
  }
}

export function saveOvpnServer(dataDir: string, state: OvpnServerState): void {
  const dir = ovpnServerDir(dataDir);
  mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(join(dir, 'server.json'), JSON.stringify(state, null, 2), 'utf8');
}

export function listOvpnPeers(dataDir: string): VpnServerPeer[] {
  const state = loadOvpnServer(dataDir);
  if (!state) return [];
  return state.peers.map((p) => ({
    id: p.id,
    name: p.name,
    engine: 'openvpn' as const,
    address: p.address,
    publicKey: '',
    createdAt: p.createdAt,
  }));
}

/**
 * Bootstrap CA + server certs + dh + tls-crypt under dataDir, write server conf, start unit.
 */
export async function ensureOpenVpnServer(
  host: HostExecutor,
  dataDir: string,
  input: {
    listenPort?: number;
    proto?: 'udp' | 'tcp';
    endpoint?: string;
    dns?: string;
    accessMode?: VpnAccessMode;
    lanCidrs?: string[];
    customCidrs?: string[];
  },
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
  if (!(await binExists(host, 'openvpn')) || !(await binExists(host, 'openssl'))) {
    return { ok: false, notes: [tl('notes.vpn.needInstall', { engine: 'OpenVPN' })] };
  }

  const dir = ovpnServerDir(dataDir);
  const pki = join(dir, 'pki');
  mkdirSync(join(pki, 'issued'), { recursive: true });
  mkdirSync(join(pki, 'private'), { recursive: true });
  mkdirSync(join(dir, 'ccd'), { recursive: true });

  let state = loadOvpnServer(dataDir);
  if (!state) {
    state = {
      listenPort: input.listenPort ?? 1194,
      proto: input.proto === 'tcp' ? 'tcp' : 'udp',
      endpoint: input.endpoint?.trim() || '',
      dns: input.dns?.trim() || '1.1.1.1',
      accessMode: parseAccessMode(input.accessMode ?? 'full'),
      lanCidrs: normalizeCidrList(input.lanCidrs ?? [...DEFAULT_VPN_LAN_CIDRS]),
      customCidrs: normalizeCidrList(input.customCidrs ?? []),
      peers: [],
      updatedAt: new Date().toISOString(),
    };
  } else {
    if (input.listenPort) state.listenPort = input.listenPort;
    if (input.proto) state.proto = input.proto;
    if (input.endpoint != null) state.endpoint = input.endpoint.trim();
    if (input.dns != null) state.dns = input.dns.trim() || state.dns;
    if (input.accessMode != null) state.accessMode = parseAccessMode(input.accessMode);
    if (input.lanCidrs != null) state.lanCidrs = normalizeCidrList(input.lanCidrs);
    if (input.customCidrs != null) state.customCidrs = normalizeCidrList(input.customCidrs);
    if (!state.accessMode) state.accessMode = 'full';
    if (!state.lanCidrs?.length) state.lanCidrs = [...DEFAULT_VPN_LAN_CIDRS];
  }

  const caKey = join(pki, 'private', 'ca.key');
  const caCrt = join(pki, 'ca.crt');
  const srvKey = join(pki, 'private', 'server.key');
  const srvCrt = join(pki, 'issued', 'server.crt');
  const dh = join(pki, 'dh.pem');
  const ta = join(pki, 'ta.key');

  // Generate PKI once
  if (!existsSync(caCrt) || !existsSync(srvCrt) || !existsSync(dh) || !existsSync(ta)) {
    const pkiScript = [
      'set -euo pipefail',
      `mkdir -p ${JSON.stringify(join(pki, 'private'))} ${JSON.stringify(join(pki, 'issued'))}`,
      `openssl genrsa -out ${JSON.stringify(caKey)} 2048`,
      `openssl req -new -x509 -days 3650 -key ${JSON.stringify(caKey)} -out ${JSON.stringify(caCrt)} -subj '/CN=YSK-OpenVPN-CA'`,
      `openssl genrsa -out ${JSON.stringify(srvKey)} 2048`,
      `openssl req -new -key ${JSON.stringify(srvKey)} -out ${JSON.stringify(join(pki, 'server.csr'))} -subj '/CN=ysk-openvpn-server'`,
      `openssl x509 -req -in ${JSON.stringify(join(pki, 'server.csr'))} -CA ${JSON.stringify(caCrt)} -CAkey ${JSON.stringify(caKey)} -CAcreateserial -out ${JSON.stringify(srvCrt)} -days 3650`,
      // 2048 dh is slow; 2048 still preferred for security
      `openssl dhparam -out ${JSON.stringify(dh)} 2048`,
      `openvpn --genkey secret ${JSON.stringify(ta)}`,
      `chmod 600 ${JSON.stringify(caKey)} ${JSON.stringify(srvKey)} ${JSON.stringify(ta)}`,
    ].join('\n');
    notes.push(tl('notes.vpn.ovpnPkiStart'));
    const pkiRun = await host.runCommand(['bash', '-c', pkiScript], { timeoutMs: 600_000 });
    if (pkiRun.exitCode !== 0) {
      notes.push(
        tl('notes.vpn.applyFailed', {
          detail: (pkiRun.stderr || pkiRun.stdout || '').slice(0, 300),
        }),
      );
      return { ok: false, notes };
    }
    notes.push(tl('notes.vpn.ovpnPkiDone'));
  }

  saveOvpnServer(dataDir, state);

  const accessMode = parseAccessMode(state.accessMode ?? 'full');
  const lanCidrs = normalizeCidrList(state.lanCidrs ?? [...DEFAULT_VPN_LAN_CIDRS]);
  const customCidrs = normalizeCidrList(state.customCidrs ?? []);
  const confBody = buildOpenVpnServerConf({
    port: state.listenPort,
    proto: state.proto,
    dns: state.dns,
    caPath: caCrt,
    certPath: srvCrt,
    keyPath: srvKey,
    dhPath: dh,
    taPath: ta,
    ccdDir: join(dir, 'ccd'),
    statusPath: '/run/openvpn-server/ysk-status.log',
    accessMode,
    lanCidrs,
    customCidrs,
  });
  const enableNat = needsInternetNat(accessMode, customCidrs);
  const natShell = buildVpnNatShell({
    sourceCidr: '10.8.0.0/24',
    tunnelIfaceHint: 'tun0',
    enableNat,
    lanCidrs,
    mark: 'YSK-VPN-OVPN',
  });
  // Prefer /etc/openvpn/server/ysk.conf (Debian openvpn-server@.service)
  const confPath = '/etc/openvpn/server/ysk.conf';
  const apply = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'mkdir -p /etc/openvpn/server /var/log/openvpn /run/openvpn-server',
        // Status file must be writable by openvpn (nobody) — prepare before start
        'touch /run/openvpn-server/ysk-status.log /var/log/openvpn/ysk-status.log 2>/dev/null || true',
        'chown nobody:nogroup /run/openvpn-server /run/openvpn-server/ysk-status.log 2>/dev/null || true',
        'chown nobody:nogroup /var/log/openvpn /var/log/openvpn/ysk-status.log 2>/dev/null || true',
        'chmod 755 /run/openvpn-server /var/log/openvpn 2>/dev/null || true',
        'chmod 644 /run/openvpn-server/ysk-status.log /var/log/openvpn/ysk-status.log 2>/dev/null || true',
        `cat > ${JSON.stringify(confPath)} <<'YSKOVPN'`,
        confBody,
        'YSKOVPN',
        'chmod 600 /etc/openvpn/server/ysk.conf',
        // access mode: IP forward + NAT / LAN forward
        natShell,
        // unit name varies: openvpn-server@ysk or openvpn@server
        'if systemctl list-unit-files | grep -q openvpn-server@.service; then',
        '  systemctl enable openvpn-server@ysk 2>/dev/null || true',
        '  systemctl restart openvpn-server@ysk',
        'elif systemctl list-unit-files | grep -q "openvpn@.service"; then',
        '  # Legacy openvpn@ cannot use /run/openvpn-server — patch conf status path',
        `  sed -i 's|/run/openvpn-server/ysk-status.log|/var/log/openvpn/ysk-status.log|g' ${JSON.stringify(confPath)}`,
        '  ln -sfn /etc/openvpn/server/ysk.conf /etc/openvpn/ysk.conf 2>/dev/null || cp /etc/openvpn/server/ysk.conf /etc/openvpn/ysk.conf',
        '  systemctl enable openvpn@ysk 2>/dev/null || true',
        '  systemctl restart openvpn@ysk',
        'else',
        '  openvpn --config /etc/openvpn/server/ysk.conf --daemon ysk-openvpn',
        'fi',
      ].join('\n'),
    ],
    { timeoutMs: 60_000 },
  );
  if (apply.exitCode !== 0) {
    notes.push(
      tl('notes.vpn.applyFailed', {
        detail: (apply.stderr || apply.stdout || '').slice(0, 240),
      }),
    );
    return { ok: false, notes };
  }
  notes.push(
    tl('notes.vpn.ovpnServerActive', {
      port: String(state.listenPort),
      proto: state.proto,
    }),
  );
  if (enableNat) {
    notes.push(tl('notes.vpn.accessFullNat'));
  } else {
    notes.push(tl('notes.vpn.accessLanOnly'));
  }
  notes.push(tl('notes.vpn.accessReconnectHint'));
  return { ok: true, notes };
}

export async function addOvpnPeer(
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
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
      notes: [tl('notes.vpn.needExecuteServer')],
    };
  }
  let state = loadOvpnServer(dataDir);
  if (!state) {
    const ens = await ensureOpenVpnServer(host, dataDir, {});
    if (!ens.ok) {
      return {
        ok: false,
        notes: ens.notes,
        blocked: ens.blocked,
        requiresExecute: ens.requiresExecute,
      };
    }
    state = loadOvpnServer(dataDir);
  }
  if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };

  const dir = ovpnServerDir(dataDir);
  const pki = join(dir, 'pki');
  const caKey = join(pki, 'private', 'ca.key');
  const caCrt = join(pki, 'ca.crt');
  const ta = join(pki, 'ta.key');
  if (!existsSync(caCrt)) {
    return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
  }

  const id = newId();
  const name = sanitizePeerName(nameRaw);
  const address = nextOpenVpnClientIp(state.peers.map((p) => p.address));
  const clientKey = join(pki, 'private', `${id}.key`);
  const clientCsr = join(pki, `${id}.csr`);
  const clientCrt = join(pki, 'issued', `${id}.crt`);

  const gen = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set -euo pipefail',
        `openssl genrsa -out ${JSON.stringify(clientKey)} 2048`,
        `openssl req -new -key ${JSON.stringify(clientKey)} -out ${JSON.stringify(clientCsr)} -subj ${JSON.stringify(`/CN=${name}`)}`,
        `openssl x509 -req -in ${JSON.stringify(clientCsr)} -CA ${JSON.stringify(caCrt)} -CAkey ${JSON.stringify(caKey)} -CAcreateserial -out ${JSON.stringify(clientCrt)} -days 3650`,
        `chmod 600 ${JSON.stringify(clientKey)}`,
        // CCD fixed IP
        `echo "ifconfig-push ${address} 255.255.255.0" > ${JSON.stringify(join(dir, 'ccd', name))}`,
      ].join('\n'),
    ],
    { timeoutMs: 60_000 },
  );
  if (gen.exitCode !== 0) {
    return {
      ok: false,
      notes: [
        tl('notes.vpn.applyFailed', {
          detail: (gen.stderr || gen.stdout || '').slice(0, 200),
        }),
      ],
    };
  }

  state.peers.push({ id, name, address, createdAt: new Date().toISOString() });
  saveOvpnServer(dataDir, state);

  mkdirSync(join(dir, 'clients'), { recursive: true });
  writeFileSync(
    join(dir, 'clients', `${id}.json`),
    JSON.stringify(
      {
        id,
        name,
        address,
        clientKey,
        clientCrt,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  const remoteHost = (state.endpoint.split(':')[0] || 'YOUR_PUBLIC_IP').trim();
  const config = buildOpenVpnClientOvpn({
    remote: remoteHost,
    port: state.listenPort,
    proto: state.proto,
    caCrt: readFileSync(caCrt, 'utf8'),
    clientCrt: readFileSync(clientCrt, 'utf8'),
    clientKey: readFileSync(clientKey, 'utf8'),
    taKey: readFileSync(ta, 'utf8'),
  });
  writeFileSync(join(dir, 'clients', `${id}.ovpn`), config, 'utf8');

  return {
    ok: true,
    peer: {
      id,
      name,
      engine: 'openvpn',
      address,
      publicKey: '',
      createdAt: new Date().toISOString(),
    },
    config,
    notes: [
      tl('notes.vpn.peerCreated', { name }),
      !state.endpoint ? tl('notes.vpn.setEndpointHint') : '',
    ].filter(Boolean),
  };
}

export function getOvpnPeerConfig(
  dataDir: string,
  peerId: string,
): { config: string; filename: string } | null {
  const ovpn = join(ovpnServerDir(dataDir), 'clients', `${peerId}.ovpn`);
  const meta = join(ovpnServerDir(dataDir), 'clients', `${peerId}.json`);
  if (!existsSync(ovpn)) return null;
  let name = peerId;
  try {
    if (existsSync(meta)) {
      name = (JSON.parse(readFileSync(meta, 'utf8')) as { name?: string }).name || peerId;
    }
  } catch {
    /* */
  }
  return { config: readFileSync(ovpn, 'utf8'), filename: `${name}.ovpn` };
}

export async function deleteOvpnPeer(
  host: HostExecutor,
  dataDir: string,
  peerId: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const state = loadOvpnServer(dataDir);
  if (!state) return { ok: false, notes: [tl('notes.vpn.serverMissing')] };
  const peer = state.peers.find((p) => p.id === peerId);
  if (!peer) return { ok: false, notes: [tl('notes.vpn.peerNotFound')] };
  state.peers = state.peers.filter((p) => p.id !== peerId);
  saveOvpnServer(dataDir, state);
  const dir = ovpnServerDir(dataDir);
  try {
    rmSync(join(dir, 'clients', `${peerId}.ovpn`), { force: true });
    rmSync(join(dir, 'clients', `${peerId}.json`), { force: true });
    rmSync(join(dir, 'ccd', peer.name), { force: true });
  } catch {
    /* */
  }
  void host;
  return { ok: true, notes: [tl('notes.vpn.peerRemoved')] };
}

export async function isOvpnServerActive(host: HostExecutor): Promise<boolean> {
  if (!host.executeEnabled()) return false;
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      'systemctl is-active --quiet openvpn-server@ysk || systemctl is-active --quiet openvpn@ysk || pgrep -f "openvpn.*ysk.conf" >/dev/null',
    ],
    { timeoutMs: 8_000 },
  );
  return r.exitCode === 0;
}

/** Client up via openvpn --config + systemd unit template */
export async function openvpnClientUp(
  host: HostExecutor,
  confPath: string,
  unitName: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const unitFile = `/etc/systemd/system/${unitName}.service`;
  const script = [
    'set -euo pipefail',
    `mkdir -p /etc/openvpn/client`,
    `cp ${JSON.stringify(confPath)} /etc/openvpn/client/${unitName}.ovpn`,
    `chmod 600 /etc/openvpn/client/${unitName}.ovpn`,
    `cat > ${JSON.stringify(unitFile)} <<'EOF'`,
    '[Unit]',
    'Description=YSK OpenVPN client',
    'After=network-online.target',
    'Wants=network-online.target',
    '[Service]',
    'Type=simple',
    `ExecStart=/usr/sbin/openvpn --config /etc/openvpn/client/${unitName}.ovpn`,
    'Restart=on-failure',
    '[Install]',
    'WantedBy=multi-user.target',
    'EOF',
    'systemctl daemon-reload',
    `systemctl enable ${unitName} 2>/dev/null || true`,
    `systemctl restart ${unitName}`,
  ].join('\n');
  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 45_000 });
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
  return { ok: true, notes: [] };
}

export async function openvpnClientDown(
  host: HostExecutor,
  unitName: string,
): Promise<void> {
  await host.runCommand(
    [
      'bash',
      '-c',
      `systemctl stop ${unitName} 2>/dev/null || true; systemctl disable ${unitName} 2>/dev/null || true`,
    ],
    { timeoutMs: 20_000 },
  );
}

export async function openvpnClientIsUp(
  host: HostExecutor,
  unitName: string,
): Promise<boolean> {
  const r = await host.runCommand(['systemctl', 'is-active', '--quiet', unitName], {
    timeoutMs: 5_000,
  });
  return r.exitCode === 0;
}

export { openVpnClientUnitName };
