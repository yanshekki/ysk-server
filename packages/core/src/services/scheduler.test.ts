import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  it('registers, lists, and stops jobs', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.every('t1', 60_000, fn, { runImmediately: true });
    // allow microtask for immediate run
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalled();
    const list = s.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('t1');
    expect(list[0].lastRunAt).toBeTruthy();
    s.stop('t1');
    expect(s.list()).toHaveLength(0);
    s.stopAll();
  });

  it('does not double-run when previous tick still running', async () => {
    const s = new Scheduler();
    let resolveGate: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });
    let entered = 0;
    s.every(
      'slow',
      10,
      async () => {
        entered += 1;
        await gate;
      },
      { runImmediately: true },
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(entered).toBe(1);
    resolveGate!();
    await new Promise((r) => setTimeout(r, 20));
    s.stopAll();
  });

  it('records lastRunAt even when fn throws', async () => {
    const s = new Scheduler();
    s.every(
      'boom',
      60_000,
      () => {
        throw new Error('nope');
      },
      { runImmediately: true },
    );
    await new Promise((r) => setTimeout(r, 20));
    const job = s.list().find((j) => j.id === 'boom');
    expect(job?.lastRunAt).toBeTruthy();
    expect(job?.running).toBe(false);
    s.stopAll();
  });

  it('touchLastRun seeds lastRunAt without running the job', () => {
    const s = new Scheduler();
    s.every('updates.scan', 60_000, () => undefined);
    expect(s.get('updates.scan')?.lastRunAt).toBeUndefined();
    s.touchLastRun('updates.scan', '2026-08-15T03:00:00.000Z');
    expect(s.get('updates.scan')?.lastRunAt).toBe('2026-08-15T03:00:00.000Z');
    s.touchLastRun('missing-job', '2026-08-15T03:00:00.000Z');
    s.stopAll();
  });
});
