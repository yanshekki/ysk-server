import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToastViewport } from './Toast';
import { toast } from '../../stores/toast-store';

describe('ToastViewport', () => {
  afterEach(() => {
    toast.clear();
  });

  it('renders toast messages and dismiss button', async () => {
    render(<ToastViewport />);
    act(() => {
      toast.ok('Saved hostname');
    });
    expect(await screen.findByText('Saved hostname')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      toast.error('Something broke');
    });
    expect(await screen.findByText('Something broke')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('dismisses when close clicked', async () => {
    render(<ToastViewport />);
    act(() => {
      toast.info('Closeable');
    });
    const close = await screen.findByRole('button', { name: /close/i });
    act(() => {
      close.click();
    });
    expect(screen.queryByText('Closeable')).not.toBeInTheDocument();
  });
});
