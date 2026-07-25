import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { findFreePort, isPortListening, waitHttpOk, checkHttp } from './health.js';

describe('host health helpers', () => {
  it('findFreePort returns a bindable port', async () => {
    const port = await findFreePort(3200, 3299);
    expect(port).toBeGreaterThanOrEqual(3200);
    expect(await isPortListening(port)).toBe(false);
  });

  it('waitHttpOk succeeds when server responds 200', async () => {
    const port = await findFreePort(3300, 3399);
    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
    try {
      const r = await waitHttpOk(`http://127.0.0.1:${port}/`, { timeoutMs: 5000 });
      expect(r.ok).toBe(true);
      expect(r.body).toContain('ok');
      const once = await checkHttp(`http://127.0.0.1:${port}/`);
      expect(once.ok).toBe(true);
      expect(await isPortListening(port)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
