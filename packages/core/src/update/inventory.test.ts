import { describe, expect, it, vi, afterEach } from 'vitest';
import { LocalHostExecutor } from '../host/executor.js';
import { adviseInventory, collectInventory, lookupOsvVulns } from './inventory.js';

describe('inventory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collects nodejs and optional dpkg packages', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const items = await collectInventory(host);
    expect(items.some((i) => i.packageName === 'nodejs')).toBe(true);
    const advice = adviseInventory(items);
    expect(advice.length).toBe(items.length);
  });

  it('lookupOsvVulns returns ids from mock API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          vulns: [{ id: 'CVE-2024-TEST', severity: [{ score: 'HIGH' }] }],
        }),
      })),
    );
    const ids = await lookupOsvVulns('openssl', '3.0.0');
    expect(ids.some((i) => i.includes('CVE-2024-TEST'))).toBe(true);
  });

  it('lookupOsvVulns returns empty on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await lookupOsvVulns('x', '1')).toEqual([]);
  });
});
