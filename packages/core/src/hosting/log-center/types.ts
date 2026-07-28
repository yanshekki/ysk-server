/**
 * System Log Center types.
 */

export type LogSourceKind = 'journal' | 'file' | 'project';

export type LogPriority =
  | 'emerg'
  | 'alert'
  | 'crit'
  | 'err'
  | 'warning'
  | 'notice'
  | 'info'
  | 'debug';

export type LogSincePreset = '15m' | '1h' | '6h' | '24h' | '7d';

export interface LogSourceDef {
  id: string;
  kind: LogSourceKind;
  label: string;
  description?: string;
  /** journal unit name */
  unit?: string;
  /** candidate absolute paths (first existing wins) */
  paths?: string[];
  group: 'system' | 'web' | 'mail' | 'security' | 'app' | 'other';
  defaultEnabled: boolean;
}

export interface LogSourceStatus extends LogSourceDef {
  available: boolean;
  resolvedPath?: string;
  bytes?: number;
  mtime?: string;
  notes?: string[];
}

export interface LogQueryResult {
  ok: boolean;
  source: string;
  lines: string[];
  lineCount: number;
  truncated: boolean;
  notes: string[];
  blocked?: boolean;
  requiresRoot?: boolean;
  requiresExecute?: boolean;
  rawBytes?: number;
  format?: 'text' | 'jsonl';
}

export interface LogBookmark {
  id: string;
  name: string;
  source: string;
  since?: string;
  priority?: string;
  grep?: string;
  lines?: number;
  createdAt: string;
}

export interface LogCenterSettings {
  maxLines: number;
  maxBytes: number;
  followIntervalSec: number;
  vacuumDefaultDays: number;
  maskSecrets: boolean;
  disabledSources: string[];
  /** Admin-registered extra absolute paths under allowlist roots */
  customAllowPaths: string[];
  /** Saved queries */
  bookmarks: LogBookmark[];
  /** Auto vacuum daily when EXECUTE+root (scheduler) */
  autoVacuumEnabled: boolean;
  autoVacuumTime: string;
  /** Warn when journal disk string parses large or /var/log big */
  journalWarnMb: number;
}

export const DEFAULT_LOG_SETTINGS: LogCenterSettings = {
  maxLines: 500,
  maxBytes: 2 * 1024 * 1024,
  followIntervalSec: 3,
  vacuumDefaultDays: 14,
  maskSecrets: true,
  disabledSources: [],
  customAllowPaths: [],
  bookmarks: [],
  autoVacuumEnabled: false,
  autoVacuumTime: '03:00',
  journalWarnMb: 1024,
};

export interface LogOverview {
  at: string;
  journalDisk?: string;
  journalDiskMb?: number;
  varLogHint?: string;
  varLogMb?: number;
  logrotate?: {
    installed: boolean;
    statusText?: string;
    notes: string[];
  };
  quickUnits: Array<{ unit: string; label: string }>;
  sourceCount: { total: number; available: number };
  recentErrors?: number;
  notes: string[];
  executeEnabled: boolean;
  isRoot: boolean;
  settings: LogCenterSettings;
  /** Aggregate project-generated log discovery */
  projectLogs?: {
    projectCount: number;
    fileCount: number;
    withFiles: number;
  };
}

export interface JournalUnitRow {
  unit: string;
  active?: string;
  description?: string;
}
