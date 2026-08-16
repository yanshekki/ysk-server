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

function wrapRouter(initial = '/?tab=b') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

describe('usePageTab', () => {
  it('syncs tab from URL and setTab updates search params', async () => {
    const { result } = renderHook(() => usePageTab(['a', 'b', 'c'] as const, 'a'), {
      wrapper: wrapRouter('/?tab=b') });
    expect(result.current[0]).toBe('b');
    act(() => {
      result.current[1]('c');
    });
    await waitFor(() => expect(result.current[0]).toBe('c'));
    act(() => {
      result.current[1]('a'); // fallback clears param
    });
    await waitFor(() => expect(result.current[0]).toBe('a'));
    act(() => {
      result.current[1]('nope'); // ignored
    });
    expect(result.current[0]).toBe('a');
  });

  it('rewrites alias query tabs onto the real id', async () => {
    const { result } = renderHook(
      () => usePageTab(['overview', 'panel', 'storage'] as const, 'overview'),
      { wrapper: wrapRouter('/?tab=self') },
    );
    expect(result.current[0]).toBe('panel');
    const disk = renderHook(
      () => usePageTab(['overview', 'storage'] as const, 'overview'),
      { wrapper: wrapRouter('/?tab=disk') },
    );
    expect(disk.result.current[0]).toBe('storage');
    const dash = renderHook(
      () => usePageTab(['nodes', 'dashboard', 'sites'] as const, 'nodes'),
      { wrapper: wrapRouter('/?tab=dash') },
    );
    expect(dash.result.current[0]).toBe('dashboard');
  });

  it('rewrites unknown query tabs to the default', async () => {
    const { result } = renderHook(
      () => usePageTab(['account', 'tools'] as const, 'account'),
      { wrapper: wrapRouter('/?tab=nope') },
    );
    expect(result.current[0]).toBe('account');
  });

  it('maps allowlist / ssh=system aliases', async () => {
    const tools = renderHook(
      () =>
        usePageTab(['account', 'tools'] as const, 'account', {
          aliases: { allowlist: 'tools' },
        }),
      { wrapper: wrapRouter('/?tab=allowlist') },
    );
    expect(tools.result.current[0]).toBe('tools');
    const sshd = renderHook(
      () =>
        usePageTab(['outbound', 'sshd'] as const, 'outbound', {
          param: 'ssh',
          aliases: { system: 'sshd' },
        }),
      { wrapper: wrapRouter('/?tab=ssh&ssh=system') },
    );
    expect(sshd.result.current[0]).toBe('sshd');
  });

  it('local mode without URL sync', () => {
    const { result } = renderHook(
      () => usePageTab(['x', 'y'] as const, 'x', { syncUrl: false }),
      { wrapper: wrapRouter('/') },
    );
    expect(result.current[0]).toBe('x');
    act(() => result.current[1]('y'));
    expect(result.current[0]).toBe('y');
  });
});

describe('useServerList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads items, filters, clear, and surfaces errors', async () => {
    let failNext = false;
    const fetchMock = vi.fn(async () => {
      if (failNext) {
        return new Response(JSON.stringify({ message: 'network boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({
          items: [{ id: '1', name: 'Alpha' }],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    // Keep options referentially stable (extraParams must not be a new object each render)
    const opts = {
      path: '/api/v1/demo-list',
      debounceMs: 10,
      initialQ: '' };
    const { result } = renderHook(() =>
      useServerList<{ id: string; name: string }>(opts),
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalled();

    act(() => {
      result.current.setFilter('role', 'admin');
      result.current.setFilters({ role: 'viewer' });
      result.current.setFilter('role', 'all');
      result.current.setQ('x');
      result.current.clear();
      result.current.setError(null);
    });
    expect(result.current.q).toBe('');
    expect(result.current.filters).toEqual({});

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items.length).toBe(1);

    failNext = true;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeTruthy();
  });

  it('skips fetch when disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useServerList({ path: '/api/v1/skip', enabled: false }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useAuth + useCapabilities', () => {
  beforeEach(() => {
    authStore.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('login loads me capabilities and logout clears', async () => {
    installFetchMock([
      {
        match: '/api/v1/auth/login',
        body: {
          token: 'tok',
          user: { id: '1', username: 'admin', roles: ['admin'], locale: 'en' } } },
      {
        match: '/api/v1/auth/me',
        body: {
          user: { id: '1', username: 'admin', roles: ['admin'], locale: 'en' },
          capabilities: ['projects.read'] } },
      { match: '/api/v1/auth/logout', body: { ok: true } },
    ]);

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login('admin', 'secret');
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.username).toBe('admin');

    const caps = renderHook(() => useCapabilities());
    await waitFor(() => expect(caps.result.current.loaded).toBe(true));
    expect(caps.result.current.can('projects.read')).toBe(true);
    expect(caps.result.current.can('projects.write')).toBe(true); // admin fail-open

    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('admin without token capabilities still fail-open after me error', async () => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    installFetchMock([
      {
        match: '/api/v1/auth/me',
        status: 500,
        body: { message: 'down' } },
    ]);
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.can('users.write')).toBe(true);
  });
});
