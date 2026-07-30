/**
 * Host full-migrate contract (整機遷移).
 * Inventory + job state shared by core, API, CLI, web.
 */

import type { OpsResultDto } from './ops.js';

export type MigratePhase =
  | 'inventory'
  | 'preflight'
  | 'package'
  | 'transfer'
  | 'bootstrap'
  | 'restore'
  | 'reapply'
  | 'verify'
  | 'done'
  | 'failed';

export const MIGRATE_PHASES: readonly MigratePhase[] = [
  'inventory',
  'preflight',
  'package',
  'transfer',
  'bootstrap',
  'restore',
  'reapply',
  'verify',
  'done',
  'failed',
] as const;

export type MigrateDbEngine = 'mysql' | 'mariadb' | 'postgres';

export interface HostManifestProject {
  id: string;
  name: string;
  home_dir: string;
  linux_user: string;
  linux_group?: string;
  runtime: string;
  domain?: string;
  /** Numeric uid on source (when resolvable) */
  uid?: number;
  gid?: number;
  /** Home exists on disk at inventory time */
  homeExists: boolean;
  bind_ip?: string;
}

export interface HostManifestDatabase {
  engine: MigrateDbEngine;
  name: string;
  /** Registry row id if any */
  id?: string;
  username?: string;
  /** Relative to dataDir after package phase */
  dumpRelPath?: string;
  bytes?: number;
}

export interface HostManifestRedis {
  id: string;
  name?: string;
  /** Relative to dataDir after package phase */
  rdbRelPath?: string;
  bytes?: number;
}

export interface HostManifestMailbox {
  id: string;
  domain: string;
  local: string;
  maildirRelPath: string;
  exists: boolean;
}

/**
 * Complete source inventory for lossless host migration.
 * version bumps only when fields are incompatible.
 */
export interface HostManifest {
  version: 1;
  createdAt: string;
  source: {
    hostname: string;
    os: string;
    arch: string;
    dataDir: string;
    yskVersion: string;
    nodeVersion: string;
  };
  /** Entity counts from control-plane store (+ disk facts where noted) */
  counts: Record<string, number>;
  projects: HostManifestProject[];
  databases: HostManifestDatabase[];
  redis: HostManifestRedis[];
  mailboxes: HostManifestMailbox[];
  emailDomains: Array<{ id: string; domain: string }>;
  /**
   * Software catalog ids needed on target (align with core SoftwareId strings).
   * e.g. nginx, mysql-server, postfix, node, php
   */
  softwareNeeded: string[];
  paths: {
    dataDir: string;
    /** Absolute project homes to rsync */
    homes: string[];
    /** Optional host paths (e.g. /etc/letsencrypt) */
    optionalEtc: string[];
    /** Relative paths under dataDir that must exist */
    dataDirCritical: string[];
  };
  /** sha256 hex of key artifacts for post-transfer verify */
  fingerprints: Record<string, string>;
  /** Non-fatal issues operator must review */
  warnings: string[];
  /** Operator-chosen exclusion globs (not applied in inventory itself) */
  exclusions: string[];
  /** Domains / hostnames for DNS cutover checklist */
  cutoverHostnames: string[];
  /** Set after package phase completes dumps */
  packagedAt?: string;
}

export interface MigrateJobStep {
  id: string;
  phase: MigratePhase;
  name: string;
  at: string;
  result: OpsResultDto;
}

export interface MigrateJobTarget {
  host: string;
  port: number;
  user: string;
  /** Optional outbound identity vault id (never store password here) */
  identityId?: string;
}

export interface MigrateJobVerify {
  productionReady?: boolean;
  mismatches: string[];
  notes: string[];
}

/**
 * Persistable migrate job (no secrets).
 * Lives under `{dataDir}/migrate/{id}/job.json`.
 */
export interface MigrateJobDto {
  id: string;
  phase: MigratePhase;
  target?: MigrateJobTarget;
  /** Target dataDir (default /var/lib/ysk-server) */
  targetDataDir: string;
  forceWipeTarget?: boolean;
  maintenanceAccepted?: boolean;
  manifest?: HostManifest;
  steps: MigrateJobStep[];
  verify?: MigrateJobVerify;
  createdAt: string;
  updatedAt: string;
  /** Last error summary */
  lastError?: string;
}

export function isMigratePhase(v: unknown): v is MigratePhase {
  return typeof v === 'string' && (MIGRATE_PHASES as readonly string[]).includes(v);
}
