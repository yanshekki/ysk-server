import { describe, expect, it } from 'vitest';
import { evaluateProtection } from './protection.js';

describe('evaluateProtection', () => {
  it('returns normal when network ok', () => {
    const s = evaluateProtection({ networkReachable: true });
    expect(s.mode).toBe('normal');
    expect(s.localLlmOnly).toBe(false);
  });

  it('goes offline when network down', () => {
    const s = evaluateProtection({ networkReachable: false });
    expect(s.mode).toBe('offline');
    expect(s.localLlmOnly).toBe(true);
    expect(s.emergencyPlaybooksOnly).toBe(true);
  });

  it('ddos-protection when suspected', () => {
    const s = evaluateProtection({ networkReachable: true, ddosSuspected: true });
    expect(s.mode).toBe('ddos-protection');
    expect(s.localLlmOnly).toBe(true);
  });

  it('forceOffline wins', () => {
    const s = evaluateProtection({
      networkReachable: true,
      forceOffline: true,
    });
    expect(s.mode).toBe('offline');
  });
});
