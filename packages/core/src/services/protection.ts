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
      reason: signals.forceOffline ? '強制離線模式' : '網路無法連線',
      changedAt: now,
    };
  }
  if (signals.ddosSuspected) {
    return {
      mode: 'ddos-protection',
      localLlmOnly: true,
      blockExternalTools: false,
      emergencyPlaybooksOnly: true,
      reason: '疑似 DDoS — 降級運作',
      changedAt: now,
    };
  }
  if (signals.highRequestRate) {
    return {
      mode: 'degraded',
      localLlmOnly: false,
      blockExternalTools: false,
      emergencyPlaybooksOnly: false,
      reason: '請求率偏高 — 已啟用限流',
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
