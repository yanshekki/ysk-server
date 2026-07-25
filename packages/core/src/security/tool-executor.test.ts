import { describe, expect, it } from 'vitest';
import { createDefaultAllowlist } from './allowlist.js';
import { ApprovalQueue } from './approval.js';
import { executeToolCall } from './tool-executor.js';

describe('executeToolCall', () => {
  it('denies non-listed destructive tools', () => {
    const result = executeToolCall(
      { tool: 'shell.exec', args: { cmd: 'rm -rf /' } },
      { allowlist: createDefaultAllowlist(), approvals: new ApprovalQueue(), actor: 'agent' },
    );
    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBeTruthy();
  });

  it('creates approval for high-risk tools and executes after approve', () => {
    const approvals = new ApprovalQueue();
    const allowlist = createDefaultAllowlist();
    const pending = executeToolCall(
      { tool: 'service.restart', args: { name: 'nginx' } },
      { allowlist, approvals, actor: 'operator' },
    );
    expect(pending.requiresApproval).toBe(true);
    expect(pending.approvalId).toBeTruthy();

    approvals.approve(pending.approvalId!, 'admin');
    const done = executeToolCall(
      { tool: 'service.restart', args: { name: 'nginx' } },
      { allowlist, approvals, actor: 'operator' },
      pending.approvalId,
    );
    expect(done.allowed).toBe(true);
    expect(done.result).toMatchObject({ executed: true });
  });

  it('supports dry-run schema discovery without side effects', () => {
    const result = executeToolCall(
      { tool: 'fs.write', args: { path: '/tmp/a', content: 'x' }, dryRun: true },
      { allowlist: createDefaultAllowlist(), approvals: new ApprovalQueue(), actor: 'admin' },
    );
    expect(result.dryRun).toBe(true);
    expect(result.result).toMatchObject({ wouldRequireApproval: true });
  });
});
