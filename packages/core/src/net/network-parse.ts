import { tl } from '@ysk-server/shared';
/**
 * Parse `ip -j` JSON into DTOs.
 */

import type { NetAddress, NetInterface, NetLinkStats, NetRoute } from './network-types.js';

type IpAddrJson = {
  ifindex?: number;
  ifname?: string;
  flags?: string[];
  mtu?: number;
  operstate?: string;
  address?: string;
  link_type?: string;
  addr_info?: Array<{
    family?: string;
    local?: string;
    prefixlen?: number;
    scope?: string;
    label?: string;
    dynamic?: boolean;
  }>;
};

type IpLinkJson = {
  ifindex?: number;
  ifname?: string;
  mtu?: number;
  operstate?: string;
  address?: string;
  flags?: string[];
  link_type?: string;
  stats64?: {
    rx?: { bytes?: number; packets?: number; errors?: number };
    tx?: { bytes?: number; packets?: number; errors?: number };
  };
};

type IpRouteJson = {
  dst?: string;
  gateway?: string;
  dev?: string;
  protocol?: string;
  metric?: number;
  scope?: string;
  prefsrc?: string;
  flags?: string[];
};

export function parseIpAddrJson(raw: string): NetInterface[] {
  let arr: IpAddrJson[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    arr = parsed as IpAddrJson[];
  } catch {
    return [];
  }
  const out: NetInterface[] = [];
  for (const row of arr) {
    if (!row.ifname) continue;
    const flags = Array.isArray(row.flags) ? row.flags.map(String) : [];
    const addrs: NetAddress[] = [];
    for (const a of row.addr_info ?? []) {
      if (!a.local || a.prefixlen == null) continue;
      const fam = a.family === 'inet6' ? 'inet6' : a.family === 'inet' ? 'inet' : null;
      if (!fam) continue;
      addrs.push({
        family: fam,
        local: a.local,
        prefixlen: Number(a.prefixlen),
        scope: a.scope,
        label: a.label,
        dynamic: a.dynamic,
      });
    }
    out.push({
      name: row.ifname,
      ifindex: Number(row.ifindex) || 0,
      mac: row.address,
      mtu: row.mtu,
      operstate: row.operstate || 'UNKNOWN',
      flags,
      linkType: row.link_type,
      addrs,
      isLoopback: flags.includes('LOOPBACK') || row.ifname === 'lo',
    });
  }
  return out;
}

export function mergeLinkStats(
  ifaces: NetInterface[],
  linkRaw: string,
): NetInterface[] {
  let arr: IpLinkJson[] = [];
  try {
    const parsed = JSON.parse(linkRaw) as unknown;
    if (!Array.isArray(parsed)) return ifaces;
    arr = parsed as IpLinkJson[];
  } catch {
    return ifaces;
  }
  const byName = new Map(arr.map((l) => [l.ifname, l]));
  return ifaces.map((iface) => {
    const l = byName.get(iface.name);
    if (!l) return iface;
    const stats: NetLinkStats | undefined = l.stats64
      ? {
          rxBytes: Number(l.stats64.rx?.bytes) || 0,
          txBytes: Number(l.stats64.tx?.bytes) || 0,
          rxPackets: Number(l.stats64.rx?.packets) || 0,
          txPackets: Number(l.stats64.tx?.packets) || 0,
          rxErrors: Number(l.stats64.rx?.errors) || 0,
          txErrors: Number(l.stats64.tx?.errors) || 0,
        }
      : undefined;
    return {
      ...iface,
      mtu: l.mtu ?? iface.mtu,
      mac: l.address ?? iface.mac,
      operstate: l.operstate || iface.operstate,
      flags: Array.isArray(l.flags) ? l.flags.map(String) : iface.flags,
      linkType: l.link_type ?? iface.linkType,
      stats,
    };
  });
}

export function parseIpRouteJson(raw: string): NetRoute[] {
  let arr: IpRouteJson[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    arr = parsed as IpRouteJson[];
  } catch {
    return [];
  }
  return arr.map((r) => ({
    dst: r.dst || 'default',
    gateway: r.gateway,
    dev: r.dev,
    protocol: r.protocol,
    metric: r.metric,
    scope: r.scope,
    prefsrc: r.prefsrc,
    flags: Array.isArray(r.flags) ? r.flags.map(String) : undefined,
  }));
}

export function parseResolvConf(text: string): {
  nameservers: string[];
  search: string[];
} {
  const nameservers: string[] = [];
  const search: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/\s+/);
    if (parts[0] === 'nameserver' && parts[1]) nameservers.push(parts[1]);
    if ((parts[0] === 'search' || parts[0] === 'domain') && parts.length > 1) {
      search.push(...parts.slice(1));
    }
  }
  return { nameservers, search };
}

/** Validate interface name (no shell metachar). */
export function isValidIfName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 64 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._@:/-]*$/.test(name)
  );
}

/**
 * CIDR like 192.168.1.10/24 or 2001:db8::1/64
 */
export function parseCidr(
  cidr: string,
): { ok: true; cidr: string; ip: string; prefix: number; family: 4 | 6 } | { ok: false; reason: string } {
  const s = cidr.trim();
  const m = s.match(/^([^/]+)\/(\d{1,3})$/);
  if (!m) return { ok: false, reason: tl('notes.auto.n1378') };
  const ip = m[1].trim();
  const prefix = Number(m[2]);
  // light check: no spaces, basic v4/v6 shape
  if (ip.includes(' ') || ip.includes('%')) {
    return { ok: false, reason: tl('notes.auto.n0119') };
  }
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
  const isV6 = ip.includes(':');
  if (!isV4 && !isV6) return { ok: false, reason: tl('notes.auto.n1193') };
  if (isV4 && (prefix < 0 || prefix > 32)) {
    return { ok: false, reason: tl('notes.auto.n0120') };
  }
  if (isV6 && (prefix < 0 || prefix > 128)) {
    return { ok: false, reason: tl('notes.auto.n0121') };
  }
  return {
    ok: true,
    cidr: `${ip}/${prefix}`,
    ip,
    prefix,
    family: isV4 ? 4 : 6,
  };
}
