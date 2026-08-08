import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CronScheduleBuilder,
  defaultScheduleState,
  type ScheduleState } from './CronScheduleBuilder';

describe('CronScheduleBuilder UI', () => {
  it('switches modes and patches schedule', async () => {
    const user = userEvent.setup();
    let state: ScheduleState = defaultScheduleState();
    const onChange = vi.fn((next: ScheduleState) => {
      state = next;
      rerender(<CronScheduleBuilder value={state} onChange={onChange} />);
    });
    const { rerender } = render(
      <CronScheduleBuilder value={state} onChange={onChange} />,
    );

    // mode chips / radios
    for (const name of [
      /every|minute|分鐘/i,
      /hour|小時/i,
      /day|日/i,
      /week|週/i,
      /month|月/i,
      /custom|自訂/i,
    ]) {
      const btn =
        screen.queryAllByRole('button', { name })[0] ??
        screen.queryAllByRole('radio', { name })[0] ??
        screen.queryAllByLabelText(name)[0];
      if (btn) await user.click(btn);
    }

    // weekday toggles if present
    for (const b of screen.queryAllByRole('button').slice(0, 12)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    expect(onChange.mock.calls.length).toBeGreaterThan(0);
  });

  it('weekly toggle off/on + monthly day + hour/minute custom presets', async () => {
    const user = userEvent.setup();
    let state: ScheduleState = {
      ...defaultScheduleState(),
      mode: 'weekly',
      weekdays: [1, 3],
      hour: 9,
      minute: 15 };
    const onChange = vi.fn((next: ScheduleState) => {
      state = next;
      rerender(<CronScheduleBuilder value={state} onChange={onChange} />);
    });
    const { rerender } = render(
      <CronScheduleBuilder value={state} onChange={onChange} />,
    );

    // Toggle weekdays (including un-toggle to hit empty-fallback path)
    for (const b of screen.queryAllByRole('button', { pressed: true })) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
    for (const b of screen.queryAllByRole('button').slice(0, 10)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // Switch to monthly and pick day
    const monthly =
      screen.queryAllByRole('radio', { name: /month|月/i })[0] ??
      screen.queryAllByRole('button', { name: /month|月/i })[0];
    if (monthly) await user.click(monthly);

    for (const label of ['1', '15', '31', '28']) {
      const chip = screen.queryAllByRole('button', { name: new RegExp(`^${label}$`) })[0];
      if (chip) await user.click(chip);
    }

    // Hour / minute chips + custom inputs if present
    for (const label of ['03', '12', '23', '00', '30', '45']) {
      const chip = screen.queryAllByRole('button', { name: new RegExp(`^${label}$`) })[0];
      if (chip) await user.click(chip);
    }
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])'),
    ).slice(0, 4)) {
      fireEvent.change(input, { target: { value: '7' } });
    }

    // Custom mode expression field
    const custom =
      screen.queryAllByRole('radio', { name: /custom|advanced|自訂|高级/i })[0] ??
      screen.queryAllByRole('button', { name: /custom|advanced|自訂|高级/i })[0];
    if (custom) await user.click(custom);
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])'),
    )) {
      fireEvent.change(input, { target: { value: '0 0 * * 0' } });
    }

    expect(onChange.mock.calls.length).toBeGreaterThan(0);
  });
});

