/**
 * Secure tool execution gate: Protection → Allowlist → RBAC → Approval → dry-run.
 * LLM output must never execute without this path.
 */

import type {
  OperationLevel,
  ResourceScope,
  SystemRole,
  ToolCallRequest,
  ToolCallResult,
} from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { Allowlist } from './allowlist.js';
import type { ApprovalQueue } from './approval.js';
import { checkRbac } from './rbac.js';
import { toolImpliedLevel } from './operation-level.js';
import type { ProtectionState } from '../services/protection.js';

/** Tools considered safe during emergency-playbook-only mode */
const EMERGENCY_TOOLS = new Set([
  'sys.info',
  'process.list',
  'service.status',
  'fs.read',
  'fs.list',
  'service.restart', // allow restarting critical services under ops playbooks
]);

export interface ToolExecutorOptions {
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  /** Who is requesting (for audit) */
  actor: string;
  /** Caller roles for RBAC (highest privilege wins) */
  roles?: SystemRole[];
  /** Optional resource scope (defaults to global) */
  scope?: ResourceScope;
  /** Active protection mode flags */
  protection?: ProtectionState;
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

  // Protection Mode gates (before allowlist so offline blocks early)
  const protection = opts.protection;
  if (protection?.blockExternalTools) {
    // In offline / hard protection, only local emergency catalog may proceed
    if (protection.emergencyPlaybooksOnly && !EMERGENCY_TOOLS.has(req.tool)) {
      return {
        allowed: false,
        requiresApproval: false,
        dryRun: Boolean(req.dryRun),
        denialReason: `Protection mode ${protection.mode}: tool blocked (emergency playbooks only)`,
      };
    }
    if (!protection.emergencyPlaybooksOnly && !EMERGENCY_TOOLS.has(req.tool)) {
      return {
        allowed: false,
        requiresApproval: false,
        dryRun: Boolean(req.dryRun),
        denialReason: `Protection mode ${protection.mode}: external/non-local tools blocked`,
      };
    }
  } else if (protection?.emergencyPlaybooksOnly && !EMERGENCY_TOOLS.has(req.tool)) {
    return {
      allowed: false,
      requiresApproval: false,
      dryRun: Boolean(req.dryRun),
      denialReason: `Protection mode ${protection.mode}: emergency playbooks only`,
    };
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

  const level: OperationLevel = toolImpliedLevel(req.tool, evaluation.risk);
  const scope: ResourceScope = opts.scope ?? req.scope ?? { kind: 'global' };
  const roles = opts.roles?.length ? opts.roles : (['viewer'] as SystemRole[]);

  // RBAC: any role may grant access; all denied → reject
  const rbacResults = roles.map((role) => checkRbac(role, scope, level));
  const rbacAllowed = rbacResults.some((r) => r.allowed);
  if (!rbacAllowed) {
    const reason =
      rbacResults.find((r) => !r.allowed)?.reason ??
      `RBAC denied for roles=${roles.join(',')} level=${level}`;
    return {
      allowed: false,
      requiresApproval: false,
      dryRun: Boolean(req.dryRun),
      denialReason: reason,
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
        operationLevel: level,
        wouldRequireApproval: evaluation.requiresApproval,
        schema: evaluation.entry?.argsSchema,
        protectionMode: protection?.mode ?? 'normal',
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

  const result = {
    tool: req.tool,
    args: req.args,
    executed: true,
    message: `Tool ${req.tool} executed under policy`,
    protectionMode: protection?.mode ?? 'normal',
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
