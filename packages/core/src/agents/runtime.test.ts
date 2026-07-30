import { describe, expect, it } from 'vitest';
import { listAgentRuntimes, parseAgentKind, planAgentInstall } from './runtime.js';
import { AgentComms } from './comms.js';

describe('agent runtimes + comms', () => {
  it('lists and plans OpenClaw Hermes IonClaw', () => {
    const list = listAgentRuntimes();
    expect(list.map((a) => a.kind).sort()).toEqual(['hermes', 'ionclaw', 'openclaw']);
    const plan = planAgentInstall('openclaw');
    expect(plan.commands.length).toBeGreaterThan(0);
    expect(plan.commands.every((c) => !c.includes('|| true'))).toBe(true);
    expect(plan.supervision.some((s) => /Allowlist/i.test(s))).toBe(true);
    expect(parseAgentKind('hermes')).toBe('hermes');
  });

  it('registers outbound agent sessions', () => {
    const comms = new AgentComms();
    const session = comms.register('edge-1');
    expect(session.status).toBe('connected');
    comms.heartbeat(session.id);
    const cmd = comms.enqueueCommand(session.id, { tool: 'sys.info' });
    expect(cmd.direction).toBe('outbound');
    expect(comms.listMessages(session.id).length).toBeGreaterThan(0);
  });
});
