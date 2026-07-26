/**
 * Probe + one-click install for catalog software (panel only).
 */

import type { HostExecutor } from '../host/executor.js';
import {
  getSoftware,
  listSoftwareForFeature,
  type SoftwareId,
  type SoftwareSpec,
} from './software-catalog.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { planOrInstallRuntime } from './runtime-probe.js';

export type SoftwareStatus = {
  id: SoftwareId | string;
  title: string;
  installed: boolean;
  active?: string;
  bins: string[];
  missingBins: string[];
  features: string[];
};

export type SoftwareInstallStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
};

export type SoftwareInstallResult = {
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockReason?: BlockReason;
  blockMessage?: string;
  id: string;
  title: string;
  installed: boolean;
  notes: string[];
  steps: SoftwareInstallStep[];
  status: SoftwareStatus;
};

let lastAptUpdateMs = 0;
const APT_UPDATE_MS = 5 * 60_000;

async function binExists(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} 2>/dev/null || true`], {
    timeoutMs: 5_000,
  });
  return r.stdout.trim().length > 0;
}

async function unitActive(host: HostExecutor, unit: string): Promise<string | undefined> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return undefined;
  }
  const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || undefined;
}

export async function probeSoftware(
  host: HostExecutor,
  spec: SoftwareSpec,
): Promise<SoftwareStatus> {
  const missingBins: string[] = [];
  let anyOk = false;
  for (const b of spec.bins) {
    const ok = await binExists(host, b);
    if (ok) anyOk = true;
    else missingBins.push(b);
  }
  // For multi-bin packages (e.g. mysqld|mariadbd): installed if ANY bin exists
  const installedAny = spec.bins.length === 0 ? false : anyOk;

  let active: string | undefined;
  if (spec.units?.[0] && installedAny) {
    active = await unitActive(host, spec.units[0]);
  }

  return {
    id: spec.id,
    title: spec.title,
    installed: installedAny,
    active,
    bins: spec.bins,
    missingBins: installedAny ? [] : missingBins,
    features: spec.features,
  };
}

export async function probeAllSoftware(
  host: HostExecutor,
  feature?: string,
): Promise<SoftwareStatus[]> {
  const list = listSoftwareForFeature(feature ?? 'all');
  const out: SoftwareStatus[] = [];
  for (const spec of list) {
    out.push(await probeSoftware(host, spec));
  }
  return out;
}

export async function installSoftware(input: {
  host: HostExecutor;
  id: string;
  dataDir?: string;
  /** enable units after apt (default true) */
  enableUnits?: boolean;
}): Promise<SoftwareInstallResult> {
  const spec = getSoftware(input.id);
  if (!spec) {
    return {
      ok: false,
      executed: false,
      id: input.id,
      title: input.id,
      installed: false,
      notes: ['未知軟件'],
      steps: [{ name: '驗證', status: 'failed', detail: '未知軟件 ID' }],
      status: {
        id: input.id,
        title: input.id,
        installed: false,
        bins: [],
        missingBins: [],
        features: [],
      },
    };
  }

  const steps: SoftwareInstallStep[] = [];
  const notes: string[] = [];
  const before = await probeSoftware(input.host, spec);
  if (before.installed) {
    notes.push(`${spec.title} 已安裝`);
    if (spec.units?.length && input.enableUnits !== false) {
      for (const u of spec.units) {
        const en = await input.host.runCommand(['systemctl', 'enable', '--now', u], {
          timeoutMs: 60_000,
        });
        steps.push({
          name: `啟動 ${u}`,
          status: en.exitCode === 0 ? 'ok' : 'failed',
          detail: en.exitCode === 0 ? 'ok' : en.stderr,
        });
      }
    }
    const status = await probeSoftware(input.host, spec);
    return {
      ok: true,
      executed: false,
      id: spec.id,
      title: spec.title,
      installed: true,
      notes,
      steps: steps.length ? steps : [{ name: '探測', status: 'ok', detail: '已安裝' }],
      status,
    };
  }

  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    const blockReason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(blockReason);
    notes.push(blockMessage);
    steps.push({ name: '一鍵安裝', status: 'blocked', detail: blockMessage });
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockReason,
      blockMessage,
      id: spec.id,
      title: spec.title,
      installed: false,
      notes,
      steps,
      status: before,
    };
  }

  // Runtime installers
  if (spec.installer === 'runtime-node' || spec.installer === 'runtime-php') {
    if (!input.dataDir) {
      notes.push('缺少 dataDir，無法安裝 runtime');
      return {
        ok: false,
        executed: false,
        id: spec.id,
        title: spec.title,
        installed: false,
        notes,
        steps: [{ name: '安裝', status: 'failed', detail: '缺少 dataDir' }],
        status: before,
      };
    }
    const kind = spec.installer === 'runtime-node' ? 'node' : 'php';
    const version = spec.runtimeVersion ?? (kind === 'node' ? '20' : '8.3');
    const r = await planOrInstallRuntime({
      host: input.host,
      dataDir: input.dataDir,
      kind,
      version,
      install: true,
    });
    const status = await probeSoftware(input.host, spec);
    return {
      ok: r.ok && status.installed,
      executed: true,
      blocked: r.ok === false && (r.requiresExecute || r.requiresRoot),
      blockMessage:
        r.ok === false && (r.requiresExecute || r.requiresRoot)
          ? panelBlockMessage(r.requiresExecute ? 'no_execute' : 'no_root')
          : undefined,
      id: spec.id,
      title: spec.title,
      installed: status.installed,
      notes: r.notes.length ? r.notes : status.installed ? [`已安裝 ${spec.title}`] : ['安裝未完成'],
      steps: (r.notes ?? []).slice(0, 6).map((n) => ({
        name: '安裝步驟',
        status: r.ok ? ('ok' as const) : ('failed' as const),
        detail: n,
      })),
      status,
    };
  }

  // apt path
  const pkgs = spec.aptPackages.filter(Boolean);
  if (!pkgs.length) {
    notes.push('此軟件無 apt 套件定義');
    return {
      ok: false,
      executed: false,
      id: spec.id,
      title: spec.title,
      installed: false,
      notes,
      steps: [{ name: '安裝', status: 'failed', detail: '無套件' }],
      status: before,
    };
  }

  const now = Date.now();
  if (now - lastAptUpdateMs > APT_UPDATE_MS) {
    const up = await input.host.runCommand(
      ['bash', '-c', 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq'],
      { timeoutMs: 180_000 },
    );
    steps.push({
      name: '更新套件索引',
      status: up.exitCode === 0 ? 'ok' : 'failed',
      detail: up.exitCode === 0 ? undefined : up.stderr,
    });
    if (up.exitCode === 0) lastAptUpdateMs = now;
  } else {
    steps.push({ name: '更新套件索引', status: 'skipped', detail: '最近已更新' });
  }

  // Try packages one-by-one groups: first package set as OR — install all listed, ignore individual fails partially
  const installCmd = `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${pkgs.map((p) => JSON.stringify(p)).join(' ')}`;
  const inst = await input.host.runCommand(['bash', '-c', installCmd], { timeoutMs: 600_000 });
  // mysql-client OR mariadb-client: if full fail, try each
  let installOk = inst.exitCode === 0;
  if (!installOk && pkgs.length > 1) {
    for (const p of pkgs) {
      const one = await input.host.runCommand(
        ['bash', '-c', `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${JSON.stringify(p)}`],
        { timeoutMs: 300_000 },
      );
      if (one.exitCode === 0) {
        installOk = true;
        steps.push({ name: `安裝 ${p}`, status: 'ok' });
        break;
      }
      steps.push({ name: `安裝 ${p}`, status: 'failed', detail: one.stderr });
    }
  } else {
    steps.push({
      name: `安裝 ${pkgs.join(', ')}`,
      status: installOk ? 'ok' : 'failed',
      detail: installOk ? undefined : inst.stderr,
    });
  }

  if (installOk && spec.units?.length && input.enableUnits !== false) {
    for (const u of spec.units) {
      const en = await input.host.runCommand(['systemctl', 'enable', '--now', u], {
        timeoutMs: 60_000,
      });
      steps.push({
        name: `啟動 ${u}`,
        status: en.exitCode === 0 ? 'ok' : 'failed',
        detail: en.exitCode === 0 ? '已啟動' : en.stderr,
      });
    }
  }

  const status = await probeSoftware(input.host, spec);
  const ok = status.installed;
  notes.push(ok ? `已安裝 ${spec.title}` : `未能安裝 ${spec.title}`);
  return {
    ok,
    executed: true,
    id: spec.id,
    title: spec.title,
    installed: status.installed,
    notes,
    steps,
    status,
  };
}

export async function installSoftwareBatch(input: {
  host: HostExecutor;
  ids: string[];
  dataDir?: string;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  results: SoftwareInstallResult[];
  notes: string[];
}> {
  const results: SoftwareInstallResult[] = [];
  for (const id of input.ids) {
    results.push(
      await installSoftware({ host: input.host, id, dataDir: input.dataDir, enableUnits: true }),
    );
  }
  const ok = results.every((r) => r.ok);
  const blocked = results.some((r) => r.blocked);
  const blockMessage =
    results.find((r) => r.blockMessage)?.blockMessage ??
    (blocked ? '伺服器未開啟系統變更權限，無法在管理面板完成此操作' : undefined);
  return {
    ok,
    blocked,
    blockMessage,
    results,
    notes: results.flatMap((r) => r.notes),
  };
}

export async function installForFeature(input: {
  host: HostExecutor;
  feature: string;
  dataDir?: string;
  /** only missing (default true) */
  onlyMissing?: boolean;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  results: SoftwareInstallResult[];
  missingBefore: SoftwareStatus[];
  notes: string[];
}> {
  const probed = await probeAllSoftware(input.host, input.feature);
  const missing = probed.filter((p) => !p.installed);
  const ids =
    input.onlyMissing === false ? probed.map((p) => p.id) : missing.map((p) => p.id);
  if (!ids.length) {
    return {
      ok: true,
      results: [],
      missingBefore: [],
      notes: ['所需軟件均已安裝'],
    };
  }
  const batch = await installSoftwareBatch({
    host: input.host,
    ids,
    dataDir: input.dataDir,
  });
  return {
    ok: batch.ok,
    blocked: batch.blocked,
    blockMessage: batch.blockMessage,
    results: batch.results,
    missingBefore: missing,
    notes: batch.notes,
  };
}
