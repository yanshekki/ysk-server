import { describe, expect, it } from 'vitest';
import { ErrorCodes, YskError } from '@yanshekki/shared';
import {
  assertOsIsolationForDeploy,
  canRunAsProjectUser,
  isolationModeFor,
  shellQuote,
} from './project-user-run.js';
import type { ProjectRow } from '../repositories/project-repo.js';
import type { HostExecutor } from '../host/executor.js';

function fakeHost(opts: { root: boolean; execute: boolean }): HostExecutor {
  return {
    isRoot: () => opts.root,
    executeEnabled: () => opts.execute,
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    mkdirp: async () => undefined,
    listDir: async () => [],
    deletePath: async () => undefined,
    writeFile: async () => undefined,
    readFile: async () => '',
    isUnderWriteRoots: () => true,
  } as unknown as HostExecutor;
}

function baseRow(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Demo',
    linux_user: 'ysks_a1b2c3d4e5f6',
    linux_group: 'ysks_a1b2c3d4e5f6',
    home_dir: '/home/ysk-server-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    runtime: 'node',
    runtime_version: '20',
    env: 'production',
    status: 'active',
    os_provisioned: false,
    force_https: false,
    hsts: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe('project-user-run isolation', () => {
  it('hard-blocks deploy when root+execute but not provisioned', () => {
    const host = fakeHost({ root: true, execute: true });
    expect(() => assertOsIsolationForDeploy(baseRow(), host, 'Deploy')).toThrow(YskError);
    try {
      assertOsIsolationForDeploy(baseRow(), host);
    } catch (e) {
      expect(e).toBeInstanceOf(YskError);
      expect((e as YskError).code).toBe(ErrorCodes.VALIDATION);
      expect((e as YskError).message).toMatch(/Linux 用戶隔離/);
    }
  });

  it('allows deploy when provisioned under root', () => {
    const host = fakeHost({ root: true, execute: true });
    expect(() =>
      assertOsIsolationForDeploy(baseRow({ os_provisioned: true }), host),
    ).not.toThrow();
    expect(canRunAsProjectUser(baseRow({ os_provisioned: true }), host)).toBe(true);
    expect(isolationModeFor(baseRow({ os_provisioned: true }), host)).toBe('isolated');
  });

  it('degraded mode does not throw when not root', () => {
    const host = fakeHost({ root: false, execute: false });
    expect(() => assertOsIsolationForDeploy(baseRow(), host)).not.toThrow();
    expect(canRunAsProjectUser(baseRow({ os_provisioned: true }), host)).toBe(false);
    expect(isolationModeFor(baseRow({ os_provisioned: true }), host)).toBe('degraded');
  });

  it('shellQuote escapes single quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(shellQuote('/home/ysk-server-x')).toBe(`'/home/ysk-server-x'`);
  });
});
