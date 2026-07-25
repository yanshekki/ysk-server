import { describe, expect, it } from 'vitest';
import { adviseUpdate, buildAdvisoryQueries, planUpdateExecution } from './advisor.js';

describe('intelligent update advisor', () => {
  it('returns structured advice for security and breaking changes', () => {
    const urgent = adviseUpdate({
      packageName: 'openssl',
      currentVersion: '3.0.0',
      candidateVersion: '3.0.15',
      knownCves: ['CVE-2024-XXXX CRITICAL'],
      hasSecurityFix: true,
    });
    expect(urgent.advice).toBe('urgent');
    expect(urgent.risk).toBe('critical');
    expect(urgent.requiresApproval).toBe(true);

    const breaking = adviseUpdate({
      packageName: 'app',
      currentVersion: '1.0.0',
      candidateVersion: '2.0.0',
      hasBreakingChange: true,
    });
    expect(breaking.advice).toBe('watch');
    expect(breaking.requiresApproval).toBe(true);
  });

  it('builds advisory lookup queries and execution plan with rollback', () => {
    const queries = buildAdvisoryQueries('nginx', '1.24.0');
    expect(queries.some((q) => q.source === 'nvd')).toBe(true);

    const item = adviseUpdate({
      packageName: 'curl',
      currentVersion: '8.0.0',
      candidateVersion: '8.5.0',
      hasSecurityFix: true,
    });
    const plan = planUpdateExecution(item);
    expect(plan.rollbackCommands.length).toBeGreaterThan(0);
    expect(plan.audit.from).toBe('8.0.0');
  });
});
