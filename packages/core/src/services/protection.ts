/**
 * Offline / Protection Mode for network disruption and DDoS degradation.
 */

import type { ProtectionMode } from '@ysk/shared';

export interface ProtectionState {
  mode: ProtectionMode;
  localLlmOnly: boolean;
  blockExternalTools: boolean;
  emergencyPlaybooksOnly: boolean;
  reason?: string;
  changedAt: string;
}

/**
 * Decide protection mode from signals.
 */
export function evaluateProtection(signals: {
  networkReachable: boolean;
  highRequestRate?: boolean;
  ddosSuspected?: boolean;
  forceOffline?: boolean;
}): ProtectionState {
  const now = new Date().toISOString();
  if (signals.forceOffline || !signals.networkReachable) {
    return {
      mode: 'offline',
      localLlmOnly: true,
      blockExternalTools: true,
      emergencyPlaybooksOnly: true,
      reason: signals.forceOffline ? 'Forced offline' : 'Network unreachable',
      changedAt: now,
    };
  }
  if (signals.ddosSuspected) {
    return {
      mode: 'ddos-protection',
      localLlmOnly: true,
      blockExternalTools: false,
      emergencyPlaybooksOnly: true,
      reason: 'DDoS suspected — degraded operations',
      changedAt: now,
    };
  }
  if (signals.highRequestRate) {
    return {
      mode: 'degraded',
      localLlmOnly: false,
      blockExternalTools: false,
      emergencyPlaybooksOnly: false,
      reason: 'High request rate — rate limiting active',
      changedAt: now,
    };
  }
  return {
    mode: 'normal',
    localLlmOnly: false,
    blockExternalTools: false,
    emergencyPlaybooksOnly: false,
    changedAt: now,
  };
}

export const EMERGENCY_PLAYBOOKS = [
  'block-attacker-ip',
  'enable-cdn-under-attack',
  'scale-down-noncritical',
  'local-llm-ops-only',
] as const;
