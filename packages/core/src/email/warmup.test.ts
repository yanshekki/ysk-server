import { describe, expect, it } from 'vitest';
import { planEmailWarmup } from './warmup.js';

describe('email warmup', () => {
  it('returns phased limits and checklist', () => {
    const plan = planEmailWarmup({
      domain: 'mail.example.com',
      serverIp: '203.0.113.10',
      isNewIp: true,
    });
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
    expect(plan.phases[0].maxMessagesPerDay).toBeLessThan(plan.phases[2].maxMessagesPerDay);
    expect(plan.checklist.some((c) => /PTR|DNSBL|SPF/i.test(c))).toBe(true);
    expect(plan.notes.join(' ')).toMatch(/new/i);
  });
});
