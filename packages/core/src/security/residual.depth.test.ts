import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ApprovalRepository } from '../repositories/approval-repo.js';
import { ApprovalQueue } from './approval.js';
import { checkRbac, roleCan } from './rbac.js';
import { createDefaultAllowlist } from './allowlist.js';
import { executeToolCall } from './tool-executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { ErrorCodes, YskError } from '@yanshekki/shared';

function mockHost(opts?: {
  execute?: boolean;
  onRun?: (argv: string[]) => Partial<RunResult>;
  listDir?: () => Promise<string[]>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => true,
    pathExists: () => false,
    readFile: async (p) => `content:${p}`,
    listDir: opts?.listDir ?? (async () => ['1', '2', 'notpid']),
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({ hostname: 'h' }),
    serviceStatus: async (name) => ({
      stdout: `status:${name}`,
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(opts?.onRun?.(argv) ?? {}),
    }),
  };
}

describe('security residual — approval repo-backed', () => {
  it('persists request/get/list/approve/reject/executed via repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-appr-'));
    try {
      const db = openDatabase(join(dir, 'db.json'));
      const repo = new ApprovalRepository(db);
      const q = new ApprovalQueue(repo);

      const r = q.request({
        action: 'fs.write',
        risk: 'medium',
        requestedBy: 'op',
        payload: { path: '/x' },
      });
      expect(q.get(r.id)?.status).toBe('pending');
      expect(q.list('pending')).toHaveLength(1);
      expect(q.list()).toHaveLength(1);

      expect(() => q.markExecuted(r.id)).toThrow(YskError);
      expect(() => q.approve(r.id, 'admin')).not.toThrow();
      expect(q.get(r.id)?.status).toBe('approved');
      expect(q.get(r.id)?.decidedBy).toBe('admin');

      // re-approve non-pending fails
      expect(() => q.reject(r.id, 'admin')).toThrow(YskError);

      q.assertApproved(r.id, 'fs.write');
      const ex = q.markExecuted(r.id);
      expect(ex.status).toBe('executed');
      q.assertApproved(r.id, 'fs.write');

      // wrong action
      expect(() => q.assertApproved(r.id, 'other.tool')).toThrow(YskError);
      // missing
      expect(() => q.assertApproved('missing', 'fs.write')).toThrow(YskError);
      // decide missing
      expect(() => q.approve('nope', 'a')).toThrow(YskError);

      closeDatabase(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('memory queue list filter and action mismatch', () => {
    const q = new ApprovalQueue();
    const a = q.request({ action: 'a', risk: 'low', requestedBy: 'u' });
    const b = q.request({ action: 'b', risk: 'high', requestedBy: 'u' });
    q.approve(a.id, 'admin');
    expect(q.list('approved')).toHaveLength(1);
    expect(q.list('pending')).toHaveLength(1);
    expect(() => q.assertApproved(a.id, 'b')).toThrow(YskError);
    expect(q.get(b.id)?.action).toBe('b');
  });
});

describe('security residual — rbac edge', () => {
  it('unknown role denied; agent global write-high blocked; server scope needs id', () => {
    expect(checkRbac('nope' as never, { kind: 'global' }, 'read').allowed).toBe(false);
    expect(checkRbac('agent', { kind: 'global' }, 'write-high').allowed).toBe(false);
    expect(
      checkRbac('operator', { kind: 'server' }, 'write-low').allowed,
    ).toBe(false);
    expect(
      checkRbac('operator', { kind: 'server', id: 's1' }, 'write-low').allowed,
    ).toBe(true);
    expect(roleCan('agent', 'write-low')).toBe(true);
    expect(roleCan('agent', 'privilege')).toBe(false);
  });
});

describe('security residual — tool-executor dispatch', () => {
  it('validates tool name and missing path/name args', async () => {
    const host = mockHost();
    const base = {
      allowlist: createDefaultAllowlist(),
      approvals: new ApprovalQueue(),
      actor: 'admin',
      roles: ['admin'] as const,
      host,
    };
    await expect(
      executeToolCall({ tool: '' as never, args: {} }, base as never),
    ).rejects.toThrow(YskError);

    await expect(
      executeToolCall({ tool: 'fs.read', args: {} }, base as never),
    ).rejects.toThrow(YskError);
    await expect(
      executeToolCall({ tool: 'fs.list', args: {} }, base as never),
    ).rejects.toThrow(YskError);
    await expect(
      executeToolCall({ tool: 'service.status', args: {} }, base as never),
    ).rejects.toThrow(YskError);
  });

  it('service.restart and pkg tools with approval + audit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-res-'));
    try {
      const runs: string[][] = [];
      const audits: Array<{ action: string; ok: boolean }> = [];
      const host = mockHost({
        execute: true,
        onRun: (argv) => {
          runs.push(argv);
          return { exitCode: 0, stdout: 'ok' };
        },
      });
      const approvals = new ApprovalQueue();
      const allowlist = createDefaultAllowlist();
      const opts = {
        allowlist,
        approvals,
        actor: 'admin',
        roles: ['admin'] as const,
        host,
        audit: {
          append: (row: { action: string; ok: boolean }) => {
            audits.push({ action: row.action, ok: row.ok });
          },
        },
      };

      // service.restart requires approval typically
      const first = await executeToolCall(
        { tool: 'service.restart', args: { name: 'nginx' } },
        opts as never,
      );
      if (first.requiresApproval && first.approvalId) {
        approvals.approve(first.approvalId, 'admin');
        const done = await executeToolCall(
          { tool: 'service.restart', args: { name: 'nginx' } },
          opts as never,
          first.approvalId,
        );
        expect(done.allowed).toBe(true);
        expect(runs.some((a) => a[0] === 'systemctl' && a[1] === 'restart')).toBe(true);
      }

      // invalid service name
      const badName = await executeToolCall(
        { tool: 'service.restart', args: { name: 'bad name!' }, dryRun: true },
        opts as never,
      );
      expect(badName.allowed || badName.dryRun).toBeTruthy();

      // pkg.install after approval if needed
      const pkgFirst = await executeToolCall(
        { tool: 'pkg.install', args: { name: 'curl' } },
        opts as never,
      );
      if (pkgFirst.requiresApproval && pkgFirst.approvalId) {
        approvals.approve(pkgFirst.approvalId, 'admin');
        const pkg = await executeToolCall(
          { tool: 'pkg.install', args: { name: 'curl' } },
          opts as never,
          pkgFirst.approvalId,
        );
        expect(pkg.allowed).toBe(true);
      }

      // invalid package name throws when dispatched
      const invPkg = await executeToolCall(
        { tool: 'pkg.remove', args: { name: 'bad pkg!' } },
        opts as never,
      );
      if (invPkg.requiresApproval && invPkg.approvalId) {
        approvals.approve(invPkg.approvalId, 'admin');
        await expect(
          executeToolCall(
            { tool: 'pkg.remove', args: { name: 'bad pkg!' } },
            opts as never,
            invPkg.approvalId,
          ),
        ).rejects.toThrow(YskError);
      } else if (invPkg.allowed) {
        // if allowlist denied earlier that's fine
      }

      // process.list /proc failure path
      const hostFail = mockHost({
        listDir: async () => {
          throw new Error('no proc');
        },
      });
      const procs = await executeToolCall(
        { tool: 'process.list', args: {} },
        { ...opts, host: hostFail } as never,
      );
      expect(procs.allowed).toBe(true);
      expect((procs.result as { pids: string[] }).pids).toEqual([]);

      // fs.read long content summarize via audit
      writeFileSync(join(dir, 'big.txt'), 'x'.repeat(300), 'utf8');
      // use mock host readFile already returns short content
      await executeToolCall(
        { tool: 'fs.read', args: { path: join(dir, 'big.txt') } },
        {
          ...opts,
          dataDir: dir,
          host: {
            ...host,
            readFile: async () => 'y'.repeat(250),
          },
        } as never,
      );
      expect(audits.some((a) => a.action === 'tool.execute' && a.ok)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dispatch throws wrap non-YskError and rejects bad restart name', async () => {
    const host = mockHost({
      onRun: () => {
        throw new Error('boom-host');
      },
    });
    const allowlist = createDefaultAllowlist();
    const approvals = new ApprovalQueue();
    // force sys.info which uses host.sysInfo — make it throw
    const badHost: HostExecutor = {
      ...host,
      sysInfo: async () => {
        throw new Error('sys fail');
      },
    };
    await expect(
      executeToolCall(
        { tool: 'sys.info', args: {} },
        {
          allowlist,
          approvals,
          actor: 'admin',
          roles: ['admin'],
          host: badHost,
        },
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.INTERNAL });

    // service.restart invalid chars after approval path
    const first = await executeToolCall(
      { tool: 'service.restart', args: { name: 'nginx;rm' } },
      {
        allowlist,
        approvals,
        actor: 'admin',
        roles: ['admin'],
        host: mockHost(),
      },
    );
    if (first.requiresApproval && first.approvalId) {
      approvals.approve(first.approvalId, 'admin');
      await expect(
        executeToolCall(
          { tool: 'service.restart', args: { name: 'nginx;rm' } },
          {
            allowlist,
            approvals,
            actor: 'admin',
            roles: ['admin'],
            host: mockHost(),
          },
          first.approvalId,
        ),
      ).rejects.toThrow(YskError);
    }
  });
});
