/**
 * Real self-update steps: check npm registry, plan download, optional npm install -g.
 */

import { planSelfUpdate, compareVersions, isValidSha256 } from './self-update.js';
import type { HostExecutor } from '../host/executor.js';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface RegistryVersion {
  latest: string;
  tarball?: string;
  shasum?: string;
}

/**
 * Query npm registry for package latest version.
 */
export async function fetchNpmLatest(packageName = 'ysk-server'): Promise<RegistryVersion> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, `npm registry HTTP ${res.status}`, {
      httpStatus: 502,
    });
  }
  const body = (await res.json()) as {
    version?: string;
    dist?: { tarball?: string; shasum?: string };
  };
  if (!body.version) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, 'npm latest missing version', { httpStatus: 502 });
  }
  return {
    latest: body.version,
    tarball: body.dist?.tarball,
    shasum: body.dist?.shasum,
  };
}

/**
 * Build and optionally apply self-update via npm install -g.
 */
export async function runSelfUpdate(input: {
  currentVersion: string;
  host: HostExecutor;
  packageName?: string;
  apply?: boolean;
  latestOverride?: string;
}): Promise<{
  registry?: RegistryVersion;
  plan: ReturnType<typeof planSelfUpdate>;
  applied: boolean;
  /** false when apply was requested but did not succeed */
  ok: boolean;
  commandResults: Array<{ argv: string[]; exitCode: number; stdout: string; stderr: string }>;
  notes: string[];
}> {
  const notes: string[] = [];
  let registry: RegistryVersion | undefined;
  let latest = input.latestOverride;
  if (!latest) {
    try {
      registry = await fetchNpmLatest(input.packageName ?? 'ysk-server');
      latest = registry.latest;
      if (registry.shasum && !isValidSha256(registry.shasum) && registry.shasum.length !== 40) {
        notes.push('registry shasum is not sha256 (npm uses sha1 often) — verify via npm integrity');
      }
    } catch (e) {
      notes.push(`registry fetch failed: ${e instanceof Error ? e.message : e}`);
      latest = input.currentVersion;
    }
  }

  const plan = planSelfUpdate({
    current: input.currentVersion,
    latest: latest!,
    checksumSha256: registry?.shasum && isValidSha256(registry.shasum) ? registry.shasum : undefined,
  });

  const commandResults: Array<{
    argv: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];
  let applied = false;

  if (input.apply && plan.status.updateAvailable) {
    if (!input.host.executeEnabled()) {
      notes.push('apply skipped: set YSK_EXECUTE=1');
    } else {
      const pkg = `${input.packageName ?? 'ysk-server'}@${latest}`;
      const r = await input.host.runCommand(['npm', 'install', '-g', pkg], { timeoutMs: 300_000 });
      commandResults.push({
        argv: ['npm', 'install', '-g', pkg],
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
      });
      applied = r.exitCode === 0;
      notes.push(applied ? `installed ${pkg}` : `npm install failed: ${r.stderr}`);
    }
  } else if (!plan.status.updateAvailable) {
    notes.push('already up to date');
  }

  const ok = input.apply
    ? applied || !plan.status.updateAvailable
    : true;
  if (input.apply && plan.status.updateAvailable && !applied) {
    // ensure callers can detect refuse without fake success
    if (!notes.some((n) => /YSK_EXECUTE|failed|already/i.test(n))) {
      notes.push('apply did not complete');
    }
  }

  return { registry, plan, applied, commandResults, notes, ok };
}

export { compareVersions };
