import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('settings routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated llm and security reads', async () => {
    ts = await startTestServer();
    const llm = await apiJson(ts, 'GET', '/api/v1/settings/llm', undefined, { auth: false });
    expect(llm.status).toBeGreaterThanOrEqual(401);

    const sec = await apiJson(ts, 'GET', '/api/v1/settings/security', undefined, {
      auth: false,
    });
    expect(sec.status).toBeGreaterThanOrEqual(401);
  });

  it('gets llm settings when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/settings/llm');
    expect(res.status).toBe(200);
    const body = res.body as { llm?: unknown; transport?: string };
    expect(body.llm).toBeDefined();
    expect(typeof body.transport).toBe('string');
  });

  it('gets security settings when authenticated (admin)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/settings/security');
    expect(res.status).toBe(200);
    const body = res.body as {
      ok?: boolean;
      requireAdminTotp?: boolean;
      requireAdminTotpStrict?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.requireAdminTotp).toBe('boolean');
  });

  it('updates llm settings when authenticated', async () => {
    ts = await startTestServer();
    const put = await apiJson(ts, 'POST', '/api/v1/settings/llm', {
      baseUrl: '',
      model: 'test-model',
      apiKey: 'sk-secret-test',
    });
    expect(put.status).toBe(200);
    expect((put.body as { ok?: boolean }).ok).toBe(true);
    expect((put.body as { llm?: { apiKey?: string } }).llm?.apiKey).toBe('***');

    const get = await apiJson(ts, 'GET', '/api/v1/settings/llm');
    expect(get.status).toBe(200);
    const llm = (get.body as { llm?: { model?: string; apiKey?: string } }).llm;
    expect(llm?.model).toBe('test-model');
    expect(llm?.apiKey).toBe('***');
  });

  it('rejects unauthenticated llm mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/settings/llm',
      { model: 'x' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('rejects unauthenticated security mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/settings/security',
      { requireAdminTotp: false },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('can set requireAdminTotp false without step-up (no TOTP enrolled)', async () => {
    ts = await startTestServer();
    // Step-up only gates when the actor has totp_enabled; fresh setup admin has none.
    const res = await apiJson(ts, 'POST', '/api/v1/settings/security', {
      requireAdminTotp: false,
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean; requireAdminTotp?: boolean }).ok).toBe(true);
    expect((res.body as { requireAdminTotp?: boolean }).requireAdminTotp).toBe(false);

    const userOff = await apiJson(ts, 'POST', '/api/v1/settings/security', {
      requireUserTotp: false,
    });
    expect(userOff.status).toBe(200);
    expect((userOff.body as { requireUserTotp?: boolean }).requireUserTotp).toBe(false);
  });

  it('requireAdminTotp true without step-up is honest fail; strict flag saves', async () => {
    ts = await startTestServer();
    const enable = await apiJson(ts, 'POST', '/api/v1/settings/security', {
      requireAdminTotp: true,
      totp: '000000',
    });
    // without enrolled totp: may 200 (no step-up needed) or 403 needsStepUp
    expect(enable.status).toBeLessThan(500);

    const strict = await apiJson(ts, 'POST', '/api/v1/settings/security', {
      requireAdminTotpStrict: true,
    });
    expect(strict.status).toBe(200);
    expect((strict.body as { requireAdminTotpStrict?: boolean }).requireAdminTotpStrict).toBe(
      true,
    );

    const strictOff = await apiJson(ts, 'POST', '/api/v1/settings/security', {
      requireAdminTotpStrict: false,
    });
    expect(strictOff.status).toBe(200);
    expect((strictOff.body as { requireAdminTotpStrict?: boolean }).requireAdminTotpStrict).toBe(
      false,
    );
  });
});
