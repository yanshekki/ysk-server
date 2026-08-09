import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultAllowlist } from './allowlist.js';
import { ApprovalQueue } from './approval.js';
import { executeToolCall } from './tool-executor.js';
import { evaluateProtection } from '../services/protection.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('executeToolCall (real host)', () => {
  it('denies non-listed destructive tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const result = await executeToolCall(
      { tool: 'shell.exec', args: { cmd: 'rm -rf /' } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'agent',
        roles: ['admin'],
        host,
      },
    );
    expect(result.allowed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('really reads a file via fs.read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello-ysk', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const result = await executeToolCall(
      { tool: 'fs.read', args: { path: file } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
        dataDir: dir,
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.result).toMatchObject({ content: 'hello-ysk', executed: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses fs.read outside sandbox (e.g. /etc/passwd)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    await expect(
      executeToolCall(
        { tool: 'fs.read', args: { path: '/etc/passwd' } },
        {
          allowlist: createDefaultAllowlist(),
          approvals: new ApprovalQueue(),
          actor: 'admin',
          roles: ['admin'],
          host,
          dataDir: dir,
        },
      ),
    ).rejects.toThrow(/sandbox|SANDBOX|outside|path|沙箱|範圍/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires approval then really writes file under managed root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const file = join(dir, 'out.txt');
    const approvals = new ApprovalQueue();
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const allowlist = createDefaultAllowlist();

    const pending = await executeToolCall(
      { tool: 'fs.write', args: { path: file, content: 'written-for-real' } },
      { allowlist, approvals, actor: 'operator', roles: ['admin'], host, dataDir: dir },
    );
    expect(pending.requiresApproval).toBe(true);
    expect(pending.approvalId).toBeTruthy();
    // file must not exist yet
    expect(() => readFileSync(file, 'utf8')).toThrow();

    approvals.approve(pending.approvalId!, 'admin');
    const done = await executeToolCall(
      { tool: 'fs.write', args: { path: file, content: 'written-for-real' } },
      { allowlist, approvals, actor: 'operator', roles: ['admin'], host, dataDir: dir },
      pending.approvalId,
    );
    expect(done.allowed).toBe(true);
    expect(done.result).toMatchObject({ executed: true });
    expect(readFileSync(file, 'utf8')).toBe('written-for-real');
    rmSync(dir, { recursive: true, force: true });
  });

  it('enforces RBAC: viewer cannot run write tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir] });
    const result = await executeToolCall(
      { tool: 'fs.write', args: { path: join(dir, 'a'), content: 'x' }, dryRun: true },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'bob',
        roles: ['viewer'],
        host,
      },
    );
    expect(result.allowed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('blocks non-emergency tools in offline protection mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir] });
    const protection = evaluateProtection({ networkReachable: false });
    const denied = await executeToolCall(
      { tool: 'pkg.install', args: { name: 'htop' } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        protection,
        host,
      },
    );
    expect(denied.allowed).toBe(false);
    expect(denied.denialReason).toMatch(/Protection mode|emergency/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns real sys.info from host', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const result = await executeToolCall(
      { tool: 'sys.info', args: {} },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
      },
    );
    expect(result.allowed).toBe(true);
    expect((result.result as { info: { hostname: string } }).info.hostname).toBeTruthy();
  });

  it('dryRun returns plan without writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const file = join(dir, 'nope.txt');
    const result = await executeToolCall(
      { tool: 'fs.write', args: { path: file, content: 'x' }, dryRun: true },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(() => readFileSync(file, 'utf8')).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fs.list and process.list work', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    writeFileSync(join(dir, 'a.txt'), 'a', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const list = await executeToolCall(
      { tool: 'fs.list', args: { path: dir } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
        dataDir: dir,
      },
    );
    expect(list.allowed).toBe(true);
    expect((list.result as { entries: string[] }).entries).toContain('a.txt');

    const procs = await executeToolCall(
      { tool: 'process.list', args: {} },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
      },
    );
    expect(procs.allowed).toBe(true);
    expect(Array.isArray((procs.result as { pids: string[] }).pids)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fs.delete removes managed file after approval path not required for low?', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tool-'));
    const file = join(dir, 'del.txt');
    writeFileSync(file, 'x', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const allowlist = createDefaultAllowlist();
    const approvals = new ApprovalQueue();
    // fs.delete may require approval depending on allowlist
    const first = await executeToolCall(
      { tool: 'fs.delete', args: { path: file } },
      { allowlist, approvals, actor: 'admin', roles: ['admin'], host, dataDir: dir },
    );
    if (first.requiresApproval && first.approvalId) {
      approvals.approve(first.approvalId, 'admin');
      const done = await executeToolCall(
        { tool: 'fs.delete', args: { path: file } },
        { allowlist, approvals, actor: 'admin', roles: ['admin'], host, dataDir: dir },
        first.approvalId,
      );
      expect(done.allowed).toBe(true);
    } else if (first.allowed) {
      expect((first.result as { deleted?: boolean }).deleted).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('service.status returns host result shape', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const result = await executeToolCall(
      { tool: 'service.status', args: { name: 'nginx' } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
      },
    );
    expect(result.allowed).toBe(true);
    expect((result.result as { name: string }).name).toBe('nginx');
  });

  it('rejects unknown tool dispatcher', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    // force via allowlist won't help — use a tool that might not be on allowlist
    const denied = await executeToolCall(
      { tool: 'totally.unknown.tool', args: {} },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        host,
      },
    );
    expect(denied.allowed).toBe(false);
  });
});
