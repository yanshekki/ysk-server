/**
 * Human-in-the-loop approval queue for high-risk actions.
 */

import type { ApprovalStatus, RiskTier } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { randomUUID } from 'node:crypto';

export interface ApprovalRecord {
  id: string;
  action: string;
  risk: RiskTier;
  requestedBy: string;
  status: ApprovalStatus;
  payload: unknown;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export class ApprovalQueue {
  private readonly records = new Map<string, ApprovalRecord>();

  /**
   * Create a pending approval request for a high-risk action.
   */
  request(input: {
    action: string;
    risk: RiskTier;
    requestedBy: string;
    payload?: unknown;
  }): ApprovalRecord {
    const record: ApprovalRecord = {
      id: randomUUID(),
      action: input.action,
      risk: input.risk,
      requestedBy: input.requestedBy,
      status: 'pending',
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  get(id: string): ApprovalRecord | undefined {
    const r = this.records.get(id);
    return r ? { ...r } : undefined;
  }

  list(status?: ApprovalStatus): ApprovalRecord[] {
    const all = [...this.records.values()];
    const filtered = status ? all.filter((r) => r.status === status) : all;
    return filtered.map((r) => ({ ...r }));
  }

  /**
   * Approve a pending request. Returns updated record.
   */
  approve(id: string, decidedBy: string): ApprovalRecord {
    return this.decide(id, 'approved', decidedBy);
  }

  /**
   * Reject a pending request.
   */
  reject(id: string, decidedBy: string): ApprovalRecord {
    return this.decide(id, 'rejected', decidedBy);
  }

  /**
   * Mark approved request as executed after successful run.
   */
  markExecuted(id: string): ApprovalRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Approval not found: ${id}`, { httpStatus: 404 });
    }
    if (record.status !== 'approved') {
      throw new YskError(
        ErrorCodes.VALIDATION,
        `Cannot mark executed from status ${record.status}`,
        { httpStatus: 400 },
      );
    }
    record.status = 'executed';
    return { ...record };
  }

  /**
   * Ensure an approval id is approved before high-risk execute.
   */
  assertApproved(id: string | undefined, action: string): void {
    if (!id) {
      throw new YskError(
        ErrorCodes.APPROVAL_REQUIRED,
        `Human approval required for action: ${action}`,
        { httpStatus: 403, details: { action } },
      );
    }
    const record = this.records.get(id);
    if (!record) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Approval not found: ${id}`, { httpStatus: 404 });
    }
    if (record.status === 'pending') {
      throw new YskError(ErrorCodes.APPROVAL_PENDING, 'Approval still pending', {
        httpStatus: 403,
        details: { id, action },
      });
    }
    if (record.status === 'rejected') {
      throw new YskError(ErrorCodes.APPROVAL_REJECTED, 'Approval was rejected', {
        httpStatus: 403,
        details: { id, action },
      });
    }
    if (record.status !== 'approved' && record.status !== 'executed') {
      throw new YskError(ErrorCodes.APPROVAL_REQUIRED, `Invalid approval status: ${record.status}`, {
        httpStatus: 403,
      });
    }
    if (record.action !== action) {
      throw new YskError(ErrorCodes.VALIDATION, 'Approval action mismatch', {
        httpStatus: 400,
        details: { expected: action, got: record.action },
      });
    }
  }

  private decide(id: string, status: 'approved' | 'rejected', decidedBy: string): ApprovalRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Approval not found: ${id}`, { httpStatus: 404 });
    }
    if (record.status !== 'pending') {
      throw new YskError(ErrorCodes.VALIDATION, `Approval already ${record.status}`, {
        httpStatus: 400,
      });
    }
    record.status = status;
    record.decidedAt = new Date().toISOString();
    record.decidedBy = decidedBy;
    return { ...record };
  }
}
