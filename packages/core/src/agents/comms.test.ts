import { describe, expect, it } from 'vitest';
import { AgentComms } from './comms.js';
import { YskError } from 'ysk-server-shared';

describe('AgentComms', () => {
  it('registers, heartbeats, enqueues, lists', () => {
    const c = new AgentComms();
    expect(() => c.register('')).toThrow(YskError);
    const s = c.register('edge-1');
    expect(s.status).toBe('connected');
    expect(c.listSessions().some((x) => x.id === s.id)).toBe(true);

    const hb = c.heartbeat(s.id);
    expect(hb.status).toBe('connected');

    const cmd = c.enqueueCommand(s.id, { op: 'ping' });
    expect(cmd.type).toBe('command');
    expect(cmd.direction).toBe('outbound');
    expect(c.listMessages(s.id).length).toBeGreaterThanOrEqual(2);

    expect(() => c.heartbeat('missing')).toThrow(YskError);
  });
});
