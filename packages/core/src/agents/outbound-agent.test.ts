import { describe, expect, it } from 'vitest';
import { agentCycle } from './outbound-agent.js';

describe('outbound agent cycle', () => {
  it('registers, heartbeats, and handles commands via mock fetch', async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/register')) {
        return new Response(JSON.stringify({ id: 'sess-1', agent_id: 'a1', status: 'connected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/heartbeat')) {
        return new Response(JSON.stringify({ id: 'sess-1', status: 'connected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/commands')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'c1', payload: { tool: 'sys.info' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const handled: unknown[] = [];
    const r = await agentCycle({
      controlPlane: 'http://cp.local',
      agentId: 'edge-1',
      fetchImpl: fetchImpl as typeof fetch,
      onCommand: (cmd) => {
        handled.push(cmd.payload);
        return { ok: true };
      },
    });
    expect(r.sessionId).toBe('sess-1');
    expect(r.heartbeated).toBe(true);
    expect(r.commandsHandled).toBe(1);
    expect(handled[0]).toEqual({ tool: 'sys.info' });
    expect(calls.some((c) => c.includes('register'))).toBe(true);
  });
});
