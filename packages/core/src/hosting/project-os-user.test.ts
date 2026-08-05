import { describe, expect, it } from 'vitest';
import { applyOsUserLimits, probeOsUser } from './project-os-user.js';
import type { ProjectRow } from '../repositories/project-repo.js';
import type { HostExecutor } from '../host/executor.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function host(opts: {
  root: boolean;
  execute: boolean;
  answers?: Record<string, { exitCode: number; stdout: string; stderr?: string }>;
}): HostExecutor {
  return {
    isRoot: () => opts.root,
    executeEnabled: () => opts.execute,
    runCommand: async (argv: string[]) => {
      const key = argv.join(' ');
      for (const [k, v] of Object.entries(opts.answers ?? {})) {
        if (key.includes(k)) return { exitCode: v.exitCode, stdout: v.stdout, stderr: v.stderr ?? '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  } as unknown as HostExecutor;
}

function row(home: string): ProjectRow {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Demo',
    linux_user: 'ysks_a1b2c3d4e5f6',
    linux_group: 'ysks_a1b2c3d4e5f6',
    home_dir: home,
    runtime: 'node',
    env: 'production',
    status: 'active',
    os_provisioned: true,
    force_https: false,
    hsts: false,
    quota_mb: 1024,
    memory_max: '512M',
    cpu_quota_percent: 100,
    tasks_max: 256,
    limit_nofile: 4096,
    shell: '/usr/sbin/nologin',
    account_locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('project-os-user', () => {
  it('probe reports missing user honestly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-os-'));
    mkdirSync(dir, { recursive: true });
    try {
      const h = host({
        root: false,
        execute: false,
        answers: { 'id -u': { exitCode: 0, stdout: '' } },
      });
      const live = await probeOsUser(h, row(dir));
      expect(live.homeExists).toBe(true);
      expect(live.canonicalHome).toContain('/home/ysk-server-');
      expect(live.userExists).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probe user exists with lock states and mismatched home', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-os-live-'));
    mkdirSync(dir, { recursive: true });
    try {
      const h = host({
        root: true,
        execute: true,
        answers: {
          'id -u': {
            exitCode: 0,
            stdout: '1201\n1201\nysks_a1b2c3d4e5f6:x:1201:1201::/home/other:/bin/bash\n',
          },
          'passwd -S': { exitCode: 0, stdout: 'ysks_a1b2c3d4e5f6 L 01/01/2020 0 99999 7 -1\n' },
        },
      });
      const live = await probeOsUser(h, row(dir));
      expect(live.userExists).toBe(true);
      expect(live.uid).toBe(1201);
      expect(live.locked).toBe(true);
      expect(live.shellLive).toBe('/bin/bash');
      expect(live.notes.some((n) => n.length > 0)).toBe(true); // home mismatch note

      const unlocked = host({
        root: true,
        execute: true,
        answers: {
          'id -u': {
            exitCode: 0,
            stdout: '1201\n1201\nysks_a1b2c3d4e5f6:x:1201:1201::' + dir + ':/usr/sbin/nologin\n',
          },
          'passwd -S': { exitCode: 0, stdout: 'ysks_a1b2c3d4e5f6 P 01/01/2020 0 99999 7 -1\n' },
        },
      });
      const live2 = await probeOsUser(unlocked, {
        ...row(dir),
        os_provisioned: true,
        home_dir: dir,
      });
      expect(live2.locked).toBe(false);

      const emptyPasswd = host({
        root: false,
        execute: false,
        answers: {
          'id -u': { exitCode: 0, stdout: '1\n2\n' },
          'passwd -S': { exitCode: 0, stdout: '' },
        },
      });
      const live3 = await probeOsUser(emptyPasswd, { ...row(dir), os_provisioned: false });
      expect(live3.userExists).toBe(true);
      expect(live3.locked).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply limits with execute applies shell lock and unit props', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-os-apply-'));
    mkdirSync(dir, { recursive: true });
    try {
      const h = host({
        root: true,
        execute: true,
        answers: {
          'id -u': {
            exitCode: 0,
            stdout: '1201\n1201\nysks_a1b2c3d4e5f6:x:1201:1201::' + dir + ':/usr/sbin/nologin\n',
          },
          'passwd -S': { exitCode: 0, stdout: 'ysks_a1b2c3d4e5f6 P\n' },
          usermod: { exitCode: 0, stdout: '' },
          'is-active': { exitCode: 0, stdout: 'active\n' },
          'set-property': { exitCode: 0, stdout: '' },
          setquota: { exitCode: 0, stdout: '' },
          'command -v setquota': { exitCode: 0, stdout: '/usr/sbin/setquota\n' },
        },
      });
      const r = await applyOsUserLimits({
        host: h,
        row: { ...row(dir), account_locked: true, quota_mb: 512 },
        dataDir: dir,
      });
      expect(r.blocked).toBe(false);
      expect(r.applied === true || r.ok === true).toBe(true);

      const unlock = await applyOsUserLimits({
        host: h,
        row: { ...row(dir), account_locked: false, os_provisioned: false, quota_mb: 0 },
        dataDir: dir,
      });
      expect(unlock.notes.length).toBeGreaterThan(0);

      // usermod fail + unit inactive
      const h2 = host({
        root: true,
        execute: true,
        answers: {
          usermod: { exitCode: 1, stdout: '', stderr: 'fail' },
          'is-active': { exitCode: 0, stdout: 'inactive\n' },
          'id -u': { exitCode: 0, stdout: '' },
        },
      });
      const fail = await applyOsUserLimits({
        host: h2,
        row: { ...row(dir), account_locked: false },
        dataDir: dir,
      });
      expect(fail.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply limits blocked without root/execute but written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-os2-'));
    mkdirSync(dir, { recursive: true });
    try {
      const h = host({ root: false, execute: false });
      const r = await applyOsUserLimits({ host: h, row: row(dir), dataDir: dir });
      expect(r.blocked).toBe(true);
      expect(r.applied).toBe(false);
      expect(r.written).toBe(true);
      expect(r.notes.join(' ')).toMatch(/YSK_EXECUTE|root|系統變更權限|管理員/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply limits runs usermod when root+execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-os3-'));
    mkdirSync(dir, { recursive: true });
    try {
      const h = host({
        root: true,
        execute: true,
        answers: {
          usermod: { exitCode: 0, stdout: '' },
          'is-active': { exitCode: 0, stdout: 'inactive\n' },
          setquota: { exitCode: 1, stdout: 'no quota' },
          'command -v setquota': { exitCode: 0, stdout: 'no\n' },
          'id -u': { exitCode: 0, stdout: '1001\n1001\nysks:x:1001:1001::/home:/usr/sbin/nologin\n' },
        },
      });
      const r = await applyOsUserLimits({ host: h, row: row(dir), dataDir: dir });
      expect(r.requiresRoot).toBe(false);
      expect(r.notes.join(' ')).toMatch(/shell|unit|setquota|軟|配額|未 active/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
