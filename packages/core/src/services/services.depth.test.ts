import { describe, expect, it, vi } from 'vitest';
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
import { runProtectionProbes } from './protection-probe.js';
import { Scheduler } from './scheduler.js';
import { YskError } from 'ysk-server-shared';

describe('services thin paths depth', () => {
  it('Scheduler everyDynamic re-arms and stopAll', async () => {
    const s = new Scheduler();
    let interval = 5_000;
    const fn = vi.fn();
    s.everyDynamic(
      'dyn',
      () => interval,
      async () => {
        fn();
        interval = 6_000;
      },
      { runImmediately: true },
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(fn).toHaveBeenCalled();
    const job = s.get('dyn');
    expect(job?.id).toBe('dyn');
    expect(job?.intervalMs).toBeGreaterThanOrEqual(5_000);
    s.stopAll();
    expect(s.list()).toHaveLength(0);
    expect(s.get('dyn')).toBeUndefined();
  });

  it('Scheduler everyDynamic without immediate still registers', async () => {
    const s = new Scheduler();
    s.everyDynamic('later', () => 10_000, () => undefined, { runImmediately: false });
    expect(s.list()).toHaveLength(1);
    expect(s.get('later')?.nextRunAt).toBeTruthy();
    s.stop('later');
  });

  it('AiTaskService cancel and rejectStep', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ai-d-'));
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

    const task = await svc.create('show system info', 'admin', false);
    expect(task.status).toBe('awaiting_review');
    const stepId = task.steps[0]?.id;
    expect(stepId).toBeTruthy();

    const rejected = svc.rejectStep(task.id, stepId!, 'admin');
    expect(rejected.steps.find((s) => s.id === stepId)?.status).toBe('rejected');
    expect(() => svc.rejectStep(task.id, 'no-step', 'admin')).toThrow(YskError);

    const t2 = await svc.create('list files', 'admin', false);
    const cancelled = svc.cancel(t2.id, 'admin');
    expect(cancelled.status).toBe('cancelled');
    const again = svc.cancel(t2.id, 'admin');
    expect(again.status).toBe('cancelled');

    // execute with rejected/skipped steps still finishes
    const t3 = await svc.create('show system info', 'admin', false);
    svc.approve(t3.id, 'admin');
    svc.rejectStep(t3.id, t3.steps[0]!.id, 'admin');
    const done = await svc.execute(t3.id, 'admin', ['admin']);
    expect(['completed', 'failed']).toContain(done.status);

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('runProtectionProbes high rate path', async () => {
    const r = await runProtectionProbes({
      requestCountLastMinute: 10_000,
      rateThreshold: 100,
    });
    expect(r.highRequestRate).toBe(true);
    expect(r.details.join(' ')).toMatch(/10000|100/);
    expect(r.protection.mode).toMatch(/degraded|ddos|normal|offline/);
  }, 15_000);
});
