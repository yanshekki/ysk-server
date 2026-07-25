import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ApprovalRepository } from './approval-repo.js';

describe('ApprovalRepository', () => {
  it('inserts, finds, lists, updates status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-appr-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new ApprovalRepository(db);
    const row = {
      id: 'ap-1',
      action: 'tool.dangerous',
      risk: 'high' as const,
      status: 'pending' as const,
      requested_by: 'admin',
      created_at: new Date().toISOString(),
      payload: {},
    };
    repo.insert(row);
    expect(repo.find('ap-1')?.action).toBe('tool.dangerous');
    expect(repo.list('pending')).toHaveLength(1);
    repo.updateStatus('ap-1', 'approved', 'admin');
    expect(repo.find('ap-1')?.status).toBe('approved');
    expect(repo.find('ap-1')?.decided_by).toBe('admin');
    expect(repo.list('pending')).toHaveLength(0);
    repo.updateStatus('nope', 'rejected');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
