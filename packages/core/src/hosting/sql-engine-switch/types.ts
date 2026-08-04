/**
 * MySQL XOR MariaDB engine switch — types.
 */

export type SqlSwitchTarget = 'mysql' | 'mariadb';
export type SqlSwitchFlavor = SqlSwitchTarget | 'none';

export const SQL_SWITCH_CONFIRM_PHRASE = 'SWITCH' as const;

export type SqlSwitchDbInfo = {
  name: string;
  tableCount?: number;
};

/** Stable codes for UI i18n (never send English prose as the only channel). */
export type SqlSwitchWarningKey =
  | 'replace_engine'
  | 'exclusive'
  | 'uninstall_packages'
  | 'logical_dump'
  | 'dialect_risk'
  | 'no_replication'
  | 'root_auth'
  | 'no_user_dbs'
  | 'has_user_dbs';

export type SqlSwitchPreview = {
  ok: boolean;
  currentFlavor: SqlSwitchFlavor;
  target: SqlSwitchTarget;
  /** True only when the other server flavor is installed and switch is required */
  needsSwitch: boolean;
  canProceed: boolean;
  blockReason?: string;
  databases: SqlSwitchDbInfo[];
  /** Prefer warningKeys + UI t(); kept for logs / non-UI clients */
  warnings: string[];
  /** i18n keys under sqlEngineSwitch.warn.* */
  warningKeys: SqlSwitchWarningKey[];
  confirmPhrase: typeof SQL_SWITCH_CONFIRM_PHRASE;
  dataDirHint: string;
  sourceUnit?: string;
  targetUnit?: string;
  sourceServerId?: string;
  targetServerId?: string;
};

export type SqlSwitchStep = {
  name: string;
  status: 'ok' | 'failed' | 'skipped' | 'blocked';
  detail?: string;
};

export type SqlSwitchResult = {
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  code?: 'needs_confirm' | 'failed_safe' | 'failed_need_manual' | string;
  notes: string[];
  steps: SqlSwitchStep[];
  dumpPath?: string;
  oldDatadirBackup?: string;
  currentFlavor?: SqlSwitchFlavor;
  target?: SqlSwitchTarget;
};
