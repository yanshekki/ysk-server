/**
 * Human-in-the-loop approval queue — persisted via ApprovalRepository when provided.
 */

import type { ApprovalStatus, RiskTier } from '@ysk-server/shared';
import { ErrorCodes, YskError, tl} from '@ysk-server/shared';
import { randomUUID } from 'node:crypto';
import type { ApprovalRepository, ApprovalRow } from '../repositories/approval-repo.js';

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
  private readonly memory = new Map<string, ApprovalRecord>();

  constructor(private readonly repo?: ApprovalRepository) {}

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
      createdAt: new Date().toISOString() };
    if (this.repo) {
      this.repo.insert(toRow(record));
    } else {
      this.memory.set(record.id, record);
    }
    return { ...record };
  }

  get(id: string): ApprovalRecord | undefined {
    if (this.repo) {
      const row = this.repo.find(id);
      return row ? fromRow(row) : undefined;
    }
    const r = this.memory.get(id);
    return r ? { ...r } : undefined;
  }

  list(status?: ApprovalStatus): ApprovalRecord[] {
    if (this.repo) {
      return this.repo.list(status).map(fromRow);
    }
    const all = [...this.memory.values()];
    return (status ? all.filter((r) => r.status === status) : all).map((r) => ({ ...r }));
  }

  approve(id: string, decidedBy: string): ApprovalRecord {
    return this.decide(id, 'approved', decidedBy);
  }

  reject(id: string, decidedBy: string): ApprovalRecord {
    return this.decide(id, 'rejected', decidedBy);
  }

  markExecuted(id: string): ApprovalRecord {
    const record = this.require(id);
    if (record.status !== 'approved') {
      throw new YskError(
        ErrorCodes.VALIDATION,
        tl('notes.auto.t0012', { v0: (record.status) }),
        { httpStatus: 400 },
      );
    }
    record.status = 'executed';
    this.persist(record);
    return { ...record };
  }

  assertApproved(id: string | undefined, action: string): void {
    if (!id) {
      throw new YskError(
        ErrorCodes.APPROVAL_REQUIRED,
        tl('notes.auto.t0013', { v0: (action) }),
        { httpStatus: 403, details: { action } },
      );
    }
    const record = this.get(id);
    if (!record) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.approval.notFound', { id }), { httpStatus: 404 });
    }
    if (record.status === 'pending') {
      throw new YskError(ErrorCodes.APPROVAL_PENDING, tl('notes.auto.n0670'), {
        httpStatus: 403,
        details: { id, action } });
    }
    if (record.status === 'rejected') {
      throw new YskError(ErrorCodes.APPROVAL_REJECTED, tl('notes.auto.n0672'), {
        httpStatus: 403,
        details: { id, action } });
    }
    if (record.status !== 'approved' && record.status !== 'executed') {
      throw new YskError(ErrorCodes.APPROVAL_REQUIRED, tl('notes.auto.t0014', { v0: (record.status) }), {
        httpStatus: 403 });
    }
    if (record.action !== action) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0671'), {
        httpStatus: 400,
        details: { expected: action, got: record.action } });
    }
  }

  private decide(id: string, status: 'approved' | 'rejected', decidedBy: string): ApprovalRecord {
    const record = this.require(id);
    if (record.status !== 'pending') {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0015', { v0: (record.status) }), {
        httpStatus: 400 });
    }
    record.status = status;
    record.decidedAt = new Date().toISOString();
    record.decidedBy = decidedBy;
    this.persist(record);
    return { ...record };
  }

  private require(id: string): ApprovalRecord {
    const record = this.get(id);
    if (!record) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.approval.notFound', { id }), { httpStatus: 404 });
    }
    // return mutable copy bound for persist — re-fetch into memory map if needed
    if (!this.repo) {
      return this.memory.get(id)!;
    }
    // for repo-backed, work on a mutable object then persist
    return { ...record };
  }

  private persist(record: ApprovalRecord): void {
    if (this.repo) {
      this.repo.updateStatus(record.id, record.status, record.decidedBy);
    } else {
      this.memory.set(record.id, record);
    }
  }
}

function toRow(r: ApprovalRecord): ApprovalRow {
  return {
    id: r.id,
    action: r.action,
    risk: r.risk,
    requested_by: r.requestedBy,
    status: r.status,
    payload: r.payload,
    created_at: r.createdAt,
    decided_at: r.decidedAt,
    decided_by: r.decidedBy };
}

function fromRow(r: ApprovalRow): ApprovalRecord {
  return {
    id: r.id,
    action: r.action,
    risk: r.risk,
    requestedBy: r.requested_by,
    status: r.status,
    payload: r.payload,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by };
}
