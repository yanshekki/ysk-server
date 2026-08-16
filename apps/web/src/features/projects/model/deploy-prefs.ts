/**
 * Per-project deploy preferences (entry / skipBuild) in localStorage.
 */

const PREFIX = 'ysk.deployPrefs.v1.';

/** Process supervisor for Node/Bun deploys. Default production path is systemd. */
export type ProcessManager = 'systemd' | 'pm2';

export type DeployPrefs = {
  entry?: string;
  skipBuild?: boolean;
  /** node/bun only; omitted → systemd */
  processManager?: ProcessManager;
};

export function normalizeProcessManager(v: unknown): ProcessManager {
  return v === 'pm2' ? 'pm2' : 'systemd';
}

/** Map UI process manager → deploy API enableSystemd flag. */
export function enableSystemdFromProcessManager(pm: ProcessManager): boolean {
  return pm === 'systemd';
}

export function loadDeployPrefs(projectId: string): DeployPrefs {
  try {
    const raw = localStorage.getItem(PREFIX + projectId);
    if (!raw) return {};
    const o = JSON.parse(raw) as DeployPrefs;
    return {
      entry: typeof o.entry === 'string' ? o.entry : undefined,
      skipBuild: Boolean(o.skipBuild),
      processManager:
        o.processManager === 'pm2' || o.processManager === 'systemd'
          ? o.processManager
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveDeployPrefs(projectId: string, prefs: DeployPrefs): void {
  try {
    const prev = loadDeployPrefs(projectId);
    localStorage.setItem(
      PREFIX + projectId,
      JSON.stringify({
        entry: prefs.entry ?? prev.entry ?? '',
        skipBuild: prefs.skipBuild ?? prev.skipBuild ?? false,
        processManager: normalizeProcessManager(
          prefs.processManager ?? prev.processManager ?? 'systemd',
        ),
      }),
    );
  } catch {
    /* private mode / quota */
  }
}

export function runtimeInstallKind(
  runtime: string,
): 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun' | null {
  if (
    runtime === 'node' ||
    runtime === 'php' ||
    runtime === 'python' ||
    runtime === 'go' ||
    runtime === 'rust' ||
    runtime === 'java' ||
    runtime === 'kotlin' ||
    runtime === 'bun'
  ) {
    return runtime;
  }
  return null;
}

export function runtimePagePath(runtime: string): string | null {
  const k = runtimeInstallKind(runtime);
  return k ? `/runtimes/${k}` : null;
}

/**
 * Offline placeholder only — UI should prefer fetchRuntimeVersionChoices (discovery).
 * Not a product SSOT for installable versions.
 */
export function defaultRuntimeInstallVersion(runtime: string): string {
  if (runtime === 'php') return '8.3';
  if (runtime === 'python') return '3.12';
  if (runtime === 'go') return '1.22';
  if (runtime === 'rust') return 'stable';
  if (runtime === 'node') return '20';
  if (runtime === 'java') return '21';
  if (runtime === 'kotlin') return '2.1.0';
  if (runtime === 'bun') return 'latest';
  return '';
}

/**
 * Offline fallback choices when software/versions is unavailable.
 * Prefer {@link fetchRuntimeVersionChoices} in UI.
 */
export function runtimeVersionChoices(runtime: string): string[] {
  const def = defaultRuntimeInstallVersion(runtime);
  if (!def) return [];
  // Minimal offline set (single pin + common neighbors) — not a hard-coded product menu
  if (runtime === 'php') return ['8.2', '8.3', '8.4', '8.5'];
  if (runtime === 'node') return ['20', '22', '24'];
  if (runtime === 'python') return ['3.11', '3.12', '3.13', '3.14'];
  if (runtime === 'go') return ['1.22', '1.23', '1.24', '1.25', '1.26'];
  if (runtime === 'rust') return ['stable'];
  if (runtime === 'java') return ['17', '21'];
  if (runtime === 'kotlin') return [def];
  if (runtime === 'bun') return ['latest'];
  return def ? [def] : [];
}

/** Load version chips from version-discovery API (no hardcode). */
export async function fetchRuntimeVersionChoices(
  runtime: string,
): Promise<{ choices: string[]; labels?: Record<string, string>; latest?: string; source?: string }> {
  const kind = runtimeInstallKind(runtime);
  if (!kind) return { choices: [] };
  try {
    const { systemApi } = await import('../../system');
    const h = await Promise.race([
      systemApi.softwareVersions({ id: kind, refresh: false }),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error('timeout')), 8_000);
      }),
    ]);
    const choices = (h.candidates ?? [])
      .map((c) => c.version)
      .filter((v): v is string => Boolean(v));
    if (choices.length) {
      const labels: Record<string, string> = {};
      for (const c of h.candidates ?? []) {
        if (c.version && c.label) labels[c.version] = c.label;
      }
      return {
        choices,
        labels,
        latest: h.latestVersion || choices[0],
        source: h.source,
      };
    }
  } catch {
    /* offline / timeout — fall back */
  }
  const fallback = runtimeVersionChoices(runtime);
  return {
    choices: fallback,
    latest: defaultRuntimeInstallVersion(runtime) || fallback[0],
    source: 'offline-fallback',
  };
}
