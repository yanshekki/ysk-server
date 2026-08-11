/**
 * VPN access mode helpers — routes, AllowedIPs, NAT need.
 */

import type { VpnAccessMode } from './types.js';
import { DEFAULT_VPN_LAN_CIDRS } from './types.js';

export function parseAccessMode(raw: unknown): VpnAccessMode {
  const s = String(raw ?? 'full').toLowerCase();
  if (s === 'lan' || s === 'local' || s === 'split') return 'lan';
  if (s === 'custom') return 'custom';
  return 'full';
}

export function normalizeCidrList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const c = String(x ?? '').trim();
    if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(c)) out.push(c);
  }
  return [...new Set(out)];
}

/** CIDR → OpenVPN push "route a.b.c.d netmask" */
export function cidrToOvpnRoutePush(cidr: string): string | null {
  const m = cidr.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const ip = m[1]!;
  const prefix = Number(m[2]);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return null;
  const maskNum = prefix === 0 ? 0 : (((0xffffffff << (32 - prefix)) >>> 0) as number);
  const mask = [24, 16, 8, 0].map((s) => (maskNum >>> s) & 255).join('.');
  return `push "route ${ip} ${mask}"`;
}

export function needsInternetNat(mode: VpnAccessMode, customCidrs: string[]): boolean {
  if (mode === 'full') return true;
  if (mode === 'custom') {
    return customCidrs.some((c) => c === '0.0.0.0/0' || c === '::/0');
  }
  return false;
}

/** WireGuard client AllowedIPs for access mode */
export function wgClientAllowedIps(
  mode: VpnAccessMode,
  opts?: { lanCidrs?: string[]; customCidrs?: string[]; vpnNet?: string },
): string {
  const vpnNet = opts?.vpnNet ?? '10.66.66.0/24';
  if (mode === 'full') return '0.0.0.0/0, ::/0';
  if (mode === 'custom') {
    const list = normalizeCidrList(opts?.customCidrs ?? []);
    return list.length ? list.join(', ') : vpnNet;
  }
  // lan
  const lan = normalizeCidrList(opts?.lanCidrs ?? [...DEFAULT_VPN_LAN_CIDRS]);
  const parts = [vpnNet, ...lan];
  return [...new Set(parts)].join(', ');
}

/** OpenVPN server push lines for access mode (excluding DNS). */
export function ovpnAccessPushLines(
  mode: VpnAccessMode,
  opts?: { lanCidrs?: string[]; customCidrs?: string[]; vpnNetCidr?: string },
): string[] {
  const lines: string[] = [];
  if (mode === 'full') {
    lines.push('push "redirect-gateway def1 bypass-dhcp"');
    return lines;
  }
  const vpnCidr = opts?.vpnNetCidr ?? '10.8.0.0/24';
  const vpnPush = cidrToOvpnRoutePush(vpnCidr);
  if (vpnPush) lines.push(vpnPush);

  const cidrs =
    mode === 'custom'
      ? normalizeCidrList(opts?.customCidrs ?? [])
      : normalizeCidrList(opts?.lanCidrs ?? [...DEFAULT_VPN_LAN_CIDRS]);
  for (const c of cidrs) {
    if (c === vpnCidr) continue;
    const p = cidrToOvpnRoutePush(c);
    if (p) lines.push(p);
  }
  return lines;
}

/**
 * Idempotent iptables NAT + forward for VPN clients.
 * comment mark YSK-VPN for cleanup.
 */
export function buildVpnNatShell(input: {
  /** e.g. 10.8.0.0/24 or 10.66.66.0/24 */
  sourceCidr: string;
  /** tun0 / wg0 — used for FORWARD -i */
  tunnelIfaceHint: string;
  enableNat: boolean;
  /** optional LAN destinations for lan mode forward only */
  lanCidrs?: string[];
  mark: string;
}): string {
  const src = input.sourceCidr;
  const mark = input.mark.replace(/[^A-Za-z0-9_-]/g, '') || 'YSK-VPN';
  const wan = `WAN=$(ip route 2>/dev/null | awk '/default/{print $5; exit}')`;
  const tun = `TUN=$(ip -br link 2>/dev/null | awk '/^${input.tunnelIfaceHint}|^tun|^wg/{print $1; exit}' | head -1); [ -z "$TUN" ] && TUN=${JSON.stringify(input.tunnelIfaceHint)}`;

  const lines = [
    'set +e',
    'sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true',
    wan,
    tun,
    'if [ -z "$WAN" ]; then echo "YSK-VPN: no default WAN iface"; exit 0; fi',
    // cleanup old marked rules (best-effort)
    `iptables-save 2>/dev/null | grep -F ${JSON.stringify(mark)} | sed 's/^-A /iptables -D /' | sh 2>/dev/null || true`,
  ];

  if (input.enableNat) {
    lines.push(
      `iptables -C FORWARD -i "$TUN" -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -i "$TUN" -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -i "$TUN" -j ACCEPT`,
      `iptables -C FORWARD -o "$TUN" -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -o "$TUN" -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -o "$TUN" -m state --state RELATED,ESTABLISHED -j ACCEPT`,
      `iptables -t nat -C POSTROUTING -s ${JSON.stringify(src)} -o "$WAN" -j MASQUERADE -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -t nat -A POSTROUTING -s ${JSON.stringify(src)} -o "$WAN" -j MASQUERADE -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -t nat -A POSTROUTING -s ${JSON.stringify(src)} -o "$WAN" -j MASQUERADE`,
      'echo "YSK-VPN: full NAT applied iface=$TUN wan=$WAN src=' + src + '"',
    );
  } else {
    // lan: allow forward from tunnel to listed nets only; no default MASQUERADE
    const lans = input.lanCidrs?.length ? input.lanCidrs : [...DEFAULT_VPN_LAN_CIDRS];
    for (const lan of lans) {
      lines.push(
        `iptables -C FORWARD -s ${JSON.stringify(src)} -d ${JSON.stringify(lan)} -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -s ${JSON.stringify(src)} -d ${JSON.stringify(lan)} -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || true`,
      );
    }
    lines.push(
      `iptables -C FORWARD -d ${JSON.stringify(src)} -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || iptables -A FORWARD -d ${JSON.stringify(src)} -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment ${JSON.stringify(mark)} 2>/dev/null || true`,
      'echo "YSK-VPN: lan forward only (no internet NAT)"',
    );
  }
  return lines.join('\n');
}
