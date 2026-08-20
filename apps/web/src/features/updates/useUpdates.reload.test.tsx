import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { installFetchMock, type FetchRoute } from '../../test/mock-fetch';
import { authStore } from '../../shared/stores/auth-store';
import { useUpdates } from './useUpdates';

vi.mock('./self-apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./self-apply')>();
  return {
    ...actual,
    waitForPanelAfterRestart: vi.fn(async (input: { expectVersion?: string }) => ({
      currentVersion: input.expectVersion ?? '1.1.20',
      ok: true,
    })),
  };
});

const catchAll: FetchRoute = { match: /.*/, body: { ok: true, items: [] } };

describe('useUpdates UI reload prompt', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('sets uiReloadVersion after a successful panel apply', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('/api/v1/updates/self/apply'),
        body: { ok: true, applied: true, restarting: true, notes: [] },
      },
      {
        match: (url) => url.startsWith('/api/v1/updates/self'),
        body: {
          ok: true,
          checked: true,
          updateAvailable: true,
          currentVersion: '1.1.19',
          latestVersion: '1.1.20',
        },
      },
      catchAll,
    ]);
    const { result } = renderHook(() => useUpdates());
    await waitFor(() => expect(result.current.selfUpdate).toBeTruthy());
    await act(async () => {
      await result.current.applySelf();
    });
    expect(result.current.uiReloadVersion).toBe('1.1.20');
  });
});
