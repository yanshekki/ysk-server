import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('agents / fleet routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('POST agents/register without auth is rejected', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/agents/register',
      { agentId: 'http-agent-reg-1' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('POST agents/register with panel auth works', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/agents/register', {
      agentId: 'http-agent-reg-1',
    });
    expect(res.status).toBe(200);
    const body = res.body as { agentId?: string; id?: string };
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

    // unauthenticated register without enroll → 401
    const unauth = await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/agents/register',
      { agentId: 'fleet-http-1', group: 'edge' },
      { auth: false },
    );
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const reg = await apiJson(ts, 'POST', '/api/v1/fleet/agents/register', {
      agentId: 'fleet-http-1',
      group: 'edge',
      meta: { source: 'test' },
    });
    expect(reg.status).toBe(200);
    const session = reg.body as {
      id?: string;
      agentId?: string;
      agent_id?: string;
      token?: string;
    };
    const sessionId = session.id;
    const agentToken = session.token;
    expect(sessionId).toBeTruthy();
    expect(agentToken).toMatch(/^ysk_agent_/);

    const list = await apiJson(ts, 'GET', '/api/v1/fleet/agents?group=edge&status=unknown');
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);

    const listAll = await apiJson(ts, 'GET', '/api/v1/fleet/agents');
    expect(listAll.status).toBe(200);

    // heartbeat without agent token → 401
    const hbNo = await apiJson(
      ts,
      'POST',
      `/api/v1/fleet/agents/${sessionId}/heartbeat`,
      {},
      { auth: false },
    );
    expect(hbNo.status).toBeGreaterThanOrEqual(401);

    const hb = await fetch(`${ts.baseUrl}/api/v1/fleet/agents/${sessionId}/heartbeat`, {
      method: 'POST',
      headers: { 'X-Ysk-Agent-Token': agentToken! },
    });
    expect(hb.status).toBe(200);

    const enq = await apiJson(ts, 'POST', `/api/v1/fleet/agents/${sessionId}/commands`, {
      payload: { op: 'ping' },
    });
    expect(enq.status).toBe(200);
    const cmd = enq.body as { id?: string };
    expect(cmd.id).toBeTruthy();

    const pullUnauth = await apiJson(
      ts,
      'GET',
      `/api/v1/fleet/agents/${sessionId}/commands`,
      undefined,
      { auth: false },
    );
    expect(pullUnauth.status).toBeGreaterThanOrEqual(401);

    const pullRes = await fetch(`${ts.baseUrl}/api/v1/fleet/agents/${sessionId}/commands`, {
      headers: { 'X-Ysk-Agent-Token': agentToken! },
    });
    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as { items?: unknown[] };
    expect(Array.isArray(pullBody.items)).toBe(true);

    const history = await apiJson(
      ts,
      'GET',
      `/api/v1/fleet/agents/${sessionId}/commands?history=1`,
    );
    expect(history.status).toBe(200);

    const ack = await fetch(`${ts.baseUrl}/api/v1/fleet/commands/${cmd.id}/ack`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Ysk-Agent-Token': agentToken!,
      },
      body: JSON.stringify({ result: { ok: true }, error: false }),
    });
    expect(ack.status).toBe(200);

    const ackMiss = await fetch(`${ts.baseUrl}/api/v1/fleet/commands/no-such-cmd/ack`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Ysk-Agent-Token': agentToken!,
      },
      body: JSON.stringify({ result: {} }),
    });
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
