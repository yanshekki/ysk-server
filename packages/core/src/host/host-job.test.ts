import { describe, expect, it, beforeEach } from 'vitest';
import { __resetHostMutatingJobForTests, withHostMutatingJob } from './host-job.js';

describe('withHostMutatingJob', () => {
  beforeEach(() => {
    __resetHostMutatingJobForTests();
  });

  it('serializes concurrent jobs (second waits for first)', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const a = withHostMutatingJob(async () => {
      order.push('a-start');
      await firstGate;
      order.push('a-end');
      return 1;
    });

    // Let a acquire the lock
    await new Promise((r) => setTimeout(r, 20));

    const b = withHostMutatingJob(async () => {
      order.push('b-start');
      order.push('b-end');
      return 2;
    });

    await new Promise((r) => setTimeout(r, 30));
    // b must not have started while a holds the lock
    expect(order).toEqual(['a-start']);

    releaseFirst();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(1);
    expect(rb).toBe(2);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('releases lock when job throws', async () => {
    await expect(
      withHostMutatingJob(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const ok = await withHostMutatingJob(async () => 'recovered');
    expect(ok).toBe('recovered');
  });
});
