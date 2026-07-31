import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError, ErrorCodes } from '@ysk/shared';
import {
  looksLikeOpsResult,
  statusFromOpsResult,
  getBearer,
  parseUrl,
  localeFromRequest,
  sendJson,
  sendOpsResult,
  sendError,
  readBody,
} from './util.js';
import { assertHonestOps } from '@ysk/shared';

function mockRes(): ServerResponse & {
  statusCode: number;
  body: string;
  headers: Record<string, string | number | string[]>;
} {
  const state = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string | number | string[]>,
  };
  const res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(v: number) {
      state.statusCode = v;
    },
    body: '',
    headers: state.headers,
    writeHead(code: number, headers?: Record<string, string | number | string[]>) {
      state.statusCode = code;
      if (headers) Object.assign(state.headers, headers);
    },
    end(chunk?: string) {
      state.body = chunk ?? '';
      res.body = state.body;
    },
  } as unknown as ServerResponse & {
    statusCode: number;
    body: string;
    headers: Record<string, string | number | string[]>;
  };
  // keep body in sync via proxy on end
  const origEnd = res.end.bind(res);
  res.end = ((chunk?: string) => {
    state.body = chunk ?? '';
    (res as { body: string }).body = state.body;
    return undefined as never;
  }) as typeof res.end;
  void origEnd;
  return res;
}

describe('statusFromOpsResult', () => {
  it('returns 200 for written success even with requiresExecute soft flag', () => {
    const honest = assertHonestOps({
      ok: true,
      apply_status: 'written',
      requiresExecute: true,
      notes: ['written only'],
    });
    expect(honest.ok).toBe(true);
    expect(statusFromOpsResult(honest)).toBe(200);
  });

  it('returns 403 for hard blocked', () => {
    const honest = assertHonestOps({
      ok: true,
      blocked: true,
      notes: ['need root'],
    });
    expect(honest.ok).toBe(false);
    expect(statusFromOpsResult(honest)).toBe(403);
  });

  it('returns 403 when ok false and requiresExecute', () => {
    expect(
      statusFromOpsResult({
        ok: false,
        requiresExecute: true,
      }),
    ).toBe(403);
  });

  it('returns 403 when requiresRoot or apply_status blocked', () => {
    expect(statusFromOpsResult({ ok: false, requiresRoot: true })).toBe(403);
    expect(statusFromOpsResult({ ok: false, apply_status: 'blocked' })).toBe(403);
  });

  it('returns 422 for generic failure', () => {
    expect(statusFromOpsResult({ ok: false })).toBe(422);
  });

  it('notFound option yields 404', () => {
    expect(statusFromOpsResult({ ok: false }, { notFound: true })).toBe(404);
  });
});

describe('looksLikeOpsResult', () => {
  it('detects notes / blocked shapes', () => {
    expect(looksLikeOpsResult({ ok: true, notes: [] })).toBe(true);
    expect(looksLikeOpsResult({ ok: false, blocked: true })).toBe(true);
    expect(looksLikeOpsResult({ ok: true, apply_status: 'written' })).toBe(true);
    expect(looksLikeOpsResult({ ok: false, requiresExecute: true })).toBe(true);
    expect(looksLikeOpsResult({ ok: false, requiresRoot: true })).toBe(true);
    expect(looksLikeOpsResult({ ok: true, id: 'x' })).toBe(false);
    expect(looksLikeOpsResult(null)).toBe(false);
    expect(looksLikeOpsResult('x')).toBe(false);
    expect(looksLikeOpsResult({ notes: [] })).toBe(false);
  });
});

describe('getBearer / parseUrl / localeFromRequest', () => {
  it('parses bearer token', () => {
    const req = {
      headers: { authorization: 'Bearer  abc.token  ' },
    } as IncomingMessage;
    expect(getBearer(req)).toBe('abc.token');
    expect(getBearer({ headers: {} } as IncomingMessage)).toBeUndefined();
    expect(
      getBearer({ headers: { authorization: 'Basic x' } } as IncomingMessage),
    ).toBeUndefined();
  });

  it('parseUrl builds URL from host', () => {
    const req = {
      url: '/api/v1/health?x=1',
      headers: { host: 'example.test:9443' },
    } as IncomingMessage;
    const u = parseUrl(req);
    expect(u.pathname).toBe('/api/v1/health');
    expect(u.searchParams.get('x')).toBe('1');
  });

  it('localeFromRequest reads accept-language and query', () => {
    const req = {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    } as IncomingMessage;
    const loc = localeFromRequest(req);
    expect(typeof loc).toBe('string');
    const url = new URL('http://x/?locale=zh-HK');
    const loc2 = localeFromRequest(req, url);
    expect(typeof loc2).toBe('string');
  });
});

describe('sendJson / sendOpsResult / sendError / readBody', () => {
  it('sendJson writes JSON headers and body', () => {
    const res = mockRes();
    sendJson(res, 201, { ok: true, n: 1 });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ ok: true, n: 1 });
    expect(String(res.headers['Content-Type'])).toMatch(/application\/json/);
  });

  it('sendOpsResult uses honest status for blocked', () => {
    const res = mockRes();
    sendOpsResult(res, {
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: ['need execute'],
      apply_status: 'blocked',
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { ok: boolean; blocked?: boolean };
    expect(body.ok).toBe(false);
  });

  it('sendOpsResult 200 for written success', () => {
    const res = mockRes();
    sendOpsResult(res, {
      ok: true,
      apply_status: 'written',
      notes: ['written under dataDir'],
      written: ['/tmp/x'],
    });
    expect(res.statusCode).toBe(200);
  });

  it('sendOpsResult notFound option', () => {
    const res = mockRes();
    sendOpsResult(res, { ok: false, notes: ['missing'] }, { notFound: true });
    expect(res.statusCode).toBe(404);
  });

  it('sendError handles YskError and generic Error', () => {
    const res1 = mockRes();
    sendError(
      res1,
      new YskError(ErrorCodes.VALIDATION, 'bad input', {
        httpStatus: 400,
        messageKey: 'errors.http.validation',
      }),
    );
    expect(res1.statusCode).toBe(400);
    expect(JSON.parse(res1.body).ok).toBe(false);

    const res2 = mockRes();
    sendError(res2, new Error('boom'));
    expect(res2.statusCode).toBe(500);
    expect(JSON.parse(res2.body).code).toBe('YSK_INTERNAL');

    const res3 = mockRes();
    sendError(res3, 'string-err');
    expect(res3.statusCode).toBe(500);
  });

  it('readBody concatenates chunks', async () => {
    const req = new EventEmitter() as IncomingMessage & EventEmitter;
    const p = readBody(req);
    req.emit('data', Buffer.from('{"a":'));
    req.emit('data', Buffer.from('1}'));
    req.emit('end');
    await expect(p).resolves.toBe('{"a":1}');
  });
});
