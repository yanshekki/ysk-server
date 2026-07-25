import { describe, expect, it } from 'vitest';
import { collectMetrics } from './metrics.js';

describe('collectMetrics', () => {
  it('returns load and memory snapshot', () => {
    const m = collectMetrics();
    expect(m.cpuCount).toBeGreaterThan(0);
    expect(m.memory.total).toBeGreaterThan(0);
    expect(m.loadavg).toHaveLength(3);
    expect(m.at).toBeTruthy();
  });
});
