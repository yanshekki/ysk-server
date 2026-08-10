/**
 * Pure WireGuard conf builders (no host I/O).
 */

export type WgKeypair = { privateKey: string; publicKey: string };

export function buildServerConf(input: {
  privateKey: string;
  address: string;
  listenPort: number;
  peers: Array<{ publicKey: string; allowedIps: string; name?: string }>;
}): string {
  const lines = [
    '# YSK-managed WireGuard server (wg0)',
    '[Interface]',
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    `ListenPort = ${input.listenPort}`,
    // NAT for client internet access — applied via PostUp when EXECUTE installs
    'SaveConfig = false',
    '',
  ];
  for (const p of input.peers) {
    if (p.name) lines.push(`# peer: ${p.name}`);
    lines.push('[Peer]');
    lines.push(`PublicKey = ${p.publicKey}`);
    lines.push(`AllowedIPs = ${p.allowedIps}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function buildClientConf(input: {
  privateKey: string;
  address: string;
  dns?: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIps?: string;
  persistentKeepalive?: number;
}): string {
  const dns = input.dns ?? '1.1.1.1';
  const allowed = input.allowedIps ?? '0.0.0.0/0, ::/0';
  const ka = input.persistentKeepalive ?? 25;
  return [
    '# YSK WireGuard client — import into WireGuard app / wg-quick',
    '[Interface]',
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    `DNS = ${dns}`,
    '',
    '[Peer]',
    `PublicKey = ${input.serverPublicKey}`,
    `Endpoint = ${input.endpoint}`,
    `AllowedIPs = ${allowed}`,
    `PersistentKeepalive = ${ka}`,
    '',
  ].join('\n');
}

/** Next client IP in 10.66.66.0/24 (server uses .1). */
export function nextClientAddress(used: string[]): string {
  const taken = new Set(
    used.map((a) => {
      const m = a.match(/10\.66\.66\.(\d+)/);
      return m ? Number(m[1]) : 0;
    }),
  );
  for (let i = 2; i < 254; i++) {
    if (!taken.has(i)) return `10.66.66.${i}/32`;
  }
  throw new Error('no free client addresses in 10.66.66.0/24');
}

export function sanitizePeerName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'client';
}

export function clientIfaceName(id: string): string {
  const short = id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'x';
  return `wg-c-${short}`.slice(0, 15);
}
