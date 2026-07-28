import { describe, expect, it } from 'vitest';
import {
  deriveLinuxUser,
  deriveLinuxUserFromProjectId,
  isCanonicalProjectHome,
  isSafeProjectHomePath,
  planProjectIsolation,
  projectHomeDir,
} from './project.js';

const SAMPLE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('Project isolation naming', () => {
  it('home is /home/ysk-server-{projectId}', () => {
    expect(projectHomeDir(SAMPLE_ID)).toBe(`/home/ysk-server-${SAMPLE_ID}`);
    expect(isCanonicalProjectHome(`/home/ysk-server-${SAMPLE_ID}`, SAMPLE_ID)).toBe(true);
    expect(isCanonicalProjectHome('/var/lib/ysk-server/projects/x', SAMPLE_ID)).toBe(false);
  });

  it('linux user from id is short, stable, ≤32', () => {
    const u = deriveLinuxUserFromProjectId(SAMPLE_ID);
    expect(u).toMatch(/^ysks_[a-f0-9]{12}$/);
    expect(u.length).toBeLessThanOrEqual(32);
    // stable
    expect(deriveLinuxUserFromProjectId(SAMPLE_ID)).toBe(u);
    // different ids differ
    expect(deriveLinuxUserFromProjectId('11111111-1111-1111-1111-111111111111')).not.toBe(u);
  });

  it('plan uses id-based user and canonical home (not display name)', () => {
    const plan = planProjectIsolation({
      id: SAMPLE_ID,
      name: 'My Blog',
      runtime: 'node',
      runtimeVersion: '20',
      domain: 'blog.example.com',
    });
    expect(plan.project.linuxUser).toBe(deriveLinuxUserFromProjectId(SAMPLE_ID));
    expect(plan.project.linuxUser).not.toBe(deriveLinuxUser('My Blog'));
    expect(plan.project.linuxGroup).toBe(plan.project.linuxUser);
    expect(plan.project.homeDir).toBe(`/home/ysk-server-${SAMPLE_ID}`);
    expect(plan.commands.some((c) => c.includes('useradd'))).toBe(true);
    expect(plan.commands.some((c) => c.includes(plan.project.homeDir))).toBe(true);
  });

  it('rejects empty project name / bad id', () => {
    expect(() =>
      planProjectIsolation({ id: SAMPLE_ID, name: '   ', runtime: 'static' }),
    ).toThrow();
    expect(() => deriveLinuxUserFromProjectId('short')).toThrow();
  });

  it('safe home path whitelist', () => {
    const dataDir = '/var/lib/ysk-server';
    const user = deriveLinuxUserFromProjectId(SAMPLE_ID);
    expect(
      isSafeProjectHomePath(`/home/ysk-server-${SAMPLE_ID}`, {
        projectId: SAMPLE_ID,
        dataDir,
        linuxUser: user,
      }),
    ).toBe(true);
    expect(
      isSafeProjectHomePath(`${dataDir}/homes/ysk-server-${SAMPLE_ID}`, {
        projectId: SAMPLE_ID,
        dataDir,
        linuxUser: user,
      }),
    ).toBe(true);
    expect(
      isSafeProjectHomePath(`${dataDir}/projects/${user}`, {
        projectId: SAMPLE_ID,
        dataDir,
        linuxUser: user,
      }),
    ).toBe(true);
    expect(
      isSafeProjectHomePath('/home/other-user', {
        projectId: SAMPLE_ID,
        dataDir,
        linuxUser: user,
      }),
    ).toBe(false);
    expect(
      isSafeProjectHomePath('/etc/passwd', {
        projectId: SAMPLE_ID,
        dataDir,
        linuxUser: user,
      }),
    ).toBe(false);
  });
});
