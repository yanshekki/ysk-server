import { tl } from '@ysk/shared';
/**
 * Mutate host network (ip addr / link / route / DNS) — fail-closed without YSK_EXECUTE + root.
 */

import { isIP } from 'node:net';
import type { HostExecutor } from '../host/executor.js';
import { isValidIfName, parseCidr } from './network-parse.js';
import type { NetApplyResult } from './network-types.js';

function gate(host: HostExecutor): NetApplyResult | null {
  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  if (!executeEnabled || !isRoot) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n1191'),
      notes: [tl('ops.blocked.needExecuteRoot')],
      executeEnabled,
      isRoot };
  }
  return null;
}

function base(host: HostExecutor, iface?: string): Pick<
  NetApplyResult,
  'executeEnabled' | 'isRoot' | 'interface'
> {
  return {
    executeEnabled: host.executeEnabled(),
    isRoot: host.isRoot(),
    interface: iface };
}

export async function networkAddAddr(input: {
  host: HostExecutor;
  ifname: string;
  cidr: string;
  /** Save to NetworkManager profile (reboot-safe) */
  persistent?: boolean;
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return { ...g, interface: input.ifname };

  if (!isValidIfName(input.ifname)) {
    return {
      ok: false,
      notes: [tl('notes.net.invalidIface')],
      ...base(input.host, input.ifname) };
  }
  if (input.ifname === 'lo') {
    return {
      ok: false,
      notes: [tl('notes.auto.n0872')],
      ...base(input.host, input.ifname) };
  }
  const c = parseCidr(input.cidr);
  if (!c.ok) {
    return { ok: false, notes: [c.reason], ...base(input.host, input.ifname) };
  }

  const notes: string[] = [];

  // Persistent first (NM writes profile + up applies address)
  if (input.persistent) {
    const nm = await resolveNmConnection(input.host, input.ifname);
    if (!nm) {
      return {
        ok: false,
        blocked: true,
        blockMessage: tl('notes.net.needNmActive'),
        notes: [
          tl('notes.auto.n1003'),
        ],
        ...base(input.host, input.ifname) };
    }
    const prop = c.family === 6 ? '+ipv6.addresses' : '+ipv4.addresses';
    const mod = await input.host.runCommand(
      ['nmcli', 'connection', 'modify', nm.connection, prop, c.cidr],
      { timeoutMs: 15_000 },
    );
    if (mod.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          tl('notes.auto.t0025', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 240)) }),
        ],
        ...base(input.host, input.ifname) };
    }
    notes.push(tl('notes.auto.t0026', { v0: (c.cidr), v1: (nm.connection) }));
    const up = await input.host.runCommand(
      ['nmcli', 'connection', 'up', nm.connection],
      { timeoutMs: 45_000 },
    );
    if (up.exitCode !== 0) {
      // still try live add so address may appear
      notes.push(
        tl('notes.auto.t0027', { v0: ((up.stderr || up.stdout || '').trim().slice(0, 160)) }),
      );
      const live = await input.host.runCommand(
        ['ip', 'addr', 'add', c.cidr, 'dev', input.ifname],
        { timeoutMs: 10_000 },
      );
      if (live.exitCode === 0) {
        notes.push(tl('notes.auto.n0740'));
        return {
          ok: true,
          notes,
          persistent: true,
          ephemeral: true,
          ...base(input.host, input.ifname) };
      }
      return {
        ok: false,
        notes: [...notes, tl('notes.auto.n1368')],
        persistent: true,
        ...base(input.host, input.ifname) };
    }
    notes.push(tl('notes.auto.t0028'));
    return {
      ok: true,
      notes,
      persistent: true,
      ephemeral: false,
      ...base(input.host, input.ifname) };
  }

  const r = await input.host.runCommand(
    ['ip', 'addr', 'add', c.cidr, 'dev', input.ifname],
    { timeoutMs: 10_000 },
  );
  if (r.exitCode !== 0) {
    const err = (r.stderr || r.stdout || '').trim().slice(0, 240);
    notes.push(tl('notes.tpl.ipAddrAddFailed', { detail: err || `exit ${r.exitCode}` }));
    return {
      ok: false,
      notes,
      ephemeral: true,
      ...base(input.host, input.ifname) };
  }
  notes.push(tl('notes.auto.t0029', { v0: (c.cidr), v1: (input.ifname) }));
  return {
    ok: true,
    notes,
    ephemeral: true,
    persistent: false,
    ...base(input.host, input.ifname) };
}

export async function networkDelAddr(input: {
  host: HostExecutor;
  ifname: string;
  cidr: string;
  /** Also remove from NM profile */
  persistent?: boolean;
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return { ...g, interface: input.ifname };

  if (!isValidIfName(input.ifname)) {
    return { ok: false, notes: [tl('notes.net.invalidIface')], ...base(input.host, input.ifname) };
  }
  const c = parseCidr(input.cidr);
  if (!c.ok) {
    return { ok: false, notes: [c.reason], ...base(input.host, input.ifname) };
  }
  if (
    input.ifname === 'lo' &&
    (c.ip === '127.0.0.1' || c.ip === '::1')
  ) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0873')],
      ...base(input.host, input.ifname) };
  }

  const notes: string[] = [];

  if (input.persistent) {
    const nm = await resolveNmConnection(input.host, input.ifname);
    if (nm) {
      const prop = c.family === 6 ? '-ipv6.addresses' : '-ipv4.addresses';
      const mod = await input.host.runCommand(
        ['nmcli', 'connection', 'modify', nm.connection, prop, c.cidr],
        { timeoutMs: 15_000 },
      );
      if (mod.exitCode === 0) {
        notes.push(tl('notes.auto.t0030', { v0: (nm.connection), v1: (c.cidr) }));
        await input.host.runCommand(
          ['nmcli', 'connection', 'up', nm.connection],
          { timeoutMs: 45_000 },
        );
      } else {
        notes.push(
          tl('notes.auto.t0031', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 160)) }),
        );
      }
    } else {
      notes.push(tl('notes.auto.n1061'));
    }
  }

  const r = await input.host.runCommand(
    ['ip', 'addr', 'del', c.cidr, 'dev', input.ifname],
    { timeoutMs: 10_000 },
  );
  if (r.exitCode !== 0 && !notes.some((n) => n.includes(tl('notes.auto.n0777')))) {
    return {
      ok: false,
      notes: [
        ...notes,
        tl('notes.tpl.ipAddrDelFailed', { detail: (r.stderr || r.stdout || '').trim().slice(0, 240) || `exit ${r.exitCode}` }),
      ],
      ephemeral: true,
      ...base(input.host, input.ifname) };
  }
  if (r.exitCode === 0) notes.push(tl('notes.auto.t0032', { v0: (c.cidr), v1: (input.ifname) }));
  return {
    ok: true,
    notes: notes.length ? notes : [tl('notes.tpl.deleted', { name: c.cidr })],
    ephemeral: !input.persistent,
    persistent: Boolean(input.persistent),
    ...base(input.host, input.ifname) };
}

export async function networkSetLink(input: {
  host: HostExecutor;
  ifname: string;
  action?: 'up' | 'down';
  mtu?: number;
  /** required when down on default egress or any down */
  confirmName?: string;
  isDefaultEgress?: boolean;
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return { ...g, interface: input.ifname };

  if (!isValidIfName(input.ifname)) {
    return { ok: false, notes: [tl('notes.net.invalidIface')], ...base(input.host, input.ifname) };
  }
  if (input.ifname === 'lo' && input.action === 'down') {
    return {
      ok: false,
      notes: [tl('notes.auto.n0869')],
      ...base(input.host, input.ifname) };
  }

  const notes: string[] = [];

  if (input.action === 'down') {
    if (input.confirmName !== input.ifname) {
      return {
        ok: false,
        notes: [tl('notes.auto.n0101')],
        ...base(input.host, input.ifname) };
    }
    if (input.isDefaultEgress) {
      notes.push(tl('notes.auto.n1433'));
    }
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'down'],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      notes.push(
        tl('notes.auto.t0033', { v0: ((r.stderr || r.stdout || '').trim().slice(0, 200)) }),
      );
      return { ok: false, notes, ...base(input.host, input.ifname) };
    }
    notes.push(tl('notes.auto.t0034', { v0: (input.ifname) }));
  } else if (input.action === 'up') {
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'up'],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          tl('notes.auto.t0035', { v0: ((r.stderr || r.stdout || '').trim().slice(0, 200)) }),
        ],
        ...base(input.host, input.ifname) };
    }
    notes.push(tl('notes.auto.t0036', { v0: (input.ifname) }));
  }

  if (input.mtu != null) {
    const mtu = Math.floor(Number(input.mtu));
    if (!Number.isFinite(mtu) || mtu < 68 || mtu > 65535) {
      return {
        ok: false,
        notes: [...notes, tl('notes.auto.n0130')],
        ...base(input.host, input.ifname) };
    }
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'mtu', String(mtu)],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      notes.push(
        tl('notes.auto.t0037', { v0: ((r.stderr || r.stdout || '').trim().slice(0, 200)) }),
      );
      return { ok: false, notes, ...base(input.host, input.ifname) };
    }
    notes.push(`MTU → ${mtu}`);
  }

  if (!input.action && input.mtu == null) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1401')],
      ...base(input.host, input.ifname) };
  }

  return {
    ok: true,
    notes,
    ephemeral: true,
    ...base(input.host, input.ifname) };
}

/** Pick active NM connection (prefer device / default egress). */
async function resolveNmConnection(
  host: HostExecutor,
  device?: string,
): Promise<{ connection: string; device: string } | null> {
  const act = await host.runCommand(
    ['nmcli', '-t', '-f', 'NAME,DEVICE,TYPE', 'connection', 'show', '--active'],
    { timeoutMs: 5_000 },
  );
  if (act.exitCode !== 0) return null;
  const prefer = device?.trim();
  let picked: { connection: string; device: string } | null = null;
  for (const line of act.stdout.split('\n').filter(Boolean)) {
    const [name, dev, type] = line.split(':');
    if (!name || !dev) continue;
    if (type === 'loopback' || dev === 'lo') continue;
    if (type === 'bridge' && dev.startsWith('docker')) continue;
    if (prefer && dev === prefer) return { connection: name, device: dev };
    if (!picked) picked = { connection: name, device: dev };
  }
  return picked;
}

function isDefaultDst(dst: string): boolean {
  return dst === 'default' || dst === '0.0.0.0/0' || dst === '0.0.0.0';
}

function isBareIp(s: string): boolean {
  return isIP(s) !== 0 && !s.includes('/') && !s.includes(' ');
}

/**
 * Add route. persistent=true → NetworkManager connection (survives reboot).
 */
export async function networkAddRoute(input: {
  host: HostExecutor;
  dst: string;
  gateway?: string;
  dev?: string;
  confirmDefault?: boolean;
  /** Save to NM connection profile (reboot-safe) */
  persistent?: boolean;
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return g;

  const dst = input.dst.trim() || 'default';
  const isDef = isDefaultDst(dst);
  if (isDef && !input.confirmDefault) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1444')],
      ...base(input.host) };
  }
  if (input.dev && !isValidIfName(input.dev)) {
    return { ok: false, notes: [tl('notes.net.invalidDev')], ...base(input.host) };
  }
  const gw = input.gateway?.trim();
  if (gw && !isBareIp(gw)) {
    return { ok: false, notes: [tl('notes.auto.n0296')], ...base(input.host) };
  }

  // —— Persistent via NetworkManager ——
  if (input.persistent) {
    const nm = await resolveNmConnection(input.host, input.dev);
    if (!nm) {
      return {
        ok: false,
        blocked: true,
        blockMessage: tl('notes.net.needNmActive'),
        notes: [
          tl('notes.auto.n1001'),
        ],
        ...base(input.host) };
    }
    const notes: string[] = [];

    if (isDef) {
      if (!gw) {
        return {
          ok: false,
          notes: [tl('notes.auto.n0880')],
          ...base(input.host) };
      }
      const mod = await input.host.runCommand(
        [
          'nmcli',
          'connection',
          'modify',
          nm.connection,
          'ipv4.gateway',
          gw,
          'ipv4.never-default',
          'no',
        ],
        { timeoutMs: 15_000 },
      );
      if (mod.exitCode !== 0) {
        return {
          ok: false,
          notes: [
            tl('notes.auto.t0038', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 240)) }),
          ],
          ...base(input.host) };
      }
      notes.push(
        tl('notes.auto.t0039', { v0: (gw), v1: (nm.connection) }),
      );
    } else {
      // static route: "prefix[/len] [next-hop]"
      let routeSpec = dst;
      if (!routeSpec.includes('/') && isBareIp(routeSpec)) {
        routeSpec = `${routeSpec}/32`;
      }
      if (gw) routeSpec = `${routeSpec} ${gw}`;
      const mod = await input.host.runCommand(
        [
          'nmcli',
          'connection',
          'modify',
          nm.connection,
          '+ipv4.routes',
          routeSpec,
        ],
        { timeoutMs: 15_000 },
      );
      if (mod.exitCode !== 0) {
        return {
          ok: false,
          notes: [
            tl('notes.auto.t0040', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 240)) }),
          ],
          ...base(input.host) };
      }
      notes.push(
        tl('notes.auto.t0041', { v0: (routeSpec), v1: (nm.connection) }),
      );
    }

    const up = await input.host.runCommand(
      ['nmcli', 'connection', 'up', nm.connection],
      { timeoutMs: 45_000 },
    );
    if (up.exitCode !== 0) {
      notes.push(
        tl('notes.tpl.connUpWarn', { detail: (up.stderr || up.stdout || '').trim().slice(0, 200) || `exit ${up.exitCode}` }),
      );
      return {
        ok: false,
        notes: [...notes, tl('notes.auto.n1369')],
        persistent: true,
        ...base(input.host) };
    }
    notes.push(tl('notes.tpl.reenabledLink', { name: nm.connection }));
    return {
      ok: true,
      notes,
      persistent: true,
      ephemeral: false,
      ...base(input.host) };
  }

  // —— Ephemeral ip route ——
  const argv = ['ip', 'route', 'add', isDef ? 'default' : dst];
  if (gw) argv.push('via', gw);
  if (input.dev) argv.push('dev', input.dev);

  const r = await input.host.runCommand(argv, { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    return {
      ok: false,
      notes: [
        tl('notes.auto.t0042', { v0: ((r.stderr || r.stdout || '').trim().slice(0, 240)) }),
      ],
      ephemeral: true,
      ...base(input.host) };
  }
  return {
    ok: true,
    notes: [
      tl('notes.tpl.routeAdded', { dst, via: gw ? ` via ${gw}` : '', dev: input.dev ? ` dev ${input.dev}` : '' }),
    ],
    ephemeral: true,
    persistent: false,
    ...base(input.host) };
}

export async function networkDelRoute(input: {
  host: HostExecutor;
  dst: string;
  gateway?: string;
  dev?: string;
  confirmDefault?: boolean;
  /** Also remove from NM profile when possible */
  persistent?: boolean;
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return g;

  const dst = input.dst.trim() || 'default';
  const isDef = isDefaultDst(dst);
  if (isDef && !input.confirmDefault) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0600')],
      ...base(input.host) };
  }
  const notes: string[] = [];
  const gw = input.gateway?.trim();

  if (input.persistent) {
    const nm = await resolveNmConnection(input.host, input.dev);
    if (nm) {
      if (isDef) {
        const mod = await input.host.runCommand(
          [
            'nmcli',
            'connection',
            'modify',
            nm.connection,
            'ipv4.gateway',
            '',
          ],
          { timeoutMs: 15_000 },
        );
        if (mod.exitCode === 0) {
          notes.push(tl('notes.auto.t0045', { v0: (nm.connection) }));
          await input.host.runCommand(
            ['nmcli', 'connection', 'up', nm.connection],
            { timeoutMs: 45_000 },
          );
        } else {
          notes.push(
            tl('notes.auto.t0046', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 160)) }),
          );
        }
      } else {
        let routeSpec = dst;
        if (!routeSpec.includes('/') && isBareIp(routeSpec)) {
          routeSpec = `${routeSpec}/32`;
        }
        if (gw) routeSpec = `${routeSpec} ${gw}`;
        const mod = await input.host.runCommand(
          [
            'nmcli',
            'connection',
            'modify',
            nm.connection,
            '-ipv4.routes',
            routeSpec,
          ],
          { timeoutMs: 15_000 },
        );
        if (mod.exitCode === 0) {
          notes.push(tl('notes.auto.t0047', { v0: (nm.connection), v1: (routeSpec) }));
          await input.host.runCommand(
            ['nmcli', 'connection', 'up', nm.connection],
            { timeoutMs: 45_000 },
          );
        } else {
          notes.push(
            tl('notes.auto.t0048', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 160)) }),
          );
        }
      }
    } else {
      notes.push(tl('notes.auto.n1062'));
    }
  }

  const argv = ['ip', 'route', 'del', isDef ? 'default' : dst];
  if (gw) argv.push('via', gw);
  if (input.dev) {
    if (!isValidIfName(input.dev)) {
      return { ok: false, notes: [tl('notes.net.invalidDev')], ...base(input.host) };
    }
    argv.push('dev', input.dev);
  }
  const r = await input.host.runCommand(argv, { timeoutMs: 10_000 });
  if (r.exitCode !== 0 && !notes.some((n) => n.includes(tl('notes.auto.n0774')))) {
    return {
      ok: false,
      notes: [
        ...notes,
        tl('notes.auto.t0049', { v0: ((r.stderr || r.stdout || '').trim().slice(0, 240)) }),
      ],
      ephemeral: true,
      ...base(input.host) };
  }
  if (r.exitCode === 0) notes.push(tl('notes.auto.t0050', { v0: (dst) }));
  return {
    ok: true,
    notes: notes.length ? notes : [tl('notes.auto.t0051', { v0: (dst) })],
    ephemeral: !input.persistent,
    persistent: Boolean(input.persistent),
    ...base(input.host) };
}

function validateDnsList(list: string[]): { ok: true; servers: string[] } | { ok: false; reason: string } {
  const servers: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    if (s.includes('%') || s.includes('/')) {
      return { ok: false, reason: tl('notes.auto.t0052', { v0: (s) }) };
    }
    if (isIP(s) === 0) {
      return { ok: false, reason: tl('notes.auto.t0053', { v0: (s) }) };
    }
    if (!servers.includes(s)) servers.push(s);
  }
  if (servers.length > 8) {
    return { ok: false, reason: tl('notes.auto.n0932') };
  }
  return { ok: true, servers };
}

/**
 * Set IPv4 DNS on active NetworkManager connection (persistent) + re-up.
 * mode=dhcp restores auto DNS from DHCP.
 */
export async function networkSetDns(input: {
  host: HostExecutor;
  /** Explicit servers; empty + mode dhcp clears static DNS */
  nameservers?: string[];
  search?: string[];
  /** nm connection id; auto-detect if omitted */
  connection?: string;
  /** Prefer device when auto-picking connection */
  device?: string;
  /**
   * static = set ipv4.dns + ignore-auto-dns yes
   * dhcp = clear ipv4.dns + ignore-auto-dns no
   */
  mode?: 'static' | 'dhcp';
}): Promise<NetApplyResult> {
  const g = gate(input.host);
  if (g) return g;

  const notes: string[] = [];
  const mode = input.mode ?? 'static';

  // Resolve connection name
  let conn = input.connection?.trim() || '';
  if (!conn) {
    const act = await input.host.runCommand(
      ['nmcli', '-t', '-f', 'NAME,DEVICE,TYPE', 'connection', 'show', '--active'],
      { timeoutMs: 5_000 },
    );
    if (act.exitCode !== 0) {
      return {
        ok: false,
        blocked: true,
        blockMessage: tl('notes.auto.n0137'),
        notes: [tl('notes.auto.n1538')],
        ...base(input.host) };
    }
    const prefer = input.device?.trim();
    for (const line of act.stdout.split('\n').filter(Boolean)) {
      const [name, dev, type] = line.split(':');
      if (!name || !dev) continue;
      if (type === 'loopback' || dev === 'lo') continue;
      if (type === 'bridge' && dev.startsWith('docker')) continue;
      if (prefer && dev === prefer) {
        conn = name;
        break;
      }
      if (!conn) conn = name;
    }
  }
  if (!conn) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0859')],
      ...base(input.host) };
  }

  if (mode === 'dhcp') {
    const mod = await input.host.runCommand(
      [
        'nmcli',
        'connection',
        'modify',
        conn,
        'ipv4.dns',
        '',
        'ipv4.dns-search',
        '',
        'ipv4.ignore-auto-dns',
        'no',
      ],
      { timeoutMs: 15_000 },
    );
    if (mod.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          tl('notes.auto.t0054', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 240)) }),
        ],
        ...base(input.host) };
    }
    notes.push(tl('notes.auto.t0055', { v0: (conn) }));
  } else {
    const v = validateDnsList(input.nameservers ?? []);
    if (!v.ok) {
      return { ok: false, notes: [v.reason], ...base(input.host) };
    }
    if (!v.servers.length) {
      return {
        ok: false,
        notes: [tl('notes.auto.n1425')],
        ...base(input.host) };
    }
    const search = (input.search ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    const mod = await input.host.runCommand(
      [
        'nmcli',
        'connection',
        'modify',
        conn,
        'ipv4.dns',
        v.servers.join(' '),
        'ipv4.dns-search',
        search.join(' '),
        'ipv4.ignore-auto-dns',
        'yes',
      ],
      { timeoutMs: 15_000 },
    );
    if (mod.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          tl('notes.auto.t0056', { v0: ((mod.stderr || mod.stdout || '').trim().slice(0, 240)) }),
        ],
        ...base(input.host) };
    }
    notes.push(
      tl('notes.tpl.dnsWritten', {
        conn,
        dns: v.servers.join(', '),
        search: search.length ? ` · search ${search.join(' ')}` : '',
      }),
    );
  }

  const up = await input.host.runCommand(
    ['nmcli', 'connection', 'up', conn],
    { timeoutMs: 45_000 },
  );
  if (up.exitCode !== 0) {
    notes.push(
      tl('notes.tpl.connUpWarn', { detail: (up.stderr || up.stdout || '').trim().slice(0, 200) || `exit ${up.exitCode}` }),
    );
    // still partial success if modify ok
    return {
      ok: false,
      notes: [...notes, tl('notes.auto.n1370')],
      persistent: true,
      ...base(input.host) };
  }
  notes.push(tl('notes.tpl.reenabledLink', { name: conn }));
  return {
    ok: true,
    notes,
    persistent: true,
    ephemeral: false,
    ...base(input.host) };
}

/** Resolve a name via getent — honest connectivity check */
export async function networkTestDns(input: {
  host: HostExecutor;
  name?: string;
}): Promise<NetApplyResult & { answers?: string[] }> {
  // read-only — no execute gate
  const name = (input.name || 'example.com').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name || name.length > 253) {
    return { ok: false, notes: [tl('notes.auto.n1005')], ...base(input.host) };
  }
  const r = await input.host.runCommand(
    ['getent', 'ahosts', name],
    { timeoutMs: 8_000 },
  );
  if (r.exitCode !== 0) {
    return {
      ok: false,
      notes: [
        tl('notes.auto.t0058', { v0: (name) }),
        (r.stderr || r.stdout || '').trim().slice(0, 200) || `exit ${r.exitCode}`,
      ],
      ...base(input.host) };
  }
  const answers = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  return {
    ok: answers.length > 0,
    notes: answers.length
      ? [tl('notes.auto.t0059', { v0: (name), v1: (answers.length) })]
      : [tl('notes.auto.t0060', { v0: (name) })],
    answers,
    ...base(input.host) };
}
