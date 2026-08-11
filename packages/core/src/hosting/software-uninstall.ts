/**
 * Feature / catalog software uninstall with impact preview.
 * Shares apt remove/purge patterns with stack uninstall.
 */

import { tl } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import {
  getSoftware,
  listSoftwareForFeature,
  resolveSoftwareTitle,
  type SoftwareSpec,
} from './software-catalog.js';
import {
  probeAllSoftware,
  probeSoftware,
  type SoftwareInstallStep,
  type SoftwareStatus,
} from './software-install.js';
import { panelBlockMessage } from './system-apply.js';
import { isPurgePathAllowed } from './stack/definitions.js';

export type UninstallDataPolicy = 'keep' | 'purge';

export type UninstallTarget = {
  id: string;
  title: string;
  installed: boolean;
  packages: string[];
  units: string[];
  dataPaths: string[];
  impactKeys: string[];
  protected: boolean;
  installer?: string;
};

export type UninstallPreview = {
  ok: boolean;
  targets: UninstallTarget[];
  summary: {
    packageCount: number;
    unitCount: number;
    installedCount: number;
    willStopServices: boolean;
    willTouchData: boolean;
  };
  warningKeys: string[];
  confirmPhrase: string;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
};

export type UninstallResult = {
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  dataPolicy: UninstallDataPolicy;
  targets: string[];
  steps: SoftwareInstallStep[];
  notes: string[];
  statuses: SoftwareStatus[];
};

/**
 * Never one-click uninstall these catalog ids (shared host tools / control plane).
 * Git is required by deploy, clone, and panel ops — never remove with a runtime stack.
 */
const PROTECTED_IDS = new Set<string>(['git']);

function essentialPkgs(): Set<string> {
  return new Set(['sudo', 'bash', 'coreutils', 'apt', 'dpkg', 'libc6']);
}

export function resolveUninstallIds(input: {
  feature?: string;
  ids?: string[];
}): string[] {
  if (input.ids?.length) {
    return [...new Set(input.ids.map(String))];
  }
  if (input.feature) {
    return listSoftwareForFeature(input.feature).map((s) => s.id);
  }
  return [];
}

function targetFromSpec(
  spec: SoftwareSpec,
  installed: boolean,
): UninstallTarget {
  return {
    id: spec.id,
    title: resolveSoftwareTitle(spec),
    installed,
    packages: [...(spec.aptPackages ?? [])],
    units: [...(spec.units ?? [])],
    dataPaths: [...(spec.dataPaths ?? [])],
    impactKeys: [...(spec.impactKeys ?? ['generic'])],
    protected: Boolean(spec.uninstallProtected || PROTECTED_IDS.has(spec.id)),
    installer: spec.installer,
  };
}

export async function previewSoftwareUninstall(input: {
  host: HostExecutor;
  feature?: string;
  ids?: string[];
  dataPolicy?: UninstallDataPolicy;
}): Promise<UninstallPreview> {
  const dataPolicy: UninstallDataPolicy = input.dataPolicy === 'purge' ? 'purge' : 'keep';
  const ids = resolveUninstallIds(input);
  if (!ids.length) {
    return {
      ok: false,
      targets: [],
      summary: {
        packageCount: 0,
        unitCount: 0,
        installedCount: 0,
        willStopServices: false,
        willTouchData: false,
      },
      warningKeys: [],
      confirmPhrase: 'UNINSTALL',
      notes: [tl('notes.software.uninstallNoTargets')],
    };
  }

  const targets: UninstallTarget[] = [];
  for (const id of ids) {
    const spec = getSoftware(id);
    if (!spec) continue;
    const st = await probeSoftware(input.host, spec);
    targets.push(targetFromSpec(spec, st.installed));
  }

  const installed = targets.filter((t) => t.installed);
  const protectedHit = installed.filter((t) => t.protected);
  const packageCount = installed.reduce((n, t) => n + t.packages.length, 0);
  const unitCount = installed.reduce((n, t) => n + t.units.length, 0);
  const willTouchData =
    dataPolicy === 'purge' &&
    installed.some((t) => t.dataPaths.some((p) => isPurgePathAllowed(p)));

  const warningKeys: string[] = [];
  for (const t of installed) {
    for (const k of t.impactKeys) {
      if (!warningKeys.includes(k)) warningKeys.push(k);
    }
  }
  if (dataPolicy === 'purge') warningKeys.push('purgeData');
  if (protectedHit.length) warningKeys.push('protectedSkipped');

  const notes: string[] = [];
  if (!installed.length) {
    notes.push(tl('notes.software.uninstallNothingInstalled'));
  }
  if (protectedHit.length) {
    notes.push(
      tl('notes.software.uninstallProtected', {
        ids: protectedHit.map((t) => t.id).join(', '),
      }),
    );
  }

  return {
    ok: true,
    targets,
    summary: {
      packageCount,
      unitCount,
      installedCount: installed.length,
      willStopServices: unitCount > 0,
      willTouchData,
    },
    warningKeys,
    confirmPhrase: 'UNINSTALL',
    notes,
  };
}

async function removeOneSoftware(
  host: HostExecutor,
  spec: SoftwareSpec,
  dataPolicy: UninstallDataPolicy,
  log?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void,
): Promise<SoftwareInstallStep[]> {
  const steps: SoftwareInstallStep[] = [];
  const id = spec.id;
  const emit = (line: string, stream: 'stdout' | 'stderr' | 'status' = 'status') => {
    log?.(stream, line);
  };

  if (spec.uninstallProtected || PROTECTED_IDS.has(id)) {
    steps.push({
      name: id,
      status: 'skipped',
      detail: 'protected',
    });
    emit(`skip protected ${id}`);
    return steps;
  }

  emit(`stop units: ${(spec.units ?? []).join(', ') || '—'}`);
  for (const u of spec.units ?? []) {
    await host.runCommand(['systemctl', 'stop', u], { timeoutMs: 30_000 });
    await host.runCommand(['systemctl', 'disable', u], { timeoutMs: 30_000 });
    steps.push({ name: `${id}:stop:${u}`, status: 'ok' });
    emit(`stopped ${u}`);
  }

  // Runtime installers: remove every probed version via uninstallRuntimeVersion
  if (spec.installer && spec.installer.startsWith('runtime-')) {
    const kindMap: Record<string, string> = {
      'runtime-node': 'node',
      'runtime-php': 'php',
      'runtime-python': 'python',
      'runtime-go': 'go',
      'runtime-rust': 'rust',
      'runtime-java': 'java',
      'runtime-kotlin': 'kotlin',
      'runtime-bun': 'bun',
    };
    const kind = kindMap[spec.installer];
    if (kind) {
      try {
        const { probeRuntimes, uninstallRuntimeVersion } = await import(
          './runtime-probe.js'
        );
        const probe = await probeRuntimes(host, {});
        const items = (probe as unknown as Record<string, unknown>)[kind];
        const list = Array.isArray(items) ? items : [];
        const versions = [
          ...new Set(
            list
              .filter((i) => i && typeof i === 'object' && (i as { available?: boolean }).available)
              .map((i) => String((i as { version?: string }).version ?? '').trim())
              .filter(Boolean),
          ),
        ];
        // Fallback to catalog pin when probe empty but binary present
        if (!versions.length && spec.runtimeVersion) {
          versions.push(String(spec.runtimeVersion));
        }
        emit(`runtime ${kind}: uninstall versions ${versions.join(', ') || '—'}`);
        for (const ver of versions) {
          const ur = await uninstallRuntimeVersion({
            host,
            kind: kind as 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun',
            version: ver,
          });
          steps.push({
            name: `${id}:version:${ver}`,
            status: ur.ok ? 'ok' : ur.blocked ? 'skipped' : 'failed',
            detail: (ur.notes ?? []).slice(0, 3).join(' · ') || ver,
          });
          for (const n of (ur.notes ?? []).slice(0, 6)) emit(n);
        }
        if (!versions.length) {
          steps.push({
            name: id,
            status: 'ok',
            detail: 'runtime: no versions probed',
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push({ name: id, status: 'failed', detail: msg.slice(0, 200) });
        emit(`runtime uninstall error: ${msg}`, 'stderr');
      }
    }
    // Still try apt if listed below
  }

  if (spec.installer === 'npm-global' && (spec.npmPackages ?? []).length) {
    const pkgs = (spec.npmPackages ?? []).map((p) => JSON.stringify(p)).join(' ');
    emit(`npm uninstall -g ${pkgs}`);
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        `if command -v npm >/dev/null 2>&1; then npm uninstall -g ${pkgs} 2>&1; else echo "npm missing" >&2; exit 2; fi`,
      ],
      { timeoutMs: 180_000 },
    );
    const out = (r.stdout || r.stderr || '').trim();
    if (out) {
      for (const line of out.split('\n').slice(-20)) {
        log?.(r.exitCode === 0 ? 'stdout' : 'stderr', line);
      }
    }
    steps.push({
      name: `${id}:npm`,
      status: r.exitCode === 0 ? 'ok' : 'failed',
      detail: out.slice(0, 200) || 'npm-global',
    });
  }

  const essential = essentialPkgs();
  const filtered = (spec.aptPackages ?? []).filter((p) => !essential.has(p));
  if (filtered.length) {
    const mode = dataPolicy === 'purge' ? 'purge' : 'remove';
    emit(`apt-get ${mode} ${filtered.join(' ')}`);
    const cmd = `export DEBIAN_FRONTEND=noninteractive; apt-get ${mode} -y ${filtered.map((p) => JSON.stringify(p)).join(' ')} 2>&1`;
    const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 600_000 });
    const out = (r.stdout || r.stderr || '').trim();
    if (out) {
      for (const line of out.split('\n').slice(-40)) {
        log?.(r.exitCode === 0 ? 'stdout' : 'stderr', line);
      }
    }
    steps.push({
      name: id,
      status: r.exitCode === 0 ? 'ok' : 'failed',
      detail: r.exitCode === 0 ? mode : out.slice(0, 300),
    });
  } else if (!spec.installer) {
    steps.push({ name: id, status: 'ok', detail: 'no apt packages' });
  }

  if (dataPolicy === 'purge') {
    for (const p of spec.dataPaths ?? []) {
      if (!isPurgePathAllowed(p)) {
        steps.push({ name: `${id}:purge`, status: 'skipped', detail: `refused ${p}` });
        emit(`purge refused ${p}`, 'stderr');
        continue;
      }
      emit(`rm -rf ${p}`);
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

export async function uninstallSoftware(input: {
  host: HostExecutor;
  feature?: string;
  ids?: string[];
  dataPolicy?: UninstallDataPolicy;
  /** Must match preview confirmPhrase */
  confirmPhrase?: string;
  /** Optional live log */
  onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
}): Promise<UninstallResult> {
  const dataPolicy: UninstallDataPolicy =
    input.dataPolicy === 'purge' ? 'purge' : 'keep';
  const preview = await previewSoftwareUninstall({
    host: input.host,
    feature: input.feature,
    ids: input.ids,
    dataPolicy,
  });

  if (input.confirmPhrase !== preview.confirmPhrase) {
    return {
      ok: false,
      executed: false,
      dataPolicy,
      targets: [],
      steps: [],
      notes: [tl('notes.software.uninstallConfirmMismatch')],
      statuses: [],
    };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    const msg = !input.host.executeEnabled()
      ? panelBlockMessage('no_execute')
      : panelBlockMessage('no_root');
    return {
      ok: false,
      executed: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: msg,
      dataPolicy,
      targets: preview.targets.map((t) => t.id),
      steps: [{ name: 'auth', status: 'blocked', detail: msg }],
      notes: [msg],
      statuses: await probeAllSoftware(input.host, input.feature ?? 'all'),
    };
  }

  const toRemove = preview.targets.filter((t) => t.installed && !t.protected);
  if (!toRemove.length) {
    return {
      ok: true,
      executed: false,
      dataPolicy,
      targets: [],
      steps: [],
      notes: [tl('notes.software.uninstallNothingInstalled')],
      statuses: await probeAllSoftware(
        input.host,
        input.feature ?? 'all',
      ),
    };
  }

  input.onLog?.('status', `uninstall start policy=${dataPolicy} n=${toRemove.length}`);
  const steps: SoftwareInstallStep[] = [];
  const notes: string[] = [];

  for (const t of toRemove) {
    const spec = getSoftware(t.id);
    if (!spec) continue;
    input.onLog?.('status', `— ${t.title} (${t.id})`);
    const s = await removeOneSoftware(input.host, spec, dataPolicy, input.onLog);
    steps.push(...s);
  }

  const failed = steps.some((s) => s.status === 'failed');
  const statuses = input.feature
    ? await probeAllSoftware(input.host, input.feature)
    : await Promise.all(
        toRemove.map(async (t) => {
          const spec = getSoftware(t.id)!;
          return probeSoftware(input.host, spec);
        }),
      );

  if (!failed) {
    notes.push(tl('notes.software.uninstallOk', { n: toRemove.length }));
  } else {
    notes.push(tl('notes.software.uninstallPartial'));
  }
  input.onLog?.('status', failed ? 'uninstall finished with errors' : 'uninstall done');

  return {
    ok: !failed,
    executed: true,
    dataPolicy,
    targets: toRemove.map((t) => t.id),
    steps,
    notes,
    statuses,
  };
}
