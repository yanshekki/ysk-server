import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { createDefaultAllowlist } from '../security/allowlist.js';
import { ApprovalQueue } from '../security/approval.js';
import { LocalHostExecutor } from '../host/executor.js';
import { AuditRepository } from '../repositories/audit-repo.js';
import { LlmGateway, echoTransport } from '../llm/gateway.js';
import { AiTaskService } from './ai-task-service.js';
import { evaluateProtection } from './protection.js';
import { YskError } from 'ysk-server-shared';

describe('AiTaskService', () => {
  function makeService(dir: string) {
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const audit = new AuditRepository(db);
    const llm = new LlmGateway(
      { baseUrl: 'http://127.0.0.1:11434', defaultModel: 'local' },
      echoTransport,
    );
    const svc = new AiTaskService(
      db,
      createDefaultAllowlist(),
      new ApprovalQueue(),
      host,
      audit,
      llm,
      () => evaluateProtection({ networkReachable: true }),
    );
    return { db, svc };
  }

  it('creates, lists, approves, and executes sys.info task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ai-'));
    const { db, svc } = makeService(dir);

    const task = await svc.create('show system info', 'admin', false);
    expect(task.status).toBe('awaiting_review');
    expect(task.steps.some((s) => s.tool === 'sys.info')).toBe(true);
    expect(svc.list().some((t) => t.id === task.id)).toBe(true);

    const approved = svc.approve(task.id, 'admin');
    expect(approved.steps.every((s) => s.status === 'approved')).toBe(true);

    const done = await svc.execute(task.id, 'admin', ['admin']);
    expect(['completed', 'failed']).toContain(done.status);
    expect(done.steps.some((s) => s.tool === 'sys.info' && s.status === 'executed')).toBe(true);

    expect(() => svc.get('missing')).toThrow(YskError);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
