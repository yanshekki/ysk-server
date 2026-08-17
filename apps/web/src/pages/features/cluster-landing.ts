/** /cluster landing — pick an installed engine, never dump onto missing MySQL. */

export type ClusterEngine = 'mysql' | 'mariadb' | 'postgres' | 'redis';

export const CLUSTER_ENGINE_ORDER: readonly ClusterEngine[] = [
  'mariadb',
  'postgres',
  'redis',
  'mysql',
];

export function clusterServicePath(engine: string): string {
  return `/databases/${engine}/service?tab=cluster&from=cluster`;
}

export function pickClusterLandingPath(opts: {
  clusters: Array<{ engine: string }>;
  installed: Partial<Record<ClusterEngine, boolean>>;
}): string | null {
  const installed = CLUSTER_ENGINE_ORDER.filter((e) => opts.installed[e] === true);
  const clusterEngines = opts.clusters
    .map((c) => c.engine)
    .filter((e): e is ClusterEngine =>
      (CLUSTER_ENGINE_ORDER as readonly string[]).includes(e),
    );
  const preferred = clusterEngines.find((e) => opts.installed[e] === true);
  if (preferred) return clusterServicePath(preferred);
  if (installed[0]) return clusterServicePath(installed[0]);
  return null;
}

export function isStaleClusterPlan(
  c: { status: string; createdAt: string },
  now = Date.now(),
): boolean {
  if (c.status !== 'planned' && c.status !== 'draft') return false;
  const t = Date.parse(c.createdAt);
  if (!Number.isFinite(t)) return false;
  return now - t > 7 * 24 * 60 * 60 * 1000;
}
