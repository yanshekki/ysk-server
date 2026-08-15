/**
 * YSK Defense Center — types
 */

export type DefensePresetId = 'daily' | 'hardened' | 'under_attack' | 'emergency';

export type ThreatLevel = 'low' | 'elevated' | 'under_attack' | 'critical';

export type DefenseActionKind =
  | 'nginx_limits'
  | 'fail2ban_jails'
  | 'ufw_hint'
  | 'protection_mode'
  | 'note';

export interface DefenseAction {
  id: string;
  kind: DefenseActionKind;
  title: string;
  detail: string;
}

export interface NginxLimitSpec {
  /** e.g. 10r/s */
  reqRate: string;
  burst: number;
  /** concurrent connections per IP */
  connLimit: number;
}

export interface DefensePreset {
  id: DefensePresetId;
  label: string;
  short: string;
  bullets: string[];
  nginx: NginxLimitSpec;
  fail2banJails: string[];
  /** maps to control-plane protection evaluation hint */
  protectionHint: 'normal' | 'degraded' | 'ddos-protection' | 'offline';
  danger?: boolean;
  /** require body.confirm === 'EMERGENCY' */
  requireConfirm?: string;
}

export interface ThreatSignal {
  id: string;
  label: string;
  value: string | number | boolean;
  points: number;
  detail?: string;
}

export interface BanEntry {
  ip: string;
  source: 'fail2ban' | 'panel' | 'ufw' | 'auto';
  jail?: string;
  reason?: string;
  at?: string;
  /** false = listed in the panel only; kernel / fail2ban is not applying it */
  enforced?: boolean;
}

export type AutoBanMode = 'off' | 'soft' | 'normal' | 'aggressive';
export type BanMethod = 'fail2ban' | 'ufw' | 'both';

export interface AutoBanPolicy {
  enabled: boolean;
  mode: AutoBanMode;
  method: BanMethod;
  /** minutes before same IP can be auto-banned again */
  cooldownMinutes: number;
  maxAutoBansPerHour: number;
  whitelist: string[];
  /** ISO timestamps of recent auto bans (for circuit breaker) */
  recentAutoBanAts?: string[];
  lastTickAt?: string;
  lastTickNotes?: string[];
  pausedReason?: string;
}

export interface SuspectIp {
  ip: string;
  score: number;
  hits: number;
  reasons: string[];
  sources: string[];
  lastSeen: string;
  alreadyBanned?: boolean;
  whitelisted?: boolean;
}

export interface StatusLabel {
  short: string;
  tone: 'ok' | 'warn' | 'danger' | 'default';
  detail?: string;
}

export interface DefenseStatus {
  at: string;
  threatLevel: ThreatLevel;
  score: number;
  signals: ThreatSignal[];
  activePreset: DefensePresetId;
  presets: Array<Pick<DefensePreset, 'id' | 'label' | 'short' | 'bullets' | 'danger'>>;
  bans: { count: number; items: BanEntry[] };
  nginxLimits: NginxLimitSpec & { confPath: string; exists: boolean };
  firewall: { active?: string; installed?: boolean };
  fail2ban: { active?: string; installed?: boolean; jails?: number };
  /** Human-readable strip labels (UI should prefer these) */
  labels: {
    firewall: StatusLabel;
    fail2ban: StatusLabel;
    apply: StatusLabel;
    autoBan: StatusLabel;
  };
  autoBan: AutoBanPolicy & { autoBansLastHour: number };
  protectionMode?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  suggestions: Array<{ id: string; title: string; body: string; action?: string }>;
  notes: string[];
}

export interface DefenseApplyResult {
  ok: boolean;
  blocked?: boolean;
  applied: boolean;
  written: string[];
  actions: DefenseAction[];
  notes: string[];
  preset: DefensePresetId;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
}
