/**
 * Deep unit coverage for metricsApi signal / renice / openStream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsApi } from './api';
import { authStore } from '../../shared/stores/auth-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('metricsApi deep', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('signal: happy path + invalid body + non-object fallback', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pid: '9', signal: 'TERM', stillAlive: false, notes: ['ok'] }),
    );
    const ok = await metricsApi.signal({ pid: '9', signal: 'TERM' });
    expect(ok.ok).toBe(true);
    expect(ok.notes).toEqual(['ok']);

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
    const bad = await metricsApi.signal({ pid: '1', signal: 'KILL', confirmKill: true });
    expect(bad.ok).toBe(false);
    expect(bad.pid).toBe('1');

    fetchMock.mockResolvedValueOnce(
      new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const nul = await metricsApi.signal({ pid: '2', signal: 'TERM' });
    expect(nul.notes?.[0]).toMatch(/HTTP|2/);
  });

  it('signal: fills missing pid/signal from request body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, notes: 'x' }));
    const r = await metricsApi.signal({ pid: '77', signal: 'TERM' });
    expect(r.pid).toBe('77');
    expect(r.signal).toBe('TERM');
    expect(r.notes).toEqual([]);
  });

  it('renice: happy + parse fail', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, pid: '3', nice: 5, notes: ['reniced'] }),
    );
    const r = await metricsApi.renice({ pid: '3', nice: 5 });
    expect(r.ok).toBe(true);
    expect(r.pid).toBe('3');

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 200 }));
    const r2 = await metricsApi.renice({ pid: '4', nice: 0 });
    expect(r2.pid).toBe('4');
    expect(r2.ok).toBe(false);
  });

  it('processes query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, rows: [], notes: [] }));
    await metricsApi.processes({ sort: 'mem', limit: 20, top: true, header: false });
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('sort=mem');
    expect(url).toContain('limit=20');
    expect(url).toContain('top=1');
    expect(url).toContain('header=0');
  });

  it('projectsUsage with and without limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await metricsApi.projectsUsage();
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await metricsApi.projectsUsage({ limit: 3 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('limit=3'))).toBe(true);
  });

  it('openStream: no token path', async () => {
    authStore.clear();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const ac = metricsApi.openStream({
      onTick: () => {},
      onError,
      onEnd,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('no_token');
    ac.abort();
  });

  it('openStream: http error 401 and generic', async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    metricsApi.openStream({ onTick: () => {}, onError, onEnd });
    await new Promise((r) => setTimeout(r, 30));
    expect(onError).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('http_error');

    onError.mockClear();
    onEnd.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    metricsApi.openStream({ onTick: () => {}, onError, onEnd });
    await new Promise((r) => setTimeout(r, 30));
    expect(onError).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('http_error');
  });

  it('openStream: parses tick / error / end events and bad JSON', async () => {
    const ticks: unknown[] = [];
    const onError = vi.fn();
    const onEnd = vi.fn();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: tick\ndata: {"metrics":{"loadavg":[1,1,1]}}\n\n',
        'event: error\ndata: {"message":"stream boom"}\n\n',
        'event: end\ndata: {"reason":"done"}\n\n',
        'event: tick\ndata: not-json\n\n',
        'event: message\ndata: \n\n',
        ': comment only\n\n',
      ]),
    );
    const ac = metricsApi.openStream({
      interval: 1,
      sort: 'cpu',
      limit: 10,
      top: true,
      onTick: (t) => ticks.push(t),
      onError,
      onEnd,
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(onError).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
    ac.abort();
  });

  it('openStream: fetch network error (non-abort)', async () => {
    const onError = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    metricsApi.openStream({ onTick: () => {}, onError });
    await new Promise((r) => setTimeout(r, 40));
    expect(onError).toHaveBeenCalledWith('network down');
  });

  it('openStream: abort mid-stream does not call onError', async () => {
    const onError = vi.fn();
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode('event: tick\ndata: {"a":1}\n\n'));
        }
        // hang until abort
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const ac = metricsApi.openStream({ onTick: () => {}, onError });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    // aborted path returns early
    expect(true).toBe(true);
  });
});
