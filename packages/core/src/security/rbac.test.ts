import { describe, expect, it } from 'vitest';
import { checkRbac, roleCan } from './rbac.js';

describe('RBAC three-axis', () => {
  it('rejects unauthorized role/scope/level combinations', () => {
    const denied = checkRbac('viewer', { kind: 'global' }, 'write-low');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/唯讀|無法執行|read-only|cannot perform/i);

    const agentGlobal = checkRbac('agent', { kind: 'global' }, 'write-high');
    expect(agentGlobal.allowed).toBe(false);

    const noProjectId = checkRbac('operator', { kind: 'project' }, 'write-low');
    expect(noProjectId.allowed).toBe(false);
  });

  it('allows admin privilege and operator write-high with scope id', () => {
    expect(checkRbac('admin', { kind: 'global' }, 'privilege').allowed).toBe(true);
    expect(
      checkRbac('operator', { kind: 'project', id: 'p1' }, 'write-high').allowed,
    ).toBe(true);
    expect(roleCan('viewer', 'read')).toBe(true);
    expect(roleCan('viewer', 'destructive')).toBe(false);
  });
});
