/**
 * Shared public endpoint parsing for WireGuard / OpenVPN / Shadowsocks.
 * Rejects common typos like "51820:1194" (WG port used as host).
 */

import type { HostExecutor } from '../../host/executor.js';

export type ParsedVpnEndpoint = {
  host: string;
  port: number;
  ok: boolean;
};

/** True if host looks like a real hostname / IP (not a bare port number). */
export function isValidEndpointHost(host: string): boolean {
  const h = host.trim();
  if (!h) return false;
  if (/^\d+$/.test(h)) return false;
  return true;
}

/**
 * Parse panel "公開端點" host[:port].
 * - "1.2.3.4:1194" → host 1.2.3.4, port 1194
 * - "vpn.example.com" → host + listenPort
 * - "51820:1194" → invalid (digits-only host)
 * - "[::1]:1194" → IPv6
 */
export function parseVpnEndpoint(
  endpoint: string | undefined | null,
  listenPort: number,
): ParsedVpnEndpoint {
  const raw = (endpoint || '').trim();
  if (!raw) return { host: 'YOUR_PUBLIC_IP', port: listenPort, ok: false };

  // [ipv6]:port
  const v6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const host = v6[1]!;
    return {
      host,
      port: v6[2] ? Number(v6[2]) : listenPort,
      ok: isValidEndpointHost(host) || host.includes(':'),
    };
  }

  const parts = raw.split(':');
  if (parts.length === 1) {
    const h = parts[0]!.trim();
    const ok = isValidEndpointHost(h);
    return { host: ok ? h : 'YOUR_PUBLIC_IP', port: listenPort, ok };
  }

  // host:port — last segment is port when numeric
  const portStr = parts[parts.length - 1]!;
  const host = parts.slice(0, -1).join(':').trim();
  const port = /^\d+$/.test(portStr) ? Number(portStr) : listenPort;
  if (!isValidEndpointHost(host)) {
    return { host: 'YOUR_PUBLIC_IP', port: listenPort, ok: false };
  }
  return {
    host,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : listenPort,
    ok: true,
  };
}

export function formatVpnEndpoint(host: string, port: number): string {
  const h = host.trim();
  if (!isValidEndpointHost(h) && !h.includes(':')) return '';
  if (h.includes(':') && !h.startsWith('[')) return `[${h}]:${port}`;
  return `${h}:${port}`;
}

/** Best-effort public IPv4:port for client conf / QR. */
export async function guessPublicEndpoint(
  host: HostExecutor,
  port: number,
): Promise<string> {
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

/** Patch OpenVPN client conf `remote` line to current host/port. */
export function applyOvpnRemote(
  config: string,
  host: string,
  port: number,
): string {
  const line = `remote ${host} ${port}`;
  if (/^remote\s+/m.test(config)) {
    return config.replace(/^remote\s+.+$/m, line);
  }
  if (/^proto\s+/m.test(config)) {
    return config.replace(/^(proto\s+\S+)\s*$/m, `$1\n${line}`);
  }
  return `${line}\n${config}`;
}
