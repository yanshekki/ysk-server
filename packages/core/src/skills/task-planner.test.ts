import { describe, expect, it } from 'vitest';
import { createDefaultAllowlist } from '../security/allowlist.js';
import {
  approveTaskSteps,
  buildRcaReport,
  createAiTask,
  planStepsFromPrompt,
  type AiTask,
  type TaskStore,
} from './task-planner.js';
import { getPlaybook, listPlaybooks, startPlaybookRun } from './playbooks.js';

class MemStore implements TaskStore {
  tasks = new Map<string, AiTask>();
  save(t: AiTask) {
    this.tasks.set(t.id, t);
  }
  get(id: string) {
    return this.tasks.get(id);
  }
  list() {
    return [...this.tasks.values()];
  }
}

describe('AI task planner', () => {
  it('plans allowlisted tools from natural language', () => {
    const al = createDefaultAllowlist();
    const plan = planStepsFromPrompt('show system info and nginx status', al);
    expect(plan.steps.some((s) => s.tool === 'sys.info')).toBe(true);
    expect(plan.steps.some((s) => s.tool === 'service.status')).toBe(true);
  });

  it('creates persisted task awaiting review', () => {
    const store = new MemStore();
    const task = createAiTask({
      prompt: 'list processes',
      actor: 'admin',
      allowlist: createDefaultAllowlist(),
      store,
    });
    expect(task.status).toBe('awaiting_review');
    expect(store.get(task.id)?.steps[0]?.tool).toBe('process.list');
  });

  it('builds RCA with hypotheses', () => {
    const r = buildRcaReport({
      title: 'svc down',
      facts: { status: 'inactive' },
    });
    expect(r.hypotheses.length).toBeGreaterThan(0);
    expect(r.recommendedActions.length).toBeGreaterThan(0);
  });

  it('lists built-in playbooks', () => {
    expect(listPlaybooks().length).toBeGreaterThan(2);
    expect(getPlaybook('nginx-health').steps[0].tool).toBe('service.status');
  });

  it('startPlaybookRun creates pending run and rejects unknown', () => {
    const run = startPlaybookRun('discover-host', 'admin');
    expect(run.status).toBe('pending');
    expect(run.playbookId).toBe('discover-host');
    expect(() => getPlaybook('no-such-playbook')).toThrow(/not found/i);
  });

  it('approveTaskSteps marks planned steps approved', () => {
    const store = new MemStore();
    const task = createAiTask({
      prompt: 'show system info',
      actor: 'admin',
      allowlist: createDefaultAllowlist(),
      store,
    });
    const approved = approveTaskSteps(task, store);
    expect(approved.steps.every((s) => s.status === 'approved')).toBe(true);
  });

  it('plans default discovery when prompt unmatched', () => {
    const plan = planStepsFromPrompt('something vague xyz', createDefaultAllowlist());
    expect(plan.steps.some((s) => s.tool === 'sys.info')).toBe(true);
  });

  it('buildRcaReport detects disk and service signals', () => {
    const down = buildRcaReport({ title: 'x', facts: { status: 'inactive' } });
    expect(down.hypotheses.some((h) => /service/i.test(h))).toBe(true);
    const disk = buildRcaReport({ title: 'x', facts: { err: 'ENOSPC no space' } });
    expect(disk.hypotheses.some((h) => /disk/i.test(h))).toBe(true);
    const empty = buildRcaReport({ title: 'x', facts: {} });
    expect(empty.hypotheses.length).toBeGreaterThan(0);
  });
});
