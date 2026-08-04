/**
 * stack-manifest.json — records what YSK install/uninstall owns.
 */

import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { SqlServerChoice } from './definitions.js';

export type ManifestComponent = {
  source: string;
  packages: string[];
  units: string[];
  dataPaths: string[];
  installedAt: string;
};

export type StackManifest = {
  version: 1;
  product: 'ysk-server';
  installedAt: string;
  updatedAt: string;
  plan: string;
  bundles: string[];
  options: {
    sqlServer?: SqlServerChoice;
    clamav?: boolean;
  };
  components: Record<string, ManifestComponent>;
  dataDir: string;
  installLog?: string;
  inferred?: boolean;
};

export function emptyManifest(dataDir: string, plan = 'unknown'): StackManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    product: 'ysk-server',
    installedAt: now,
    updatedAt: now,
    plan,
    bundles: [],
    options: {},
    components: {},
    dataDir,
  };
}

export function manifestPath(dataDir: string): string {
  return join(dataDir, 'stack-manifest.json');
}

export async function loadStackManifest(
  host: HostExecutor,
  dataDir: string,
): Promise<StackManifest> {
  const path = manifestPath(dataDir);
  if (!host.pathExists(path)) {
    return emptyManifest(dataDir);
  }
  try {
    const raw = await host.readFile(path);
    const j = JSON.parse(raw) as StackManifest;
    if (!j || typeof j !== 'object') return emptyManifest(dataDir);
    return {
      ...emptyManifest(dataDir),
      ...j,
      version: 1,
      components: j.components ?? {},
      bundles: Array.isArray(j.bundles) ? j.bundles : [],
      options: j.options ?? {},
      dataDir: j.dataDir || dataDir,
    };
  } catch {
    return emptyManifest(dataDir);
  }
}

export async function saveStackManifest(
  host: HostExecutor,
  dataDir: string,
  manifest: StackManifest,
): Promise<{ ok: boolean; path: string; notes: string[] }> {
  const path = manifestPath(dataDir);
  const notes: string[] = [];
  const next: StackManifest = {
    ...manifest,
    version: 1,
    product: 'ysk-server',
    updatedAt: new Date().toISOString(),
    dataDir,
  };
  try {
    await host.mkdirp(dataDir);
    await host.writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    notes.push(`manifest saved: ${path}`);
    return { ok: true, path, notes };
  } catch (e) {
    notes.push(`manifest save failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, path, notes };
  }
}

export function upsertComponent(
  m: StackManifest,
  id: string,
  partial: Partial<ManifestComponent> & { source?: string },
): StackManifest {
  const now = new Date().toISOString();
  const prev = m.components[id];
  return {
    ...m,
    updatedAt: now,
    components: {
      ...m.components,
      [id]: {
        source: partial.source ?? prev?.source ?? 'apt',
        packages: partial.packages ?? prev?.packages ?? [],
        units: partial.units ?? prev?.units ?? [],
        dataPaths: partial.dataPaths ?? prev?.dataPaths ?? [],
        installedAt: prev?.installedAt ?? now,
      },
    },
  };
}

export function removeComponent(m: StackManifest, id: string): StackManifest {
  const { [id]: _drop, ...rest } = m.components;
  return {
    ...m,
    updatedAt: new Date().toISOString(),
    components: rest,
  };
}

export function setManifestMeta(
  m: StackManifest,
  meta: {
    plan: string;
    bundles: string[];
    sqlServer?: SqlServerChoice;
    clamav?: boolean;
    installLog?: string;
  },
): StackManifest {
  return {
    ...m,
    plan: meta.plan,
    bundles: meta.bundles,
    options: {
      ...m.options,
      sqlServer: meta.sqlServer ?? m.options.sqlServer,
      clamav: meta.clamav ?? m.options.clamav,
    },
    installLog: meta.installLog ?? m.installLog,
    updatedAt: new Date().toISOString(),
    installedAt: m.installedAt || new Date().toISOString(),
  };
}
