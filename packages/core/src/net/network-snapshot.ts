import { tl } from 'ysk-server-shared';
/**
 * Collect host network snapshot via iproute2 + resolv (honest).
 */

import type { HostExecutor } from '../host/executor.js';
import {
  mergeLinkStats,
  parseIpAddrJson,
  parseIpRouteJson,
  parseResolvConf,
} from './network-parse.js';
import type { NetworkSnapshot, NetBackend } from './network-types.js';

async function unitState(
  host: HostExecutor,
  unit: string,
): Promise<'active' | 'inactive' | 'unknown'> {
  try {
    const r = await host.runCommand(['systemctl', 'is-active', unit], {
      timeoutMs: 4_000,
    });
    const t = r.stdout.trim();
    if (t === 'active') return 'active';
    if (t === 'inactive' || t === 'failed' || t === 'dead') return 'inactive';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function collectNetworkSnapshot(
  host: HostExecutor,
  opts?: { includeRaw?: boolean },
): Promise<NetworkSnapshot> {
  const notes: string[] = [];
  const at = new Date().toISOString();
  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();

  const backend: NetBackend = {
    hasIp: false,
    networkManager: 'unknown',
    networkd: 'unknown',
    canPersist: false,
  };

  const [nm, nd] = await Promise.all([
    unitState(host, 'NetworkManager'),
    unitState(host, 'systemd-networkd'),
  ]);
  backend.networkManager = nm;
  backend.networkd = nd;
  backend.canPersist = nm === 'active';

  const addrR = await host.runCommand(['ip', '-j', 'addr'], { timeoutMs: 8_000 });
  let interfaces = parseIpAddrJson(addrR.stdout);
  if (addrR.exitCode === 0 && interfaces.length) {
    backend.hasIp = true;
  } else {
    notes.push(
      addrR.exitCode !== 0
        ? tl('notes.auto.t0023', { v0: ((addrR.stderr || addrR.stdout).slice(0, 160)) })
        : tl('notes.auto.n0309'),
    );
    // fallback: try non-json
    const plain = await host.runCommand(['ip', 'addr'], { timeoutMs: 8_000 });
    if (plain.exitCode === 0 && plain.stdout.trim()) {
      notes.push(tl('notes.auto.n0995'));
      backend.hasIp = true;
    }
  }

  const linkR = await host.runCommand(['ip', '-j', '-s', 'link'], {
    timeoutMs: 8_000,
  });
  if (linkR.exitCode === 0) {
    interfaces = mergeLinkStats(interfaces, linkR.stdout);
  }

  const routeR = await host.runCommand(['ip', '-j', 'route'], { timeoutMs: 8_000 });
  let routes = routeR.exitCode === 0 ? parseIpRouteJson(routeR.stdout) : [];
  if (routeR.exitCode !== 0) {
    notes.push(tl('notes.auto.t0024', { v0: ((routeR.stderr || '').slice(0, 120)) }));
  }

  const def = routes.find((r) => r.dst === 'default' || r.dst === '0.0.0.0/0');
  if (def?.dev) {
    interfaces = interfaces.map((i) =>
      i.name === def.dev ? { ...i, isDefaultEgress: true } : i,
    );
  }

  // DNS — prefer uplink (NM / resolvectl), filter stub 127.0.0.53 for UI
  const stubServers: string[] = [];
  let search: string[] = [];
  let source = 'none';
  let mode: 'networkmanager' | 'resolved' | 'static' | 'unknown' = 'unknown';
  let connection: string | undefined;
  let device: string | undefined = def?.dev;
  let ignoreAutoDns: boolean | null = null;
  const uplinkServers: string[] = [];
  const dnsNotes: string[] = [];

  const resolv = await host.runCommand(['cat', '/etc/resolv.conf'], {
    timeoutMs: 3_000,
  });
  if (resolv.exitCode === 0) {
    const p = parseResolvConf(resolv.stdout);
    stubServers.push(...p.nameservers);
    search = p.search.filter((s) => s && s !== '.');
    source = '/etc/resolv.conf';
    if (resolv.stdout.includes('systemd-resolved')) {
      source = 'systemd-resolved (stub via resolv.conf)';
      mode = 'resolved';
    } else {
      mode = 'static';
    }
  } else {
    notes.push(tl('notes.auto.n1182'));
  }

  // resolvectl per-link DNS (uplink)
  const rv = await host.runCommand(
    ['bash', '-c', 'resolvectl status 2>/dev/null | head -n 120'],
    { timeoutMs: 5_000 },
  );
  if (rv.exitCode === 0 && rv.stdout.trim()) {
    mode = mode === 'static' ? 'resolved' : mode === 'unknown' ? 'resolved' : mode;
    // Current DNS Server: x / DNS Servers: a b
    for (const line of rv.stdout.split('\n')) {
      const m = line.match(/DNS Servers:\s*(.+)$/i);
      const c = line.match(/Current DNS Server:\s*(\S+)/i);
      if (c?.[1] && !isStubDns(c[1])) pushUnique(uplinkServers, c[1]);
      if (m?.[1]) {
        for (const tok of m[1].split(/\s+/)) {
          if (looksLikeIp(tok) && !isStubDns(tok)) pushUnique(uplinkServers, tok);
        }
      }
    }
  }

  // NetworkManager active connection + configured DNS
  if (backend.networkManager === 'active') {
    mode = 'networkmanager';
    const act = await host.runCommand(
      ['nmcli', '-t', '-f', 'NAME,DEVICE,TYPE', 'connection', 'show', '--active'],
      { timeoutMs: 5_000 },
    );
    if (act.exitCode === 0) {
      const preferDev = def?.dev;
      let picked: { name: string; dev: string } | null = null;
      for (const line of act.stdout.split('\n').filter(Boolean)) {
        const [name, dev, type] = line.split(':');
        if (!name || !dev) continue;
        if (type === 'loopback' || dev === 'lo') continue;
        if (type === 'bridge' && dev.startsWith('docker')) continue;
        if (preferDev && dev === preferDev) {
          picked = { name, dev };
          break;
        }
        if (!picked) picked = { name, dev };
      }
      if (picked) {
        connection = picked.name;
        device = picked.dev;
        const show = await host.runCommand(
          [
            'nmcli',
            '-g',
            'ipv4.dns,ipv4.dns-search,ipv4.ignore-auto-dns,ipv4.method',
            'connection',
            'show',
            picked.name,
          ],
          { timeoutMs: 5_000 },
        );
        if (show.exitCode === 0) {
          // nmcli -g with multiple props: one value per line
          const lines = show.stdout.split('\n').map((l) => l.trim());
          const dnsLine = lines[0] ?? '';
          const searchLine = lines[1] ?? '';
          const ignoreLine = (lines[2] ?? '').toLowerCase();
          if (dnsLine) {
            for (const tok of dnsLine.split(/[,\s]+/).filter(Boolean)) {
              if (looksLikeIp(tok)) pushUnique(uplinkServers, tok);
            }
          }
          if (searchLine && !search.length) {
            search = searchLine.split(/[,\s]+/).filter(Boolean);
          }
          if (ignoreLine === 'yes' || ignoreLine === 'true') ignoreAutoDns = true;
          else if (ignoreLine === 'no' || ignoreLine === 'false') ignoreAutoDns = false;
          source = `NetworkManager · ${picked.name} (${picked.dev})`;
        }
        // device DNS (what is actually used, includes DHCP)
        const devDns = await host.runCommand(
          ['nmcli', '-g', 'IP4.DNS', 'device', 'show', picked.dev],
          { timeoutMs: 4_000 },
        );
        if (devDns.exitCode === 0 && devDns.stdout.trim()) {
          for (const tok of devDns.stdout.split(/[|\n,\s]+/).filter(Boolean)) {
            if (looksLikeIp(tok) && !isStubDns(tok)) pushUnique(uplinkServers, tok);
          }
        }
      }
    }
  }

  let nameservers =
    uplinkServers.length > 0
      ? [...uplinkServers]
      : stubServers.filter((s) => !isStubDns(s));
  if (!nameservers.length && stubServers.length) {
    // only stub left
    nameservers = [...stubServers];
    dnsNotes.push(tl('notes.auto.n0574'));
  }
  if (!nameservers.length) dnsNotes.push(tl('notes.auto.n1082'));

  const canApplyDns = backend.networkManager === 'active' && Boolean(connection);

  const raw =
    opts?.includeRaw
      ? {
          addr: (await host.runCommand(['ip', 'addr'], { timeoutMs: 5_000 })).stdout
            .slice(0, 8000),
          route: (await host.runCommand(['ip', 'route'], { timeoutMs: 5_000 })).stdout
            .slice(0, 4000),
        }
      : undefined;

  const ok = interfaces.length > 0 || routes.length > 0;

  return {
    ok,
    at,
    interfaces,
    routes,
    dns: {
      nameservers,
      search,
      source,
      notes: dnsNotes,
      mode,
      canApply: canApplyDns,
      connection,
      device,
      stubServers,
      uplinkServers,
      ignoreAutoDns,
      gatewayDns: def?.gateway,
    },
    backend,
    caps: {
      executeEnabled,
      isRoot,
      canMutate: executeEnabled && isRoot,
    },
    defaultGateway: def?.gateway,
    defaultDev: def?.dev,
    notes,
    raw,
  };
}

function isStubDns(ip: string): boolean {
  return ip === '127.0.0.53' || ip === '127.0.0.1' || ip === '::1';
}

function looksLikeIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(':') && !s.includes(' '));
}

function pushUnique(arr: string[], v: string): void {
  if (!arr.includes(v)) arr.push(v);
}
