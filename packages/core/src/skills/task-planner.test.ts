import { describe, expect, it } from 'vitest';
import { createDefaultAllowlist } from '../security/allowlist.js';
import {
  buildRcaReport,
  createAiTask,
  planStepsFromPrompt,
  type AiTask,
  type TaskStore,
} from './task-planner.js';
import { getPlaybook, listPlaybooks } from './playbooks.js';

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
});
