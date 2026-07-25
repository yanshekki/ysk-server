/**
 * Secure tool execution gate: Allowlist → Approval → (optional) dry-run.
 * LLM output must never execute without this path.
 */

import type { ToolCallRequest, ToolCallResult } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { Allowlist } from './allowlist.js';
import type { ApprovalQueue } from './approval.js';

export interface ToolExecutorOptions {
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  /** Who is requesting (for audit) */
  actor: string;
}

/**
 * Evaluate and optionally stage a tool call. Never trusts model text.
 */
export function executeToolCall(
  req: ToolCallRequest,
  opts: ToolExecutorOptions,
  approvalId?: string,
): ToolCallResult {
  if (!req.tool || typeof req.tool !== 'string') {
    throw new YskError(ErrorCodes.VALIDATION, 'tool is required', { httpStatus: 400 });
  }

  const evaluation = opts.allowlist.evaluate(req.tool);

  if (!evaluation.allowed) {
    return {
      allowed: false,
      requiresApproval: false,
      dryRun: Boolean(req.dryRun),
      denialReason: evaluation.reason,
    };
  }

  if (req.dryRun) {
    return {
      allowed: true,
      requiresApproval: evaluation.requiresApproval,
      dryRun: true,
      result: {
        tool: req.tool,
        args: req.args,
        risk: evaluation.risk,
        wouldRequireApproval: evaluation.requiresApproval,
        schema: evaluation.entry?.argsSchema,
      },
    };
  }

  if (evaluation.requiresApproval) {
    if (!approvalId) {
      const pending = opts.approvals.request({
        action: req.tool,
        risk: evaluation.risk,
        requestedBy: opts.actor,
        payload: req.args,
      });
      return {
        allowed: true,
        requiresApproval: true,
        approvalId: pending.id,
        dryRun: false,
        result: { status: 'pending_approval', approvalId: pending.id },
      };
    }
    opts.approvals.assertApproved(approvalId, req.tool);
  }

  // Pure "execution" stub — real side effects live behind host adapters in production
  const result = {
    tool: req.tool,
    args: req.args,
    executed: true,
    message: `Tool ${req.tool} executed under policy`,
  };

  if (approvalId) {
    try {
      opts.approvals.markExecuted(approvalId);
    } catch {
      // already executed is ok for idempotent retry paths
    }
  }

  return {
    allowed: true,
    requiresApproval: evaluation.requiresApproval,
    approvalId,
    dryRun: false,
    result,
  };
}
