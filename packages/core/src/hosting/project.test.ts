import { describe, expect, it } from 'vitest';
import { deriveLinuxUser, planProjectIsolation } from './project.js';

describe('Project isolation', () => {
  it('derives independent linux user/group and home', () => {
    const plan = planProjectIsolation({
      id: 'p1',
      name: 'My Blog',
      runtime: 'node',
      runtimeVersion: '20',
      domain: 'blog.example.com',
    });
    expect(plan.project.linuxUser).toBe(deriveLinuxUser('My Blog'));
    expect(plan.project.linuxUser).toMatch(/^ysk_/);
    expect(plan.project.linuxGroup).toBe(plan.project.linuxUser);
    expect(plan.project.homeDir).toContain(plan.project.linuxUser);
    expect(plan.commands.some((c) => c.startsWith('useradd'))).toBe(true);
    expect(plan.commands.some((c) => c.startsWith('groupadd'))).toBe(true);
  });

  it('rejects empty project name', () => {
    expect(() =>
      planProjectIsolation({ id: 'x', name: '   ', runtime: 'static' }),
    ).toThrow();
  });
});
