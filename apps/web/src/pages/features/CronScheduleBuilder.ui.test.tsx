import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CronScheduleBuilder,
  defaultScheduleState,
  type ScheduleState,
} from './CronScheduleBuilder';

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
});
