import { describe, expect, it } from 'vitest';
import { evaluateProtection } from './protection.js';
import { runProtectionProbes, tcpProbe } from './protection-probe.js';

describe('protection probes', () => {
  it('tcpProbe returns boolean without throwing', async () => {
    const ok = await tcpProbe('127.0.0.1', 1, 200);
    expect(typeof ok).toBe('boolean');
  });

  it('runProtectionProbes returns structured protection + suggestions', async () => {
    const r = await runProtectionProbes({ requestCountLastMinute: 0 });
    expect(r.protection.mode).toMatch(/normal|degraded|offline|ddos/);
    expect(r.details.length).toBeGreaterThan(0);
    expect(Array.isArray(r.suggestedPlaybooks)).toBe(true);
  }, 15_000);

  it('high rate signals degraded/ddos via evaluateProtection', () => {
    expect(
      evaluateProtection({ networkReachable: true, highRequestRate: true }).mode,
    ).toBe('degraded');
    expect(
      evaluateProtection({ networkReachable: true, ddosSuspected: true }).mode,
    ).toBe('ddos-protection');
  });
});
