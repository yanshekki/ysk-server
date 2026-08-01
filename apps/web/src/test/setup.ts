/**
 * Vitest + Testing Library setup for @ysk/web.
 * Fixed locale en for locale-agnostic assertions.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import i18n from '../shared/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('en');
  try {
    localStorage.setItem('ysk.locale', 'en');
  } catch {
    /* ignore */
  }
  // Safety net: never open real network for non-API absolute URLs (iframe/preview hosts).
  const realFetch = globalThis.fetch?.bind(globalThis);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (
        /^https?:\/\//i.test(raw) &&
        !raw.includes('/api/') &&
        !raw.includes('local.test')
      ) {
        return new Response('', { status: 204 });
      }
      if (typeof realFetch === 'function') {
        try {
          return await realFetch(input as never, init);
        } catch {
          return new Response(JSON.stringify({ ok: true, items: [], missing: [], ready: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ ok: true, items: [], missing: [], ready: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
});
