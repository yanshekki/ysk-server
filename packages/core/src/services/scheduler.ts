/**
 * Lightweight in-process scheduler for protection probes + daily inventory hooks.
 */

export type ScheduledJob = {
  id: string;
  intervalMs: number;
  lastRunAt?: string;
  /** ISO — best-effort next fire (updated after each run / reschedule) */
  nextRunAt?: string;
  running: boolean;
};

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private jobs = new Map<string, ScheduledJob>();
  /** Dynamic jobs: re-read interval after each tick */
  private dynamicFns = new Map<
    string,
    { fn: () => void | Promise<void>; getIntervalMs: () => number }
  >();

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
    const job: ScheduledJob = {
      id,
      intervalMs,
      running: false,
      nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
    };
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
        job.nextRunAt = new Date(Date.now() + job.intervalMs).toISOString();
      }
    };

    if (opts?.runImmediately) void tick();
    const handle = setInterval(() => void tick(), intervalMs);
    if (typeof handle === 'object' && 'unref' in handle) {
      (handle as NodeJS.Timeout).unref?.();
    }
    this.timers.set(id, handle);
  }

  /**
   * Recurring job whose interval is re-read after every tick (e.g. panel-tunable).
   */
  everyDynamic(
    id: string,
    getIntervalMs: () => number,
    fn: () => void | Promise<void>,
    opts?: { runImmediately?: boolean; /** Max interval clamp (default 7d; was 10m). */ maxIntervalMs?: number },
  ): void {
    this.stop(id);
    this.dynamicFns.set(id, { fn, getIntervalMs });
    const maxMs = opts?.maxIntervalMs ?? 7 * 24 * 60 * 60_000;
    const clamp = (raw: number) =>
      Math.max(5_000, Math.min(maxMs, Number.isFinite(raw) && raw > 0 ? raw : 120_000));
    const arm = (runNow: boolean) => {
      const ms = clamp(getIntervalMs() || 120_000);
      const job: ScheduledJob = {
        id,
        intervalMs: ms,
        running: false,
        nextRunAt: new Date(Date.now() + (runNow ? 0 : ms)).toISOString(),
        lastRunAt: this.jobs.get(id)?.lastRunAt,
      };
      this.jobs.set(id, job);
      const prev = this.timers.get(id);
      if (prev) clearInterval(prev);

      const tick = async () => {
        const j = this.jobs.get(id);
        if (!j || j.running) return;
        j.running = true;
        try {
          await fn();
          j.lastRunAt = new Date().toISOString();
        } catch {
          j.lastRunAt = new Date().toISOString();
        } finally {
          j.running = false;
          // re-arm with latest interval
          const nextMs = clamp(getIntervalMs() || 120_000);
          j.intervalMs = nextMs;
          j.nextRunAt = new Date(Date.now() + nextMs).toISOString();
          const old = this.timers.get(id);
          if (old) clearInterval(old);
          const h = setInterval(() => void tick(), nextMs);
          if (typeof h === 'object' && 'unref' in h) (h as NodeJS.Timeout).unref?.();
          this.timers.set(id, h);
        }
      };

      if (runNow) void tick();
      else {
        const h = setInterval(() => void tick(), ms);
        if (typeof h === 'object' && 'unref' in h) (h as NodeJS.Timeout).unref?.();
        this.timers.set(id, h);
      }
    };
    arm(Boolean(opts?.runImmediately));
  }

  stop(id: string): void {
    const t = this.timers.get(id);
    if (t) clearInterval(t);
    this.timers.delete(id);
    this.jobs.delete(id);
    this.dynamicFns.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.stop(id);
  }

  list(): ScheduledJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }

  get(id: string): ScheduledJob | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j } : undefined;
  }

  /**
   * Record that work matching this job already happened (manual scan,
   * persisted last_inventory, etc.) so the schedule list is not “never run”.
   */
  touchLastRun(id: string, at?: string): void {
    const j = this.jobs.get(id);
    if (!j) return;
    const iso = at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString();
    j.lastRunAt = iso;
  }
}
