/**
 * Persist AI tasks and execute approved steps through the secure tool gate.
 */

import type { YskDatabase } from '../db/database.js';
import type { Allowlist } from '../security/allowlist.js';
import type { ApprovalQueue } from '../security/approval.js';
import type { HostExecutor } from '../host/executor.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { ProtectionState } from './protection.js';
import type { SystemRole } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import {
  approveTaskSteps,
  createAiTask,
  enrichPlanWithLlm,
  type AiTask,
  type TaskStore,
} from '../skills/task-planner.js';
import { executeToolCall } from '../security/tool-executor.js';
import type { LlmGateway } from '../llm/gateway.js';

class DbTaskStore implements TaskStore {
  constructor(private readonly db: YskDatabase) {}
  save(task: AiTask): void {
    const list = this.db.snapshot.ai_tasks as unknown as AiTask[];
    const i = list.findIndex((t) => t.id === task.id);
    if (i >= 0) list[i] = task;
    else list.unshift(task);
    this.db.persist();
  }
  get(id: string): AiTask | undefined {
    return (this.db.snapshot.ai_tasks as unknown as AiTask[]).find((t) => t.id === id);
  }
  list(): AiTask[] {
    return (this.db.snapshot.ai_tasks as unknown as AiTask[]).map((t) => ({
      ...t,
      steps: t.steps.map((s) => ({ ...s })),
    }));
  }
}

export class AiTaskService {
  private readonly store: DbTaskStore;

  constructor(
    db: YskDatabase,
    private readonly allowlist: Allowlist,
    private readonly approvals: ApprovalQueue,
    private readonly host: HostExecutor,
    private readonly audit: AuditRepository,
    private readonly llm: LlmGateway,
    private readonly getProtection: () => ProtectionState,
  ) {
    this.store = new DbTaskStore(db);
  }

  list(): AiTask[] {
    return this.store.list();
  }

  get(id: string): AiTask {
    const t = this.store.get(id);
    if (!t) throw new YskError(ErrorCodes.NOT_FOUND, `task not found: ${id}`, { httpStatus: 404 });
    return t;
  }

  async create(prompt: string, actor: string, enrich = true): Promise<AiTask> {
    let task = createAiTask({
      prompt,
      actor,
      allowlist: this.allowlist,
      store: this.store,
    });
    if (enrich) {
      task = await enrichPlanWithLlm(task, this.llm);
      this.store.save(task);
    }
    this.audit.append({
      actor,
      action: 'ai.task.create',
      resource: task.id,
      detail: { prompt, steps: task.steps.map((s) => s.tool) },
      ok: true,
    });
    return task;
  }

  approve(id: string, actor: string): AiTask {
    const task = this.get(id);
    const updated = approveTaskSteps(task, this.store);
    this.audit.append({
      actor,
      action: 'ai.task.approve',
      resource: id,
      detail: {},
      ok: true,
    });
    return updated;
  }

  /**
   * Execute approved (or non-approval) steps via real tool executor.
   */
  async execute(
    id: string,
    actor: string,
    roles: SystemRole[],
  ): Promise<AiTask> {
    const task = this.get(id);
    task.status = 'running';
    this.store.save(task);

    for (const step of task.steps) {
      if (step.status === 'rejected' || step.status === 'skipped') continue;
      // auto-approve low risk planned steps for execution path
      if (step.status === 'planned' && !step.requiresApproval) {
        step.status = 'approved';
      }
      if (step.status !== 'approved' && step.status !== 'planned') continue;
      if (step.requiresApproval && step.status !== 'approved') {
        step.status = 'skipped';
        step.error = 'requires human approval — call approve first';
        continue;
      }

      try {
        let approvalId: string | undefined;
        if (step.requiresApproval) {
          // create and auto-link if already task-approved: still need approval queue record for tool gate
          const pending = this.approvals.request({
            action: step.tool,
            risk: step.risk,
            requestedBy: actor,
            payload: step.args,
          });
          this.approvals.approve(pending.id, actor);
          approvalId = pending.id;
        }
        const result = await executeToolCall(
          { tool: step.tool, args: step.args },
          {
            allowlist: this.allowlist,
            approvals: this.approvals,
            actor,
            roles,
            host: this.host,
            audit: this.audit,
            protection: this.getProtection(),
          },
          approvalId,
        );
        if (!result.allowed) {
          step.status = 'failed';
          step.error = result.denialReason;
        } else if (result.requiresApproval && !result.result) {
          step.status = 'failed';
          step.error = 'approval still required';
        } else {
          step.status = 'executed';
          step.result = result.result;
        }
      } catch (e) {
        step.status = 'failed';
        step.error = e instanceof Error ? e.message : String(e);
      }
    }

    const failed = task.steps.some((s) => s.status === 'failed');
    task.status = failed ? 'failed' : 'completed';
    task.updated_at = new Date().toISOString();
    this.store.save(task);
    this.audit.append({
      actor,
      action: 'ai.task.execute',
      resource: id,
      detail: { status: task.status },
      ok: !failed,
    });
    return task;
  }
}
