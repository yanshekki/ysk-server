/**
 * Target bootstrap via SSH: minimal tools → full softwareNeeded + ysk-server CLI.
 * Does not claim services are production-ready (that is reapply/verify).
 */

import type { HostManifest, MigrateJobDto, OpsResultDto } from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import { getSoftware, SOFTWARE_CATALOG } from '../software-catalog.js';
import {
  appendMigrateStep,
  setMigratePhase,
  writeMigrateProgress,
} from './job-store.js';
import {
  type MigrateSshAuth,
  type MigrateSshEndpoint,
  runSshCommand,
  userAtHost,
} from './transport.js';

export type BootstrapStage = 'minimal' | 'software' | 'ysk-cli' | 'full';

export type BootstrapResult = OpsResultDto & {
  stages: Array<{ id: string; ok: boolean; notes: string[] }>;
};

/** Map softwareNeeded ids → unique apt package names (runtime installers skipped here). */
export function aptPackagesForSoftwareIds(ids: string[]): string[] {
  const pkgs = new Set<string>();
  for (const id of ids) {
    const spec = getSoftware(id) ?? SOFTWARE_CATALOG.find((s) => s.id === id);
    if (!spec) continue;
    if (spec.installer?.startsWith('runtime-')) {
      // node/php handled separately
      continue;
    }
    for (const p of spec.aptPackages) {
      // mysql-server vs mariadb-server: prefer mariadb if both listed? take as-is
      pkgs.add(p);
    }
  }
  // Always useful for migrate
  pkgs.add('rsync');
  pkgs.add('curl');
  pkgs.add('ca-certificates');
  pkgs.add('openssh-client');
  return [...pkgs].sort();
}

/**
 * Build remote bash for apt install (DEBIAN_FRONTEND=noninteractive).
 * Packages shell-escaped as single-quoted list.
 */
export function buildAptInstallScript(packages: string[]): string {
  const list = packages
    .map((p) => p.replace(/[^a-zA-Z0-9.+_-]/g, ''))
    .filter(Boolean);
  if (!list.length) {
    return 'echo YSK_APT_NONE; exit 0';
  }
  const joined = list.map((p) => `'${p}'`).join(' ');
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'command -v apt-get >/dev/null || { echo YSK_NO_APT; exit 2; }',
    'apt-get update -y',
    `apt-get install -y ${joined}`,
    'echo YSK_APT_OK',
  ].join('\n');
}

/** Minimal: rsync + curl so transfer can run. */
export function buildMinimalBootstrapScript(): string {
  return buildAptInstallScript(['rsync', 'curl', 'ca-certificates']);
}

/**
 * Install Node.js ≥20 on Debian/Ubuntu (NodeSource setup or distro package).
 */
export function buildNodeInstallScript(): string {
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'if command -v node >/dev/null 2>&1; then',
    '  MAJOR=$(node -p "process.versions.node.split(\\".\\")[0]" 2>/dev/null || echo 0)',
    '  if [ "$MAJOR" -ge 20 ]; then echo YSK_NODE_OK; exit 0; fi',
    'fi',
    'apt-get update -y',
    '# try distro node first',
    'if apt-get install -y nodejs npm 2>/dev/null; then',
    '  MAJOR=$(node -p "process.versions.node.split(\\".\\")[0]" 2>/dev/null || echo 0)',
    '  if [ "$MAJOR" -ge 20 ]; then echo YSK_NODE_OK; exit 0; fi',
    'fi',
    '# NodeSource 20.x',
    'apt-get install -y ca-certificates curl gnupg',
    'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
    'apt-get install -y nodejs',
    'MAJOR=$(node -p "process.versions.node.split(\\".\\")[0]" 2>/dev/null || echo 0)',
    'if [ "$MAJOR" -ge 20 ]; then echo YSK_NODE_OK; else echo YSK_NODE_FAIL major=$MAJOR; exit 1; fi',
  ].join('\n');
}

/**
 * Install ysk-server CLI globally via npm (same major as source when version given).
 */
export function buildYskCliInstallScript(opts?: {
  version?: string;
  skipIfPresent?: boolean;
}): string {
  const ver = (opts?.version || '').replace(/[^0-9A-Za-z.+_-]/g, '');
  const pkg = ver ? `ysk-server@${ver}` : 'ysk-server';
  return [
    'set -e',
    opts?.skipIfPresent !== false
      ? 'if command -v ysk-server >/dev/null 2>&1; then echo YSK_CLI_PRESENT; ysk-server --version 2>/dev/null || true; exit 0; fi'
      : 'true',
    'command -v npm >/dev/null || { echo YSK_NO_NPM; exit 2; }',
    `npm install -g ${JSON.stringify(pkg)} 2>&1`,
    'command -v ysk-server >/dev/null && echo YSK_CLI_OK || { echo YSK_CLI_MISSING; exit 1; }',
  ].join('\n');
}

/**
 * Enable common units if packages installed (best-effort).
 */
export function buildEnableUnitsScript(softwareIds: string[]): string {
  const units = new Set<string>();
  for (const id of softwareIds) {
    const spec = getSoftware(id);
    if (spec?.units) {
      for (const u of spec.units) units.add(u);
    }
  }
  if (!units.size) return 'echo YSK_UNITS_NONE; exit 0';
  const lines = ['set +e', 'echo YSK_UNITS_BEGIN'];
  for (const u of units) {
    lines.push(`systemctl enable --now ${JSON.stringify(u)} 2>/dev/null || true`);
  }
  lines.push('echo YSK_UNITS_END', 'exit 0');
  return lines.join('\n');
}

async function runStage(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  name: string;
  script: string;
  timeoutMs?: number;
  successMarkers?: string[];
}): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; apply_status?: OpsResultDto['apply_status'] }> {
  const r = await runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: input.script,
    timeoutMs: input.timeoutMs ?? 600_000,
    name: input.name,
  });
  if (!r.ok) {
    return {
      ok: false,
      blocked: r.blocked,
      apply_status: r.apply_status,
      notes: r.notes,
    };
  }
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (input.successMarkers?.length) {
    const hit = input.successMarkers.some((m) => out.includes(m));
    if (!hit) {
      return {
        ok: false,
        apply_status: 'failed',
        notes: [
          `遠端未回報成功標記 (${input.successMarkers.join('|')})`,
          out.slice(0, 300),
        ],
      };
    }
  }
  return {
    ok: true,
    apply_status: 'applied',
    notes: [`${input.name} ok`, ...r.notes.slice(0, 2)],
  };
}

/**
 * Minimal bootstrap so rsync works on target.
 */
export async function bootstrapTargetMinimal(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
}): Promise<BootstrapResult> {
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: '無法 bootstrap：未開啟 YSK_EXECUTE',
      notes: ['bootstrap 需要 YSK_EXECUTE=1'],
      stages: [],
    }) as BootstrapResult;
  }
  const st = await runStage({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    name: 'minimal-apt',
    script: buildMinimalBootstrapScript(),
    successMarkers: ['YSK_APT_OK', 'YSK_APT_NONE'],
  });
  return assertHonestOps({
    ok: st.ok,
    blocked: st.blocked,
    apply_status: st.apply_status ?? (st.ok ? 'applied' : 'failed'),
    notes: st.ok
      ? [`minimal bootstrap ok → ${userAtHost(input.endpoint)}`, ...st.notes]
      : ['minimal bootstrap 失敗', ...st.notes],
    stages: [{ id: 'minimal', ok: st.ok, notes: st.notes }],
  }) as BootstrapResult;
}

/**
 * Full bootstrap: apt softwareNeeded + node + ysk-server CLI + enable units.
 */
export async function bootstrapTargetFull(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  /** npm package version pin */
  yskVersion?: string;
  /** Skip phase bookkeeping */
  skipJobPhase?: boolean;
}): Promise<BootstrapResult> {
  const stages: BootstrapResult['stages'] = [];
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: '無法 bootstrap：未開啟 YSK_EXECUTE',
      notes: ['bootstrap 需要 YSK_EXECUTE=1'],
      stages: [],
    }) as BootstrapResult;
  }

  if (!input.skipJobPhase) {
    setMigratePhase(input.dataDir, input.job, 'bootstrap');
  }
  writeMigrateProgress(input.dataDir, input.job.id, {
    phase: 'bootstrap',
    status: 'starting',
  });

  // 1) apt packages from catalog
  const aptPkgs = aptPackagesForSoftwareIds(input.manifest.softwareNeeded);
  writeMigrateProgress(input.dataDir, input.job.id, {
    phase: 'bootstrap',
    status: 'apt',
    packages: aptPkgs.length,
  });
  const apt = await runStage({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    name: 'apt-software',
    script: buildAptInstallScript(aptPkgs),
    timeoutMs: 1_800_000,
    successMarkers: ['YSK_APT_OK', 'YSK_APT_NONE'],
  });
  stages.push({ id: 'apt-software', ok: apt.ok, notes: apt.notes });
  appendMigrateStep(input.dataDir, input.job, {
    phase: 'bootstrap',
    name: 'apt-software',
    result: {
      ok: apt.ok,
      blocked: apt.blocked,
      apply_status: apt.apply_status ?? (apt.ok ? 'applied' : 'failed'),
      notes: [
        ...apt.notes,
        `packages=${aptPkgs.length}: ${aptPkgs.slice(0, 12).join(', ')}${aptPkgs.length > 12 ? '…' : ''}`,
      ],
    },
  });
  if (!apt.ok) {
    if (!input.skipJobPhase) {
      setMigratePhase(input.dataDir, input.job, 'failed', 'apt 安裝失敗');
    }
    return assertHonestOps({
      ok: false,
      blocked: apt.blocked,
      apply_status: apt.apply_status ?? 'failed',
      notes: ['bootstrap 中止：apt 失敗', ...apt.notes],
      stages,
    }) as BootstrapResult;
  }

  // 2) Node ≥20 if softwareNeeded includes node or always for ysk-cli
  const needNode =
    input.manifest.softwareNeeded.includes('node') ||
    input.manifest.projects.some((p) => p.runtime === 'node') ||
    true; // CLI needs node
  if (needNode) {
    writeMigrateProgress(input.dataDir, input.job.id, {
      phase: 'bootstrap',
      status: 'node',
    });
    const node = await runStage({
      host: input.host,
      endpoint: input.endpoint,
      auth: input.auth,
      name: 'node',
      script: buildNodeInstallScript(),
      timeoutMs: 900_000,
      successMarkers: ['YSK_NODE_OK'],
    });
    stages.push({ id: 'node', ok: node.ok, notes: node.notes });
    appendMigrateStep(input.dataDir, input.job, {
      phase: 'bootstrap',
      name: 'node',
      result: {
        ok: node.ok,
        apply_status: node.apply_status ?? (node.ok ? 'applied' : 'failed'),
        notes: node.notes,
      },
    });
    if (!node.ok) {
      if (!input.skipJobPhase) {
        setMigratePhase(input.dataDir, input.job, 'failed', 'Node 安裝失敗');
      }
      return assertHonestOps({
        ok: false,
        apply_status: 'failed',
        notes: ['bootstrap 中止：Node 失敗', ...node.notes],
        stages,
      }) as BootstrapResult;
    }
  }

  // 3) ysk-server CLI
  writeMigrateProgress(input.dataDir, input.job.id, {
    phase: 'bootstrap',
    status: 'ysk-cli',
  });
  const ver = input.yskVersion ?? input.manifest.source.yskVersion;
  const cli = await runStage({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    name: 'ysk-cli',
    script: buildYskCliInstallScript({ version: ver === '0.1.0' ? undefined : ver }),
    timeoutMs: 600_000,
    successMarkers: ['YSK_CLI_OK', 'YSK_CLI_PRESENT'],
  });
  stages.push({ id: 'ysk-cli', ok: cli.ok, notes: cli.notes });
  appendMigrateStep(input.dataDir, input.job, {
    phase: 'bootstrap',
    name: 'ysk-cli',
    result: {
      ok: cli.ok,
      apply_status: cli.apply_status ?? (cli.ok ? 'applied' : 'failed'),
      notes: cli.notes,
    },
  });
  // CLI install failure is soft-fail if dataDir already has everything — still notes
  if (!cli.ok) {
    stages[stages.length - 1]!.notes.push(
      'ysk-server CLI 安裝失敗 — 可稍後手動 npm i -g ysk-server',
    );
  }

  // 4) enable units best-effort
  writeMigrateProgress(input.dataDir, input.job.id, {
    phase: 'bootstrap',
    status: 'units',
  });
  const units = await runStage({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    name: 'enable-units',
    script: buildEnableUnitsScript(input.manifest.softwareNeeded),
    timeoutMs: 300_000,
    successMarkers: ['YSK_UNITS_END', 'YSK_UNITS_NONE'],
  });
  stages.push({ id: 'enable-units', ok: units.ok, notes: units.notes });
  appendMigrateStep(input.dataDir, input.job, {
    phase: 'bootstrap',
    name: 'enable-units',
    result: {
      ok: units.ok,
      apply_status: units.ok ? 'applied' : 'partial',
      notes: units.notes,
    },
  });

  writeMigrateProgress(input.dataDir, input.job.id, {
    phase: 'bootstrap',
    status: 'done',
  });

  const criticalOk = stages
    .filter((s) => s.id === 'apt-software' || s.id === 'node')
    .every((s) => s.ok);
  const softFail = stages.filter((s) => !s.ok).map((s) => s.id);

  return assertHonestOps({
    ok: criticalOk,
    apply_status: criticalOk
      ? softFail.length
        ? 'partial'
        : 'applied'
      : 'failed',
    notes: [
      criticalOk
        ? `bootstrap 完成 → ${userAtHost(input.endpoint)}`
        : 'bootstrap 關鍵步驟失敗',
      `softwareNeeded=${input.manifest.softwareNeeded.length} aptPkgs=${aptPkgs.length}`,
      ...(softFail.length ? [`非關鍵失敗: ${softFail.join(', ')}`] : []),
      ...stages.filter((s) => !s.ok).flatMap((s) => s.notes),
    ],
    stages,
  }) as BootstrapResult;
}

/**
 * Recommended order: minimal bootstrap → transfer → full bootstrap.
 */
export async function transferThenBootstrap(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  targetDataDir?: string;
  includeOptionalEtc?: boolean;
  dryRun?: boolean;
  yskVersion?: string;
  /** Skip full bootstrap (transfer only) */
  skipFullBootstrap?: boolean;
}): Promise<
  OpsResultDto & {
    transfer?: Awaited<ReturnType<typeof import('./transfer.js').transferMigratePayload>>;
    bootstrapMinimal?: BootstrapResult;
    bootstrapFull?: BootstrapResult;
  }
> {
  // dynamic import type only — call modules directly
  const { transferMigratePayload } = await import('./transfer.js');

  const minimal = await bootstrapTargetMinimal({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
  });
  if (!minimal.ok && !input.dryRun) {
    // rsync might still work if rsync already installed
    // continue with note if rsync exists — check
    const probe = await runSshCommand({
      host: input.host,
      endpoint: input.endpoint,
      auth: input.auth,
      remoteCommand: 'command -v rsync && echo YSK_HAS_RSYNC || echo YSK_NO_RSYNC',
      timeoutMs: 15_000,
    });
    if (!probe.stdout.includes('YSK_HAS_RSYNC')) {
      return assertHonestOps({
        ok: false,
        blocked: minimal.blocked,
        apply_status: 'failed',
        notes: [
          '無法在目標安裝 rsync，且目標原本也沒有 rsync',
          ...minimal.notes,
        ],
        bootstrapMinimal: minimal,
      }) as OpsResultDto & {
        bootstrapMinimal: BootstrapResult;
      };
    }
  }

  const transfer = await transferMigratePayload({
    host: input.host,
    dataDir: input.dataDir,
    job: input.job,
    manifest: input.manifest,
    endpoint: input.endpoint,
    auth: input.auth,
    targetDataDir: input.targetDataDir,
    includeOptionalEtc: input.includeOptionalEtc,
    dryRun: input.dryRun,
  });

  if (!transfer.ok) {
    return assertHonestOps({
      ok: false,
      blocked: transfer.blocked,
      apply_status: transfer.apply_status ?? 'failed',
      notes: transfer.notes,
      transfer,
      bootstrapMinimal: minimal,
    }) as OpsResultDto & {
      transfer: typeof transfer;
      bootstrapMinimal: BootstrapResult;
    };
  }

  if (input.dryRun || input.skipFullBootstrap) {
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [
        input.dryRun ? 'dry-run transfer 完成（略過 full bootstrap）' : 'transfer 完成（略過 full bootstrap）',
        ...transfer.notes,
      ],
      transfer,
      bootstrapMinimal: minimal,
    }) as OpsResultDto & {
      transfer: typeof transfer;
      bootstrapMinimal: BootstrapResult;
    };
  }

  const full = await bootstrapTargetFull({
    host: input.host,
    dataDir: input.dataDir,
    job: input.job,
    manifest: input.manifest,
    endpoint: input.endpoint,
    auth: input.auth,
    yskVersion: input.yskVersion,
  });

  return assertHonestOps({
    ok: full.ok,
    apply_status: full.apply_status ?? (full.ok ? 'applied' : 'failed'),
    notes: [...transfer.notes, ...full.notes],
    transfer,
    bootstrapMinimal: minimal,
    bootstrapFull: full,
  }) as OpsResultDto & {
    transfer: typeof transfer;
    bootstrapMinimal: BootstrapResult;
    bootstrapFull: BootstrapResult;
  };
}
