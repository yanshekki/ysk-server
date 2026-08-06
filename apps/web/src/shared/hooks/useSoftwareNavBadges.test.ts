import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSoftwareNavBadges } from './useSoftwareNavBadges';

vi.mock('../../features/system', () => ({
  systemApi: {
    softwareUpgrades: vi.fn(),
  },
}));

vi.mock('../../features/updates', () => ({
  updatesApi: {
    inventory: vi.fn(),
  },
}));

import { systemApi } from '../../features/system';
import { updatesApi } from '../../features/updates';

describe('useSoftwareNavBadges', () => {
  beforeEach(() => {
    vi.mocked(systemApi.softwareUpgrades).mockResolvedValue({
      items: [],
      upgradableCount: 3,
    });
    vi.mocked(updatesApi.inventory).mockResolvedValue({
      inventory: [
        {
          packageName: 'curl',
          currentVersion: '1',
          candidateVersion: '2',
        },
      ],
      advice: [],
      meta: { upgradableCount: 1 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads catalog and host upgradable counts', async () => {
    const { result } = renderHook(() => useSoftwareNavBadges());
    await waitFor(() => {
      expect(result.current.software).toBe(3);
      expect(result.current.updates).toBe(1);
    });
  });
});
