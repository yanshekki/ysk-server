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
    });
  });
});
