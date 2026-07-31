import { describe, expect, it } from 'vitest';
import {
  listPlaybooks,
  getPlaybook,
  startPlaybookRun,
  BUILTIN_PLAYBOOKS,
} from './playbooks.js';
import { YskError } from '@ysk/shared';

describe('playbooks', () => {
  it('lists builtin playbooks with steps', () => {
    const list = listPlaybooks();
    expect(list.length).toBe(BUILTIN_PLAYBOOKS.length);
    expect(list.length).toBeGreaterThan(3);
    for (const p of list) {
      expect(p.id).toBeTruthy();
      expect(p.steps.length).toBeGreaterThan(0);
      for (const s of p.steps) {
        expect(s.tool).toBeTruthy();
        expect(typeof s.args).toBe('object');
      }
    }
  });

  it('getPlaybook returns known id and throws for unknown', () => {
    const p = getPlaybook('discover-host');
    expect(p.id).toBe('discover-host');
    expect(p.steps.some((s) => s.tool === 'sys.info')).toBe(true);
    expect(() => getPlaybook('no-such-playbook-xyz')).toThrow(YskError);
  });

  it('startPlaybookRun creates pending run after validating playbook', () => {
    const run = startPlaybookRun('nginx-health', 'admin');
    expect(run.status).toBe('pending');
    expect(run.playbookId).toBe('nginx-health');
    expect(run.actor).toBe('admin');
    expect(run.results).toEqual([]);
    expect(run.id).toMatch(/[0-9a-f-]{36}/i);
    expect(() => startPlaybookRun('missing', 'admin')).toThrow(YskError);
  });

  it('includes at least one emergency playbook', () => {
    expect(listPlaybooks().some((p) => p.emergency)).toBe(true);
  });
});
