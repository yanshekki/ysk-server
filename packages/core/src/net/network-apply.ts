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
      blockMessage: '無法變更網路：需要系統變更權限（YSK_EXECUTE）與 root',
      notes: ['需要 YSK_EXECUTE=1 與 root'],
      executeEnabled,
      isRoot,
    };
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
    interface: iface,
  };
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
      notes: ['介面名稱無效'],
      ...base(input.host, input.ifname),
    };
  }
  if (input.ifname === 'lo') {
    return {
      ok: false,
      notes: ['拒絕修改 loopback 位址（保護）'],
      ...base(input.host, input.ifname),
    };
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
        blockMessage: '無法持久化：需要 NetworkManager 作用中連線',
        notes: [
          '本機無對應 NM 連線；唔會假成功。可改「僅即時」或啟用 NetworkManager。',
        ],
        ...base(input.host, input.ifname),
      };
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
          `nmcli 寫入地址失敗：${(mod.stderr || mod.stdout || '').trim().slice(0, 240)}`,
        ],
        ...base(input.host, input.ifname),
      };
    }
    notes.push(`已保存 ${c.cidr} → 連線「${nm.connection}」`);
    const up = await input.host.runCommand(
      ['nmcli', 'connection', 'up', nm.connection],
      { timeoutMs: 45_000 },
    );
    if (up.exitCode !== 0) {
      // still try live add so address may appear
      notes.push(
        `connection up 警告：${(up.stderr || up.stdout || '').trim().slice(0, 160)}`,
      );
      const live = await input.host.runCommand(
        ['ip', 'addr', 'add', c.cidr, 'dev', input.ifname],
        { timeoutMs: 10_000 },
      );
      if (live.exitCode === 0) {
        notes.push('已即時 ip addr add（設定檔已寫入，重開應仍在）');
        return {
          ok: true,
          notes,
          persistent: true,
          ephemeral: true,
          ...base(input.host, input.ifname),
        };
      }
      return {
        ok: false,
        notes: [...notes, '設定已寫入但套用失敗'],
        persistent: true,
        ...base(input.host, input.ifname),
      };
    }
    notes.push(`已重新啟用連線（重開仍在）`);
    return {
      ok: true,
      notes,
      persistent: true,
      ephemeral: false,
      ...base(input.host, input.ifname),
    };
  }

  const r = await input.host.runCommand(
    ['ip', 'addr', 'add', c.cidr, 'dev', input.ifname],
    { timeoutMs: 10_000 },
  );
  if (r.exitCode !== 0) {
    const err = (r.stderr || r.stdout || '').trim().slice(0, 240);
    notes.push(`ip addr add 失敗：${err || `exit ${r.exitCode}`}`);
    return {
      ok: false,
      notes,
      ephemeral: true,
      ...base(input.host, input.ifname),
    };
  }
  notes.push(`已新增 ${c.cidr} → ${input.ifname}（即時；重開可能消失）`);
  return {
    ok: true,
    notes,
    ephemeral: true,
    persistent: false,
    ...base(input.host, input.ifname),
  };
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
    return { ok: false, notes: ['介面名稱無效'], ...base(input.host, input.ifname) };
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
      notes: ['拒絕刪除 loopback 核心地址'],
      ...base(input.host, input.ifname),
    };
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
        notes.push(`已從連線「${nm.connection}」移除 ${c.cidr}`);
        await input.host.runCommand(
          ['nmcli', 'connection', 'up', nm.connection],
          { timeoutMs: 45_000 },
        );
      } else {
        notes.push(
          `NM 移除地址：${(mod.stderr || mod.stdout || '').trim().slice(0, 160)}`,
        );
      }
    } else {
      notes.push('無 NM 連線可改；僅刪即時地址');
    }
  }

  const r = await input.host.runCommand(
    ['ip', 'addr', 'del', c.cidr, 'dev', input.ifname],
    { timeoutMs: 10_000 },
  );
  if (r.exitCode !== 0 && !notes.some((n) => n.includes('已從連線'))) {
    return {
      ok: false,
      notes: [
        ...notes,
        `ip addr del 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 240) || `exit ${r.exitCode}`}`,
      ],
      ephemeral: true,
      ...base(input.host, input.ifname),
    };
  }
  if (r.exitCode === 0) notes.push(`已刪除即時 ${c.cidr} ← ${input.ifname}`);
  return {
    ok: true,
    notes: notes.length ? notes : [`已刪除 ${c.cidr}`],
    ephemeral: !input.persistent,
    persistent: Boolean(input.persistent),
    ...base(input.host, input.ifname),
  };
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
    return { ok: false, notes: ['介面名稱無效'], ...base(input.host, input.ifname) };
  }
  if (input.ifname === 'lo' && input.action === 'down') {
    return {
      ok: false,
      notes: ['拒絕 down loopback'],
      ...base(input.host, input.ifname),
    };
  }

  const notes: string[] = [];

  if (input.action === 'down') {
    if (input.confirmName !== input.ifname) {
      return {
        ok: false,
        notes: ['Down 需 confirmName 等於介面名'],
        ...base(input.host, input.ifname),
      };
    }
    if (input.isDefaultEgress) {
      notes.push('警告：此介面為預設路由出口，down 可能令面板斷線');
    }
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'down'],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      notes.push(
        `link down 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 200)}`,
      );
      return { ok: false, notes, ...base(input.host, input.ifname) };
    }
    notes.push(`已 down ${input.ifname}`);
  } else if (input.action === 'up') {
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'up'],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      return {
        ok: false,
        notes: [
          `link up 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 200)}`,
        ],
        ...base(input.host, input.ifname),
      };
    }
    notes.push(`已 up ${input.ifname}`);
  }

  if (input.mtu != null) {
    const mtu = Math.floor(Number(input.mtu));
    if (!Number.isFinite(mtu) || mtu < 68 || mtu > 65535) {
      return {
        ok: false,
        notes: [...notes, 'MTU 須在 68–65535'],
        ...base(input.host, input.ifname),
      };
    }
    const r = await input.host.runCommand(
      ['ip', 'link', 'set', 'dev', input.ifname, 'mtu', String(mtu)],
      { timeoutMs: 10_000 },
    );
    if (r.exitCode !== 0) {
      notes.push(
        `設 MTU 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 200)}`,
      );
      return { ok: false, notes, ...base(input.host, input.ifname) };
    }
    notes.push(`MTU → ${mtu}`);
  }

  if (!input.action && input.mtu == null) {
    return {
      ok: false,
      notes: ['請指定 action 或 mtu'],
      ...base(input.host, input.ifname),
    };
  }

  return {
    ok: true,
    notes,
    ephemeral: true,
    ...base(input.host, input.ifname),
  };
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
      notes: ['變更 default 路由需 confirmDefault: true'],
      ...base(input.host),
    };
  }
  if (input.dev && !isValidIfName(input.dev)) {
    return { ok: false, notes: ['dev 名稱無效'], ...base(input.host) };
  }
  const gw = input.gateway?.trim();
  if (gw && !isBareIp(gw)) {
    return { ok: false, notes: ['gateway 須為純 IP'], ...base(input.host) };
  }

  // —— Persistent via NetworkManager ——
  if (input.persistent) {
    const nm = await resolveNmConnection(input.host, input.dev);
    if (!nm) {
      return {
        ok: false,
        blocked: true,
        blockMessage: '無法持久化：需要 NetworkManager 作用中連線',
        notes: [
          '本機無可用 NM 連線；唔會假成功。可改用「僅即時」或啟用 NetworkManager。',
        ],
        ...base(input.host),
      };
    }
    const notes: string[] = [];

    if (isDef) {
      if (!gw) {
        return {
          ok: false,
          notes: ['持久 default 路由需要 Gateway'],
          ...base(input.host),
        };
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
            `nmcli 寫入 gateway 失敗：${(mod.stderr || mod.stdout || '').trim().slice(0, 240)}`,
          ],
          ...base(input.host),
        };
      }
      notes.push(
        `已保存 default gateway ${gw} → 連線「${nm.connection}」（重開仍在）`,
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
            `nmcli 寫入 routes 失敗：${(mod.stderr || mod.stdout || '').trim().slice(0, 240)}`,
          ],
          ...base(input.host),
        };
      }
      notes.push(
        `已保存靜態路由 ${routeSpec} →「${nm.connection}」（重開仍在）`,
      );
    }

    const up = await input.host.runCommand(
      ['nmcli', 'connection', 'up', nm.connection],
      { timeoutMs: 45_000 },
    );
    if (up.exitCode !== 0) {
      notes.push(
        `connection up 警告：${(up.stderr || up.stdout || '').trim().slice(0, 200) || `exit ${up.exitCode}`}`,
      );
      return {
        ok: false,
        notes: [...notes, '設定已寫入連線但重啟失敗；請手動 nmcli connection up'],
        persistent: true,
        ...base(input.host),
      };
    }
    notes.push(`已重新啟用連線 ${nm.connection}`);
    return {
      ok: true,
      notes,
      persistent: true,
      ephemeral: false,
      ...base(input.host),
    };
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
        `ip route add 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 240)}`,
      ],
      ephemeral: true,
      ...base(input.host),
    };
  }
  return {
    ok: true,
    notes: [
      `已加即時路由 ${dst}${gw ? ` via ${gw}` : ''}${input.dev ? ` dev ${input.dev}` : ''}（重開可能消失；要持久請用「保存」）`,
    ],
    ephemeral: true,
    persistent: false,
    ...base(input.host),
  };
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
      notes: ['刪除 default 路由需 confirmDefault: true'],
      ...base(input.host),
    };
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
          notes.push(`已從連線「${nm.connection}」清除 ipv4.gateway`);
          await input.host.runCommand(
            ['nmcli', 'connection', 'up', nm.connection],
            { timeoutMs: 45_000 },
          );
        } else {
          notes.push(
            `NM 清除 gateway：${(mod.stderr || mod.stdout || '').trim().slice(0, 160)}`,
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
          notes.push(`已從「${nm.connection}」移除路由 ${routeSpec}`);
          await input.host.runCommand(
            ['nmcli', 'connection', 'up', nm.connection],
            { timeoutMs: 45_000 },
          );
        } else {
          notes.push(
            `NM 移除 routes：${(mod.stderr || mod.stdout || '').trim().slice(0, 160)}`,
          );
        }
      }
    } else {
      notes.push('無 NM 連線可改；僅刪即時路由');
    }
  }

  const argv = ['ip', 'route', 'del', isDef ? 'default' : dst];
  if (gw) argv.push('via', gw);
  if (input.dev) {
    if (!isValidIfName(input.dev)) {
      return { ok: false, notes: ['dev 名稱無效'], ...base(input.host) };
    }
    argv.push('dev', input.dev);
  }
  const r = await input.host.runCommand(argv, { timeoutMs: 10_000 });
  if (r.exitCode !== 0 && !notes.some((n) => n.includes('已從'))) {
    return {
      ok: false,
      notes: [
        ...notes,
        `ip route del 失敗：${(r.stderr || r.stdout || '').trim().slice(0, 240)}`,
      ],
      ephemeral: true,
      ...base(input.host),
    };
  }
  if (r.exitCode === 0) notes.push(`已刪即時路由 ${dst}`);
  return {
    ok: true,
    notes: notes.length ? notes : [`已刪路由 ${dst}`],
    ephemeral: !input.persistent,
    persistent: Boolean(input.persistent),
    ...base(input.host),
  };
}

function validateDnsList(list: string[]): { ok: true; servers: string[] } | { ok: false; reason: string } {
  const servers: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    if (s.includes('%') || s.includes('/')) {
      return { ok: false, reason: `DNS 無效：${s}` };
    }
    if (isIP(s) === 0) {
      return { ok: false, reason: `DNS 不是合法 IP：${s}` };
    }
    if (!servers.includes(s)) servers.push(s);
  }
  if (servers.length > 8) {
    return { ok: false, reason: '最多 8 個 nameserver' };
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
        blockMessage: 'NetworkManager 不可用，無法寫入 DNS',
        notes: ['需 NetworkManager active 才能持久改 DNS（唔會盲寫 /etc/resolv.conf）'],
        ...base(input.host),
      };
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
      notes: ['找不到可用的 NetworkManager 連線'],
      ...base(input.host),
    };
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
          `nmcli modify 失敗：${(mod.stderr || mod.stdout || '').trim().slice(0, 240)}`,
        ],
        ...base(input.host),
      };
    }
    notes.push(`已還原 ${conn} 使用 DHCP DNS（ignore-auto-dns=no）`);
  } else {
    const v = validateDnsList(input.nameservers ?? []);
    if (!v.ok) {
      return { ok: false, notes: [v.reason], ...base(input.host) };
    }
    if (!v.servers.length) {
      return {
        ok: false,
        notes: ['請至少填一個 nameserver，或選「還原 DHCP DNS」'],
        ...base(input.host),
      };
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
          `nmcli modify 失敗：${(mod.stderr || mod.stdout || '').trim().slice(0, 240)}`,
        ],
        ...base(input.host),
      };
    }
    notes.push(
      `已寫入 ${conn}：DNS ${v.servers.join(', ')}${search.length ? ` · search ${search.join(' ')}` : ''}`,
    );
  }

  const up = await input.host.runCommand(
    ['nmcli', 'connection', 'up', conn],
    { timeoutMs: 45_000 },
  );
  if (up.exitCode !== 0) {
    notes.push(
      `connection up 警告：${(up.stderr || up.stdout || '').trim().slice(0, 200) || `exit ${up.exitCode}`}`,
    );
    // still partial success if modify ok
    return {
      ok: false,
      notes: [...notes, '設定已寫入連線但重新啟用失敗，請手動 nmcli connection up'],
      persistent: true,
      ...base(input.host),
    };
  }
  notes.push(`已重新啟用連線 ${conn}`);
  return {
    ok: true,
    notes,
    persistent: true,
    ephemeral: false,
    ...base(input.host),
  };
}

/** Resolve a name via getent — honest connectivity check */
export async function networkTestDns(input: {
  host: HostExecutor;
  name?: string;
}): Promise<NetApplyResult & { answers?: string[] }> {
  // read-only — no execute gate
  const name = (input.name || 'example.com').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name || name.length > 253) {
    return { ok: false, notes: ['查詢名稱無效'], ...base(input.host) };
  }
  const r = await input.host.runCommand(
    ['getent', 'ahosts', name],
    { timeoutMs: 8_000 },
  );
  if (r.exitCode !== 0) {
    return {
      ok: false,
      notes: [
        `解析失敗：${name}`,
        (r.stderr || r.stdout || '').trim().slice(0, 200) || `exit ${r.exitCode}`,
      ],
      ...base(input.host),
    };
  }
  const answers = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  return {
    ok: answers.length > 0,
    notes: answers.length
      ? [`${name} → ${answers.length} 筆`]
      : [`${name} 無結果`],
    answers,
    ...base(input.host),
  };
}
