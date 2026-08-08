import { describe, expect, it } from 'vitest';
import { buildProjectSpawnPlan, buildRootSpawnPlan } from './spawn-plan.js';

describe('terminal spawn-plan', () => {
  it('builds root bash -l', () => {
    const p = buildRootSpawnPlan({ cols: 80, rows: 24, home: '/root' });
    expect(p.file).toBe('bash');
    expect(p.args).toEqual(['-l']);
    expect(p.linuxUser).toBe('root');
    expect(p.cwd).toBe('/root');
    expect(p.env.TERM).toBe('xterm-256color');
  });

  it('builds project runuser shell', () => {
    const p = buildProjectSpawnPlan({
      linuxUser: 'ysks_abc',
      homeDir: '/home/ysks_abc',
      projectId: 'p1',
      projectName: 'Demo',
      cols: 100,
      rows: 40,
    });
    expect(p.file).toBe('runuser');
    expect(p.args).toEqual(['-u', 'ysks_abc', '--', 'bash', '-l']);
    expect(p.cwd).toBe('/home/ysks_abc');
    expect(p.projectId).toBe('p1');
  });

  it('rejects root as project user', () => {
    expect(() =>
      buildProjectSpawnPlan({
        linuxUser: 'root',
        homeDir: '/root',
        projectId: 'x',
        projectName: 'x',
      }),
    ).toThrow(/invalid/);
  });
});
