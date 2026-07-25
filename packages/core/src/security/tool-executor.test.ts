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
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.result).toMatchObject({ content: 'hello-ysk', executed: true });
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
      { allowlist, approvals, actor: 'operator', roles: ['admin'], host },
    );
    expect(pending.requiresApproval).toBe(true);
    expect(pending.approvalId).toBeTruthy();
    // file must not exist yet
    expect(() => readFileSync(file, 'utf8')).toThrow();

    approvals.approve(pending.approvalId!, 'admin');
    const done = await executeToolCall(
      { tool: 'fs.write', args: { path: file, content: 'written-for-real' } },
      { allowlist, approvals, actor: 'operator', roles: ['admin'], host },
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
});
