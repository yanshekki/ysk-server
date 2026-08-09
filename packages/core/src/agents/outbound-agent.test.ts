import { describe, expect, it, vi } from 'vitest';
import { agentCycle, isCommandFailure, runOutboundAgent } from './outbound-agent.js';

describe('outbound-agent', () => {
  it('isCommandFailure detects exit / ok flags', () => {
    expect(isCommandFailure({ ok: true, exitCode: 0 })).toBe(false);
    expect(isCommandFailure({ ok: false, exitCode: 2 })).toBe(true);
    expect(isCommandFailure({ exitCode: 3 })).toBe(true);
    expect(isCommandFailure({ pong: true })).toBe(false);
  });

  it('registers, heartbeats, handles commands via mock fetch', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/register')) {
        return {
          ok: true,
          json: async () => ({ id: 'sess-1', token: 'ysk_agent_testtoken1' }),
        } as Response;
      }
      if (u.includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (u.includes('/commands') && (!init || init.method === undefined || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'c1', payload: { op: 'ping' } }],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const onCommand = vi.fn(async () => ({ pong: true, ok: true, exitCode: 0 }));
    const r = await agentCycle({
      controlPlane: 'http://cp.local',
      agentId: 'edge-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onCommand,
    });
    expect(r.sessionId).toBe('sess-1');
    expect(r.heartbeated).toBe(true);
    expect(r.commandsHandled).toBe(1);
    expect(onCommand).toHaveBeenCalled();
    const ackCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/ack'));
    expect(ackCall).toBeTruthy();
    const body = JSON.parse(String((ackCall?.[1] as RequestInit)?.body ?? '{}')) as {
      error?: boolean;
    };
    expect(body.error).toBe(false);
  });

  it('acks with error when CLI exitCode non-zero', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/register')) {
        return {
          ok: true,
          json: async () => ({ id: 'sess-2', token: 'ysk_agent_testtoken2' }),
        } as Response;
      }
      if (u.includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (u.includes('/commands') && (!init || !init.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'c-fail', payload: { cli: ['projects', 'get'] } }],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    await agentCycle({
      controlPlane: 'http://cp.local',
      agentId: 'edge-2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onCommand: async () => ({
        ok: false,
        exitCode: 2,
        result: { ok: false, code: 'YSK_VALIDATION' },
      }),
    });
    const ackCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/ack'));
    const body = JSON.parse(String((ackCall?.[1] as RequestInit)?.body ?? '{}')) as {
      error?: boolean;
      result?: { exitCode?: number };
    };
    expect(body.error).toBe(true);
    expect(body.result?.exitCode).toBe(2);
  });

  it('throws on register failure', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    await expect(
      agentCycle({
        controlPlane: 'http://cp.local',
        agentId: 'x',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/register failed/);
  });

  it('runOutboundAgent stops on abort', async () => {
    const ac = new AbortController();
    let n = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      n += 1;
      if (n > 2) ac.abort();
      if (String(url).endsWith('/register')) {
        return {
          ok: true,
          json: async () => ({ id: 's', token: 'ysk_agent_loop' }),
        } as Response;
      }
      if (String(url).includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ items: [] }) } as Response;
    });
    await runOutboundAgent({
      controlPlane: 'http://cp.local',
      agentId: 'a',
      intervalMs: 5,
      signal: ac.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
  });
});
