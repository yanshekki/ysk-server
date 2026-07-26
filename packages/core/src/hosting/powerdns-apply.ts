/**
 * PowerDNS dual-mode: probe tools + optional load of managed BIND zone files.
 * Never fakes success — load needs YSK_EXECUTE + pdnsutil (or documented refuse).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { listManagedDnsZones, writeManagedDnsZone } from './dns-zone.js';

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
    const r = await host.runCommand(['bash', '-c', `command -v ${bin} || true`], {
      timeoutMs: 5_000,
    });
    return r.stdout.trim() || undefined;
  };
  const pdnsutil = await find('pdnsutil');
  const pdnsControl = await find('pdns_control');
  const pdnsServer = await find('pdns_server');
  if (pdnsutil) notes.push(`pdnsutil: ${pdnsutil}`);
  if (pdnsControl) notes.push(`pdns_control: ${pdnsControl}`);
  if (pdnsServer) notes.push(`pdns_server: ${pdnsServer}`);
  if (!pdnsutil && !pdnsControl) {
    notes.push('找不到 PowerDNS 工具 — 請安裝 pdns-server / pdns-tools');
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
  mailHost?: string;
  /** When true, attempt pdnsutil load-zone (needs EXECUTE) */
  load?: boolean;
  /** Rewrite zone file first (default true) */
  rewriteZone?: boolean;
}): Promise<PowerDnsLoadResult> {
  const zone = input.zone.trim().toLowerCase().replace(/\.$/, '');
  if (!zone) {
    throw new YskError(ErrorCodes.VALIDATION, '請填寫 zone', { httpStatus: 400 });
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
      'if command -v pdnsutil >/dev/null 2>&1; then',
      '  pdnsutil load-zone "$ZONE" "$FILE"',
      '  pdnsutil rectify-zone "$ZONE" || true',
      '  echo "loaded $ZONE"',
      'else',
      '  echo "pdnsutil 找不到" >&2',
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
        '尚未載入 zone：請於管理面板重試',
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
      notes: [...notes, '無法載入 PowerDNS zone：伺服器未開啟系統變更權限'],
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
        'pdnsutil 找不到 — install PowerDNS tools or run helper script as root after install',
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
    notes.push(`pdnsutil load-zone 失敗：${load.stderr || load.stdout}`);
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

  notes.push(`已透過 pdnsutil 載入 zone ${zone}`);
  const rect = await input.host.runCommand(['pdnsutil', 'rectify-zone', zone], {
    timeoutMs: 30_000,
  });
  commandResults.push({
    argv: ['pdnsutil', 'rectify-zone', zone],
    exitCode: rect.exitCode,
    stderr: rect.stderr,
  });
  if (rect.exitCode === 0) notes.push('zone rectify 完成');
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
 * Write PowerDNS install helper under dataDir; optional apt install when root+EXECUTE.
 * Never fakes success when install was requested but skipped/failed.
 */
export async function installPowerDnsPackages(input: {
  dataDir: string;
  host: HostExecutor;
  /** When true, run apt install (needs root + YSK_EXECUTE) */
  install?: boolean;
}): Promise<PowerDnsInstallResult> {
  const dir = join(input.dataDir, 'dns', 'powerdns');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'install-pdns.sh');
  const packages = ['pdns-server', 'pdns-backend-bind', 'pdns-tools'];
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      '# YSK Server — install PowerDNS (BIND backend) for managed zone files',
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      `apt-get install -y ${packages.join(' ')}`,
      'systemctl enable --now pdns || true',
      'echo "PowerDNS installed — use ysk-server hosting powerdns-load --load"',
      '',
    ].join('\n'),
    'utf8',
  );
  const notes = [
    `Install helper: ${scriptPath}`,
    `Packages: ${packages.join(', ')}`,
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
    commands.push(['systemctl', 'enable', '--now', 'pdns']);
  }
  const execute = Boolean(want && input.host.executeEnabled() && input.host.isRoot());
  if (want && !execute) {
    notes.push('無法安裝 PowerDNS：需要系統管理員權限');
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
