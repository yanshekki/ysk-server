import { tl } from '@ysk-server/shared';
/**
 * Offline / Protection Mode for network disruption and DDoS degradation.
 */

import type { ProtectionMode } from '@ysk-server/shared';

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
      reason: signals.forceOffline ? tl('notes.auto.n0831') : tl('notes.auto.n1317'),
      changedAt: now,
    };
  }
  if (signals.ddosSuspected) {
    return {
      mode: 'ddos-protection',
      localLlmOnly: true,
      blockExternalTools: false,
      emergencyPlaybooksOnly: true,
      reason: tl('notes.auto.n1262'),
      changedAt: now,
    };
  }
  if (signals.highRequestRate) {
    return {
      mode: 'degraded',
      localLlmOnly: false,
      blockExternalTools: false,
      emergencyPlaybooksOnly: false,
      reason: tl('notes.auto.n1421'),
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
