import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdatesNavBadge } from './useUpdatesNavBadge';

vi.mock('../../features/updates', () => ({
  updatesApi: {
    summary: vi.fn(),
  },
}));

import { updatesApi } from '../../features/updates';

describe('useUpdatesNavBadge', () => {
  beforeEach(() => {
    vi.mocked(updatesApi.summary).mockResolvedValue({
      badgeCount: 5,
      stale: false,
      panelUpdateAvailable: true,
      panelLatest: '1.1.6',
      panelCurrent: '1.1.5',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads badge count from summary', async () => {
    const { result } = renderHook(() => useUpdatesNavBadge());
    await waitFor(() => {
      expect(result.current.count).toBe(5);
      expect(result.current.stale).toBe(false);
      expect(result.current.panelUpdateAvailable).toBe(true);
      expect(result.current.panelLatest).toBe('1.1.6');
    });
  });

  it('hides the same-version panel banner', async () => {
    vi.mocked(updatesApi.summary).mockResolvedValue({
      badgeCount: 1,
      stale: false,
      panelUpdateAvailable: true,
      panelLatest: '1.1.12',
      panelCurrent: '1.1.12',
    });
    const { result } = renderHook(() => useUpdatesNavBadge());
    await waitFor(() => {
      expect(result.current.panelUpdateAvailable).toBe(false);
      expect(result.current.count).toBe(0);
    });
  });
});
