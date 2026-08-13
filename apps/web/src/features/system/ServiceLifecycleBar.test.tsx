import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ServiceLifecycleBar } from './ServiceLifecycleBar';

const serviceLifecycle = vi.fn();

vi.mock('./api', () => ({
  systemApi: {
    serviceLifecycle: (...args: unknown[]) => serviceLifecycle(...args),
    servicesMatrix: async () => ({ items: [{ id: 'vsftpd', unit: 'vsftpd' }] }),
  },
}));

vi.mock('../../shared/lib/notify', () => ({
  notifyOk: vi.fn(),
  notifyWarn: vi.fn(),
  notifyError: vi.fn(),
}));

function wrap(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ServiceLifecycleBar', () => {
  beforeEach(() => {
    serviceLifecycle.mockReset();
    serviceLifecycle.mockResolvedValue({ ok: true, notes: ['stopped'] });
  });

  it('shows stop when running and calls lifecycle after confirm', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    wrap(
      <ServiceLifecycleBar
        unit="vsftpd"
        label="vsftpd"
        installed
        running
        actions={['stop']}
        onDone={onDone}
      />,
    );
    const stopBtns = screen.getAllByRole('button', { name: /stop|停止/i });
    await user.click(stopBtns[0]!);
    const confirms = await screen.findAllByRole('button', { name: /stop|停止/i });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() => {
      expect(serviceLifecycle).toHaveBeenCalledWith({ unit: 'vsftpd', action: 'stop' });
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('hides when not installed', () => {
    wrap(
      <ServiceLifecycleBar unit="vsftpd" label="vsftpd" installed={false} running={false} />,
    );
    expect(screen.queryByRole('button', { name: /stop|停止/i })).not.toBeInTheDocument();
  });
});
