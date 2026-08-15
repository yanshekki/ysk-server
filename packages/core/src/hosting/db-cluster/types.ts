/**
 * Database engine HA cluster — registry + plan types.
 * Honest stages: draft → planned → written → applied → healthy|degraded.
 */

export type DbClusterEngine = 'mysql' | 'mariadb' | 'postgres' | 'redis';

export type DbClusterKind =
  | 'mariadb-galera'
  | 'mysql-replica'
  | 'postgres-replica'
  | 'redis-replica'
  | 'redis-sentinel';

export type DbClusterStatus =
  | 'draft'
  | 'planned'
  | 'partial'
  | 'healthy'
  | 'degraded'
  | 'failed';

export type MemberAccess = 'local' | 'ssh' | 'fleet';

export type MemberApplyStatus = 'none' | 'planned' | 'written' | 'applied' | 'failed';

export type ClusterStepKind = 'conf' | 'command' | 'manual' | 'probe';

export type ClusterStepRisk = 'read' | 'write-panel' | 'execute-host';

export interface DbClusterMemberProbe {
  at: string;
  ok: boolean;
  facts: Record<string, string>;
  notes: string[];
}

export interface DbClusterMember {
  id: string;
  /** Galera: node|arbiter · MySQL/PG: primary|replica · Redis: master|replica|sentinel */
  role: string;
  host: string;
  port: number;
  label?: string;
  access: MemberAccess;
  fleetAgentId?: string;
  ssh?: {
    username: string;
    port: number;
    /** Optional vault identity for -i (panel_outbound) */
    identityId?: string;
  };
  applyStatus: MemberApplyStatus;
  lastProbe?: DbClusterMemberProbe;
}

export interface DbCluster {
  id: string;
  name: string;
  engine: DbClusterEngine;
  kind: DbClusterKind;
  status: DbClusterStatus;
  members: DbClusterMember[];
  params: Record<string, string | number | boolean>;
  artifactDir?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClusterPlanStep {
  id: string;
  memberId?: string;
  title: string;
  kind: ClusterStepKind;
  body?: string;
  argv?: string[];
  risk: ClusterStepRisk;
}

export interface ClusterPlan {
  ok: boolean;
  dryRun: true;
  clusterId: string;
  kind: DbClusterKind;
  engine: DbClusterEngine;
  steps: ClusterPlanStep[];
  files: Array<{ relativePath: string; body: string }>;
  notes: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
}

export interface CreateDbClusterInput {
  name: string;
  engine: DbClusterEngine;
  kind: DbClusterKind;
  members?: Array<Partial<DbClusterMember> & { host: string; role?: string }>;
  params?: Record<string, string | number | boolean>;
}
