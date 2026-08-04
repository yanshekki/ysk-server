/**
 * Stack install / uninstall / scan / status using HostExecutor.
 */

import type { HostExecutor } from '../../host/executor.js';
import { panelBlockMessage, type BlockReason } from '../system-apply.js';
import { installSoftware } from '../software-install.js';
import { getSoftware } from '../software-catalog.js';
import { planOrInstallRuntime } from '../runtime-probe.js';
import { HostSoftwareProbe } from '../software-probe/index.js';
import {
  expandComponents,
  expandUninstallComponents,
  getComponent,
  isPurgePathAllowed,
  listBundleIds,
  listPlanIds,
  STACK_BUNDLES,
  STACK_COMPONENTS,
  STACK_PLANS,
  type DataPolicy,
  type ExpandOptions,
  type SqlServerChoice,
} from './definitions.js';
import {
  emptyManifest,
  loadStackManifest,
  removeComponent as manifestRemoveComponent,
  saveStackManifest,
  setManifestMeta,
  upsertComponent,
  type StackManifest,
} from './manifest.js';

export type StackStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked' | 'planned';
  detail?: string;
};

export type StackOpResult = {
  ok: boolean;
  executed: boolean;
  dryRun: boolean;
  blocked?: boolean;
  blockReason?: BlockReason;
  blockMessage?: string;
  plan?: string;
  bundles?: string[];
  components: string[];
  dataPolicy?: DataPolicy;
  steps: StackStep[];
  notes: string[];
  manifest?: StackManifest;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
};

function blockIfNeeded(host: HostExecutor): StackOpResult | null {
  if (host.executeEnabled() && host.isRoot()) return null;
  const blockReason: BlockReason = !host.executeEnabled() ? 'no_execute' : 'no_root';
  const blockMessage = panelBlockMessage(blockReason);
  return {
    ok: false,
    executed: false,
    dryRun: false,
    blocked: true,
    blockReason,
    blockMessage,
    components: [],
    steps: [{ name: 'gate', status: 'blocked', detail: blockMessage }],
    notes: [blockMessage],
    requiresExecute: !host.executeEnabled(),
    requiresRoot: !host.isRoot(),
  };
}

export function listStackPlans() {
  return listPlanIds().map((id) => ({
    id,
    ...STACK_PLANS[id]!,
  }));
}

export function listStackBundles() {
  return listBundleIds().map((id) => ({
    id,
    ...STACK_BUNDLES[id]!,
  }));
}

export async function getStackStatus(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<{
  manifest: StackManifest;
  components: Array<{
    id: string;
    title: string;
    inManifest: boolean;
    installed: boolean;
    bins: string[];
  }>;
  plans: ReturnType<typeof listStackPlans>;
  bundles: ReturnType<typeof listStackBundles>;
}> {
  const manifest = await loadStackManifest(input.host, input.dataDir);
  const probe = new HostSoftwareProbe(input.host);
  const components = [];
  for (const id of Object.keys(STACK_COMPONENTS)) {
    const def = STACK_COMPONENTS[id]!;
    let installed = false;
    if (def.softwareId && getSoftware(def.softwareId)) {
      installed = (await probe.presence(def.softwareId)).installed;
    } else {
      // Non-catalog stack ids (base-deps, apache2, …): any bin via unified resolveBin
      for (const b of def.bins) {
        if (await probe.binPresent(b)) {
          installed = true;
          break;
        }
      }
    }
    components.push({
      id,
      title: def.title,
      inManifest: Boolean(manifest.components[id]),
      installed,
      bins: def.bins,
    });
  }
  return {
    manifest,
    components,
    plans: listStackPlans(),
    bundles: listStackBundles(),
  };
}

/** Infer manifest from host probe (inferred: true) */
export async function scanStack(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<{ manifest: StackManifest; notes: string[] }> {
  const notes: string[] = [];
  const status = await getStackStatus(input);
  let m = emptyManifest(input.dataDir, 'scan');
  m.inferred = true;
  const present = status.components.filter((c) => c.installed).map((c) => c.id);
  for (const id of present) {
    const def = getComponent(id);
    if (!def) continue;
    m = upsertComponent(m, id, {
      source: def.source,
      packages: def.aptPackages,
      units: def.units,
      dataPaths: def.dataPaths,
    });
  }
  // infer bundles: if majority of bundle components present
  const bundles: string[] = [];
  for (const [bid, bdef] of Object.entries(STACK_BUNDLES)) {
    const req = bdef.components.filter((c) => c !== 'control-plane-product');
    const hit = req.filter((c) => present.includes(c) || (c === 'mariadb-server' && present.includes('mysql-server')));
    if (req.length && hit.length >= Math.ceil(req.length * 0.6)) {
      bundles.push(bid);
    }
  }
  m.bundles = bundles.length ? bundles : present.length ? ['control-plane'] : [];
  m.plan = 'scan';
  notes.push(`scan found ${present.length} components, inferred bundles: ${m.bundles.join(',') || '(none)'}`);
  return { manifest: m, notes };
}

async function aptInstall(
  host: HostExecutor,
  pkgs: string[],
  optional: boolean,
): Promise<{ ok: boolean; detail: string }> {
  if (!pkgs.length) return { ok: true, detail: 'no packages' };
  const cmd = `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${pkgs.map((p) => JSON.stringify(p)).join(' ')}`;
  const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 600_000 });
  if (r.exitCode === 0) return { ok: true, detail: pkgs.join(',') };
  if (optional) return { ok: true, detail: `optional soft-fail: ${r.stderr}` };
  // try one-by-one
  let any = false;
  for (const p of pkgs) {
    const one = await host.runCommand(
      ['bash', '-c', `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${JSON.stringify(p)}`],
      { timeoutMs: 300_000 },
    );
    if (one.exitCode === 0) any = true;
  }
  return { ok: any, detail: any ? 'partial' : r.stderr || 'apt failed' };
}

async function installOneComponent(
  host: HostExecutor,
  dataDir: string,
  id: string,
  dryRun: boolean,
): Promise<StackStep[]> {
  const steps: StackStep[] = [];
  const def = getComponent(id);
  if (!def) {
    steps.push({ name: id, status: 'failed', detail: 'unknown component' });
    return steps;
  }

  if (id === 'control-plane-product') {
    steps.push({
      name: id,
      status: dryRun ? 'planned' : 'skipped',
      detail: 'product install is via install.sh / npm; CLI stack skips npm reinstall',
    });
    return steps;
  }

  if (dryRun) {
    steps.push({
      name: id,
      status: 'planned',
      detail: `${def.source}: ${(def.aptPackages ?? []).join(' ') || def.bins.join(',')}`,
    });
    return steps;
  }

  // Prefer software-install when catalog id exists
  if (def.softwareId && getSoftware(def.softwareId) && def.source !== 'rustup') {
    const r = await installSoftware({
      host,
      id: def.softwareId,
      dataDir,
      enableUnits: false,
    });
    steps.push({
      name: id,
      status: r.blocked ? 'blocked' : r.ok ? 'ok' : 'failed',
      detail: r.notes.join('; ') || r.blockMessage,
    });
    return steps;
  }

  if (def.softwareId === 'rust' || def.source === 'rustup') {
    const r = await planOrInstallRuntime({
      host,
      dataDir,
      kind: 'rust',
      version: 'stable',
      install: true,
    });
    steps.push({
      name: id,
      status: r.ok ? 'ok' : 'failed',
      detail: r.notes.join('; '),
    });
    return steps;
  }

  if (def.softwareId === 'node' || def.source === 'nodesource') {
    const r = await planOrInstallRuntime({
      host,
      dataDir,
      kind: 'node',
      version: '20',
      install: true,
    });
    steps.push({
      name: id,
      status: r.ok ? 'ok' : 'failed',
      detail: r.notes.join('; '),
    });
    return steps;
  }

  // raw apt
  if (def.source === 'apt' || def.aptPackages.length) {
    const up = await host.runCommand(
      ['bash', '-c', 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq'],
      { timeoutMs: 180_000 },
    );
    steps.push({
      name: `${id}:apt-update`,
      status: up.exitCode === 0 ? 'ok' : 'failed',
      detail: up.exitCode === 0 ? undefined : up.stderr,
    });
    const inst = await aptInstall(host, def.aptPackages, Boolean(def.optional));
    steps.push({
      name: id,
      status: inst.ok ? 'ok' : 'failed',
      detail: inst.detail,
    });
    if (def.optionalApt?.length) {
      await aptInstall(host, def.optionalApt, true);
    }
  }

  return steps;
}

export async function installStack(input: {
  host: HostExecutor;
  dataDir: string;
  plan?: string;
  bundles?: string[];
  options?: ExpandOptions;
  dryRun?: boolean;
}): Promise<StackOpResult> {
  const dryRun = Boolean(input.dryRun);
  const expanded = expandComponents(
    { plan: input.plan, bundles: input.bundles },
    input.options ?? {},
  );
  if (!expanded.ok) {
    return {
      ok: false,
      executed: false,
      dryRun,
      components: [],
      steps: [{ name: 'expand', status: 'failed', detail: expanded.error }],
      notes: [expanded.error],
    };
  }

  if (!dryRun) {
    const blocked = blockIfNeeded(input.host);
    if (blocked) {
      return { ...blocked, plan: expanded.plan, bundles: expanded.bundles, components: expanded.components };
    }
  }

  const steps: StackStep[] = [];
  const notes: string[] = [
    `plan=${expanded.plan}`,
    `bundles=${expanded.bundles.join(',')}`,
    `components=${expanded.components.length}`,
  ];

  for (const id of expanded.components) {
    const s = await installOneComponent(input.host, input.dataDir, id, dryRun);
    steps.push(...s);
  }

  let manifest = await loadStackManifest(input.host, input.dataDir);
  if (!dryRun) {
    manifest = setManifestMeta(manifest, {
      plan: expanded.plan,
      bundles: expanded.bundles,
      sqlServer: input.options?.sqlServer ?? 'mariadb',
      clamav: Boolean(input.options?.clamav),
    });
    for (const id of expanded.components) {
      const def = getComponent(id);
      if (!def) continue;
      const failed = steps.some((s) => s.name === id && s.status === 'failed');
      const blocked = steps.some((s) => s.name === id && s.status === 'blocked');
      if (failed || blocked) continue;
      if (id === 'control-plane-product') continue;
      manifest = upsertComponent(manifest, id, {
        source: def.source,
        packages: def.aptPackages,
        units: def.units,
        dataPaths: def.dataPaths,
      });
    }
    const saved = await saveStackManifest(input.host, input.dataDir, manifest);
    notes.push(...saved.notes);
  }

  const hardFail = steps.some((s) => s.status === 'failed' && !getComponent(s.name.split(':')[0]!)?.optional);
  const anyBlocked = steps.some((s) => s.status === 'blocked');

  return {
    ok: dryRun ? true : !hardFail && !anyBlocked,
    executed: !dryRun,
    dryRun,
    blocked: anyBlocked,
    plan: expanded.plan,
    bundles: expanded.bundles,
    components: expanded.components,
    steps,
    notes,
    manifest,
    requiresExecute: dryRun ? true : undefined,
  };
}

async function removeOneComponent(
  host: HostExecutor,
  id: string,
  dataPolicy: DataPolicy,
  dryRun: boolean,
  dataDir: string,
  manifest: StackManifest,
): Promise<StackStep[]> {
  const steps: StackStep[] = [];
  const def = getComponent(id);
  const entry = manifest.components[id];
  const pkgs = entry?.packages?.length ? entry.packages : def?.aptPackages ?? [];
  const units = entry?.units?.length ? entry.units : def?.units ?? [];
  const dataPaths = entry?.dataPaths?.length ? entry.dataPaths : def?.dataPaths ?? [];

  if (dryRun) {
    steps.push({
      name: id,
      status: 'planned',
      detail: `${dataPolicy}: remove [${pkgs.join(' ')}] data=[${dataPaths.join(' ')}]`,
    });
    return steps;
  }

  for (const u of units) {
    await host.runCommand(['systemctl', 'stop', u], { timeoutMs: 30_000 });
    await host.runCommand(['systemctl', 'disable', u], { timeoutMs: 30_000 });
    steps.push({ name: `${id}:stop:${u}`, status: 'ok' });
  }

  if (id === 'control-plane-product') {
    await host.runCommand(['bash', '-c', 'npm uninstall -g ysk-server 2>/dev/null || true'], {
      timeoutMs: 120_000,
    });
    await host.runCommand(['rm', '-f', '/usr/local/bin/ysk-server'], { timeoutMs: 5_000 });
    if (dataPolicy === 'purge' && dataDir && dataDir !== '/' && isPurgePathAllowed(dataDir) === false) {
      // dataDir may be /var/lib/ysk-server — allow under /var/
      if (dataDir.startsWith('/var/') || dataDir.includes('/.ysk')) {
        await host.runCommand(['rm', '-rf', dataDir], { timeoutMs: 60_000 });
        steps.push({ name: `${id}:purge-dataDir`, status: 'ok', detail: dataDir });
      }
    }
    steps.push({ name: id, status: 'ok', detail: 'product removed' });
    return steps;
  }

  if (id === 'rust') {
    if (dataPolicy === 'purge') {
      for (const p of ['/usr/local/cargo', '/usr/local/rustup']) {
        await host.runCommand(['rm', '-rf', p], { timeoutMs: 60_000 });
      }
      await host.runCommand(['rm', '-f', '/usr/local/bin/cargo', '/usr/local/bin/rustc', '/usr/local/bin/rustup'], {
        timeoutMs: 5_000,
      });
    }
    steps.push({ name: id, status: 'ok', detail: dataPolicy === 'purge' ? 'rust purged' : 'rust untracked (toolchain kept)' });
    return steps;
  }

  const essential = new Set(['sudo', 'bash', 'coreutils', 'apt', 'dpkg']);
  const filtered = pkgs.filter((p) => !essential.has(p));
  if (filtered.length) {
    const mode = dataPolicy === 'purge' ? 'purge' : 'remove';
    const cmd = `export DEBIAN_FRONTEND=noninteractive; apt-get ${mode} -y ${filtered.map((p) => JSON.stringify(p)).join(' ')}`;
    const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 600_000 });
    steps.push({
      name: id,
      status: r.exitCode === 0 ? 'ok' : 'failed',
      detail: r.exitCode === 0 ? mode : r.stderr,
    });
  } else {
    steps.push({ name: id, status: 'ok', detail: 'no apt packages' });
  }

  if (dataPolicy === 'purge') {
    for (const p of dataPaths) {
      if (!isPurgePathAllowed(p)) {
        steps.push({ name: `${id}:purge`, status: 'skipped', detail: `refused path ${p}` });
        continue;
      }
      const r = await host.runCommand(['rm', '-rf', p], { timeoutMs: 120_000 });
      steps.push({
        name: `${id}:purge:${p}`,
        status: r.exitCode === 0 ? 'ok' : 'failed',
        detail: p,
      });
    }
  }

  return steps;
}

export async function uninstallStack(input: {
  host: HostExecutor;
  dataDir: string;
  all?: boolean;
  bundles?: string[];
  components?: string[];
  dataPolicy?: DataPolicy;
  removeProduct?: boolean;
  dryRun?: boolean;
}): Promise<StackOpResult> {
  const dryRun = Boolean(input.dryRun);
  const dataPolicy: DataPolicy = input.dataPolicy ?? 'keep';
  let manifest = await loadStackManifest(input.host, input.dataDir);

  let components: string[] = [];
  if (input.all) {
    components = Object.keys(manifest.components);
    if (!components.length) {
      // fallback: nothing tracked
      components = [];
    }
    if (input.removeProduct !== false) {
      if (!components.includes('control-plane-product')) components.push('control-plane-product');
    }
  } else if (input.bundles?.length) {
    components = expandUninstallComponents(input.bundles);
  } else if (input.components?.length) {
    components = [...input.components];
  }

  if (input.removeProduct && !components.includes('control-plane-product')) {
    components.push('control-plane-product');
  }

  if (!components.length) {
    return {
      ok: false,
      executed: false,
      dryRun,
      components: [],
      dataPolicy,
      steps: [{ name: 'select', status: 'failed', detail: 'no components selected' }],
      notes: ['Specify --all, --bundles, or --components'],
    };
  }

  if (!dryRun) {
    const blocked = blockIfNeeded(input.host);
    if (blocked) {
      return { ...blocked, components, dataPolicy };
    }
  }

  const steps: StackStep[] = [];
  const notes: string[] = [`dataPolicy=${dataPolicy}`, `count=${components.length}`];

  for (const id of components) {
    const s = await removeOneComponent(input.host, id, dataPolicy, dryRun, input.dataDir, manifest);
    steps.push(...s);
    if (!dryRun) {
      manifest = manifestRemoveComponent(manifest, id);
    }
  }

  if (!dryRun) {
    if (input.bundles?.length) {
      manifest = {
        ...manifest,
        bundles: (manifest.bundles ?? []).filter((b) => !input.bundles!.includes(b)),
        updatedAt: new Date().toISOString(),
      };
    }
    const saved = await saveStackManifest(input.host, input.dataDir, manifest);
    notes.push(...saved.notes);
  }

  const hardFail = steps.some((s) => s.status === 'failed');
  return {
    ok: dryRun ? true : !hardFail,
    executed: !dryRun,
    dryRun,
    components,
    dataPolicy,
    steps,
    notes,
    manifest,
    requiresExecute: dryRun ? true : undefined,
  };
}

export type { SqlServerChoice, DataPolicy, ExpandOptions };
