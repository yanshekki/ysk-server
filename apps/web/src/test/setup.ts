/**
 * Vitest + Testing Library setup for @ysk-server/web.
 * Fixed locale en for locale-agnostic assertions.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import i18n, { bootstrapI18n } from '../shared/lib/i18n';

beforeAll(async () => {
  try {
    localStorage.setItem('ysk.locale', 'en');
  } catch {
    /* ignore */
  }
  // Must init i18next (services.languageUtils) before changeLanguage
  await bootstrapI18n();
  await i18n.changeLanguage('en');
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
