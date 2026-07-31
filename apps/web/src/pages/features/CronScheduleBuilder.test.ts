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

  it('parseCronToState covers all modes and edges', () => {
    expect(parseCronToState('*/10 * * * *').mode).toBe('every_n_min');
    expect(parseCronToState('*/7 * * * *').mode).toBe('custom'); // not in allowlist
    expect(parseCronToState('* * * * *').everyMinutes).toBe(1);
    expect(parseCronToState('15 * * * *').mode).toBe('hourly');
    expect(parseCronToState('0 3 * * *').mode).toBe('daily');
    expect(parseCronToState('0 9 * * 1,3,5').mode).toBe('weekly');
    expect(parseCronToState('0 2 15 * *').mode).toBe('monthly');
    expect(parseCronToState('0 0 * * 7').weekdays).toContain(0); // Sun as 7
    expect(parseCronToState('bad expr').mode).toBe('custom');
    expect(parseCronToState('0 0 * 1 *').mode).toBe('custom'); // mon fixed
    expect(parseCronToState('0 9 * * ').mode).toBe('custom'); // wrong arity
  });

  it('humanizeSchedule covers all modes', () => {
    const base = defaultScheduleState();
    const t = (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k;
    expect(humanizeSchedule({ ...base, mode: 'every_n_min', everyMinutes: 1 }, t)).toMatch(
      /everyMinute/,
    );
    expect(humanizeSchedule({ ...base, mode: 'every_n_min', everyMinutes: 10 }, t)).toMatch(
      /everyMinutes/,
    );
    expect(humanizeSchedule({ ...base, mode: 'hourly' }, t)).toMatch(/hourlyAt/);
    expect(humanizeSchedule({ ...base, mode: 'daily' }, t)).toMatch(/dailyAt/);
    expect(humanizeSchedule({ ...base, mode: 'weekly', weekdays: [] }, t)).toMatch(/weeklyNone/);
    expect(humanizeSchedule({ ...base, mode: 'weekly', weekdays: [1, 3] }, t)).toMatch(
      /weeklyAt/,
    );
    expect(humanizeSchedule({ ...base, mode: 'monthly' }, t)).toMatch(/monthlyAt/);
    expect(humanizeSchedule({ ...base, mode: 'custom', custom: '' }, t)).toMatch(/customAt/);
    expect(humanizeSchedule({ ...base, mode: 'custom', custom: '0 0 * * 0' }, t)).toMatch(
      /customAt/,
    );
  });

  it('buildCronExpr clamps and defaults', () => {
    const base = defaultScheduleState();
    expect(buildCronExpr({ ...base, mode: 'every_n_min', everyMinutes: 99 })).toBe(
      '*/5 * * * *',
    );
    expect(buildCronExpr({ ...base, mode: 'weekly', weekdays: [] })).toMatch(/\* \* 1$/);
    expect(buildCronExpr({ ...base, mode: 'custom', custom: '  ' })).toBe('0 3 * * *');
    expect(
      buildCronExpr({
        ...base,
        mode: 'daily',
        minute: 99 as never,
        hour: -1 as never,
      }),
    ).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it('buildCronExpr/humanizeSchedule default branches for unknown mode', () => {
    const base = defaultScheduleState();
    const weird = { ...base, mode: 'nope' as never };
    expect(buildCronExpr(weird)).toBe('0 3 * * *');
    const t = (k: string) => k;
    expect(humanizeSchedule(weird, t)).toBe('—');
  });
});
