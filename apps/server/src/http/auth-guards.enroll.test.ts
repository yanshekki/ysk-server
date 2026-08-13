import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('enforceMustEnrollTotp', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('blocks control-plane APIs until user enrolls TOTP', async () => {
    ts = await startTestServer();
    ts.ctx.auth.setUserTotpRequired(true, 'admin');
    const blocked = await apiJson(ts, 'GET', '/api/v1/projects');
    expect(blocked.status).toBe(403);
    const body = blocked.body as { details?: { mustEnrollTotp?: boolean } };
    expect(body.details?.mustEnrollTotp).toBe(true);

    const me = await apiJson(ts, 'GET', '/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect((me.body as { mustEnrollTotp?: boolean }).mustEnrollTotp).toBe(true);

    const totp = await apiJson(ts, 'GET', '/api/v1/auth/totp');
    expect(totp.status).toBeLessThan(500);
  });
});
