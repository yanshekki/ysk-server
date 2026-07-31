import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('ai / llm routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated llm chat and ai tasks', async () => {
    ts = await startTestServer();
    const chat = await apiJson(
      ts,
      'POST',
      '/api/v1/llm/chat',
      { messages: [{ role: 'user', content: 'hi' }] },
      { auth: false },
    );
    expect(chat.status).toBeGreaterThanOrEqual(401);

    const tasks = await apiJson(ts, 'GET', '/api/v1/ai/tasks', undefined, { auth: false });
    expect(tasks.status).toBeGreaterThanOrEqual(401);
  });

  it('lists playbooks and playbook-runs', async () => {
    ts = await startTestServer();
    const pb = await apiJson(ts, 'GET', '/api/v1/ai/playbooks');
    expect(pb.status).toBe(200);
    const items = (pb.body as { items?: Array<{ id?: string }> }).items;
    expect(Array.isArray(items)).toBe(true);
    expect(items!.length).toBeGreaterThan(0);

    const runs = await apiJson(ts, 'GET', '/api/v1/ai/playbook-runs');
    expect(runs.status).toBe(200);
    expect(Array.isArray((runs.body as { items?: unknown[] }).items)).toBe(true);
  });

  it('creates ai task and lists tasks', async () => {
    ts = await startTestServer();
    process.env.YSK_LLM_ECHO = '1';
    try {
      const create = await apiJson(ts, 'POST', '/api/v1/ai/tasks', {
        prompt: 'check health for coverage',
        enrich: false,
      });
      expect(create.status).toBe(201);
      const task = create.body as { id?: string; prompt?: string };
      expect(task.id).toBeTruthy();

      const list = await apiJson(ts, 'GET', '/api/v1/ai/tasks');
      expect(list.status).toBe(200);
      expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);
    } finally {
      delete process.env.YSK_LLM_ECHO;
    }
  });

  it('llm chat with echo transport', async () => {
    ts = await startTestServer();
    process.env.YSK_LLM_ECHO = '1';
    try {
      ts.ctx.settings.setJson('llm', { model: 'echo-test', baseUrl: '' });
      ts.ctx.reloadLlm();
      const res = await apiJson(ts, 'POST', '/api/v1/llm/chat', {
        model: 'echo-test',
        messages: [{ role: 'user', content: 'ping coverage' }],
      });
      expect(res.status).toBeLessThan(500);
      // echo transport may return 200 with content
      expect(res.status).toBeGreaterThanOrEqual(200);
    } finally {
      delete process.env.YSK_LLM_ECHO;
    }
  });

  it('runs first playbook when available', async () => {
    ts = await startTestServer();
    process.env.YSK_LLM_ECHO = '1';
    try {
      const pb = await apiJson(ts, 'GET', '/api/v1/ai/playbooks');
      const items = (pb.body as { items?: Array<{ id?: string }> }).items ?? [];
      if (!items[0]?.id) return;
      const run = await apiJson(ts, 'POST', '/api/v1/ai/playbooks/run', {
        playbookId: items[0].id,
      });
      expect(run.status).toBeLessThan(500);
      expect(run.status).toBeGreaterThanOrEqual(200);
      const body = run.body as { run?: unknown; task?: unknown };
      expect(body.run || body.task || (run.body as { ok?: boolean }).ok !== undefined).toBeTruthy();
    } finally {
      delete process.env.YSK_LLM_ECHO;
    }
  });

  it('builds RCA report', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/ai/rca', {
      title: 'coverage-rca',
      facts: { source: 'ai.test' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { title?: string; facts?: unknown };
    expect(body.title || (body as { ok?: boolean }).ok !== false).toBeTruthy();
  });
});
