/**
 * Lightweight path-based fetch mock for page smoke tests.
 */
import { vi } from 'vitest';

export type FetchRoute = {
  match: string | RegExp | ((url: string, init?: RequestInit) => boolean);
  status?: number;
  body?: unknown;
  /** Dynamic body */
  handler?: (url: string, init?: RequestInit) => unknown | Promise<unknown>;
};

export const HONESTY_WRITTEN_BLOCKED = {
  ok: true,
  apply_status: 'written' as const,
  requiresExecute: true,
  notes: ['written ≠ applied on host'],
  blockMessage: 'Host execute is off',
};

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    try {
      return new URL(input, 'http://local.test').pathname + new URL(input, 'http://local.test').search;
    } catch {
      return input;
    }
  }
  if (input instanceof URL) return input.pathname + input.search;
  return input.url;
}

export function installFetchMock(routes: FetchRoute[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = pathOf(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    for (const r of routes) {
      let hit = false;
      if (typeof r.match === 'string') {
        hit = url === r.match || url.startsWith(r.match);
      } else if (r.match instanceof RegExp) {
        hit = r.match.test(url);
      } else {
        hit = r.match(url, init);
      }
      if (!hit) continue;
      const body =
        r.handler != null ? await r.handler(url, init) : (r.body ?? {});
      return new Response(JSON.stringify(body), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Default soft empty success so stray probes don't crash the page
    return new Response(JSON.stringify({ ok: true, items: [], ready: true, missing: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function softwareReadyRoute(): FetchRoute {
  return {
    match: /\/api\/v1\/system\/software/,
    body: { items: [], missing: [], ready: true },
  };
}

export { pathOf };
