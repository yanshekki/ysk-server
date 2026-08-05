/**
 * Per-project deploy preferences (entry / skipBuild) in localStorage.
 */

const PREFIX = 'ysk.deployPrefs.v1.';

export type DeployPrefs = {
  entry?: string;
  skipBuild?: boolean;
};

export function loadDeployPrefs(projectId: string): DeployPrefs {
  try {
    const raw = localStorage.getItem(PREFIX + projectId);
    if (!raw) return {};
    const o = JSON.parse(raw) as DeployPrefs;
    return {
      entry: typeof o.entry === 'string' ? o.entry : undefined,
      skipBuild: Boolean(o.skipBuild),
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

export function defaultRuntimeInstallVersion(runtime: string): string {
  if (runtime === 'php') return '8.2';
  if (runtime === 'python') return '3.12';
  if (runtime === 'go') return '1.22';
  if (runtime === 'rust') return 'stable';
  if (runtime === 'node') return '20';
  if (runtime === 'java') return '21';
  if (runtime === 'kotlin') return '2.1.0';
  if (runtime === 'bun') return 'latest';
  return '';
}

/** Versions offered in project deploy tab (must match core supported lists). */
export function runtimeVersionChoices(runtime: string): string[] {
  if (runtime === 'php') return ['8.1', '8.2', '8.3'];
  if (runtime === 'node') return ['18', '20', '22'];
  if (runtime === 'python') return ['3.10', '3.11', '3.12'];
  if (runtime === 'go') return ['1.21', '1.22', '1.23'];
  if (runtime === 'rust') return ['stable', '1.78', '1.81'];
  if (runtime === 'java') return ['17', '21'];
  if (runtime === 'kotlin') return ['2.1.0', '2.0.21'];
  if (runtime === 'bun') return ['latest', '1.1.38'];
  return [];
}
