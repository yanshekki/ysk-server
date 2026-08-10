/**
 * Pure OpenVPN conf builders (no host I/O).
 */

export function buildOpenVpnServerConf(input: {
  port: number;
  proto: 'udp' | 'tcp';
  serverNet?: string;
  dns?: string;
  caPath: string;
  certPath: string;
  keyPath: string;
  dhPath: string;
  taPath: string;
  ccdDir: string;
}): string {
  const net = input.serverNet ?? '10.8.0.0 255.255.255.0';
  const dns = input.dns ?? '1.1.1.1';
  return [
    '# YSK-managed OpenVPN server',
    `port ${input.port}`,
    `proto ${input.proto}`,
    'dev tun',
    `ca ${input.caPath}`,
    `cert ${input.certPath}`,
    `key ${input.keyPath}`,
    `dh ${input.dhPath}`,
    `tls-crypt ${input.taPath}`,
    `server ${net}`,
    'topology subnet',
    `client-config-dir ${input.ccdDir}`,
    'keepalive 10 120',
    'persist-key',
    'persist-tun',
    'user nobody',
    'group nogroup',
    'verb 3',
    `push "dhcp-option DNS ${dns}"`,
    'push "redirect-gateway def1 bypass-dhcp"',
    '',
  ].join('\n');
}

export function buildOpenVpnClientOvpn(input: {
  remote: string;
  port: number;
  proto: 'udp' | 'tcp';
  caCrt: string;
  clientCrt: string;
  clientKey: string;
  taKey: string;
}): string {
  return [
    '# YSK OpenVPN client — import into OpenVPN Connect / openvpn CLI',
    'client',
    'dev tun',
    `proto ${input.proto}`,
    `remote ${input.remote} ${input.port}`,
    'resolv-retry infinite',
    'nobind',
    'persist-key',
    'persist-tun',
    'remote-cert-tls server',
    'verb 3',
    '<ca>',
    input.caCrt.trim(),
    '</ca>',
    '<cert>',
    input.clientCrt.trim(),
    '</cert>',
    '<key>',
    input.clientKey.trim(),
    '</key>',
    '<tls-crypt>',
    input.taKey.trim(),
    '</tls-crypt>',
    '',
  ].join('\n');
}

/** Next client IP in 10.8.0.0/24 (server .1). Returns dotted IP for ifconfig-push. */
export function nextOpenVpnClientIp(used: string[]): string {
  const taken = new Set(
    used.map((a) => {
      const m = a.match(/10\.8\.0\.(\d+)/);
      return m ? Number(m[1]) : 0;
    }),
  );
  for (let i = 2; i < 254; i++) {
    if (!taken.has(i)) return `10.8.0.${i}`;
  }
  throw new Error('no free OpenVPN client addresses');
}

export function openVpnClientUnitName(id: string): string {
  const short = id.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase() || 'x';
  return `ysk-ovpn-c-${short}`;
}
