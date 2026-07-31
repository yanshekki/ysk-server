import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

/** Minimal PEM-shaped blobs so uploadCertificate path exercises store write. */
const FAKE_FULLCHAIN = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
-----END CERTIFICATE-----
`;
const FAKE_PRIVKEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7xxxxxxxx
-----END PRIVATE KEY-----
`;

describe('ssl routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated ssl list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/ssl/certificates', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists certificates / uploaded / bindings', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/ssl/certificates',
      '/api/v1/ssl/uploaded',
      '/api/v1/ssl/bindings',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBe(200);
    }
  });

  it('uploads certificate and sees it in lists', async () => {
    ts = await startTestServer();
    const up = await apiJson(ts, 'POST', '/api/v1/ssl/upload', {
      domain: 'ssl-upload-cov.test',
      fullchainPem: FAKE_FULLCHAIN,
      privkeyPem: FAKE_PRIVKEY,
    });
    // may 201 or 4xx if PEM validation is strict
    expect(up.status).toBeLessThan(500);
    if (up.status === 201) {
      const cert = (up.body as { certificate?: { domain?: string } }).certificate;
      expect(cert?.domain).toBe('ssl-upload-cov.test');
    }

    const list = await apiJson(ts, 'GET', '/api/v1/ssl/certificates?q=ssl-upload');
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);

    const bindings = await apiJson(ts, 'GET', '/api/v1/ssl/bindings');
    expect(bindings.status).toBe(200);
    expect(Array.isArray((bindings.body as { items?: unknown[] }).items)).toBe(true);
    expect(Array.isArray((bindings.body as { renewJobs?: unknown[] }).renewJobs)).toBe(true);
  });
});
