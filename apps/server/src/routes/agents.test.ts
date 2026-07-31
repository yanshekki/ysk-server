import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('agents / fleet routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('POST agents/register without auth still registers', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/agents/register',
      { agentId: 'http-agent-reg-1' },
      { auth: false },
    );
    expect(res.status).toBe(200);
    const body = res.body as { agentId?: string; id?: string; token?: string };
    expect(body.agentId || body.id).toBeTruthy();
  });

  it('GET agents/runtimes requires auth and lists items', async () => {
    ts = await startTestServer();
    const unauth = await apiJson(ts, 'GET', '/api/v1/agents/runtimes', undefined, {
      auth: false,
    });
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const res = await apiJson(ts, 'GET', '/api/v1/agents/runtimes');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('fleet agents register, list, heartbeat, commands, ack, delete', async () => {
    ts = await startTestServer();

    const reg = await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/agents/register',
      { agentId: 'fleet-http-1', group: 'edge', meta: { source: 'test' } },
      { auth: false },
    );
    expect(reg.status).toBe(200);
    const session = reg.body as { id?: string; agentId?: string; agent_id?: string };
    const sessionId = session.id;
    expect(sessionId).toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/fleet/agents?group=edge&status=unknown');
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);

    const listAll = await apiJson(ts, 'GET', '/api/v1/fleet/agents');
    expect(listAll.status).toBe(200);

    const hb = await apiJson(
      ts,
      'POST',
      `/api/v1/fleet/agents/${sessionId}/heartbeat`,
      {},
      { auth: false },
    );
    expect(hb.status).toBe(200);

    const enq = await apiJson(ts, 'POST', `/api/v1/fleet/agents/${sessionId}/commands`, {
      payload: { op: 'ping' },
    });
    expect(enq.status).toBe(200);
    const cmd = enq.body as { id?: string };
    expect(cmd.id).toBeTruthy();

    const pull = await apiJson(
      ts,
      'GET',
      `/api/v1/fleet/agents/${sessionId}/commands`,
      undefined,
      { auth: false },
    );
    expect(pull.status).toBe(200);
    expect(Array.isArray((pull.body as { items?: unknown[] }).items)).toBe(true);

    const history = await apiJson(
      ts,
      'GET',
      `/api/v1/fleet/agents/${sessionId}/commands?history=1`,
    );
    expect(history.status).toBe(200);

    const ack = await apiJson(
      ts,
      'POST',
      `/api/v1/fleet/commands/${cmd.id}/ack`,
      { result: { ok: true }, error: false },
      { auth: false },
    );
    expect(ack.status).toBe(200);

    const ackMiss = await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/commands/no-such-cmd/ack',
      { result: {} },
      { auth: false },
    );
    expect(ackMiss.status).toBe(404);

    const del = await apiJson(ts, 'DELETE', `/api/v1/fleet/agents/${sessionId}`);
    expect(del.status).toBe(200);
  });

  it('rejects unauthenticated fleet list and command enqueue', async () => {
    ts = await startTestServer();
    const list = await apiJson(ts, 'GET', '/api/v1/fleet/agents', undefined, { auth: false });
    expect(list.status).toBeGreaterThanOrEqual(401);

    const enq = await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/agents/x/commands',
      { payload: {} },
      { auth: false },
    );
    expect(enq.status).toBeGreaterThanOrEqual(401);
  });
});
