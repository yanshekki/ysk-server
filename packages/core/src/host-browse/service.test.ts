import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostBrowseService } from './service.js';

describe('HostBrowseService integration', () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer((req, res) => {
      if (req.url === '/set') {
        res.setHeader('Set-Cookie', 'sid=abc; Path=/');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html><title>Set</title><a href="/next">n</a></html>');
        return;
      }
      if (req.url === '/next') {
        const cookie = req.headers.cookie || '';
        res.setHeader('Content-Type', 'text/html');
        res.end(`<html><title>Next</title><p>${cookie}</p></html>`);
        return;
      }
      if (req.url === '/ua') {
        res.setHeader('Content-Type', 'text/plain');
        res.end(String(req.headers['user-agent'] || ''));
        return;
      }
      res.statusCode = 404;
      res.end('no');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
  });

  afterAll(async () => {
    await close();
  });

  it('fetches via host with fixed UA and server cookie jar', async () => {
    const port = Number(new URL(base).port);
    const svc = new HostBrowseService({
      allowLoopback: true,
      extraPorts: [port],
    });
    const meta = svc.createSession('user-1', 'intranet');
    expect(meta.contentToken).toBeTruthy();

    const nav = await svc.navigate('user-1', meta.sessionId, {
      url: `${base}/set`,
      action: 'goto',
    });
    expect(nav.blocked).toBeFalsy();
    expect(nav.status).toBe(200);
    expect(nav.title).toBe('Set');
    expect(nav.rewritten).toBe(true);
    expect(nav.contentPath).toContain('content?u=');

    const meta2 = svc.getSession('user-1', meta.sessionId);
    expect(meta2.cookieCount).toBeGreaterThanOrEqual(1);

    const next = await svc.navigate('user-1', meta.sessionId, {
      url: `${base}/next`,
      action: 'goto',
    });
    expect(next.status).toBe(200);

    const content = await svc.getContent(
      'user-1',
      meta.sessionId,
      meta.contentToken,
      next.finalUrl,
    );
    expect(content.body.toString('utf8')).toContain('sid=abc');

    const uaNav = await svc.navigate('user-1', meta.sessionId, {
      url: `${base}/ua`,
      action: 'goto',
    });
    const uaBody = await svc.getContent(
      'user-1',
      meta.sessionId,
      meta.contentToken,
      uaNav.finalUrl,
    );
    expect(uaBody.body.toString('utf8')).toContain('YSK-HostBrowse');
  });

  it('blocks private targets in internet mode', async () => {
    const port = Number(new URL(base).port);
    const svc = new HostBrowseService({
      allowLoopback: true,
      extraPorts: [port],
    });
    const meta = svc.createSession('user-2', 'internet');
    const nav = await svc.navigate('user-2', meta.sessionId, {
      url: `${base}/set`,
      action: 'goto',
    });
    expect(nav.blocked).toBe(true);
  });

  it('rejects foreign session access', () => {
    const svc = new HostBrowseService();
    const meta = svc.createSession('a', 'internet');
    expect(() => svc.getSession('b', meta.sessionId)).toThrow();
  });
});
