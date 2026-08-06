/**
 * PowerDNS dual-mode: probe tools + optional load of managed BIND zone files.
 * Never fakes success — load needs YSK_EXECUTE + pdnsutil (or documented refuse).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { listManagedDnsZones, writeManagedDnsZone } from './dns-zone.js';
import { resolveBin, shellBinExists } from './software-probe/index.js';

export interface PowerDnsProbe {
  pdnsutil?: string;
  pdnsControl?: string;
  pdnsServer?: string;
  available: boolean;
  notes: string[];
}

export interface PowerDnsLoadResult {
  ok: boolean;
  zone: string;
  zonePath: string;
  mode: 'plan' | 'loaded' | 'refused';
  notes: string[];
  written: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
  probe: PowerDnsProbe;
}

/**
 * Detect PowerDNS CLI tools on PATH.
 */
export async function probePowerDns(host: HostExecutor): Promise<PowerDnsProbe> {
  const notes: string[] = [];
  const find = async (bin: string) => {
    const p = await resolveBin(host, bin);
    return p || undefined;
  };
  // Prefer catalog presence for server; CLI tools via unified resolveBin
  const pdnsutil = await find('pdnsutil');
  const pdnsControl = await find('pdns_control');
  const pdnsServer = await find('pdns_server');
  if (pdnsutil) notes.push(`pdnsutil: ${pdnsutil}`);
  if (pdnsControl) notes.push(`pdns_control: ${pdnsControl}`);
  if (pdnsServer) notes.push(`pdns_server: ${pdnsServer}`);
  if (!pdnsutil && !pdnsControl) {
    notes.push(tl('notes.auto.n0846'));
  }
  return {
    pdnsutil,
    pdnsControl,
    pdnsServer,
    available: Boolean(pdnsutil || pdnsControl),
    notes,
  };
}

/**
 * Ensure managed zone file exists, then optionally load via pdnsutil.
 *
 * Preferred load command:
 *   pdnsutil load-zone <zone> <zonefile>
 * Fallback note when only pdns_control present.
 */
export async function applyPowerDnsZone(input: {
  dataDir: string;
  host: HostExecutor;
  zone: string;
  serverIp: string;
  /** Optional public IPv6 for dual-stack zone */
  serverIpv6?: string;
  mailHost?: string;
  /** When true, attempt pdnsutil load-zone (needs EXECUTE) */
  load?: boolean;
  /** Rewrite zone file first (default true) */
  rewriteZone?: boolean;
}): Promise<PowerDnsLoadResult> {
  const zone = input.zone.trim().toLowerCase().replace(/\.$/, '');
  if (!zone) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1391'), { httpStatus: 400 });
  }

  const notes: string[] = [];
  const written: string[] = [];
  const commandResults: PowerDnsLoadResult['commandResults'] = [];
  const probe = await probePowerDns(input.host);
  notes.push(...probe.notes);

  let zonePath = join(input.dataDir, 'dns', 'zones', `${zone}.zone`);
  if (input.rewriteZone !== false || !existsSync(zonePath)) {
    const w = await writeManagedDnsZone({
      dataDir: input.dataDir,
      zone,
      serverIp: input.serverIp,
      serverIpv6: input.serverIpv6,
      mailHost: input.mailHost,
      host: input.host,
      validate: false,
    });
    zonePath = w.zonePath;
    written.push(...w.written);
    notes.push(...w.notes.filter((n) => !notes.includes(n)));
  } else {
    notes.push(`Using existing zone file: ${zonePath}`);
  }

  if (!existsSync(zonePath)) {
    return {
      ok: false,
      zone,
      zonePath,
      mode: 'refused',
      notes: [...notes, 'Zone file missing'],
      written,
      commandResults,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      probe,
    };
  }

  // Always write a load helper script for operators
  const helperDir = join(input.dataDir, 'dns', 'powerdns');
  const helper = join(helperDir, `load-${zone}.sh`);
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(
    helper,
    [
      '#!/usr/bin/env bash',
      `# YSK Server — load zone ${zone} into PowerDNS`,
      'set -euo pipefail',
      `ZONE=${JSON.stringify(zone)}`,
      `FILE=${JSON.stringify(zonePath)}`,
      `if ${shellBinExists('pdnsutil')}; then`,
      '  pdnsutil load-zone "$ZONE" "$FILE"',
      '  pdnsutil rectify-zone "$ZONE" || true',
      '  echo "loaded $ZONE"',
      'else',
      tl('notes.auto.n0052'),
      '  exit 1',
      'fi',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(helper);
  notes.push(`Helper script: ${helper}`);

  const wantLoad = Boolean(input.load);
  if (!wantLoad) {
    return {
      ok: true,
      zone,
      zonePath,
      mode: 'plan',
      notes: [
        ...notes,
        tl('notes.auto.n0715'),
        `Preview (first 400 chars):\n${readFileSync(zonePath, 'utf8').slice(0, 400)}`,
      ],
      written,
      commandResults,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      probe,
    };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      zone,
      zonePath,
      mode: 'refused',
      notes: [...notes, tl('notes.auto.n1192')],
      written,
      commandResults,
      requiresExecute: true,
      requiresRoot: !input.host.isRoot(),
      probe,
    };
  }

  if (!probe.pdnsutil) {
    return {
      ok: false,
      zone,
      zonePath,
      mode: 'refused',
      notes: [
        ...notes,
        tl('notes.auto.n0370'),
      ],
      written,
      commandResults,
      requiresExecute: false,
      requiresRoot: !input.host.isRoot(),
      probe,
    };
  }

  const load = await input.host.runCommand(
    ['pdnsutil', 'load-zone', zone, zonePath],
    { timeoutMs: 60_000 },
  );
  commandResults.push({
    argv: ['pdnsutil', 'load-zone', zone, zonePath],
    exitCode: load.exitCode,
    stderr: load.stderr,
  });

  if (load.exitCode !== 0) {
    notes.push(tl('notes.auto.t0293', { v0: (load.stderr || load.stdout) }));
    return {
      ok: false,
      zone,
      zonePath,
      mode: 'refused',
      notes,
      written,
      commandResults,
      requiresExecute: false,
      requiresRoot: !input.host.isRoot(),
      probe,
    };
  }

  notes.push(tl('notes.auto.t0294', { v0: (zone) }));
  const rect = await input.host.runCommand(['pdnsutil', 'rectify-zone', zone], {
    timeoutMs: 30_000,
  });
  commandResults.push({
    argv: ['pdnsutil', 'rectify-zone', zone],
    exitCode: rect.exitCode,
    stderr: rect.stderr,
  });
  if (rect.exitCode === 0) notes.push(tl('notes.auto.n0482'));
  else notes.push(`rectify-zone exit=${rect.exitCode} (non-fatal)`);

  return {
    ok: true,
    zone,
    zonePath,
    mode: 'loaded',
    notes,
    written,
    commandResults,
    requiresExecute: false,
    requiresRoot: !input.host.isRoot(),
    probe,
  };
}

/**
 * List managed zones with PowerDNS probe (for UI status).
 */
export async function powerDnsStatus(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<{ probe: PowerDnsProbe; zones: ReturnType<typeof listManagedDnsZones> }> {
  const probe = await probePowerDns(input.host);
  return { probe, zones: listManagedDnsZones(input.dataDir) };
}

export interface PowerDnsInstallResult {
  ok: boolean;
  notes: string[];
  written: string[];
  commands: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
  probe: PowerDnsProbe;
}

/**
 * Bash: set local-address via pdns.d drop-in (public IPv4 only).
 * Avoids 0.0.0.0:53 which conflicts with systemd-resolved on 127.0.0.53/54:53.
 * Override with env YSK_PDNS_LOCAL_ADDRESS=x.x.x.x
 */
export function configurePdnsLocalAddressShell(): string {
  return [
    'set -euo pipefail',
    'CONF_DIR=/etc/powerdns',
    'CONF="$CONF_DIR/pdns.conf"',
    'DROP="$CONF_DIR/pdns.d/ysk-local-address.conf"',
    'mkdir -p "$CONF_DIR/pdns.d" 2>/dev/null || true',
    'if [ -n "${YSK_PDNS_LOCAL_ADDRESS:-}" ]; then',
    '  PUB="$YSK_PDNS_LOCAL_ADDRESS"',
    'else',
    '  PUB=$(ip -4 route get 1.1.1.1 2>/dev/null | awk \'{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}\')',
    '  if [ -z "$PUB" ] || [ "$PUB" = "127.0.0.1" ]; then',
    '    PUB=$(hostname -I 2>/dev/null | tr " " "\\n" | grep -E "^[0-9]+\\." | grep -vE "^(127\\.)" | head -1)',
    '  fi',
    'fi',
    'if [ -z "$PUB" ]; then',
    '  echo "YSK_PDNS_NO_PUBLIC_IP" >&2',
    '  exit 2',
    'fi',
    'echo "YSK_PDNS_LOCAL_ADDRESS=$PUB"',
    'cat > "$DROP" <<EOF',
    '# Managed by YSK Server — bind only public IP (avoid systemd-resolved 127.0.0.53:53 conflict)',
    'local-address=$PUB',
    'local-port=53',
    'EOF',
    'if [ -f "$CONF" ]; then',
    '  sed -i -E "s/^[[:space:]]*local-address=.*/# &  # disabled by ysk (see pdns.d\\/ysk-local-address.conf)/" "$CONF" || true',
    '  sed -i -E "s/^[[:space:]]*local-ipv6=.*/# &  # disabled by ysk/" "$CONF" || true',
    'fi',
    'if [ -f "$CONF" ] && ! grep -qE "^[[:space:]]*include-dir=" "$CONF" 2>/dev/null; then',
    '  echo "include-dir=$CONF_DIR/pdns.d" >> "$CONF"',
    'fi',
    'systemctl stop pdns 2>/dev/null || true',
    'systemctl reset-failed pdns 2>/dev/null || true',
    'systemctl enable pdns 2>/dev/null || true',
    'systemctl start pdns',
    'sleep 1',
    'systemctl is-active pdns',
    'ss -ulnp 2>/dev/null | grep -E ":53\\s" || true',
  ].join('\n');
}

export type PowerDnsHealResult = {
  ok: boolean;
  localAddress?: string;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
  unitActive?: boolean;
  listenUdp53?: boolean;
};

/**
 * Fix PowerDNS crash-loop: bind only public IPv4 instead of 0.0.0.0:53
 * (conflicts with systemd-resolved on 127.0.0.53/54).
 */
export async function healPowerDnsListener(input: {
  host: HostExecutor;
  /** Override bind address (default: detect public IPv4) */
  localAddress?: string;
}): Promise<PowerDnsHealResult> {
  const notes: string[] = [];
  const commandResults: PowerDnsHealResult['commandResults'] = [];
  const execute = input.host.executeEnabled() && input.host.isRoot();
  if (!execute) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1163'), 'Need root + EXECUTE to rewrite pdns local-address'],
      commandResults,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
    };
  }

  const envPrefix = input.localAddress?.trim()
    ? `export YSK_PDNS_LOCAL_ADDRESS=${JSON.stringify(input.localAddress.trim())}; `
    : '';
  const script = configurePdnsLocalAddressShell();
  const r = await input.host.runCommand(
    ['bash', '-c', `${envPrefix}${script}`],
    { timeoutMs: 60_000 },
  );
  commandResults.push({
    argv: ['bash', '-c', 'heal-pdns-local-address'],
    exitCode: r.exitCode,
    stderr: r.stderr,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  notes.push(...out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20));

  const addrMatch = out.match(/YSK_PDNS_LOCAL_ADDRESS=([0-9.]+)/);
  const localAddress = addrMatch?.[1];
  if (r.exitCode !== 0) {
    if (out.includes('YSK_PDNS_NO_PUBLIC_IP')) {
      notes.unshift('Could not detect public IPv4 for local-address');
    }
    return {
      ok: false,
      localAddress,
      notes,
      commandResults,
      requiresExecute: false,
      requiresRoot: false,
    };
  }

  // Probe listen
  const ss = await input.host.runCommand(
    ['bash', '-c', 'ss -ulnp 2>/dev/null | grep -E ":53\\s" || true'],
    { timeoutMs: 5_000 },
  );
  const active = await input.host.runCommand(['systemctl', 'is-active', 'pdns'], {
    timeoutMs: 5_000,
  });
  const unitActive = (active.stdout || '').trim() === 'active';
  const listenUdp53 = /:53\b/.test(ss.stdout || '');
  notes.push(
    unitActive ? 'pdns unit: active' : 'pdns unit: not active',
    listenUdp53 ? 'UDP/53: listening' : 'UDP/53: still not listening',
  );

  return {
    ok: unitActive && listenUdp53,
    localAddress,
    notes,
    commandResults,
    requiresExecute: false,
    requiresRoot: false,
    unitActive,
    listenUdp53,
  };
}

/**
 * Write PowerDNS install helper under dataDir; optional apt install when root+EXECUTE.
 * After install, configures local-address to public IP (systemd-resolved safe).
 * Never fakes success when install was requested but skipped/failed.
 */
export async function installPowerDnsPackages(input: {
  dataDir: string;
  host: HostExecutor;
  /** When true, run apt install (needs root + YSK_EXECUTE) */
  install?: boolean;
  /** Preferred bind IP for authoritative DNS */
  localAddress?: string;
}): Promise<PowerDnsInstallResult> {
  const dir = join(input.dataDir, 'dns', 'powerdns');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'install-pdns.sh');
  const packages = ['pdns-server', 'pdns-backend-bind', 'pdns-tools'];
  const healBody = configurePdnsLocalAddressShell();
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      '# YSK Server — install PowerDNS (BIND backend) for managed zone files',
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      `apt-get install -y ${packages.join(' ')}`,
      '# Bind public IP only — 0.0.0.0:53 conflicts with systemd-resolved 127.0.0.53:53',
      input.localAddress?.trim()
        ? `export YSK_PDNS_LOCAL_ADDRESS=${JSON.stringify(input.localAddress.trim())}`
        : 'true',
      healBody,
      'echo "PowerDNS installed — use ysk-server hosting powerdns-load --load"',
      '',
    ].join('\n'),
    'utf8',
  );
  const notes = [
    `Install helper: ${scriptPath}`,
    `Packages: ${packages.join(', ')}`,
    'Configures local-address to public IPv4 (avoids systemd-resolved :53 conflict)',
    'After install, load zones with pdnsutil via powerdns/load API',
  ];
  const written = [scriptPath];
  const commandResults: PowerDnsInstallResult['commandResults'] = [];
  const commands: string[][] = [];
  const want = Boolean(input.install);
  if (want) {
    commands.push(['apt-get', 'update']);
    commands.push([
      'bash',
      '-c',
      `DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.join(' ')}`,
    ]);
    // heal replaces bare enable --now
    commands.push([
      'bash',
      '-c',
      input.localAddress?.trim()
        ? `export YSK_PDNS_LOCAL_ADDRESS=${JSON.stringify(input.localAddress.trim())}; ${configurePdnsLocalAddressShell()}`
        : configurePdnsLocalAddressShell(),
    ]);
  }
  const execute = Boolean(want && input.host.executeEnabled() && input.host.isRoot());
  if (want && !execute) {
    notes.push(tl('notes.auto.n1163'));
  }
  if (execute) {
    for (const argv of commands) {
      const r = await input.host.runCommand(argv, { timeoutMs: 300_000 });
      commandResults.push({ argv, exitCode: r.exitCode, stderr: r.stderr });
    }
  }
  const ranOk = commandResults.every((c) => c.exitCode === 0);
  const probe = await probePowerDns(input.host);
  notes.push(...probe.notes);
  return {
    ok: want ? execute && ranOk : true,
    notes,
    written,
    commands: commands.map((c) => c.join(' ')),
    commandResults,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    probe,
  };
}
