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

export function clusterEngineFromServiceRow(row: {
  id?: string;
  unit?: string;
  label?: string;
  installed?: boolean;
  active?: string;
}): ClusterEngine | null {
  const blob = `${row.id ?? ''} ${row.unit ?? ''} ${row.label ?? ''}`.toLowerCase();
  if (blob.includes('mariadb')) return 'mariadb';
  if (blob.includes('mysql')) return 'mysql';
  if (blob.includes('postgres') || blob.includes('postgresql')) return 'postgres';
  if (blob.includes('redis')) return 'redis';
  return null;
}

export function serviceRowLooksInstalled(row: {
  installed?: boolean;
  active?: string;
}): boolean {
  if (row.installed === true) return true;
  const a = String(row.active ?? '');
  return a === 'active' || a === 'running';
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
