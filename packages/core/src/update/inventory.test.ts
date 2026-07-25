import { describe, expect, it } from 'vitest';
import { adviseInventory, collectInventory } from './inventory.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('inventory', () => {
  it('collects at least nodejs entry', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const inv = await collectInventory(host);
    expect(inv.some((i) => i.packageName === 'nodejs')).toBe(true);
    const advice = adviseInventory(inv.slice(0, 5));
    expect(advice.length).toBeGreaterThan(0);
    expect(advice[0].packageName).toBeTruthy();
  });
});
