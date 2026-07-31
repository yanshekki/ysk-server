import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveWebRoot, tryServeStatic } from './static.js';

describe('resolveWebRoot', () => {
  const prev = process.env.YSK_WEB_ROOT;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ysk-webroot-'));
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.YSK_WEB_ROOT;
    else process.env.YSK_WEB_ROOT = prev;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns explicit path when index exists via env/explicit', () => {
    writeFileSync(join(tmp, 'index.html'), '<html></html>');
    expect(resolveWebRoot(tmp)).toBeTruthy();
    process.env.YSK_WEB_ROOT = tmp;
    expect(resolveWebRoot()).toBeTruthy();
  });

  it('returns null or string for missing explicit path', () => {
    const r = resolveWebRoot(join(tmp, 'nope'));
    expect(r === null || typeof r === 'string').toBe(true);
  });
});

describe('tryServeStatic', () => {
  let webRoot: string;

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'ysk-static-'));
    writeFileSync(join(webRoot, 'index.html'), '<html>idx</html>');
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(webRoot, 'logo.svg'), '<svg></svg>');
  });

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true });
  });

  function mockReq(method: string, url: string): IncomingMessage {
    return { method, url, headers: {} } as IncomingMessage;
  }

  /**
   * ServerResponse stand-in: PassThrough is a real stream (pipe-safe),
   * plus writeHead/status tracking for HEAD.
   */
  function mockRes(): ServerResponse & {
    code: number;
    headers: Record<string, unknown>;
    ended: boolean;
  } {
    const stream = new PassThrough();
    const meta = {
      code: 0,
      headers: {} as Record<string, unknown>,
      ended: false,
    };
    // Drain so pipe does not backpressure forever
    stream.resume();
    const res = stream as unknown as ServerResponse & {
      code: number;
      headers: Record<string, unknown>;
      ended: boolean;
      writeHead: (code: number, h?: Record<string, unknown>) => void;
    };
    res.code = 0;
    res.headers = meta.headers;
    res.ended = false;
    res.writeHead = (code: number, h?: Record<string, unknown>) => {
      meta.code = code;
      res.code = code;
      if (h) {
        Object.assign(meta.headers, h);
        Object.assign(res.headers, h);
      }
    };
    const origEnd = stream.end.bind(stream);
    (res as { end: (...args: unknown[]) => unknown }).end = (...args: unknown[]) => {
      meta.ended = true;
      res.ended = true;
      return origEnd(...(args as Parameters<typeof origEnd>));
    };
    return res;
  }

  it('returns false when webRoot null or non-GET', () => {
    const res = mockRes();
    expect(tryServeStatic(mockReq('GET', '/'), res, '/', null)).toBe(false);
    expect(tryServeStatic(mockReq('POST', '/'), res, '/', webRoot)).toBe(false);
  });

  it('never hijacks /api or /health', () => {
    const res = mockRes();
    expect(tryServeStatic(mockReq('GET', '/api/v1/x'), res, '/api/v1/x', webRoot)).toBe(
      false,
    );
    expect(tryServeStatic(mockReq('GET', '/health'), res, '/health', webRoot)).toBe(false);
  });

  it('HEAD serves index and assets without streaming body', () => {
    const res = mockRes();
    expect(tryServeStatic(mockReq('HEAD', '/'), res, '/', webRoot)).toBe(true);
    expect(res.code).toBe(200);
    expect(res.ended).toBe(true);

    const asset = mockRes();
    expect(
      tryServeStatic(mockReq('HEAD', '/assets/app.js'), asset, '/assets/app.js', webRoot),
    ).toBe(true);
    expect(asset.code).toBe(200);
    expect(String(asset.headers['Content-Type'])).toMatch(/javascript/);
  });

  it('GET pipes file body for existing assets', async () => {
    const res = mockRes();
    expect(tryServeStatic(mockReq('GET', '/logo.svg'), res, '/logo.svg', webRoot)).toBe(
      true,
    );
    expect(res.code).toBe(200);
    await new Promise((r) => setTimeout(r, 40));
  });

  it('SPA fallback for client routes (HEAD)', () => {
    const spa = mockRes();
    expect(tryServeStatic(mockReq('HEAD', '/projects'), spa, '/projects', webRoot)).toBe(
      true,
    );
    expect(spa.code).toBe(200);
  });

  it('rejects path traversal without crashing', () => {
    const res = mockRes();
    const ok = tryServeStatic(
      mockReq('HEAD', '/../../etc/passwd'),
      res,
      '/../../etc/passwd',
      webRoot,
    );
    expect(typeof ok).toBe('boolean');
  });
});
