/**
 * Human-friendly cron schedule builder → standard 5-field expression.
 */
import { useMemo } from 'react';
import { Field, FormLayout, PresetChips, SegRadio } from '../../shared/components/ui';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { bindCall1 } from '../bind-handlers';

export type ScheduleMode =
  | 'every_n_min'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

export type ScheduleState = {
  mode: ScheduleMode;
  /** every_n_min */
  everyMinutes: number;
  minute: number;
  hour: number;
  /** weekly: 0=Sun … 6=Sat */
  weekdays: number[];
  /** monthly 1–31 */
  dayOfMonth: number;
  /** custom raw */
  custom: string;
};

function weekdayDefs(t: (k: string) => string): Array<{ v: number; label: string; short: string }> {
  return [
    { v: 1, label: t('cron.mon'), short: t('cron.mon') },
    { v: 2, label: t('cron.tue'), short: t('cron.tue') },
    { v: 3, label: t('cron.wed'), short: t('cron.wed') },
    { v: 4, label: t('cron.thu'), short: t('cron.thu') },
    { v: 5, label: t('cron.fri'), short: t('cron.fri') },
    { v: 6, label: t('cron.sat'), short: t('cron.sat') },
    { v: 0, label: t('cron.sun'), short: t('cron.sun') },
  ];
}

function modeOptions(t: (k: string) => string): Array<{ id: ScheduleMode; label: string; hint: string }> {
  return [
    { id: 'every_n_min', label: t('cron.everyNMin'), hint: t('cron.fixedInterval') },
    { id: 'hourly', label: t('cron.hourly'), hint: t('cron.atMinute') },
    { id: 'daily', label: t('cron.daily'), hint: t('cron.atTime') },
    { id: 'weekly', label: t('cron.weekly'), hint: t('cron.weekdayTime') },
    { id: 'monthly', label: t('cron.monthly'), hint: t('cron.dayTime') },
    { id: 'custom', label: t('cron.advanced'), hint: t('cron.customExpr') },
  ];
}

export function defaultScheduleState(): ScheduleState {
  return {
    mode: 'daily',
    everyMinutes: 5,
    minute: 0,
    hour: 3,
    weekdays: [1],
    dayOfMonth: 1,
    custom: '0 3 * * *',
  };
}

export function buildCronExpr(s: ScheduleState): string {
  const m = clamp(s.minute, 0, 59);
  const h = clamp(s.hour, 0, 23);
  switch (s.mode) {
    case 'every_n_min': {
      const n = [1, 5, 10, 15, 20, 30].includes(s.everyMinutes) ? s.everyMinutes : 5;
      return n === 1 ? '* * * * *' : `*/${n} * * * *`;
    }
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly': {
      const days =
        s.weekdays.length > 0
          ? [...s.weekdays].sort((a, b) => a - b).join(',')
          : '1';
      return `${m} ${h} * * ${days}`;
    }
    case 'monthly':
      return `${m} ${h} ${clamp(s.dayOfMonth, 1, 31)} * *`;
    case 'custom':
      return s.custom.trim() || '0 3 * * *';
    default:
      return '0 3 * * *';
  }
}

export function humanizeSchedule(
  s: ScheduleState,
  t: (k: string, o?: Record<string, unknown>) => string = (k, o) => i18n.t(k, o),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(s.hour)}:${pad(s.minute)}`;
  switch (s.mode) {
    case 'every_n_min':
      return s.everyMinutes === 1 ? t('cron.everyMinute') : t('cron.everyMinutes', { n: s.everyMinutes });
    case 'hourly':
      return t('cron.hourlyAt', { n: s.minute });
    case 'daily':
      return t('cron.dailyAt', { time });
    case 'weekly': {
      if (!s.weekdays.length) return t('cron.weeklyNone', { time });
      const labels = weekdayDefs(t).filter((d) => s.weekdays.includes(d.v)).map((d) => d.label);
      return t('cron.weeklyAt', { days: labels.join('、'), time });
    }
    case 'monthly':
      return t('cron.monthlyAt', { day: s.dayOfMonth, time });
    case 'custom':
      return t('cron.customAt', { expr: s.custom.trim() || '—' });
    default:
      return '—';
  }
}

/** Best-effort parse expression into builder state */
export function parseCronToState(expr: string): ScheduleState {
  const base = defaultScheduleState();
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ...base, mode: 'custom', custom: expr };
  }
  const [min, hour, dom, mon, dow] = parts;

  if (mon !== '*') return { ...base, mode: 'custom', custom: expr };

  if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*') {
    const n = Number(min.slice(2));
    if ([1, 5, 10, 15, 20, 30].includes(n)) {
      return { ...base, mode: 'every_n_min', everyMinutes: n, custom: expr };
    }
  }
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') {
    return { ...base, mode: 'every_n_min', everyMinutes: 1, custom: expr };
  }
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && dow === '*') {
    return { ...base, mode: 'hourly', minute: Number(min), custom: expr };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow === '*') {
    return {
      ...base,
      mode: 'daily',
      minute: Number(min),
      hour: Number(hour),
      custom: expr,
    };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow !== '*') {
    const days = dow.split(',').map((x) => Number(x)).filter((n) => n >= 0 && n <= 7);
    // cron 7 = Sunday → 0
    const weekdays = days.map((d) => (d === 7 ? 0 : d));
    return {
      ...base,
      mode: 'weekly',
      minute: Number(min),
      hour: Number(hour),
      weekdays: weekdays.length ? weekdays : [1],
      custom: expr,
    };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && dow === '*') {
    return {
      ...base,
      mode: 'monthly',
      minute: Number(min),
      hour: Number(hour),
      dayOfMonth: Number(dom),
      custom: expr,
    };
  }
  return { ...base, mode: 'custom', custom: expr };
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

const MINUTE_STEPS = [0, 5, 10, 15, 20, 30, 45];
const EVERY_N = [1, 5, 10, 15, 20, 30];

export interface CronScheduleBuilderProps {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
}

export function CronScheduleBuilder({ value, onChange }: CronScheduleBuilderProps) {
  const { t } = useTranslation();
  const expr = useMemo(() => buildCronExpr(value), [value]);
  const human = useMemo(() => humanizeSchedule(value), [value]);

  const patch = (partial: Partial<ScheduleState>) => {
    const next = { ...value, ...partial };
    // keep custom field in sync when not in custom mode
    if (partial.mode !== 'custom' && next.mode !== 'custom') {
      next.custom = buildCronExpr(next);
    }
    onChange(next);
  };

  const toggleWeekday = (d: number) => {
    const set = new Set(value.weekdays);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    const weekdays = [...set].sort((a, b) => a - b);
    patch({ weekdays: weekdays.length ? weekdays : [d] });
  };

  const showTime = value.mode === 'daily' || value.mode === 'weekly' || value.mode === 'monthly';
  const showMinuteOnly = value.mode === 'hourly';

  return (
    <div className="cron-sched">
      <div className="cron-sched__modes" role="radiogroup" aria-label={t('cron.frequency')}>
        {modeOptions(t).map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value.mode === m.id}
            className={`cron-sched__mode${value.mode === m.id ? ' is-active' : ''}`}
            onClick={() => patch({ mode: m.id })}
          >
            <span className="cron-sched__mode-label">{m.label}</span>
            <span className="cron-sched__mode-hint">{m.hint}</span>
          </button>
        ))}
      </div>

      <div className="cron-sched__body">
        {value.mode === 'every_n_min' ? (
          <Field label={t('cron.interval')} htmlFor="cron-every" flush hint={t('cron.fromHour')}>
            <SegRadio
              name="cron-every"
              aria-label={t('cron.intervalMinutes')}
              value={String(value.everyMinutes)}
              onChange={(v) => patch({ everyMinutes: Number(v) })}
              options={EVERY_N.map((n) => ({
                value: String(n),
                label: n === 1 ? t('cron.min1') : t('cron.minN', { n }),
              }))}
            />
          </Field>
        ) : null}

        {showMinuteOnly ? (
          <Field label={t('cron.minuteOfHour')} htmlFor="cron-min-h" flush>
            <PresetChips
              options={MINUTE_STEPS.map((n) => ({
                value: String(n),
                label: t('cron.minPad', { n: String(n).padStart(2, '0') }),
              }))}
              value={String(value.minute)}
              onChange={(v) => patch({ minute: Number(v) || 0 })}
              allowCustom
              customPlaceholder="0–59"
            />
          </Field>
        ) : null}

        {showTime ? (
          <FormLayout columns={2}>
            <Field label={t('cron.hour')} htmlFor="cron-hour" flush>
              <PresetChips
                options={[
                  { value: '0', label: '00' },
                  { value: '1', label: '01' },
                  { value: '2', label: '02' },
                  { value: '3', label: '03' },
                  { value: '4', label: '04' },
                  { value: '6', label: '06' },
                  { value: '8', label: '08' },
                  { value: '9', label: '09' },
                  { value: '12', label: '12' },
                  { value: '18', label: '18' },
                  { value: '21', label: '21' },
                  { value: '22', label: '22' },
                  { value: '23', label: '23' },
                ]}
                value={String(value.hour)}
                onChange={(v) =>
                  patch({ hour: Math.max(0, Math.min(23, Number(v) || 0)) })
                }
                allowCustom
                customPlaceholder="0–23"
              />
            </Field>
            <Field label={t('cron.minute')} htmlFor="cron-min" flush>
              <PresetChips
                options={MINUTE_STEPS.map((n) => ({
                  value: String(n),
                  label: String(n).padStart(2, '0'),
                }))}
                value={String(value.minute)}
                onChange={(v) =>
                  patch({ minute: Math.max(0, Math.min(59, Number(v) || 0)) })
                }
                allowCustom
                customPlaceholder="0–59"
              />
            </Field>
          </FormLayout>
        ) : null}

        {value.mode === 'weekly' ? (
          <div className="cron-sched__weekdays">
            <span className="cron-sched__weekdays-label">{t('cron.weekLabel')}</span>
            <div className="cron-sched__weekday-row" role="group" aria-label={t('cron.pickWeekdays')}>
              {weekdayDefs(t).map((d) => {
                const on = value.weekdays.includes(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    className={`cron-sched__dow${on ? ' is-active' : ''}`}
                    aria-pressed={on}
                    onClick={bindCall1(toggleWeekday, d.v)}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {value.mode === 'monthly' ? (
          <Field label={t('cron.dayOfMonth')} htmlFor="cron-dom" flush hint={t('cron.dayOfMonthHint')}>
            <PresetChips
              options={[
                { value: '1', label: '1' },
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '15', label: '15' },
                { value: '20', label: '20' },
                { value: '25', label: '25' },
                { value: '28', label: '28' },
                { value: '31', label: '31' },
              ]}
              value={String(value.dayOfMonth)}
              onChange={(v) =>
                patch({ dayOfMonth: Math.max(1, Math.min(31, Number(v) || 1)) })
              }
              allowCustom
              customPlaceholder="1–31"
            />
          </Field>
        ) : null}

        {value.mode === 'custom' ? (
          <Field
            label={t('cron.cronExpr')}
            htmlFor="cron-custom"
            flush
            required
            hint={t('cron.cronExprHint')}
          >
            <input
              id="cron-custom"
              value={value.custom}
              onChange={(e) => patch({ custom: e.target.value })}
              placeholder="0 3 * * *"
              spellCheck={false}
            />
          </Field>
        ) : null}
      </div>

      <div className="cron-sched__preview" aria-live="polite">
        <div className="cron-sched__preview-human">
          <span className="cron-sched__preview-label">{t('cron.willRun')}</span>
          <strong>{human}</strong>
        </div>
        <code className="cron-sched__preview-expr" title={t('cron.cronExprPh')}>
          {expr}
        </code>
      </div>
    </div>
  );
}
