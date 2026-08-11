/**
 * VPN public endpoint helpers — keep host:port in sync when listen port changes.
 */

export type VpnEngineTab = 'wireguard' | 'openvpn' | 'outline';

export function defaultPortForEngine(
  engine: VpnEngineTab,
  proto: 'udp' | 'tcp' = 'udp',
): number {
  if (engine === 'openvpn') return proto === 'tcp' ? 443 : 1194;
  if (engine === 'outline') return 8388;
  return 51820;
}

export function firewallProtoForEngine(
  engine: VpnEngineTab,
  ovpnProto: 'udp' | 'tcp',
): string {
  if (engine === 'outline') return 'both';
  if (engine === 'openvpn') return ovpnProto;
  return 'udp';
}

/** Extract host from host:port (IPv6 [addr]:port supported). */
export function hostFromEndpoint(endpoint: string, fallbackHost = ''): string {
  const e = endpoint.trim();
  if (!e) return fallbackHost;
  if (e.startsWith('[')) {
    const m = e.match(/^(\[[^\]]+\])(?::\d+)?$/);
    const h = m?.[1] ?? e;
    // bare numeric inside brackets is still weird — keep fallback if empty
    return h || fallbackHost;
  }
  const lastColon = e.lastIndexOf(':');
  let host = e;
  if (lastColon > 0 && /^\d+$/.test(e.slice(lastColon + 1))) {
    host = e.slice(0, lastColon);
  }
  // Reject "51820:1194" / bare port as host — never treat digits-only as hostname
  if (!host || /^\d+$/.test(host)) return fallbackHost;
  return host;
}

/** host:port; never emit digit-only host typos like "51820:1194". */
export function buildEndpoint(host: string, port: number): string {
  const h = host.trim();
  if (!h || /^\d+$/.test(h)) return '';
  return `${h}:${port}`;
}

/**
 * When listen port changes, keep the same host and rewrite :port.
 * Uses fallbackHost when endpoint is empty.
 */
export function syncEndpointPort(
  prevEndpoint: string,
  port: number,
  fallbackHost: string,
): string {
  const host = hostFromEndpoint(prevEndpoint, fallbackHost);
  return buildEndpoint(host || fallbackHost, port);
}

export function confDownloadName(
  engine: VpnEngineTab,
  name: string,
): string {
  const safe = name.replace(/[^\w.-]+/g, '_') || 'client';
  if (engine === 'openvpn') return `${safe}.ovpn`;
  if (engine === 'outline') return `${safe}.txt`;
  return `${safe}.conf`;
}

/** Guess client engine from pasted conf. */
export function detectClientEngine(
  conf: string,
): 'wireguard' | 'openvpn' | undefined {
  const c = conf.trim();
  if (!c) return undefined;
  if (/^\[Interface\]/im.test(c) || /PrivateKey\s*=/i.test(c)) return 'wireguard';
  if (/^\s*client\b/im.test(c) || /^\s*remote\s+/im.test(c) || /<ca>/i.test(c)) {
    return 'openvpn';
  }
  return undefined;
}
