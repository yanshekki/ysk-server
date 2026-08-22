import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('cron routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated cron list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cron', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists cron jobs and status', async () => {
    ts = await startTestServer();
    const list = await apiJson(ts, 'GET', '/api/v1/cron');
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);

    const status = await apiJson(ts, 'GET', '/api/v1/cron/status');
    expect(status.status).toBe(200);
  });

  it('creates, patches, runs, installs, deletes cron job', async () => {
    ts = await startTestServer();

    const create = await apiJson(ts, 'POST', '/api/v1/cron', {
      schedule: '*/20 * * * *',
      command: 'echo http-cron-coverage',
      user: 'ysk',
    });
    expect(create.status).toBe(201);
    const job = (create.body as { job?: { id?: string } }).job;
    expect(job?.id).toBeTruthy();
    const id = job!.id!;

    const badPatch = await apiJson(ts, 'PATCH', `/api/v1/cron/${id}`, {});
    expect(badPatch.status).toBe(400);

    const dis = await apiJson(ts, 'PATCH', `/api/v1/cron/${id}`, { enabled: false });
    expect(dis.status).toBe(200);
    expect((dis.body as { job?: { enabled?: boolean } }).job?.enabled).toBe(false);

    const en = await apiJson(ts, 'PATCH', `/api/v1/cron/${id}`, { enabled: true });
    expect(en.status).toBe(200);

    const edited = await apiJson(ts, 'PATCH', `/api/v1/cron/${id}`, {
      schedule: '0 5 * * *',
      command: 'echo patched-http-cron',
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { job?: { schedule?: string; command?: string } }).job?.schedule).toBe(
      '0 5 * * *',
    );
    expect((edited.body as { job?: { command?: string } }).job?.command).toBe('echo patched-http-cron');

    const missPatch = await apiJson(ts, 'PATCH', '/api/v1/cron/no-such-job', {
      enabled: true,
    });
    expect(missPatch.status).toBe(404);

    const run = await apiJson(ts, 'POST', `/api/v1/cron/${id}/run`, {});
    expect(run.status).toBeLessThan(500);
    const runBody = run.body as {
      ok?: boolean;
      notes?: string[];
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
    };
    if (typeof runBody.ok === 'boolean') {
      expectHonestOps(runBody);
    }

    const install = await apiJson(ts, 'POST', '/api/v1/cron/install', {});
    expect(install.status).toBeLessThan(500);
    const instBody = install.body as {
      ok?: boolean;
      notes?: string[];
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
    };
    if (typeof instBody.ok === 'boolean') {
      expectHonestOps(instBody);
    }

    const del = await apiJson(ts, 'DELETE', `/api/v1/cron/${id}`);
    expect(del.status).toBe(200);
    expect((del.body as { ok?: boolean }).ok).toBe(true);

    const delMiss = await apiJson(ts, 'DELETE', '/api/v1/cron/no-such-job');
    expect(delMiss.status).toBe(404);
  });

  it('host crontab mutate requires auth and confirm', async () => {
    ts = await startTestServer();
    const unauth = await apiJson(ts, 'POST', '/api/v1/cron/host/replace', {}, { auth: false });
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const badDel = await apiJson(ts, 'POST', '/api/v1/cron/host/delete', {
      user: 'root',
      oldRaw: '0 1 * * * /usr/bin/true',
      command: '/usr/bin/true',
      confirm: 'nope',
    });
    expect(badDel.status).toBeLessThan(500);
    expect((badDel.body as { ok?: boolean }).ok).toBe(false);

    const replace = await apiJson(ts, 'POST', '/api/v1/cron/host/replace', {
      user: 'root',
      oldRaw: '0 1 * * * /usr/bin/true',
      schedule: '0 2 * * *',
      command: '/usr/bin/true',
    });
    expect(replace.status).toBeLessThan(500);
    const body = replace.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      notes?: string[];
    };
    if (typeof body.ok === 'boolean') {
      expectHonestOps(body);
    }
  });
});
