import { tl } from 'ysk-server-shared';
/**
 * Collect host signals and score threat level.
 */

import type { HostExecutor } from '../../host/executor.js';
import { runProtectionProbes } from '../../services/protection-probe.js';
import { fail2banBannedIps, probeFail2banStatus, probeFirewallStatus } from '../system-apply.js';
import type { BanEntry, ThreatLevel, ThreatSignal } from './types.js';

/** Shared with automation.autoPreset so display level matches escalate rules. */
export type ThreatLevelThresholds = {
  /** score ≥ this → elevated (default 20; same as escalateToHardenedAt) */
  elevatedAt: number;
  /** score ≥ this → under_attack (default 45) */
  underAttackAt: number;
  /** score ≥ this → critical (default 70) */
  criticalAt: number;
};

export const DEFAULT_THREAT_THRESHOLDS: ThreatLevelThresholds = {
  elevatedAt: 20,
  underAttackAt: 45,
  criticalAt: 70,
};

export function scoreToThreatLevel(
  score: number,
  thresholds?: Partial<ThreatLevelThresholds>,
): ThreatLevel {
  const t = {
    elevatedAt: thresholds?.elevatedAt ?? DEFAULT_THREAT_THRESHOLDS.elevatedAt,
    underAttackAt: thresholds?.underAttackAt ?? DEFAULT_THREAT_THRESHOLDS.underAttackAt,
    criticalAt: thresholds?.criticalAt ?? DEFAULT_THREAT_THRESHOLDS.criticalAt,
  };
  // Ensure ordering: critical ≥ underAttack ≥ elevated
  const elevatedAt = Math.max(1, Math.min(99, t.elevatedAt));
  const underAttackAt = Math.max(elevatedAt, Math.min(99, t.underAttackAt));
  const criticalAt = Math.max(underAttackAt, Math.min(100, t.criticalAt));
  if (score >= criticalAt) return 'critical';
  if (score >= underAttackAt) return 'under_attack';
  if (score >= elevatedAt) return 'elevated';
  return 'low';
}

/** Build display thresholds from automation.autoPreset — same knobs as auto-escalate. */
export function threatThresholdsFromAutoPreset(ap: {
  escalateToHardenedAt: number;
  escalateToUnderAttackAt: number;
  suggestEmergencyAt: number;
  criticalAt?: number;
}): ThreatLevelThresholds {
  const elevatedAt = ap.escalateToHardenedAt;
  const underAttackAt = Math.max(elevatedAt, ap.escalateToUnderAttackAt);
  let criticalAt = ap.criticalAt ?? 70;
  if (criticalAt < underAttackAt) criticalAt = Math.min(100, underAttackAt + 10);
  return { elevatedAt, underAttackAt, criticalAt };
}

/** Multipliers for each signal family (1 = default). User-tunable. */
export type SignalWeights = {
  networkDown: number;
  highReqRate: number;
  ddosHeuristic: number;
  tcpInuse: number;
  ufwInactive: number;
  f2bBans: number;
};

export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  networkDown: 1,
  highReqRate: 1,
  ddosHeuristic: 1,
  tcpInuse: 1,
  ufwInactive: 1,
  f2bBans: 1,
};

function w(weights: SignalWeights | undefined, key: keyof SignalWeights): number {
  const v = weights?.[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(3, v));
}

async function readSockstat(): Promise<{ tcp: number; detail: string }> {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('/proc/net/sockstat', 'utf8');
    const m = raw.match(/TCP:\s+inuse\s+(\d+)/i);
    const tcp = m ? Number(m[1]) : 0;
    return { tcp, detail: raw.split('\n')[0] ?? '' };
  } catch {
    return { tcp: 0, detail: 'sockstat unavailable' };
  }
}

/**
 * Aggregate signals for defense dashboard.
 */
export async function collectDefenseSignals(input: {
  host: HostExecutor;
  requestCountLastMinute?: number;
  weights?: Partial<SignalWeights>;
  /** When set, threatLevel bands match automation escalate thresholds */
  threatThresholds?: Partial<ThreatLevelThresholds>;
}): Promise<{
  score: number;
  threatLevel: ThreatLevel;
  signals: ThreatSignal[];
  bans: BanEntry[];
  protectionMode?: string;
  firewall: { active?: string; installed?: boolean };
  fail2ban: { active?: string; installed?: boolean; jails?: number };
  notes: string[];
}> {
  const weights: SignalWeights = { ...DEFAULT_SIGNAL_WEIGHTS, ...input.weights };
  const signals: ThreatSignal[] = [];
  let score = 0;
  const notes: string[] = [];
  const scale = (base: number, key: keyof SignalWeights) =>
    Math.round(base * w(weights, key));

  const probe = await runProtectionProbes({
    requestCountLastMinute: input.requestCountLastMinute ?? 0,
  });
  const netPts = probe.networkReachable ? 0 : scale(15, 'networkDown');
  signals.push({
    id: 'network',
    label: tl('notes.auto.n0638'),
    value: probe.networkReachable,
    points: netPts,
    detail: probe.details.join('; '),
  });
  score += netPts;

  const reqPts = probe.highRequestRate ? scale(20, 'highReqRate') : 0;
  signals.push({
    id: 'req_rate',
    label: tl('notes.auto.n1593'),
    value: input.requestCountLastMinute ?? 0,
    points: reqPts,
    detail: probe.highRequestRate ? tl('notes.auto.n1457') : tl('notes.auto.n1030'),
  });
  score += reqPts;

  if (probe.ddosSuspected) {
    const dPts = scale(25, 'ddosHeuristic');
    score += dPts;
    signals.push({
      id: 'ddos_heuristic',
      label: tl('notes.auto.n0095'),
      value: true,
      points: dPts,
      detail: tl('notes.auto.n1610'),
    });
  }

  const sock = await readSockstat();
  const tcpBase = sock.tcp > 20000 ? 25 : sock.tcp > 8000 ? 15 : sock.tcp > 3000 ? 8 : 0;
  const tcpPoints = scale(tcpBase, 'tcpInuse');
  score += tcpPoints;
  signals.push({
    id: 'tcp_inuse',
    label: tl('notes.auto.n0194'),
    value: sock.tcp,
    points: tcpPoints,
    detail: sock.detail,
  });

  let firewall = { active: undefined as string | undefined, installed: undefined as boolean | undefined };
  let fail2ban = {
    active: undefined as string | undefined,
    installed: undefined as boolean | undefined,
    jails: undefined as number | undefined,
  };
  let bans: BanEntry[] = [];

  try {
    const fw = await probeFirewallStatus(input.host);
    firewall = { active: fw.active, installed: fw.installed };
    const ufwPts = fw.active === 'inactive' ? scale(5, 'ufwInactive') : 0;
    signals.push({
      id: 'ufw',
      label: 'UFW',
      value: fw.active ?? 'unknown',
      points: ufwPts,
      detail: fw.installed ? 'installed' : 'not installed',
    });
    score += ufwPts;
  } catch {
    notes.push(tl('notes.auto.n0198'));
  }

  try {
    const f2b = await probeFail2banStatus(input.host);
    fail2ban = {
      active: f2b.active,
      installed: f2b.installed,
      jails: f2b.jails?.length,
    };
    const banned = await fail2banBannedIps(input.host);
    bans = (banned.items ?? []).map((b) => ({
      ip: b.ip,
      source: 'fail2ban' as const,
      jail: b.jail,
    }));
    const banBase = bans.length > 50 ? 20 : bans.length > 15 ? 12 : bans.length > 5 ? 6 : 0;
    const banPoints = scale(banBase, 'f2bBans');
    score += banPoints;
    signals.push({
      id: 'f2b_bans',
      label: tl('notes.auto.n0286'),
      value: bans.length,
      points: banPoints,
      detail: f2b.active === 'active' ? `${f2b.jails?.length ?? 0} jails` : tl('notes.auto.n0284'),
    });
  } catch {
    notes.push(tl('notes.auto.n0287'));
  }

  score = Math.min(100, score);
  return {
    score,
    threatLevel: scoreToThreatLevel(score, input.threatThresholds),
    signals,
    bans,
    protectionMode: probe.protection.mode,
    firewall,
    fail2ban,
    notes,
  };
}
