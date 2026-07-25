/**
 * Lightweight in-process scheduler for protection probes + daily inventory hooks.
 */

export type ScheduledJob = {
  id: string;
  intervalMs: number;
  lastRunAt?: string;
  running: boolean;
};

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private jobs = new Map<string, ScheduledJob>();

  /**
   * Register a recurring job. Immediate first run optional.
   */
  every(
    id: string,
    intervalMs: number,
    fn: () => void | Promise<void>,
    opts?: { runImmediately?: boolean },
  ): void {
    this.stop(id);
    const job: ScheduledJob = { id, intervalMs, running: false };
    this.jobs.set(id, job);

    const tick = async () => {
      if (job.running) return;
      job.running = true;
      try {
        await fn();
        job.lastRunAt = new Date().toISOString();
      } catch {
        job.lastRunAt = new Date().toISOString();
      } finally {
        job.running = false;
      }
    };

    if (opts?.runImmediately) void tick();
    const handle = setInterval(() => void tick(), intervalMs);
    // unref so process can exit in tests if needed
    if (typeof handle === 'object' && 'unref' in handle) {
      (handle as NodeJS.Timeout).unref?.();
    }
    this.timers.set(id, handle);
  }

  stop(id: string): void {
    const t = this.timers.get(id);
    if (t) clearInterval(t);
    this.timers.delete(id);
    this.jobs.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.stop(id);
  }

  list(): ScheduledJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }
}
