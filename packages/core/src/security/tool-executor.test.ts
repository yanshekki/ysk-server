import { describe, expect, it } from 'vitest';
import { createDefaultAllowlist } from './allowlist.js';
import { ApprovalQueue } from './approval.js';
import { executeToolCall } from './tool-executor.js';
import { evaluateProtection } from '../services/protection.js';

describe('executeToolCall', () => {
  it('denies non-listed destructive tools', () => {
    const result = executeToolCall(
      { tool: 'shell.exec', args: { cmd: 'rm -rf /' } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'agent',
        roles: ['admin'],
      },
    );
    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBeTruthy();
  });

  it('creates approval for high-risk tools and executes after approve', () => {
    const approvals = new ApprovalQueue();
    const allowlist = createDefaultAllowlist();
    const pending = executeToolCall(
      { tool: 'service.restart', args: { name: 'nginx' } },
      { allowlist, approvals, actor: 'operator', roles: ['operator'], scope: { kind: 'project', id: 'p1' } },
    );
    expect(pending.requiresApproval).toBe(true);
    expect(pending.approvalId).toBeTruthy();

    approvals.approve(pending.approvalId!, 'admin');
    const done = executeToolCall(
      { tool: 'service.restart', args: { name: 'nginx' } },
      { allowlist, approvals, actor: 'operator', roles: ['operator'], scope: { kind: 'project', id: 'p1' } },
      pending.approvalId,
    );
    expect(done.allowed).toBe(true);
    expect(done.result).toMatchObject({ executed: true });
  });

  it('enforces RBAC: viewer cannot run write tools', () => {
    const result = executeToolCall(
      { tool: 'fs.write', args: { path: '/tmp/a', content: 'x' }, dryRun: true },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'bob',
        roles: ['viewer'],
      },
    );
    expect(result.allowed).toBe(false);
    expect(result.denialReason).toMatch(/read-only|cannot perform|Role viewer/i);
  });

  it('blocks non-emergency tools in offline protection mode', () => {
    const protection = evaluateProtection({ networkReachable: false });
    expect(protection.blockExternalTools).toBe(true);
    expect(protection.emergencyPlaybooksOnly).toBe(true);

    const denied = executeToolCall(
      { tool: 'pkg.install', args: { name: 'htop' } },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        protection,
      },
    );
    expect(denied.allowed).toBe(false);
    expect(denied.denialReason).toMatch(/Protection mode|emergency/i);

    const allowed = executeToolCall(
      { tool: 'sys.info', args: {}, dryRun: true },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
        protection,
      },
    );
    expect(allowed.allowed).toBe(true);
  });

  it('supports dry-run schema discovery without side effects', () => {
    const result = executeToolCall(
      { tool: 'fs.write', args: { path: '/tmp/a', content: 'x' }, dryRun: true },
      {
        allowlist: createDefaultAllowlist(),
        approvals: new ApprovalQueue(),
        actor: 'admin',
        roles: ['admin'],
      },
    );
    expect(result.dryRun).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.result).toMatchObject({ wouldRequireApproval: true });
  });
});
