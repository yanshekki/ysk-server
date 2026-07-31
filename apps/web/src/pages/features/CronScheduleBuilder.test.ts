import { describe, expect, it } from 'vitest';
import {
  buildCronExpr,
  defaultScheduleState,
  humanizeSchedule,
  parseCronToState,
} from './CronScheduleBuilder';

describe('CronScheduleBuilder pure helpers', () => {
  it('defaultScheduleState is daily at 03:00', () => {
    const s = defaultScheduleState();
    expect(s.mode).toBe('daily');
    expect(buildCronExpr(s)).toBe('0 3 * * *');
  });

  it('buildCronExpr covers modes', () => {
    const base = defaultScheduleState();
    expect(buildCronExpr({ ...base, mode: 'every_n_min', everyMinutes: 5 })).toBe(
      '*/5 * * * *',
    );
    expect(buildCronExpr({ ...base, mode: 'every_n_min', everyMinutes: 1 })).toBe(
      '* * * * *',
    );
    expect(buildCronExpr({ ...base, mode: 'hourly', minute: 15 })).toBe('15 * * * *');
    expect(buildCronExpr({ ...base, mode: 'daily', minute: 30, hour: 4 })).toBe(
      '30 4 * * *',
    );
    expect(
      buildCronExpr({ ...base, mode: 'weekly', minute: 0, hour: 9, weekdays: [1, 3, 5] }),
    ).toMatch(/^0 9 \* \* /);
    expect(
      buildCronExpr({ ...base, mode: 'monthly', minute: 0, hour: 2, dayOfMonth: 15 }),
    ).toBe('0 2 15 * *');
    expect(
      buildCronExpr({ ...base, mode: 'custom', custom: '0 0 * * 0' }),
    ).toBe('0 0 * * 0');
  });

  it('parseCronToState round-trips common expressions', () => {
    expect(parseCronToState('*/10 * * * *').mode).toBe('every_n_min');
    expect(parseCronToState('15 * * * *').mode).toBe('hourly');
    expect(parseCronToState('0 3 * * *').mode).toBe('daily');
  });

  it('humanizeSchedule returns non-empty string', () => {
    const s = defaultScheduleState();
    const h = humanizeSchedule(s);
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });
});
