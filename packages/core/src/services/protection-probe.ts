/**
 * Active probes that drive protection mode automatically.
 */

import { createConnection } from 'node:net';
import { tl } from 'ysk-server-shared';
import { evaluateProtection, type ProtectionState, EMERGENCY_PLAYBOOKS } from './protection.js';
import { getPlaybook, listPlaybooks } from '../skills/playbooks.js';

export interface ProbeResult {
  at: string;
  networkReachable: boolean;
  dnsOk: boolean;
  highRequestRate: boolean;
  ddosSuspected: boolean;
  details: string[];
  protection: ProtectionState;
  suggestedPlaybooks: Array<{ id: string; name: string; reason: string }>;
}

/**
 * TCP connect probe with timeout.
 */
export function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host, port });
    const done = (ok: boolean) => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

/**
 * Run connectivity probes and compute protection + emergency playbook suggestions.
 */
export async function runProtectionProbes(opts?: {
  /** Sliding window request count for rate detection */
  requestCountLastMinute?: number;
  rateThreshold?: number;
}): Promise<ProbeResult> {
  const details: string[] = [];
  const rateThreshold = opts?.rateThreshold ?? 500;
  const reqs = opts?.requestCountLastMinute ?? 0;

  // Probe well-known endpoints (may fail in restricted nets — that is a signal)
  const [cloudflare, googleDns] = await Promise.all([
    tcpProbe('1.1.1.1', 443, 2500),
    tcpProbe('8.8.8.8', 53, 2500),
  ]);

  const networkReachable = cloudflare || googleDns;
  details.push(
    cloudflare ? tl('notes.defense.tcpOk', { target: '1.1.1.1:443' }) : tl('notes.defense.tcpFail', { target: '1.1.1.1:443' }),
    googleDns ? tl('notes.defense.tcpOk', { target: '8.8.8.8:53' }) : tl('notes.defense.tcpFail', { target: '8.8.8.8:53' }),
  );

  // DNS ok if we can reach a DNS port or Cloudflare
  const dnsOk = googleDns || cloudflare;
  if (!dnsOk) details.push(tl('notes.defense.dnsDegraded'));

  const highRequestRate = reqs >= rateThreshold;
  if (highRequestRate) {
    details.push(tl('notes.defense.reqRateHigh', { reqs, threshold: rateThreshold }));
  }

  // Simple DDoS heuristic: high rate + partial network failure
  const ddosSuspected = highRequestRate && !cloudflare;
  if (ddosSuspected) details.push(tl('notes.defense.ddosHeuristic'));

  const protection = evaluateProtection({
    networkReachable,
    highRequestRate,
    ddosSuspected,
  });

  const suggestedPlaybooks: ProbeResult['suggestedPlaybooks'] = [];
  if (protection.mode === 'offline' || protection.mode === 'ddos-protection') {
    suggestedPlaybooks.push({
      id: 'local-llm-ops-only',
      name: getPlaybook('local-llm-ops-only').name,
      reason: protection.reason ?? protection.mode,
    });
    suggestedPlaybooks.push({
      id: 'discover-host',
      name: getPlaybook('discover-host').name,
      reason: 'Gather local facts while external network is degraded',
    });
  }
  if (protection.mode === 'ddos-protection') {
    // Map to emergency catalog names from EMERGENCY_PLAYBOOKS for UI
    for (const id of EMERGENCY_PLAYBOOKS) {
      if (id === 'local-llm-ops-only') continue;
      suggestedPlaybooks.push({
        id,
        name: id,
        reason: 'Emergency catalog action under DDoS protection',
      });
    }
  }

  // Ensure we only suggest known runnable playbooks where possible
  const known = new Set(listPlaybooks().map((p) => p.id));
  const filtered = suggestedPlaybooks.filter(
    (s) => known.has(s.id) || (EMERGENCY_PLAYBOOKS as readonly string[]).includes(s.id),
  );

  return {
    at: new Date().toISOString(),
    networkReachable,
    dnsOk,
    highRequestRate,
    ddosSuspected,
    details,
    protection,
    suggestedPlaybooks: filtered,
  };
}
