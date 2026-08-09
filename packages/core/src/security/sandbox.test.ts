import { describe, expect, it } from 'vitest';
import { pathAllowed, planSandbox } from './sandbox.js';

describe('Kernel Sandbox planner', () => {
  it('plans constrained execution with policy', () => {
    const plan = planSandbox(['node', 'app.js'], {
      runAsUser: 'ysk_demo',
      network: false,
      memoryMb: 256,
    });
    expect(plan.commands[0]).toContain('runuser -u ysk_demo');
    expect(plan.policy.network).toBe(false);
    expect(plan.notes.some((n) => n.includes('memoryMb=256'))).toBe(true);
  });

  it('validates allowed paths', () => {
    expect(pathAllowed('/var/lib/ysk-server/a', ['/var/lib/ysk-server'])).toBe(true);
    expect(pathAllowed('/etc/shadow', ['/var/lib/ysk-server'])).toBe(false);
    // Boundary-safe: /var must not match /var-evil
    expect(pathAllowed('/var-evil', ['/var'])).toBe(false);
    // Empty roots ignored; bare / only allows exact /
    expect(pathAllowed('/etc/passwd', [''])).toBe(false);
    expect(pathAllowed('/etc/passwd', ['/'])).toBe(false);
    expect(pathAllowed('/', ['/'])).toBe(true);
    expect(pathAllowed('/x\0y', ['/x'])).toBe(false);
  });

  it('rejects unconfined without runAsUser', () => {
    expect(() => planSandbox(['bash'], { seccompProfile: 'unconfined' })).toThrow();
  });
});
