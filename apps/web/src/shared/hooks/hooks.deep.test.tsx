/**
 * Extra edge cases for shared/hooks (extraParams, non-admin caps, auth totp, pageTab).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { installFetchMock } from '../../test/mock-fetch';
import { authStore } from '../stores/auth-store';
import { usePageTab } from './usePageTab';
import { useServerList } from './useServerList';
import { useAuth } from './useAuth';
import { useCapabilities } from './useCapabilities';

function wrapRouter(initial = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

describe('useServerList extra params + debounce search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends extraParams and tracks activeFilterCount while typing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        JSON.stringify({
          items: [{ id: '1', name: 'A' }],
          meta: { total: 1, page: 1, limit: 20, q: '', filters: {}, order: 'asc' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const extra = { scope: 'host', empty: '' };
    const opts = {
      path: '/api/v1/things',
      debounceMs: 20,
      initialQ: '',
      initialFilters: { role: 'admin' },
      sort: 'name',
      order: 'asc' as const,
      page: 1,
      limit: 20,
      extraParams: extra,
    };

    const { result } = renderHook(() => useServerList<{ id: string; name: string }>(opts));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('scope=host'))).toBe(true);

    act(() => {
      result.current.setQ('alpha');
    });
    expect(result.current.activeFilterCount).toBeGreaterThan(0);

    await waitFor(() => {
      expect(result.current.q).toBe('alpha');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    act(() => {
      result.current.setFilter('role', 'all');
      result.current.setFilter('env', 'prod');
    });
    expect(result.current.filters.env).toBe('prod');
    expect(result.current.filters.role).toBeUndefined();
  });
});

describe('useCapabilities non-admin', () => {
  beforeEach(() => authStore.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('operator only has listed caps; array form of can()', async () => {
    authStore.setSession('t', {
      username: 'op',
      roles: ['operator'],
      capabilities: ['projects.read'],
    });
    installFetchMock([
      {
        match: '/api/v1/auth/me',
        body: {
          user: { id: '2', username: 'op', roles: ['operator'], locale: 'en' },
          capabilities: ['projects.read', 'files.read'],
        },
      },
    ]);

    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.can('projects.read')).toBe(true);
    expect(result.current.can('files.read')).toBe(true);
    expect(result.current.can('users.write')).toBe(false);
    expect(result.current.can(['users.write', 'projects.read'])).toBe(true);

    await act(async () => {
      await result.current.refresh();
    });
  });

  it('no token marks loaded with empty caps', async () => {
    authStore.clear();
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.can('projects.read')).toBe(false);
  });
});

describe('useAuth edges', () => {
  beforeEach(() => authStore.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('login with totp; me failure still authenticates; logout without network ok', async () => {
    installFetchMock([
      {
        match: '/api/v1/auth/login',
        body: {
          token: 'tok-2fa',
          user: { id: '1', username: 'admin', roles: ['admin'], locale: 'zh-HK' },
        },
      },
      {
        match: '/api/v1/auth/me',
        status: 500,
        body: { message: 'me down' },
      },
      {
        match: '/api/v1/auth/logout',
        status: 500,
        body: { message: 'bye fail' },
      },
    ]);

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login('admin', 'secret', '123456');
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.username).toBe('admin');

    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.isAuthenticated).toBe(false);

    // logout with no token is no-op
    await act(async () => {
      await result.current.logout();
    });
  });
});

describe('usePageTab invalid initial', () => {
  it('falls back when URL tab not in list', () => {
    const { result } = renderHook(
      () => usePageTab(['overview', 'logs'] as const, 'overview'),
      { wrapper: wrapRouter('/?tab=unknown') },
    );
    expect(result.current[0]).toBe('overview');
  });
});
