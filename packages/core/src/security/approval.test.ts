import { describe, expect, it } from 'vitest';
import { ApprovalQueue } from './approval.js';
import { ErrorCodes, YskError } from '@ysk/shared';

describe('ApprovalQueue', () => {
  it('requires approval before high-risk execute', () => {
    const q = new ApprovalQueue();
    expect(() => q.assertApproved(undefined, 'service.restart')).toThrow(YskError);
    try {
      q.assertApproved(undefined, 'service.restart');
    } catch (e) {
      expect((e as YskError).code).toBe(ErrorCodes.APPROVAL_REQUIRED);
    }
  });

  it('blocks pending and rejected; allows approved', () => {
    const q = new ApprovalQueue();
    const pending = q.request({
      action: 'fs.delete',
      risk: 'critical',
      requestedBy: 'admin',
      payload: { path: '/tmp/x' },
    });
    expect(pending.status).toBe('pending');
    expect(() => q.assertApproved(pending.id, 'fs.delete')).toThrow(/pending/i);

    const approved = q.approve(pending.id, 'admin');
    expect(approved.status).toBe('approved');
    expect(() => q.assertApproved(pending.id, 'fs.delete')).not.toThrow();

    const other = q.request({
      action: 'pkg.remove',
      risk: 'critical',
      requestedBy: 'admin',
    });
    q.reject(other.id, 'admin');
    expect(() => q.assertApproved(other.id, 'pkg.remove')).toThrow(YskError);
  });

  it('marks executed after approve', () => {
    const q = new ApprovalQueue();
    const r = q.request({ action: 'fs.write', risk: 'medium', requestedBy: 'op' });
    q.approve(r.id, 'admin');
    const executed = q.markExecuted(r.id);
    expect(executed.status).toBe('executed');
  });
});
