/**
 * AI task pipeline: natural language → planned tool steps → review → execute via allowlist.
 * LLM text is never executed directly.
 */

import { randomUUID } from 'node:crypto';
import type { RiskTier } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { Allowlist } from '../security/allowlist.js';
import type { LlmGateway } from '../llm/gateway.js';

export type TaskStepStatus = 'planned' | 'approved' | 'rejected' | 'executed' | 'failed' | 'skipped';

export interface TaskStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskTier;
  requiresApproval: boolean;
  status: TaskStepStatus;
  result?: unknown;
  error?: string;
}

export interface AiTask {
  id: string;
  prompt: string;
  status: 'planning' | 'awaiting_review' | 'running' | 'completed' | 'failed' | 'cancelled';
  steps: TaskStep[];
  planSummary: string;
  created_at: string;
  updated_at: string;
  actor: string;
}

export interface TaskStore {
  save(task: AiTask): void;
  get(id: string): AiTask | undefined;
  list(): AiTask[];
}

/**
 * Heuristic planner when LLM unavailable — maps common intents to allowlisted tools.
 */
export function planStepsFromPrompt(prompt: string, allowlist: Allowlist): {
  summary: string;
  steps: Omit<TaskStep, 'id' | 'status'>[];
} {
  const p = prompt.toLowerCase();
  const steps: Omit<TaskStep, 'id' | 'status'>[] = [];

  if (/sys\.?info|系統|system info|hostname|uptime/.test(p)) {
    const e = allowlist.evaluate('sys.info');
    steps.push({
      tool: 'sys.info',
      args: {},
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }
  if (/process|進程|程序/.test(p)) {
    const e = allowlist.evaluate('process.list');
    steps.push({
      tool: 'process.list',
      args: {},
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }
  if (/nginx|service status|服務狀態/.test(p)) {
    const name = /nginx/.test(p) ? 'nginx' : 'ysk-server';
    const e = allowlist.evaluate('service.status');
    steps.push({
      tool: 'service.status',
      args: { name },
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }
  if (/read\s+(\S+)|讀取\s*(\S+)|cat\s+(\S+)/.test(p)) {
    const m = p.match(/(?:read|讀取|cat)\s+(\S+)/);
    const path = m?.[1] ?? '/etc/os-release';
    const e = allowlist.evaluate('fs.read');
    steps.push({
      tool: 'fs.read',
      args: { path },
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }
  if (/restart\s+(\S+)|重啟\s*(\S+)/.test(p)) {
    const m = p.match(/(?:restart|重啟)\s+(\S+)/);
    const name = m?.[1] ?? 'nginx';
    const e = allowlist.evaluate('service.restart');
    steps.push({
      tool: 'service.restart',
      args: { name },
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }

  if (!steps.length) {
    // Default safe discovery
    const e = allowlist.evaluate('sys.info');
    steps.push({
      tool: 'sys.info',
      args: {},
      risk: e.risk,
      requiresApproval: e.requiresApproval,
    });
  }

  return {
    summary: `Planned ${steps.length} step(s) for: ${prompt.slice(0, 120)}`,
    steps,
  };
}

/**
 * Create a task in awaiting_review (or auto-run dry plan only).
 */
export function createAiTask(input: {
  prompt: string;
  actor: string;
  allowlist: Allowlist;
  store: TaskStore;
}): AiTask {
  if (!input.prompt?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, '請輸入提示內容', { httpStatus: 400 });
  }
  const planned = planStepsFromPrompt(input.prompt, input.allowlist);
  const now = new Date().toISOString();
  const task: AiTask = {
    id: randomUUID(),
    prompt: input.prompt.trim(),
    status: 'awaiting_review',
    planSummary: planned.summary,
    actor: input.actor,
    created_at: now,
    updated_at: now,
    steps: planned.steps.map((s) => ({
      ...s,
      id: randomUUID(),
      status: 'planned',
    })),
  };
  input.store.save(task);
  return task;
}

/**
 * Optional LLM enrichment of plan summary (never trusts model for tools list alone).
 */
export async function enrichPlanWithLlm(
  task: AiTask,
  llm: LlmGateway,
): Promise<AiTask> {
  try {
    const res = await llm.chat({
      messages: [
        {
          role: 'system',
          content:
            'You summarize server ops plans. Reply with 2 short sentences. Do not invent shell commands.',
        },
        {
          role: 'user',
          content: `User asked: ${task.prompt}\nSteps: ${task.steps.map((s) => s.tool).join(', ')}`,
        },
      ],
    });
    llm.assertNotExecutable(res);
    task.planSummary = `${task.planSummary}\n[LLM untrusted note] ${res.content.slice(0, 400)}`;
    task.updated_at = new Date().toISOString();
  } catch {
    // keep heuristic summary
  }
  return task;
}

/**
 * Approve all planned steps (human review).
 */
export function approveTaskSteps(task: AiTask, store: TaskStore): AiTask {
  for (const s of task.steps) {
    if (s.status === 'planned') s.status = 'approved';
  }
  task.status = 'awaiting_review';
  task.updated_at = new Date().toISOString();
  store.save(task);
  return task;
}

/**
 * Build RCA report structure from host facts + optional LLM prose.
 */
export function buildRcaReport(input: {
  title: string;
  facts: Record<string, unknown>;
  llmNote?: string;
}): {
  id: string;
  title: string;
  facts: Record<string, unknown>;
  hypotheses: string[];
  recommendedActions: string[];
  untrustedLlmNote?: string;
  created_at: string;
} {
  const hypotheses: string[] = [];
  const recommendedActions: string[] = [];
  const factsStr = JSON.stringify(input.facts).toLowerCase();
  if (factsStr.includes('inactive') || factsStr.includes('failed')) {
    hypotheses.push('A managed service may be down or misconfigured');
    recommendedActions.push('Check service.status and recent logs before restart');
  }
  if (factsStr.includes('enospc') || factsStr.includes('no space')) {
    hypotheses.push('Disk space exhaustion');
    recommendedActions.push('Inspect disk usage and prune logs/backups');
  }
  if (!hypotheses.length) {
    hypotheses.push('Insufficient signals — gather sys.info, process.list, and service logs');
    recommendedActions.push('Run read-only discovery tools, then re-run RCA');
  }
  return {
    id: randomUUID(),
    title: input.title,
    facts: input.facts,
    hypotheses,
    recommendedActions,
    untrustedLlmNote: input.llmNote,
    created_at: new Date().toISOString(),
  };
}
