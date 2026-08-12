import type { ApprovalStatus } from 'ysk-server-shared';
import type { YskDatabase } from '../db/database.js';
import type { StoreApproval } from '../db/store.js';

export type ApprovalRow = StoreApproval;

export class ApprovalRepository {
  constructor(private readonly db: YskDatabase) {}

  insert(row: ApprovalRow): void {
    this.db.snapshot.approvals.unshift({ ...row });
    this.db.persist();
  }

  find(id: string): ApprovalRow | undefined {
    const r = this.db.snapshot.approvals.find((a) => a.id === id);
    return r ? { ...r } : undefined;
  }

  list(status?: ApprovalStatus): ApprovalRow[] {
    const all = this.db.snapshot.approvals;
    return (status ? all.filter((a) => a.status === status) : all).map((a) => ({ ...a }));
  }

  updateStatus(id: string, status: ApprovalStatus, decidedBy?: string): void {
    const r = this.db.snapshot.approvals.find((a) => a.id === id);
    if (!r) return;
    r.status = status;
    r.decided_at = new Date().toISOString();
    if (decidedBy) r.decided_by = decidedBy;
    this.db.persist();
  }
}
