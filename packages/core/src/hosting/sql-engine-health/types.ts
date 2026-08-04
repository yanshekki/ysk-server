/**
 * Generic SQL server health model (MySQL / MariaDB).
 * Not a one-off for FROZEN — catalog of findings → repair plan → execute.
 */

export type SqlEngineFlavor = 'mysql' | 'mariadb';

/** Machine-readable finding codes (stable for UI/i18n). */
export type SqlFindingId =
  | 'package_missing'
  | 'unit_not_active'
  | 'unit_failed'
  | 'frozen_marker'
  | 'datadir_uninitialized'
  | 'config_flavor_mismatch'
  | 'residual_foreign_plugins'
  | 'port_conflict'
  | 'client_missing';

export type FindingSeverity = 'info' | 'warn' | 'error' | 'blocker';

export type SqlFinding = {
  id: SqlFindingId;
  severity: FindingSeverity;
  /** sqlEngineHealth.finding.<id> */
  messageKey: string;
  params?: Record<string, string | number | boolean>;
  evidence?: string;
};

/** Ordered repair actions derived from findings (generic pipeline). */
export type SqlRepairActionId =
  | 'stop_unit'
  | 'clear_frozen'
  | 'sanitize_config'
  | 'init_datadir'
  | 'reset_failed'
  | 'enable_unit'
  | 'start_unit'
  | 'verify_active';

export type SqlRepairAction = {
  id: SqlRepairActionId;
  /** findings that caused this action to be scheduled */
  because: SqlFindingId[];
  /**
   * true = needs explicit operator confirm (destructive / data-touching).
   * Pipeline as a whole requires confirm if any action does.
   */
  requiresConfirm: boolean;
  /** sqlEngineHealth.action.<id> */
  messageKey: string;
};

export type SqlEngineHealthReport = {
  flavor: SqlEngineFlavor;
  unit: string;
  healthy: boolean;
  serverInstalled: boolean;
  clientInstalled: boolean;
  active: string;
  findings: SqlFinding[];
  repairPlan: SqlRepairAction[];
  /** true if any repair action needs confirm */
  requiresConfirm: boolean;
  frozen: boolean;
  frozenMode?: string;
  datadirUninitialized: boolean;
  configPointsTo?: string;
  executeEnabled: boolean;
  isRoot: boolean;
};

export type SqlRepairStepResult = {
  id: SqlRepairActionId;
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
};

export type SqlRepairResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  code?: 'needs_confirm' | string;
  notes: string[];
  steps: SqlRepairStepResult[];
  healthAfter?: SqlEngineHealthReport;
};
